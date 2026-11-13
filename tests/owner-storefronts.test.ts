import test from 'node:test'
import assert from 'node:assert/strict'
import { customerFixture } from './customer-fixture.ts'
import { DatabaseSync } from 'node:sqlite'
import { readFileSync, readdirSync } from 'node:fs'

test('two-store launch preserves academic settings and prices while clearing academic copy from the general store', () => {
  const db = new DatabaseSync(':memory:')
  try {
    for (const name of readdirSync(new URL('../migrations/', import.meta.url)).filter(n => n.endsWith('.sql') && n < '0060').sort()) db.exec(readFileSync(new URL('../migrations/' + name, import.meta.url), 'utf8'))
    const academic = JSON.stringify({ name: 'ScholAI', active: true, description: '面向研究生的科研服务', announcement: 'ScholAI 科研公告', logo: 'academic-logo', email: 'owner@example.test' })
    db.prepare('UPDATE owner_shop_settings SET settings=?').run(academic)
    const root = db.prepare("SELECT * FROM owner_shop_settings WHERE id='platform'").get()
    const prices = db.prepare('SELECT * FROM owner_store_prices ORDER BY store_id,plan').all()
    db.exec(readFileSync(new URL('../migrations/0060_two_active_storefronts.sql', import.meta.url), 'utf8'))
    assert.deepEqual(db.prepare("SELECT * FROM owner_shop_settings WHERE id='platform'").get(), root)
    assert.deepEqual(db.prepare('SELECT * FROM owner_store_prices ORDER BY store_id,plan').all(), prices)
    const reserved = JSON.parse(String(db.prepare("SELECT settings FROM owner_shop_settings WHERE id='store-2'").get()!.settings))
    const general = JSON.parse(String(db.prepare("SELECT settings FROM owner_shop_settings WHERE id='store-3'").get()!.settings))
    assert.equal(reserved.active, false)
    assert.equal(general.active, true)
    assert.equal(general.name, '通用商店')
    assert.equal(general.email, 'owner@example.test')
    assert.equal(general.logo, '')
    assert.doesNotMatch([general.name,general.brandName,general.pageTitle,general.headline,general.description,general.announcementTitle,general.announcement].join(' '), /ScholAI|研究生|科研|学术/i)
    assert.equal(db.prepare("SELECT COUNT(*) n FROM admin_audit WHERE id LIKE 'two-store-launch-20261112:%'").get()!.n, 2)
  } finally { db.close() }
})

test('the reserved storefront is closed by default and direct checkout remains blocked', async () => {
  const f = await customerFixture()
  try {
    f.db.exec("UPDATE catalog_plans SET enabled=1 WHERE id='plus'; UPDATE owner_store_prices SET enabled=1 WHERE plan='plus'")
    const catalog = await (await f.request('/api/catalog?partner=store-2')).json() as any
    assert.equal(catalog.active, false)
    assert.equal(catalog.checkoutEnabled, false)
    assert(catalog.plans.every((p: any) => !p.enabled))
    const buyer = (await f.request('/api/orders/client', {})).headers.get('set-cookie')!.split(';')[0]
    const response = await f.request('/api/orders', { partner: 'store-2', plan: 'plus', expectedPrice: 13900, email: 'buyer@example.test', key: crypto.randomUUID() }, buyer)
    assert.equal(response.status, 409)
    assert.equal(f.db.prepare('SELECT COUNT(*) n FROM orders').get()!.n, 0)
    const general = await (await f.request('/api/catalog?partner=store-3')).json() as any
    assert.equal(general.active, true)
    assert.equal(general.checkoutEnabled, true)
  } finally { f.db.close() }
})

async function fixture() {
  const f = await customerFixture({ openAllOwnerStores: true })
  f.db.prepare("UPDATE catalog_plans SET enabled=1,price_cents=2000 WHERE id='plus'").run()
  f.db.prepare("UPDATE owner_store_prices SET enabled=1,price_cents=CASE WHEN store_id='store-2' THEN 2500 ELSE 3000 END WHERE plan='plus'").run()
  async function read(path: string, cookie = f.admin) { const r = await f.request(path, undefined, cookie); assert.equal(r.status, 200, await r.clone().text()); return r.json() as Promise<any> }
  const stores = () => read('/api/admin/my-shop/stores')
  async function edit(id: string, patch: object) { const shop = (await stores()).stores.find((s: any) => s.id === id); return f.request('/api/admin/my-shop/stores', { ...shop, ...patch }, f.admin) }
  const price = async (id: string, amount: number, enabled = true) => {
    const p = (await stores()).prices.find((p: any) => p.store_id === id && p.plan === 'plus')
    return f.request('/api/admin/my-shop/stores/prices', { storeId: id, plan: 'plus', priceCents: amount, enabled, version: p.version }, f.admin)
  }
  async function bulk(sourceId: string, targetIds: string[], fields: string[], copyPrices = false) {
    const data = await stores()
    return { sourceId, sourceVersion: data.stores.find((s: any) => s.id === sourceId).version, targets: data.stores.filter((s: any) => targetIds.includes(s.id)).map((s: any) => ({ id: s.id, version: s.version })), fields, prices: copyPrices }
  }
  const buyer = (await f.request('/api/orders/client', {})).headers.get('set-cookie')!.split(';')[0]
  const create = (id: string, amount: number, key = crypto.randomUUID()) => f.request('/api/orders', { partner: id === 'platform' ? undefined : id, plan: 'plus', expectedPrice: amount, email: 'buyer@example.test', key }, buyer)
  return { ...f, read, stores, edit, price, bulk, create, buyer }
}

test('three owner storefronts share a platform and template data while agent accounts remain separate', async () => {
  const f = await fixture()
  try {
    const data = await f.stores()
    assert.deepEqual(data.stores.map((s: any) => s.id), ['platform','store-2','store-3'])
    assert.equal(f.db.prepare('SELECT COUNT(*) n FROM partners').get()!.n, 0)
    const catalogs = await Promise.all(['','store-2','store-3'].map(s => f.read('/api/catalog' + (s ? '?partner=' + s : ''), '')))
    assert.deepEqual(catalogs[0].plans.map((p: any) => p.id), catalogs[1].plans.map((p: any) => p.id))
    assert.deepEqual(catalogs.map(c => c.plans.find((p: any) => p.id === 'plus').price_cents), [2000,2500,3000])
    assert.ok(catalogs.every(c => !c.partner && c.shop))
  } finally { f.db.close() }
})

test('single-store parameters and retail edits preserve other stores and reject foreign-origin writes', async () => {
  const f = await fixture()
  try {
    const root = await f.read('/api/catalog', '')
    assert.equal((await f.edit('store-2', { name: '第二家店', settings: { brandName: '第二家店', headline: '单店标题', description: '单店简介', email: 'second@example.test' } })).status, 200)
    const second = await f.read('/api/catalog?partner=store-2', '')
    assert.equal(second.shop.brandName, '第二家店')
    assert.equal(second.supportContacts.email, 'second@example.test')
    assert.deepEqual((await f.read('/api/catalog', '')).shop, root.shop)
    assert.equal((await f.price('store-2', 2600)).status, 200)
    assert.equal((await f.read('/api/catalog?partner=store-3', '')).plans.find((p: any) => p.id === 'plus').price_cents, 3000)
    const body = await f.bulk('store-2', ['store-3'], ['headline'])
    assert.equal((await f.request('/api/admin/my-shop/stores/bulk', body, f.admin, 'https://evil.example.test')).status, 403)
    assert.equal((await f.request('/api/admin/my-shop/stores/bulk', body, f.buyer)).status, 401)
  } finally { f.db.close() }
})

test('bulk parameter sync copies only selected fields and price sync is a separate explicit choice', async () => {
  const f = await fixture()
  try {
    assert.equal((await f.edit('store-2', { name: '源店', settings: { brandName: '源品牌', headline: '统一标题', description: '统一简介' } })).status, 200)
    const payload = await f.bulk('store-2', ['platform','store-3'], ['headline','description'])
    assert.equal((await f.request('/api/admin/my-shop/stores/bulk', payload, f.admin)).status, 200)
    const data = await f.stores()
    assert.ok(data.stores.every((s: any) => s.settings.headline === '统一标题'))
    assert.equal(data.stores.find((s: any) => s.id === 'store-3').name, '通用商店')
    assert.deepEqual(data.prices.filter((p: any) => p.plan === 'plus').map((p: any) => p.price_cents), [2000,2500,3000])
    const copyPrices = await f.bulk('platform', ['store-2','store-3'], [], true)
    assert.equal((await f.request('/api/admin/my-shop/stores/bulk', copyPrices, f.admin)).status, 200)
    assert.deepEqual((await f.stores()).prices.filter((p: any) => p.plan === 'plus').map((p: any) => p.price_cents), [2000,2000,2000])
  } finally { f.db.close() }
})

test('bulk updates reject stale target and source snapshots without partial writes, including a transaction race', async () => {
  const f = await fixture()
  try {
    const payload = await f.bulk('platform', ['store-2','store-3'], ['headline'])
    await f.edit('store-3', { name: '后来修改的店' })
    assert.equal((await f.request('/api/admin/my-shop/stores/bulk', payload, f.admin)).status, 409)
    assert.equal((await f.stores()).stores.find((s: any) => s.id === 'store-2').version, 0)
    const current = await f.bulk('platform', ['store-2','store-3'], ['headline'])
    const originalBatch = f.env.INTEREST_DB.batch
    let raced = false
    f.env.INTEREST_DB.batch = async statements => { if (!raced) { raced = true; f.db.prepare("UPDATE owner_shop_settings SET version=version+1 WHERE id='store-3'").run() } return originalBatch(statements) }
    assert.equal((await f.request('/api/admin/my-shop/stores/bulk', current, f.admin)).status, 409)
    assert.equal((await f.stores()).stores.find((s: any) => s.id === 'store-2').version, 0)
  } finally { f.db.close() }
})

test('each frontend uses its own price at checkout and preserves store attribution in owner order totals', async () => {
  const f = await fixture()
  try {
    for (const [id, value] of [['platform',2000],['store-2',2500],['store-3',3000]] as const) {
      const created = await f.create(id, value)
      assert.equal(created.status, 201, await created.clone().text())
      const { order } = await created.json() as any
      assert.equal(f.db.prepare('SELECT owner_store_id FROM orders WHERE id=?').get(order.id)!.owner_store_id, id)
      assert.equal((await f.read('/api/admin/my-shop/orders?store=' + id)).total, 1)
    }
    assert.equal((await f.read('/api/admin/my-shop/orders')).total, 3)
    assert.deepEqual((await f.stores()).stores.map((s: any) => s.order_count), [1,1,1])
    assert.equal((await f.create('store-2', 2000)).status, 409)
    const key = crypto.randomUUID()
    assert.equal((await f.create('store-2', 2500, key)).status, 201)
    assert.equal((await f.create('store-3', 3000, key)).status, 409)
  } finally { f.db.close() }
})

test('pausing one storefront or one offer does not stop the other storefronts', async () => {
  const f = await fixture()
  try {
    await f.edit('store-2', { active: false })
    assert.equal((await f.create('store-2', 2500)).status, 409)
    assert.equal((await f.create('store-3', 3000)).status, 201)
    assert.equal((await f.price('platform', 2000, false)).status, 200)
    assert.equal((await f.create('platform', 2000)).status, 409)
    assert.equal((await f.create('store-3', 3000)).status, 201)
    assert.equal((await f.read('/api/catalog?partner=store-2', '')).checkoutEnabled, false)
  } finally { f.db.close() }
})

test('visitor statistics follow owner shop links without creating reseller records', async () => {
  const f = await fixture()
  try {
    assert.equal((await f.request('/api/visitors', { path: '/s/store-2/product/chatgpt', visitorId: crypto.randomUUID() })).status, 200)
    assert.equal((await f.read('/api/admin/my-shop/visitors?store=store-2')).visitors, 1)
    assert.equal((await f.read('/api/admin/my-shop/visitors?store=store-3')).visitors, 0)
  } finally { f.db.close() }
})

test('management links and domain cards follow configured storefront hosts, with a path fallback for unbound stores', async () => {
  const f = await fixture()
  try {
    f.env.OWNER_STOREFRONT_HOSTS = JSON.stringify({ 'www.general.example.test': 'store-3', 'general.example.test': 'store-3' })
    const before = f.db.prepare('SELECT * FROM owner_shop_settings ORDER BY slot').all()
    const stores = (await f.stores()).stores
    assert.deepEqual(stores.map((s: any) => [s.id, s.storefront_url]), [
      ['platform', 'https://shop.example.invalid/'],
      ['store-2', 'https://shop.example.invalid/s/store-2'],
      ['store-3', 'https://general.example.test/'],
    ])
    assert.equal(stores[2].legacy_url, 'https://shop.example.invalid/s/store-3')
    const domains = (await f.read('/api/admin/my-shop/domain')).domains
    assert.deepEqual(domains.map((d: any) => [d.storeId, d.hostname, d.url]), [
      ['platform', 'shop.example.invalid', 'https://shop.example.invalid/'],
      ['store-3', 'general.example.test', 'https://general.example.test/'],
      ['store-3', 'www.general.example.test', 'https://www.general.example.test/'],
    ])
    assert(domains.every((d: any) => d.state === 'active'))
    assert.deepEqual(f.db.prepare('SELECT * FROM owner_shop_settings ORDER BY slot').all(), before)
    f.env.OWNER_STOREFRONT_HOSTS = undefined
    assert.equal((await f.stores()).stores[2].storefront_url, 'https://shop.example.invalid/s/store-3')
    assert.equal((await f.read('/api/admin/my-shop/domain')).domains.length, 1)
  } finally { f.db.close() }
})

test('selected-store visitor periods retain store ownership across legacy links and mapped hosts', async () => {
  const f = await fixture()
  try {
    f.env.OWNER_STOREFRONT_HOSTS = JSON.stringify({ 'general.example.test': 'store-3' })
    const visitorId = crypto.randomUUID()
    await f.request('/api/visitors', { path: '/', visitorId })
    await f.request('/api/visitors', { path: '/s/store-3', visitorId })
    const { default: worker } = await import('../worker/index.ts')
    const visit = await worker.fetch(new Request('https://general.example.test/api/visitors', {
      method: 'POST', headers: { Origin: 'https://general.example.test', 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: '/product/chatgpt', visitorId }),
    }), f.env)
    assert.equal(visit.status, 200)
    for (const days of [1, 7, 30, 90]) {
      for (const [store, views] of [['platform', 1], ['store-2', 0], ['store-3', 2]] as const) {
        const stats = await f.read(`/api/admin/my-shop/visitors?store=${store}&days=${days}`)
        assert.equal(stats.days, days)
        assert.equal(stats.trend.length, days)
        assert.equal(stats.pageViews, views)
      }
    }
    const global = await f.read('/api/admin/visitors?days=1')
    assert.deepEqual(global.ownerStores.map((s: any) => [s.id, s.pageViews]), [['platform', 1], ['store-2', 0], ['store-3', 2]])
    assert.equal(global.ownerStores[2].storefront_url, 'https://general.example.test/')
    assert.equal(global.visitors, 1)
    assert.equal((await f.request('/api/admin/my-shop/visitors?store=store-3?days=7', undefined, f.admin)).status, 404)
  } finally { f.db.close() }
})

test('custom products share inventory but retain each storefront price, contact and order snapshot', async () => {
  const f = await fixture()
  try {
    const response = await f.request('/api/admin/my-shop/products', {
      id: '', version: 0, status: 'published', name: '演示服务', category: '工具服务', tagline: '本地验证', description: '用于验证三店共用商品资料。',
      image: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWQAAAABJRU5ErkJggg==',
      badge: '服务', unit: '份', duration: '一次', priceCents: 990, stock: 2, features: ['订单可查'], purchaseNote: '本地测试，不实际收款。', deliveryInstructions: '人工确认后交付。',
      steps: [{ title: '下单', description: '核对金额。' }], faq: [{ question: '如何交付？', answer: '原订单查看。' }], fields: [], delivery: 'manual',
      payment: { label: '演示收款', instructions: '仅模拟测试。', url: 'https://payments.example.com/pay', qr: '' },
    }, f.admin)
    assert.equal(response.status, 201, await response.clone().text())
    const { product } = await response.json() as any
    assert.equal((await f.request('/api/admin/my-shop/stores/prices', { storeId: 'store-2', plan: product.id, priceCents: 1490, enabled: true, version: 0 }, f.admin)).status, 200)
    await f.edit('store-2', { settings: { email: 'second@example.test' } })
    const create = (shop: string, price: number, key = crypto.randomUUID()) => f.request('/api/orders', { partner: shop, plan: product.id, expectedPrice: price, email: 'buyer@example.test', key }, f.buyer)
    const key = crypto.randomUUID(), order = await create('store-2', 1490, key)
    assert.equal(order.status, 201, await order.clone().text())
    const view = await order.json() as any
    assert.equal(view.order.price, 14.9)
    assert.equal(view.order.supportContacts.email, 'second@example.test')
    assert.equal((await create('store-3', 990, key)).status, 409)
    assert.equal((await create('store-3', 990)).status, 201)
    assert.equal((await create('store-2', 1490)).status, 409)
    const second = await f.read('/api/catalog?partner=store-2', '')
    assert.equal(second.products.find((p: any) => p.id === product.id).priceCents, 1490)
  } finally { f.db.close() }
})

test('coupons are priced and reserved for their selected owner storefront', async () => {
  const f = await fixture()
  try {
    const saved = await f.request('/api/admin/my-shop/coupons', { id: '', code: 'SECOND', discountCents: 100, startsAt: new Date(Date.now() - 10000).toISOString(), endsAt: new Date(Date.now() + 3600000).toISOString(), maxUses: 1, oncePerEmail: true, active: true, version: 0, targets: [{ storeId: 'store-2', plan: 'plus' }] }, f.admin)
    assert.equal(saved.status, 200, await saved.clone().text())
    const quote = await f.request('/api/orders/coupon-quote', { partner: 'store-2', plan: 'plus', email: 'buyer@example.test', code: 'SECOND' }, f.buyer)
    assert.equal(quote.status, 200, await quote.clone().text())
    assert.equal((await quote.json() as any).priceCents, 2400)
    assert.equal((await f.request('/api/orders/coupon-quote', { partner: 'store-3', plan: 'plus', email: 'buyer@example.test', code: 'SECOND' }, f.buyer)).status, 409)
    const order = await f.request('/api/orders', { partner: 'store-2', plan: 'plus', expectedPrice: 2400, couponCode: 'SECOND', email: 'buyer@example.test', key: crypto.randomUUID() }, f.buyer)
    assert.equal(order.status, 201, await order.clone().text())
    assert.equal(f.db.prepare('SELECT COUNT(*) n FROM shop_coupon_uses').get()!.n, 1)
  } finally { f.db.close() }
})

test('a price update during checkout or bulk copy is rejected atomically', async () => {
  const f = await fixture()
  try {
    const original = f.env.INTEREST_DB.batch
    let raced = false
    f.env.INTEREST_DB.batch = async statements => {
      if (!raced) { raced = true; f.db.prepare("UPDATE owner_store_prices SET price_cents=2900,version=version+1 WHERE store_id='store-2' AND plan='plus'").run() }
      return original(statements)
    }
    assert.equal((await f.create('store-2', 2500)).status, 409)
    assert.equal(f.db.prepare('SELECT COUNT(*) n FROM orders').get()!.n, 0)
    const data = await f.bulk('platform', ['store-2','store-3'], [], true)
    raced = false
    assert.equal((await f.request('/api/admin/my-shop/stores/bulk', data, f.admin)).status, 409)
    assert.equal((await f.read('/api/catalog?partner=store-3', '')).plans.find((p: any) => p.id === 'plus').price_cents, 3000)
  } finally { f.db.close() }
})

test('store-specific quick pricing and notification settings use the selected shop', async () => {
  const f = await fixture()
  try {
    const quote = (await f.stores()).prices.find((p: any) => p.store_id === 'store-2' && p.plan === 'plus')
    assert.equal((await f.request('/api/admin/my-shop/prices/plus?store=store-2', { priceCents: 2600, version: quote.version }, f.admin)).status, 200)
    assert.equal((await f.read('/api/catalog?partner=store-2', '')).plans.find((p: any) => p.id === 'plus').price_cents, 2600)
    assert.equal((await f.read('/api/catalog', '')).plans.find((p: any) => p.id === 'plus').price_cents, 2000)
    const notification = await f.read('/api/admin/my-shop/notification-settings?store=store-2')
    assert.equal((await f.request('/api/admin/my-shop/notification-settings?store=store-2', { orderCompletedEmail: true, version: notification.version }, f.admin)).status, 200)
    assert.equal((await f.read('/api/admin/my-shop/notification-settings?store=store-2')).orderCompletedEmail, true)
    assert.equal((await f.read('/api/admin/my-shop/notification-settings')).orderCompletedEmail, false)
    const payload = await f.bulk('store-2', ['store-3'], ['orderCompletedEmail'])
    assert.equal((await f.request('/api/admin/my-shop/stores/bulk', payload, f.admin)).status, 200)
    assert.equal((await f.read('/api/admin/my-shop/notification-settings?store=store-3')).orderCompletedEmail, true)
  } finally { f.db.close() }
})
