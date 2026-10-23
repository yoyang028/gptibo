import { skuName, type HanfolkDetail } from '../../shared/hanfolk-catalog.ts'
import type { InventoryMonitor, RemovalReview, SyncChange, SyncRun } from '../../shared/inventory-sync.ts'
import { ApiError, type Env } from '../platform.ts'
import { syncOptions } from './sync.ts'

export async function inventoryMonitor(env: Env, url: URL): Promise<InventoryMonitor> {
  const page = Math.max(1, Math.min(10000, Number(url.searchParams.get('page')) || 1))
  const historyPage = Math.max(1, Math.min(100000, Number(url.searchParams.get('historyPage')) || 1))
  if (!Number.isSafeInteger(page) || !Number.isSafeInteger(historyPage)) throw new ApiError('记录页码无效。')
  const db = env.INTEREST_DB
  const [options, count, runs, changes, cached, linked, removed, historyCount, history] = await Promise.all([
    syncOptions(env), db.prepare('SELECT COUNT(*) total FROM hanfolk_sync_runs').first<{total: number}>(),
    db.prepare('SELECT * FROM hanfolk_sync_runs ORDER BY started_at DESC,id DESC LIMIT 20 OFFSET ?').bind((page - 1) * 20).all<SyncRun>(),
    db.prepare('SELECT * FROM hanfolk_sync_changes WHERE run_id IN (SELECT id FROM hanfolk_sync_runs ORDER BY started_at DESC,id DESC LIMIT 20 OFFSET ?) ORDER BY created_at DESC,id DESC LIMIT 200').bind((page - 1) * 20).all<SyncChange>(),
    db.prepare("SELECT detail FROM hanfolk_catalog WHERE key_hash=(SELECT key_hash FROM hanfolk_settings WHERE id='main') AND detail IS NOT NULL").all<{detail: string}>(),
    db.prepare('SELECT product_id,sku FROM hanfolk_product_links').all<{product_id: number; sku: string}>(),
    db.prepare("SELECT p.id,json_extract(p.public_json,'$.name') name,l.product_id productId,l.sku,p.version,i.checked_at checkedAt FROM hanfolk_inventory i JOIN shop_products p ON p.id=i.local_id JOIN hanfolk_product_links l ON l.local_id=p.id WHERE i.source_state='removed' AND json_extract(p.public_json,'$.status')<>'archived' AND i.key_hash=(SELECT key_hash FROM hanfolk_settings WHERE id='main') ORDER BY i.checked_at DESC,p.id").all<RemovalReview>(),
    db.prepare('SELECT COUNT(*) total FROM hanfolk_sync_changes').first<{total: number}>(),
    db.prepare('SELECT * FROM hanfolk_sync_changes ORDER BY created_at DESC,id DESC LIMIT 30 OFFSET ?').bind((historyPage - 1) * 30).all<SyncChange>(),
  ])
  const known = new Set(linked.results.map(r => r.product_id + ':' + r.sku))
  const pendingNew = cached.results.flatMap(r => {
    const product = JSON.parse(r.detail) as HanfolkDetail
    return product.sku_variants.filter(v => !known.has(product.id + ':' + v.sku)).map(v => ({ productId: product.id, sku: v.sku, name: product.title + (product.is_sku ? ' · ' + skuName(product, v.sku) : ''), stock: v.stock }))
  })
  return { options, page, total: count?.total ?? 0, runs: runs.results, changes: changes.results, pendingNew, pendingRemoval: removed.results, historyPage, historyTotal: historyCount?.total ?? 0, history: history.results }
}

export async function saveSyncOptions(env: Env, data: Record<string, unknown>) {
  if (typeof data.enabled !== 'boolean' || ![5, 10, 30].includes(Number(data.intervalMinutes)) || typeof data.intervalMinutes !== 'number' || !Number.isSafeInteger(data.syncVersion))
    throw new ApiError('请选择有效的库存同步设置。')
  const event = crypto.randomUUID(), db = env.INTEREST_DB
  // A unique marker makes the settings CAS and audit one atomic operation.
  await db.batch([
    db.prepare("UPDATE hanfolk_sync_settings SET enabled=?,interval_minutes=?,version=version+1,change_id=? WHERE id='main' AND version=?")
      .bind(Number(data.enabled), data.intervalMinutes, event, Number(data.syncVersion)),
    db.prepare("INSERT INTO admin_audit(id,target_id,action,note,created_at) SELECT ?,'hanfolk','inventory-sync-settings',?,? WHERE EXISTS(SELECT 1 FROM hanfolk_sync_settings WHERE change_id=?)")
      .bind(event, JSON.stringify({ enabled: data.enabled, intervalMinutes: data.intervalMinutes }), Date.now(), event),
  ])
  if (!(await db.prepare('SELECT id FROM admin_audit WHERE id=?').bind(event).first())) throw new ApiError('同步设置已变化，请刷新。', 409)
}

export async function confirmRemoval(env: Env, data: Record<string, unknown>) {
  if (data.confirmed !== true || typeof data.productId !== 'string' || !Number.isSafeInteger(data.productVersion) || !Number.isSafeInteger(data.checkedAt))
    throw new ApiError('请确认需要下架的具体规格。')
  const event = crypto.randomUUID(), now = Date.now(), db = env.INTEREST_DB
  await db.batch([
    db.prepare("UPDATE shop_products SET public_json=json_set(public_json,'$.status','archived'),version=version+1,updated_at=?,change_id=? WHERE id=? AND version=? AND EXISTS(SELECT 1 FROM hanfolk_inventory i JOIN hanfolk_settings s ON s.id='main' WHERE i.local_id=shop_products.id AND i.source_state='removed' AND i.checked_at=? AND i.key_hash=s.key_hash)")
      .bind(now, event, data.productId, Number(data.productVersion), Number(data.checkedAt)),
    db.prepare('UPDATE catalog_plans SET enabled=0,partner_enabled=0,version=version+1,updated_at=? WHERE id=? AND EXISTS(SELECT 1 FROM shop_products WHERE id=? AND change_id=?)').bind(now, data.productId, data.productId, event),
    db.prepare("INSERT INTO admin_audit(id,target_id,action,note,created_at) SELECT ?,id,'inventory-owner-archive','店主确认上游移除规格下架；保留价格、详情与关联',? FROM shop_products WHERE id=? AND change_id=?").bind(event, now, data.productId, event),
  ])
  if (!(await db.prepare('SELECT id FROM admin_audit WHERE id=?').bind(event).first())) throw new ApiError('规格或上游状态已变化，请重新确认。', 409)
}
