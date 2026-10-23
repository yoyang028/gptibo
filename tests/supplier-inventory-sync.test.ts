import test, { type TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { customerFixture } from './customer-fixture.ts'
import { refreshHanfolkStock } from '../worker/hanfolk/sync.ts'
import { assertHanfolkStock } from '../worker/hanfolk/availability.ts'
import { importHanfolkDrafts } from '../worker/hanfolk/importer.ts'
import type { HanfolkDetail } from '../shared/hanfolk-catalog.ts'
import type { ShopProduct } from '../shared/shop-products.ts'
import type { InventoryMonitor } from '../shared/inventory-sync.ts'
// @ts-ignore -- isolated GET-only fixture, no live credentials.
import { hanfolkFixtureProducts, hanfolkFixtureKey } from '../scripts/cloudflare/hanfolk-fixture.mjs'

async function fixture(t: TestContext) {
  const f = await customerFixture()
  t.after(() => f.db.close())
  let sources = structuredClone(hanfolkFixtureProducts) as HanfolkDetail[]
  let failure = '', gate: (() => Promise<void>) | undefined
  const calls: Request[] = []
  t.mock.method(globalThis, 'fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init), url = new URL(request.url)
    assert.equal(request.method, 'GET'); assert.equal(url.origin, 'https://ai.hanfolk.xyz')
    assert.equal(request.headers.get('X-API-Key'), hanfolkFixtureKey)
    calls.push(request)
    if (gate) await gate()
    if (failure === 'network') throw new Error('private reflected credential ' + hanfolkFixtureKey)
    const action = url.searchParams.get('do')
    if (action === 'balance') return Response.json({ success: true, balance: 100 })
    if (action === 'products') return Response.json({ success: true, count: sources.length + (failure === 'incomplete' ? 1 : 0), products: sources })
    const product = sources.find(p => p.id === Number(url.searchParams.get('id')))
    if (failure === 'detail' && product?.id === 101) return Response.json({ success: true, product: {} })
    return Response.json({ success: true, product })
  })
  assert.equal((await f.request('/api/admin/hanfolk', { action: 'save-key', version: 0, apiKey: hanfolkFixtureKey }, f.admin)).status, 200)
  const sync = () => refreshHanfolkStock(f.env, 'manual')
  await sync()
  const imported = await importHanfolkDrafts(f.env, sources, sources[1].sku_variants.map(v => ({ productId: 101, sku: v.sku })))
  for (const id of imported.imported) {
    const row = f.db.prepare('SELECT public_json FROM shop_products WHERE id=?').get(id)!
    const product = { ...JSON.parse(String(row.public_json)), status: 'listed', pricePending: false, priceCents: 1980, description: '店主确认的商品详情' }
    f.db.prepare('UPDATE shop_products SET public_json=? WHERE id=?').run(JSON.stringify(product), id)
    f.db.prepare('UPDATE catalog_plans SET price_cents=1980 WHERE id=?').run(id)
  }
  const catalog = async () => (await (await f.request('/api/catalog')).json()) as { products: ShopProduct[]; plans: {id: string; enabled: number}[]; managedProductGroups: string[] }
  const monitor = async () => (await (await f.request('/api/admin/hanfolk/monitor', undefined, f.admin)).json()) as InventoryMonitor
  const stocks = (value: number) => sources[1].sku_variants.forEach(v => { v.stock = value })
  return { ...f, sync, catalog, monitor, stocks, ids: imported.imported, calls,
    get sources() { return sources }, set sources(value: HanfolkDetail[]) { sources = value },
    set failure(value: string) { failure = value }, set gate(value: (() => Promise<void>) | undefined) { gate = value },
  }
}

test('Zero stock retains every approved SKU, owner copy, price and artwork; restock preserves manual visibility and draft decisions', async t => {
  const f = await fixture(t)
  f.db.prepare("INSERT INTO product_artwork(product_id,settings,updated_at,change_id) VALUES('gemini','{}',0,'fixture')").run()
  const before = ['shop_products', 'catalog_plans', 'hanfolk_product_links', 'product_artwork'].map(table => f.db.prepare(`SELECT * FROM ${table} ORDER BY 1`).all())
  f.stocks(0); await f.sync()
  let catalog = await f.catalog()
  const products = catalog.products.filter(p => f.ids.includes(p.id))
  assert.equal(products.length, 2); assert(products.every(p => p.stock === 0 && p.inventory?.status === 'replenishing'))
  assert(catalog.managedProductGroups.includes('gemini'))
  assert(!catalog.plans.some(p => p.id === 'gemini-pro-18m'))
  assert.deepEqual(['shop_products', 'catalog_plans', 'hanfolk_product_links', 'product_artwork'].map(table => f.db.prepare(`SELECT * FROM ${table} ORDER BY 1`).all()), before)
  const removed = f.db.prepare('SELECT COUNT(*) n FROM catalog_deletions WHERE source=\'daju\'').get()!
  assert.equal(removed.n, 0)
  assert((await f.monitor()).changes.some(c => c.kind === 'stock' && c.after_stock === 0))
  f.db.prepare("UPDATE shop_products SET public_json=json_set(public_json,'$.status','archived') WHERE id=?").run(f.ids[0])
  f.stocks(12); await f.sync(); catalog = await f.catalog()
  assert(!catalog.products.some(p => p.id === f.ids[0]))
  assert.equal(catalog.products.find(p => p.id === f.ids[1])?.inventory?.status, 'available')
  assert.equal(catalog.products.find(p => p.id === f.ids[1])?.priceCents, 1980)
  assert.equal(catalog.plans.find(p => p.id === f.ids[1])?.enabled, 0, 'stock must not enable sales')
  assert((await f.monitor()).changes.some(c => c.kind === 'restocked' && c.after_stock === 12))
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM orders').get()!.n, 0)
})

test('Confirmed upstream removal keeps the card and SKU until the owner confirms; stale confirmation cannot archive a restocked SKU', async t => {
  const f = await fixture(t), original = structuredClone(f.sources)
  f.sources = f.sources.filter(p => p.id !== 101); await f.sync()
  assert.equal((await f.catalog()).products.filter(p => f.ids.includes(p.id)).length, 2)
  const pending = (await f.monitor()).pendingRemoval
  assert.equal(pending.length, 2)
  const item = pending[0], body = { action: 'confirm-remove', productId: item.id, productVersion: item.version, checkedAt: item.checkedAt, confirmed: true }
  assert.equal((await f.request('/api/admin/hanfolk', { ...body, confirmed: false }, f.admin)).status, 400)
  assert.equal((await f.request('/api/admin/hanfolk', { ...body, productVersion: item.version + 1 }, f.admin)).status, 409)
  assert.equal((await f.request('/api/admin/hanfolk', body, f.admin)).status, 200)
  assert(f.db.prepare('SELECT id FROM shop_products WHERE id=?').get(item.id), 'archive retains original product')
  assert.equal((await f.monitor()).pendingRemoval.length, 1)
  const other = (await f.monitor()).pendingRemoval[0]
  f.sources = original; await f.sync()
  assert.equal((await f.request('/api/admin/hanfolk', { ...body, productId: other.id, productVersion: other.version, checkedAt: other.checkedAt }, f.admin)).status, 409)
  const catalog = await f.catalog()
  assert(!catalog.products.some(p => p.id === item.id))
  assert.equal(catalog.products.find(p => p.id === other.id)?.inventory?.status, 'available')
})

test('New products and zero-stock specifications wait for owner selection, pricing and display approval', async t => {
  const f = await fixture(t)
  const added = structuredClone(f.sources[1]); added.id = 999; added.title = 'Google Gemini 新商品'
  added.sku_variants = [{ sku: '10', price: 2, stock: 0 }]
  f.sources = [...f.sources, added]; await f.sync()
  const monitor = await f.monitor()
  assert(monitor.pendingNew.some(p => p.productId === 999 && p.stock === 0))
  assert(monitor.changes.some(p => p.product_id === 999 && p.kind === 'new'))
  assert.equal((await f.catalog()).products.filter(p => p.groupId === 'gemini').length, 2)
  const result = await importHanfolkDrafts(f.env, f.sources, [{ productId: 999, sku: '10' }])
  assert.equal(result.imported.length, 1)
  await f.sync()
  assert(!(await f.catalog()).products.some(p => result.imported.includes(p.id)))
  const draft = JSON.parse(String(f.db.prepare('SELECT public_json FROM shop_products WHERE id=?').get(result.imported[0])!.public_json))
  assert.equal(draft.status, 'draft'); assert.equal(draft.pricePending, true)
  assert(!(await f.monitor()).pendingNew.some(p => p.productId === 999))
})

test('Failed, incomplete and partial supplier reads preserve the entire confirmed snapshot and record safe errors', async t => {
  const f = await fixture(t); await f.sync()
  const snapshot = () => ['hanfolk_catalog', 'hanfolk_inventory', 'shop_products', 'catalog_plans'].map(table => f.db.prepare(`SELECT * FROM ${table} ORDER BY 1`).all())
  const before = snapshot()
  for (const failure of ['network', 'incomplete', 'detail']) {
    f.failure = failure
    await assert.rejects(f.sync())
    assert.deepEqual(snapshot(), before)
  }
  const monitor = await f.monitor()
  assert.equal(monitor.options.consecutiveFailures, 3)
  assert.equal(monitor.runs.filter(r => r.status === 'failed').length, 3)
  assert(!JSON.stringify(monitor).includes(hanfolkFixtureKey))
  assert((await f.catalog()).products.filter(p => f.ids.includes(p.id)).every(p => p.stock > 0))
  f.failure = ''; await f.sync()
  assert.equal((await f.monitor()).options.consecutiveFailures, 0)
})

test('Expired stock and changed credentials preserve the card and confirmed quantities while stopping orders', async t => {
  const f = await fixture(t); await f.sync()
  const now = Date.now()
  t.mock.method(Date, 'now', () => now + 16 * 60_000)
  const catalog = await f.catalog(), products = catalog.products.filter(p => f.ids.includes(p.id))
  assert.equal(products.length, 2)
  assert(products.every(p => p.inventory?.status === 'checking' && p.stock > 0))
  await assert.rejects(assertHanfolkStock(f.env, f.ids[0]), /库存待确认/)
  t.mock.restoreAll()
  f.db.prepare("UPDATE hanfolk_settings SET key_hash='changed',checked_key_hash='' WHERE id='main'").run()
  assert((await f.catalog()).products.filter(p => f.ids.includes(p.id)).every(p => p.inventory?.status === 'checking' && p.stock > 0))
})

test('Exact-SKU checkout reads reject depleted stock and never create orders or procurement', async t => {
  const f = await fixture(t)
  await assertHanfolkStock(f.env, f.ids[0])
  f.stocks(0)
  await assert.rejects(assertHanfolkStock(f.env, f.ids[0]), /补货中/)
  assert(f.calls.every(r => r.method === 'GET'))
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM orders').get()!.n, 0)
})

test('Sync settings validate intervals, reject stale writes, respect disable/interval and permit manual refresh', async t => {
  const f = await fixture(t)
  const save = (extra: object) => f.request('/api/admin/hanfolk', { action: 'sync-settings', enabled: true, intervalMinutes: 10, syncVersion: 0, ...extra }, f.admin)
  assert.equal((await save({ intervalMinutes: 1 })).status, 400)
  assert.equal((await save({ enabled: false })).status, 200)
  assert.equal((await save({ enabled: false })).status, 409, 'identical stale replay is not a new approval')
  const count = f.calls.length
  f.db.prepare("UPDATE hanfolk_sync_settings SET last_attempt_at=0 WHERE id='main'").run()
  assert.equal(await refreshHanfolkStock(f.env), false); assert.equal(f.calls.length, count)
  await f.sync(); assert(f.calls.length > count)
  assert.equal((await save({ syncVersion: 1 })).status, 200)
  f.db.prepare("UPDATE hanfolk_sync_settings SET last_attempt_at=? WHERE id='main'").run(Date.now() - 9 * 60_000)
  assert.equal(await refreshHanfolkStock(f.env), false)
  f.db.prepare("UPDATE hanfolk_sync_settings SET last_attempt_at=? WHERE id='main'").run(Date.now() - 11 * 60_000)
  assert.equal(await refreshHanfolkStock(f.env), true)
  assert.equal((await f.request('/api/admin/hanfolk/monitor')).status, 401)
  assert.equal((await f.request('/api/admin/hanfolk', { action: 'sync-settings', enabled: true, intervalMinutes: 5, syncVersion: 2 }, f.admin, 'https://other.invalid')).status, 403)
})

test('A sync lease prevents duplicate upstream reads and stale credentials cannot overwrite a newer configuration', async t => {
  const f = await fixture(t)
  let release!: () => void, entered!: () => void
  const waiting = new Promise<void>(resolve => { release = resolve }), started = new Promise<void>(resolve => { entered = resolve })
  f.gate = async () => { entered(); await waiting }
  const first = f.sync(); await started
  const count = f.calls.length
  await assert.rejects(f.sync(), /已有库存同步/)
  assert.equal(f.calls.length, count)
  f.db.prepare("UPDATE hanfolk_settings SET version=version+1,checked_key_hash='' WHERE id='main'").run()
  release(); await assert.rejects(first, /配置已变化/)
  assert((await f.monitor()).runs.some(run => run.status === 'superseded'))
  assert.equal((await f.monitor()).options.running, false)
})

test('Monitoring records paginate and retain history without touching owner or order data', async t => {
  const f = await fixture(t), now = Date.now()
  for (let i = 0; i < 24; i++) f.db.prepare("INSERT INTO hanfolk_sync_runs(id,trigger,status,started_at,finished_at) VALUES(?,'scheduled','success',?,?)").run('page-' + i, now - i, now)
  f.db.prepare("INSERT INTO hanfolk_sync_runs(id,trigger,status,started_at) VALUES('old-run','scheduled','success',?)").run(now - 31 * 86400_000)
  f.db.prepare("INSERT INTO hanfolk_sync_changes(id,run_id,product_id,sku,name,kind,created_at) VALUES('old-change','old-run',101,'10','old','stock',?)").run(now - 91 * 86400_000)
  f.db.prepare("INSERT INTO hanfolk_sync_changes(id,run_id,product_id,sku,name,kind,created_at) VALUES('retained-change','old-run',101,'10','retained','stock',?)").run(now - 40 * 86400_000)
  await f.sync()
  assert(!f.db.prepare("SELECT id FROM hanfolk_sync_runs WHERE id='old-run'").get())
  assert(!f.db.prepare("SELECT id FROM hanfolk_sync_changes WHERE id='old-change'").get())
  const first = await f.monitor()
  const second = await (await f.request('/api/admin/hanfolk/monitor?page=2', undefined, f.admin)).json() as InventoryMonitor
  assert.equal(first.runs.length, 20); assert(second.runs.length > 0)
  assert(!second.runs.some(run => first.runs.some(other => other.id === run.id)))
  assert(first.history.some(change => change.id === 'retained-change'), '90-day changes stay accessible after their 30-day run expires')
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM orders').get()!.n, 0)
})
