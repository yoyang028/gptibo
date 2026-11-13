import { ApiError, body, json, type Env, type Statement } from './platform.ts'
import { ownerShop, ownerShopRoutes, ownerSupplyPrices, ownerProductIds } from './owner-shop.ts'
import { ownerStoreOffer } from './owner-store-prices.ts'
import { supportContactsSettings } from './support-contacts.ts'
import { safeImage, hasControlCharacters } from '../shared/shop-products.ts'
import { emailValue } from './partner-auth.ts'
import { visitorSummary } from './visitors.ts'
import { ownerStorefrontLinks } from './storefront-hosts.ts'

const fields: Record<string, number> = { name: 80, brandName: 32, logo: 400000, pageTitle: 120, headline: 120, description: 500, wechat: 64, qq: 20, email: 254, announcementTitle: 100, announcement: 2000 }
const syncFields = new Set([...Object.keys(fields), 'active', 'announcementPlacement', 'productIds', 'hiddenProductIds', 'orderCompletedEmail'])
function validate(patch: Record<string, unknown>) {
  for (const [key, value] of Object.entries(patch)) {
    if (key in fields && (typeof value !== 'string' || value.length > fields[key] || hasControlCharacters(value))) throw new ApiError('店铺参数格式或长度无效。')
  }
  if ('name' in patch && !String(patch.name).trim()) throw new ApiError('店铺名称不能为空。')
  if ('logo' in patch && !safeImage(String(patch.logo))) throw new ApiError('请上传有效 Logo。')
  if (patch.email) emailValue(patch.email)
  if (patch.qq && !/^\d{5,20}$/.test(String(patch.qq))) throw new ApiError('QQ 号无效。')
  if ('active' in patch && typeof patch.active !== 'boolean') throw new ApiError('营业状态无效。')
  if ('orderCompletedEmail' in patch && typeof patch.orderCompletedEmail !== 'boolean') throw new ApiError('订单通知状态无效。')
  if ('announcementPlacement' in patch && !['home','product','both'].includes(String(patch.announcementPlacement))) throw new ApiError('公告位置无效。')
}
async function allStores(env: Env) {
  return (await env.INTEREST_DB.prepare('SELECT id,slug,slot,version FROM owner_shop_settings ORDER BY slot').all<{ id: string; slug: string; slot: number; version: number }>()).results
}
async function storedSettings(env: Env, id: string) {
  const settings = await ownerShop(env, id)
  return id === 'platform' ? { ...settings, ...(await supportContactsSettings(env)).contacts } : settings
}
async function prices(env: Env, storeId: string) {
  return (await env.INTEREST_DB.prepare(`SELECT c.id plan,c.name,c.product_id,COALESCE(p.price_cents,c.price_cents) price_cents,
    COALESCE(p.enabled,c.enabled) enabled,CASE WHEN ?='platform' THEN c.version ELSE COALESCE(p.version,0) END version,c.version catalog_version
    FROM catalog_plans c LEFT JOIN owner_store_prices p ON p.plan=c.id AND p.store_id=?
    WHERE NOT EXISTS(SELECT 1 FROM catalog_deletions d WHERE d.plan_id=c.id)
    AND NOT EXISTS(SELECT 1 FROM shop_products sp WHERE sp.id=c.id AND (json_extract(sp.public_json,'$.status')='archived' OR json_extract(sp.public_json,'$.pricePending')=1)) ORDER BY c.rowid`).bind(storeId, storeId).all<{ plan: string; name: string; product_id: string; price_cents: number; enabled: number; version: number; catalog_version: number }>()).results
}
async function commitSettings(env: Env, expected: { id: string; version: number; prices?: unknown[] }[], writes: Statement[], id: string) {
  try {
    await env.INTEREST_DB.batch([
      env.INTEREST_DB.prepare('INSERT INTO owner_store_edits(id,expected,created_at) VALUES(?,?,?)').bind(id, JSON.stringify(expected), Date.now()),
      ...writes,
      env.INTEREST_DB.prepare("INSERT INTO admin_audit(id,target_id,action,note,created_at) VALUES(?,'owner-stores','owner-stores-update','更新所选自营店铺参数',?)").bind(id, Date.now()),
    ])
  } catch (error) {
    if (String(error).includes('store version conflict')) throw new ApiError('店铺或价格已更新，请刷新后重新确认；本次未写入任何店铺。', 409)
    throw error
  }
}

export async function ownerStorefrontRoutes(request: Request, env: Env, url: URL): Promise<Response> {
  const suffix = url.pathname.slice('/api/admin/my-shop'.length), db = env.INTEREST_DB
  if (/^\/prices\/[a-z0-9-]+$/.test(suffix) && request.method === 'POST' && url.searchParams.get('store') && url.searchParams.get('store') !== 'platform') {
    const storeId = url.searchParams.get('store')!, plan = suffix.split('/').at(-1)!
    await ownerShop(env, storeId)
    const offer = await ownerStoreOffer(env, storeId, plan), data = await body(request)
    return ownerStorefrontRoutes(new Request(new URL('/api/admin/my-shop/stores/prices', url), { method: 'POST', headers: request.headers, body: JSON.stringify({ ...data, storeId, plan, enabled: Boolean(offer.enabled) }) }), env, new URL('/api/admin/my-shop/stores/prices', url))
  }
  if (suffix === '/stores' && request.method === 'GET') {
    const base = await (await ownerShopRoutes(request, env, url)).json() as { stores: unknown[]; prices: unknown[]; [key: string]: unknown }
    const stores = await allStores(env)
    const costs = Object.fromEntries((base.prices as { plan: string; cost_known: boolean; cost_cents: number }[]).filter(p => p.cost_known).map(p => [p.plan, p.cost_cents]))
    for (const record of stores.filter(s => s.id !== 'platform')) {
      const [settings, rows, stats, visits] = await Promise.all([
        storedSettings(env, record.id), prices(env, record.id),
        db.prepare("SELECT COUNT(*) order_count,COALESCE(SUM(CASE WHEN o.mode='live' AND o.payment_status='paid' AND o.status='success' AND o.refund_hold=0 AND COALESCE(r.supply_cents,o.cost_cents) IS NOT NULL THEN MAX(0,o.price_cents-MAX(o.refunded_cents,COALESCE(r.refunded_cents,0))-COALESCE(r.supply_cents,o.cost_cents,0)) ELSE 0 END),0) earned_cents FROM orders o LEFT JOIN recharge_orders r ON r.order_id=o.id WHERE o.partner_id IS NULL AND o.owner_store_id=? AND o.is_test=0").bind(record.id).first<Record<string, number>>(),
        visitorSummary(env, new URL('?days=30', url), record.id),
      ])
      base.stores.push({ ...record, name: settings.name, active: settings.active, settings, ...stats, visitors: visits.visitors })
      base.prices.push(...rows.map(p => ({ ...p, store_id: record.id, enabled: Boolean(p.enabled), cost_cents: costs[p.plan] ?? 0, cost_known: costs[p.plan] != null, child_cost_cents: null, supply_version: p.catalog_version })))
    }
    base.stores = (base.stores as { id: string; slug: string }[]).map(store => ({ ...store, ...ownerStorefrontLinks(env, url.origin, store.id, store.slug) }))
    return json({ ...base, capabilities: { maxStores: 3, bulkSettings: true } })
  }
  if (suffix === '/domain' && request.method === 'GET') {
    const domains = (await allStores(env)).flatMap(store => {
      const links = ownerStorefrontLinks(env, url.origin, store.id, store.slug)
      return links.domains.map(hostname => ({
        id: store.id + ':' + hostname, storeId: store.id, hostname,
        url: store.id === 'platform' ? links.storefront_url : 'https://' + hostname + '/',
        free: true, state: 'active', message: '该域名对应当前店铺，店铺共用统一管理后台。',
        billingState: 'paid', expiresAt: null, billingVersion: 0, records: [],
      }))
    })
    return json({ enabled: true, eligible: true, completedOrders: 0, requiredOrders: 0, monthlyFeeCents: 0, managed: true, domains })
  }
  if (suffix === '/stores/bulk' && request.method === 'POST') {
    const data = await body(request, 32768), stores = await allStores(env)
    if (!Array.isArray(data.targets) || !data.targets.length || data.targets.length > 3 || new Set(data.targets.map(t => t.id)).size !== data.targets.length || !Array.isArray(data.fields) || data.fields.some(f => typeof f !== 'string' || !syncFields.has(f)) || (!data.fields.length && data.prices !== true)) throw new ApiError('请选择目标店铺和要同步的参数。')
    const source = stores.find(s => s.id === data.sourceId)
    if (!source || source.version !== data.sourceVersion || data.targets.some(t => !stores.some(s => s.id === t.id && s.version === t.version))) throw new ApiError('店铺版本已变化，请刷新后重新选择。', 409)
    const original = await storedSettings(env, source.id)
    const patch = Object.fromEntries(data.fields.map(k => [k, (original as unknown as Record<string, unknown>)[k] ?? '']))
    validate(patch)
    const id = crypto.randomUUID(), expected = [source, ...data.targets.filter(t => t.id !== source.id)] as { id: string; version: number; prices?: unknown[] }[]
    const writes: Statement[] = []
    let sourcePrices: Awaited<ReturnType<typeof prices>> = []
    if (data.prices === true) {
      sourcePrices = await prices(env, source.id)
      const costs = await ownerSupplyPrices(env)
      for (const p of sourcePrices) if (p.price_cents < Math.max(costs[p.plan] ?? 1, await (await import('./shop-products.ts')).customRetailFloor(env, p.plan))) throw new ApiError('部分售价低于当前供货成本，请先调整源店铺售价。')
      for (const s of expected) s.prices = (await prices(env, s.id)).map(p => ({ plan: p.plan, version: p.version, catalogVersion: p.catalog_version }))
    }
    for (const target of data.targets) {
      const settings = await storedSettings(env, target.id)
      writes.push(db.prepare('UPDATE owner_shop_settings SET settings=?,version=version+1,change_id=?,updated_at=? WHERE id=?').bind(JSON.stringify({ ...settings, ...patch, ...(patch.orderCompletedEmail === true && !settings.orderCompletedEmail ? { notificationsSince: Date.now() } : {}), version: undefined }), id, Date.now(), target.id))
      if (target.id === 'platform' && data.fields.some(k => ['wechat','qq','email'].includes(k))) {
        const contacts = { ...(await supportContactsSettings(env)).contacts, ...patch }
        writes.push(db.prepare("INSERT INTO support_contacts(owner,partner_id,wechat,qq,email,version,change_id,updated_at) VALUES('platform',NULL,?,?,?,1,?,?) ON CONFLICT(owner) DO UPDATE SET wechat=excluded.wechat,qq=excluded.qq,email=excluded.email,version=support_contacts.version+1,change_id=excluded.change_id,updated_at=excluded.updated_at").bind(String(contacts.wechat), String(contacts.qq), String(contacts.email), id, Date.now()))
      }
      for (const p of sourcePrices) {
        writes.push(target.id === 'platform'
          ? db.prepare('UPDATE catalog_plans SET price_cents=?,enabled=?,version=version+1,updated_at=? WHERE id=?').bind(p.price_cents, p.enabled, Date.now(), p.plan)
          : db.prepare('INSERT INTO owner_store_prices(store_id,plan,price_cents,enabled,change_id) VALUES(?,?,?,?,?) ON CONFLICT(store_id,plan) DO UPDATE SET price_cents=excluded.price_cents,enabled=excluded.enabled,version=owner_store_prices.version+1,change_id=excluded.change_id').bind(target.id, p.plan, p.price_cents, p.enabled, id))
      }
    }
    await commitSettings(env, expected, writes, id)
    return json({ ok: true, updated: data.targets.map(t => t.id) })
  }
  if (suffix === '/stores' && request.method === 'POST') {
    const data = await body(request, 500000)
    if (data.id === 'platform') return ownerShopRoutes(new Request(request.url, { method: 'POST', headers: request.headers, body: JSON.stringify(data) }), env, url)
    const stores = await allStores(env), store = stores.find(s => s.id === data.id)
    if (!store) throw new ApiError('店铺不存在。', 404)
    if (!data.settings || typeof data.settings !== 'object' || Array.isArray(data.settings) || typeof data.active !== 'boolean') throw new ApiError('店铺设置无效。')
    if (data.version !== store.version) throw new ApiError('店铺已更新，请刷新。', 409)
    const raw = data.settings as Record<string, unknown>
    const patch = { ...Object.fromEntries(Object.keys(fields).filter(k => k !== 'name').map(k => [k, raw[k] ?? ''])), name: data.name, active: data.active, announcementPlacement: raw.announcementPlacement ?? 'both' }
    validate(patch)
    const current = await ownerShop(env, store.id), id = crypto.randomUUID()
    await commitSettings(env, [store], [db.prepare('UPDATE owner_shop_settings SET settings=?,version=version+1,change_id=?,updated_at=? WHERE id=?').bind(JSON.stringify({ ...current, ...patch, version: undefined }), id, Date.now(), store.id)], id)
    return json({ ok: true })
  }
  if (suffix === '/stores/prices' && request.method === 'POST') {
    const data = await body(request)
    if (data.storeId === 'platform') return ownerShopRoutes(new Request(request.url, { method: 'POST', headers: request.headers, body: JSON.stringify(data) }), env, url)
    const store = (await allStores(env)).find(s => s.id === data.storeId)
    if (!store || typeof data.plan !== 'string') throw new ApiError('店铺或套餐不存在。', 404)
    const offer = await ownerStoreOffer(env, store.id, data.plan), costs = await ownerSupplyPrices(env)
    const floor = Math.max(costs[data.plan] ?? 1, await (await import('./shop-products.ts')).customRetailFloor(env, data.plan))
    if (typeof data.enabled !== 'boolean' || !Number.isSafeInteger(data.priceCents) || Number(data.priceCents) < floor || Number(data.priceCents) > 10000000) throw new ApiError('售价必须有效且不低于供货成本。')
    if (data.version !== offer.store_price_version) throw new ApiError('售价已更新，请刷新。', 409)
    const id = crypto.randomUUID()
    await commitSettings(env, [{ ...store, prices: [{ plan: data.plan, version: offer.store_price_version, catalogVersion: offer.version }] }], [
      db.prepare('INSERT INTO owner_store_prices(store_id,plan,price_cents,enabled,change_id) VALUES(?,?,?,?,?) ON CONFLICT(store_id,plan) DO UPDATE SET price_cents=excluded.price_cents,enabled=excluded.enabled,version=owner_store_prices.version+1,change_id=excluded.change_id').bind(store.id, data.plan, Number(data.priceCents), Number(data.enabled), id),
    ], id)
    return json({ ok: true })
  }
  if (suffix === '/product-order' || suffix === '/visitors') {
    const storeId = url.searchParams.get('store') ?? 'platform'
    const current = await ownerShop(env, storeId)
    if (suffix === '/visitors' && request.method === 'GET') return json(await visitorSummary(env, url, storeId))
    if (storeId !== 'platform' && suffix === '/product-order') {
      const known = await ownerProductIds(env)
      if (request.method === 'GET') return json({ productIds: [...new Set([...current.productIds, ...known])].filter(id => known.includes(id)), hiddenProductIds: current.hiddenProductIds, version: current.version })
      const data = await body(request)
      if (data.version !== current.version || !Array.isArray(data.productIds) || data.productIds.length !== known.length || new Set(data.productIds).size !== known.length || data.productIds.some(id => !known.includes(id)) || !Array.isArray(data.hiddenProductIds) || data.hiddenProductIds.some(id => !known.includes(id))) throw new ApiError('商品列表或版本已变化，请刷新。', 409)
      const id = crypto.randomUUID(), next = { ...current, productIds: data.productIds, hiddenProductIds: data.hiddenProductIds }
      await commitSettings(env, [{ id: storeId, version: current.version }], [db.prepare('UPDATE owner_shop_settings SET settings=?,version=version+1,change_id=?,updated_at=? WHERE id=?').bind(JSON.stringify({ ...next, version: undefined }), id, Date.now(), storeId)], id)
      return json({ ...next, version: current.version + 1 })
    }
  }
  return ownerShopRoutes(request, env, url)
}
