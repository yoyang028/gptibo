import { hanfolkFamily, hanfolkMoney, skuName, type HanfolkDetail } from '../../shared/hanfolk-catalog.ts'
import type { SyncOptions } from '../../shared/inventory-sync.ts'
import { ApiError, type Env, type Statement } from '../platform.ts'
import { unseal } from '../product-secrets.ts'
import { HanfolkClient, HanfolkError } from './client.ts'
import { hanfolkSettings } from './settings.ts'

type SyncRow = { enabled: number; interval_minutes: 5 | 10 | 30; version: number; last_attempt_at: number; consecutive_failures: number; last_error: string; lease_until: number; lease_token: string }
type Link = { local_id: string; product_id: number; sku: string; public_json: string }
type Inventory = { local_id: string; stock: number; source_state: string; key_hash: string }
export async function syncOptions(env: Env): Promise<SyncOptions> {
  const [row, settings] = await Promise.all([
    env.INTEREST_DB.prepare("SELECT * FROM hanfolk_sync_settings WHERE id='main'").first<SyncRow>(), hanfolkSettings(env),
  ])
  if (!row) throw new ApiError('库存监测数据库尚未迁移。', 503)
  return { enabled: Boolean(row.enabled), intervalMinutes: row.interval_minutes, version: row.version, lastAttemptAt: row.last_attempt_at, lastSuccessAt: settings.checked_at, consecutiveFailures: row.consecutive_failures, lastError: row.last_error, running: row.lease_until > Date.now() }
}

/** Complete, validated GET reads commit together. Owner configuration is immutable here. */
export async function refreshHanfolkStock(env: Env, trigger: 'manual' | 'scheduled' = 'scheduled') {
  const [settings, options] = await Promise.all([hanfolkSettings(env), syncOptions(env)])
  const started = Date.now(), id = crypto.randomUUID(), db = env.INTEREST_DB
  if (!settings.api_secret) {
    if (trigger === 'manual') throw new ApiError('请先保存 Daju API Key。', 409)
    return false
  }
  if (trigger === 'scheduled' && (!options.enabled || options.lastAttemptAt > started - options.intervalMinutes * 60_000)) return false
  await db.prepare("UPDATE hanfolk_sync_settings SET lease_token=?,lease_until=?,last_attempt_at=? WHERE id='main' AND lease_until<=? AND version=? AND (?='manual' OR (enabled=1 AND last_attempt_at<=?-interval_minutes*60000))")
    .bind(id, started + 180_000, started, started, options.version, trigger, started).run()
  const lease = await db.prepare("SELECT lease_token FROM hanfolk_sync_settings WHERE id='main'").first<{lease_token: string}>()
  if (lease?.lease_token !== id) {
    if (trigger === 'manual') throw new ApiError('已有库存同步正在进行，请稍后刷新记录。', 409)
    return false
  }
  await db.batch([
    db.prepare("UPDATE hanfolk_sync_runs SET status='failed',finished_at=?,error='同步执行超时，请重试' WHERE status='running' AND started_at<?").bind(started, started - 180_000),
    db.prepare("INSERT INTO hanfolk_sync_runs(id,trigger,status,started_at) VALUES(?,?,'running',?)").bind(id, trigger, started),
  ])
  try {
    const client = new HanfolkClient(env, await unseal(env, settings.api_secret))
    const balance = await client.balance()
    const products = (await client.products()).filter(p => hanfolkFamily(p.title))
    const details: HanfolkDetail[] = []
    for (let start = 0; start < products.length; start += 4)
      details.push(...await Promise.all(products.slice(start, start + 4).map(p => client.detail(p.id))))
    const now = Date.now()
    const [cached, linked, inventory] = await Promise.all([
      db.prepare('SELECT detail FROM hanfolk_catalog WHERE key_hash=? AND detail IS NOT NULL').bind(settings.key_hash).all<{detail: string}>(),
      db.prepare('SELECT l.local_id,l.product_id,l.sku,p.public_json FROM hanfolk_product_links l JOIN shop_products p ON p.id=l.local_id').all<Link>(),
      db.prepare('SELECT local_id,stock,source_state,key_hash FROM hanfolk_inventory').all<Inventory>(),
    ])
    const oldDetails = new Map(cached.results.map(r => { const p = JSON.parse(r.detail) as HanfolkDetail; return [p.id, p] }))
    const fresh = new Map(details.map(p => [p.id, p]))
    const inventories = new Map(inventory.results.filter(r => r.key_hash === settings.key_hash).map(r => [r.local_id, r]))
    const links = new Map(linked.results.map(r => [r.product_id + ':' + r.sku, r]))
    const changes: Statement[] = [], snapshots: Statement[] = []
    const valid = "EXISTS(SELECT 1 FROM hanfolk_settings WHERE change_id=?)"
    function change(productId: number, sku: string, name: string, kind: string, before: number | null, after: number | null, oldCost: number | null, newCost: number | null, localId: string | null) {
      changes.push(db.prepare(`INSERT INTO hanfolk_sync_changes(id,run_id,local_id,product_id,sku,name,kind,before_stock,after_stock,before_cost,after_cost,created_at) SELECT ?,?,?,?,?,?,?,?,?,?,?,? WHERE ${valid}`)
        .bind(crypto.randomUUID(), id, localId, productId, sku, name.slice(0, 300), kind, before, after, oldCost, newCost, now, id))
    }
    for (const p of details) for (const variant of p.sku_variants) {
      const prior = oldDetails.get(p.id)?.sku_variants.find(v => v.sku === variant.sku)
      const link = links.get(p.id + ':' + variant.sku)
      const name = p.title + (p.is_sku ? ' · ' + skuName(p, variant.sku) : '')
      if (!prior && !link) change(p.id, variant.sku, name, 'new', null, variant.stock, null, hanfolkMoney(variant.price), null)
      if (!link && prior && prior.stock !== variant.stock) change(p.id, variant.sku, name, prior.stock === 0 && variant.stock > 0 ? 'restocked' : 'stock', prior.stock, variant.stock, null, null, null)
      if (prior && hanfolkMoney(prior.price) !== hanfolkMoney(variant.price)) change(p.id, variant.sku, name, 'price', prior.stock, variant.stock, hanfolkMoney(prior.price), hanfolkMoney(variant.price), link?.local_id ?? null)
    }
    for (const link of linked.results) {
      const source = fresh.get(link.product_id), variant = source?.sku_variants.find(v => v.sku === link.sku)
      const state = !variant ? 'removed' : variant.stock > 0 ? 'available' : 'replenishing'
      const previous = inventories.get(link.local_id)
      const cachedVariant = oldDetails.get(link.product_id)?.sku_variants.find(v => v.sku === link.sku)
      const before = previous?.stock ?? cachedVariant?.stock ?? null, after = variant?.stock ?? 0
      const name = String(JSON.parse(link.public_json).name)
      if (state === 'removed' && previous?.source_state !== 'removed') change(link.product_id, link.sku, name, 'removed', before, 0, null, null, link.local_id)
      else if (variant && (before !== after || previous?.source_state === 'removed')) change(link.product_id, link.sku, name, after > 0 && (before === 0 || previous?.source_state === 'removed') ? 'restocked' : 'stock', before, after, null, null, link.local_id)
      snapshots.push(db.prepare(`INSERT INTO hanfolk_inventory(local_id,stock,source_state,checked_at,key_hash) SELECT ?,?,?,?,? WHERE ${valid} ON CONFLICT(local_id) DO UPDATE SET stock=excluded.stock,source_state=excluded.source_state,checked_at=excluded.checked_at,key_hash=excluded.key_hash`)
        .bind(link.local_id, after, state, now, settings.key_hash, id))
    }
    await db.batch([
      db.prepare("UPDATE hanfolk_settings SET checked_key_hash=key_hash,balance_cents=?,checked_at=?,version=version+1,change_id=? WHERE id='main' AND version=? AND key_hash=? AND EXISTS(SELECT 1 FROM hanfolk_sync_settings WHERE lease_token=? AND lease_until>?)")
        .bind(balance.balanceCents, now, id, settings.version, settings.key_hash, id, now),
      ...details.map(p => db.prepare(`INSERT INTO hanfolk_catalog(product_id,summary,detail,key_hash,checked_at) SELECT ?,?,?,?,? WHERE ${valid} ON CONFLICT(product_id) DO UPDATE SET summary=excluded.summary,detail=excluded.detail,key_hash=excluded.key_hash,checked_at=excluded.checked_at`)
        .bind(p.id, JSON.stringify(p), JSON.stringify(p), settings.key_hash, now, id)),
      db.prepare(`DELETE FROM hanfolk_catalog WHERE (key_hash<>? OR checked_at<>?) AND ${valid}`).bind(settings.key_hash, now, id),
      ...snapshots, ...changes,
      db.prepare(`UPDATE hanfolk_sync_runs SET status='success',finished_at=?,product_count=?,variant_count=?,change_count=? WHERE id=? AND ${valid}`)
        .bind(now, details.length, details.reduce((sum, p) => sum + p.sku_variants.length, 0), changes.length, id, id),
      db.prepare(`UPDATE hanfolk_sync_settings SET consecutive_failures=0,last_error='' WHERE lease_token=? AND ${valid}`).bind(id, id),
      db.prepare(`INSERT INTO admin_audit(id,target_id,action,note,created_at) SELECT ?,'hanfolk','hanfolk-refresh','库存监测完成；缺货保留展示，新增和移除待店主确认；未采购',? WHERE ${valid}`).bind(id, now, id),
      db.prepare("DELETE FROM hanfolk_sync_runs WHERE status<>'running' AND started_at<?").bind(now - 30 * 86400_000),
      db.prepare('DELETE FROM hanfolk_sync_changes WHERE created_at<?').bind(now - 90 * 86400_000),
    ])
    const run = await db.prepare('SELECT status FROM hanfolk_sync_runs WHERE id=?').bind(id).first<{status: string}>()
    if (run?.status !== 'success') {
      await db.prepare("UPDATE hanfolk_sync_runs SET status='superseded',finished_at=?,error='配置已变化，本次结果未应用' WHERE id=?").bind(now, id).run()
      throw new ApiError('同步期间配置已变化，请重新同步。', 409)
    }
    return true
  } catch (error) {
    const message = error instanceof HanfolkError ? error.message : error instanceof ApiError && error.status === 409 ? '配置已变化，请刷新后重试' : '库存同步暂时失败，已保留上次有效库存'
    await db.batch([
      db.prepare("UPDATE hanfolk_sync_runs SET status='failed',finished_at=?,error=? WHERE id=? AND status='running'").bind(Date.now(), message, id),
      db.prepare("UPDATE hanfolk_sync_settings SET consecutive_failures=consecutive_failures+1,last_error=? WHERE lease_token=?").bind(message, id),
    ])
    throw error instanceof ApiError ? error : new ApiError(message, error instanceof HanfolkError && error.code === 'AUTH' ? 409 : 503)
  } finally {
    await db.prepare("UPDATE hanfolk_sync_settings SET lease_token='',lease_until=0 WHERE lease_token=?").bind(id).run()
  }
}
