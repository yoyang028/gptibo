import test from 'node:test'
import assert from 'node:assert/strict'
import worker from '../worker/index.ts'
import { customerFixture } from './customer-fixture.ts'

async function fixture() {
  const f = await customerFixture()
  f.env.OWNER_STOREFRONT_HOSTS = JSON.stringify({ 'general.example.test': 'store-3', 'www.general.example.test': 'store-3' })
  f.db.exec("UPDATE catalog_plans SET enabled=1,price_cents=2000 WHERE id='plus'; UPDATE owner_store_prices SET enabled=1,price_cents=3100 WHERE store_id='store-3' AND plan='plus'")
  const send = (path: string, data?: unknown, cookie = '', headers: Record<string, string> = {}, host = 'general.example.test') => worker.fetch(new Request('https://' + host + path, {
    method: data === undefined ? 'GET' : 'POST', headers: { Origin: 'https://' + host, 'Content-Type': 'application/json', Cookie: cookie, ...headers },
    body: data === undefined ? undefined : JSON.stringify(data),
  }), f.env)
  const buyer = (await send('/api/orders/client', {})).headers.get('set-cookie')!.split(';')[0]
  const orderData = (price = 3100) => ({ plan: 'plus', expectedPrice: price, email: 'buyer@example.test', key: crypto.randomUUID() })
  const read = async (response: Promise<Response>, status = 200) => {
    const r = await response
    assert.equal(r.status, status, await r.clone().text())
    return r.json() as Promise<any>
  }
  return { ...f, send, buyer, orderData, read }
}

test('domain home, identity and www use the general catalog while the original root and path links retain their shops', async () => {
  const f = await fixture()
  try {
    const catalog = await f.read(f.send('/api/catalog'))
    assert.equal(catalog.ownerStoreId, 'store-3')
    assert.equal(catalog.shop.id, 'store-3')
    assert.equal(catalog.shop.name, 'AI星球')
    assert.equal(catalog.plans.find((p: any) => p.id === 'plus').price_cents, 3100)
    assert.equal((await f.read(f.send('/api/catalog?identity=1'))).shop.id, 'store-3')
    assert.equal((await f.read(f.send('/api/catalog', undefined, '', {}, 'www.general.example.test'))).shop.id, 'store-3')
    assert.equal((await f.read(f.request('/api/catalog'))).shop.id, 'platform')
    assert.equal((await f.read(f.request('/api/catalog?partner=store-3'))).shop.id, 'store-3')
    const reserved = await f.read(f.request('/api/catalog?partner=store-2'))
    assert.equal(reserved.active, false)
  } finally { f.db.close() }
})

test('native domain checkout freezes the general store and its price without requiring a browser selector', async () => {
  const f = await fixture()
  try {
    assert.equal((await f.send('/api/orders', f.orderData(2000), f.buyer)).status, 409)
    const data = f.orderData()
    const { order } = await f.read(f.send('/api/orders', data, f.buyer), 201)
    assert.equal(order.price, 31)
    assert.equal(f.db.prepare('SELECT owner_store_id FROM orders WHERE id=?').get(order.id)!.owner_store_id, 'store-3')
    assert.equal((await f.read(f.send('/api/orders', data, f.buyer))).order.id, order.id)
    assert.equal((await f.send('/api/orders', { ...data, partner: 'store-2' }, f.buyer)).status, 404)
    assert.equal(f.db.prepare('SELECT COUNT(*) n FROM orders').get()!.n, 1)
  } finally { f.db.close() }
})

test('a custom domain rejects conflicting query, body and scope headers before checkout or catalog disclosure', async () => {
  const f = await fixture()
  try {
    for (const partner of ['store-2', 'platform', 'AGENT1']) {
      assert.equal((await f.send('/api/catalog?partner=' + partner)).status, 404)
      assert.equal((await f.send('/api/catalog', undefined, '', { 'X-Storefront-Shop': partner })).status, 404)
      assert.equal((await f.send('/api/orders', { ...f.orderData(), partner }, f.buyer)).status, 404)
    }
    assert.equal((await f.send('/api/catalog?partner=store-3', undefined, '', { 'X-Storefront-Shop': 'store-3' })).status, 200)
    const root = await f.read(f.request('/api/catalog'))
    assert.equal(root.shop.id, 'platform')
    assert.equal(f.db.prepare('SELECT COUNT(*) n FROM orders').get()!.n, 0)
  } finally { f.db.close() }
})

test('domain order listing, details and actions stay in that store even with a valid cookie for another store', async () => {
  const f = await fixture()
  try {
    const general = (await f.read(f.send('/api/orders', f.orderData(), f.buyer), 201)).order
    const root = (await f.read(f.request('/api/orders', f.orderData(2000), f.buyer), 201)).order
    const listed = await f.read(f.send('/api/orders', undefined, f.buyer))
    assert.deepEqual(listed.orders.map((o: any) => o.id), [general.id])
    for (const suffix of ['', '/payment', '/fulfillment', '/refunds', '/demo-actions']) {
      const response = await f.send('/api/orders/' + root.id + suffix, suffix ? { action: 'poll' } : undefined, f.buyer)
      assert.equal(response.status, 404)
    }
    assert.equal((await f.read(f.send('/api/orders/' + general.id, undefined, f.buyer))).order.id, general.id)
    assert.equal((await f.read(f.request('/api/admin/my-shop/stores', undefined, f.admin))).stores.length, 3)
  } finally { f.db.close() }
})

test('domain coupons quote and reserve against the mapped storefront', async () => {
  const f = await fixture()
  try {
    await f.read(f.request('/api/admin/my-shop/coupons', { id: '', code: 'GENERAL', discountCents: 100, startsAt: new Date(Date.now() - 10000).toISOString(), endsAt: new Date(Date.now() + 3600000).toISOString(), maxUses: 1, oncePerEmail: true, active: true, version: 0, targets: [{ storeId: 'store-3', plan: 'plus' }] }, f.admin))
    const data = { plan: 'plus', email: 'buyer@example.test', code: 'GENERAL' }
    assert.equal((await f.read(f.send('/api/orders/coupon-quote', data, f.buyer))).priceCents, 3000)
    assert.equal((await f.request('/api/orders/coupon-quote', data, f.buyer)).status, 409)
    const { order } = await f.read(f.send('/api/orders', { ...f.orderData(3000), couponCode: 'GENERAL' }, f.buyer), 201)
    assert.equal(order.price, 30)
    assert.equal(f.db.prepare('SELECT owner_store_id FROM orders WHERE id=?').get(order.id)!.owner_store_id, 'store-3')
    assert.equal(f.db.prepare('SELECT COUNT(*) n FROM shop_coupon_uses').get()!.n, 1)
  } finally { f.db.close() }
})

test('custom product checkout uses domain pricing and stock without falling back to the main store', async () => {
  const f = await fixture()
  try {
    const { product } = await f.read(f.request('/api/admin/my-shop/products', {
      id: '', version: 0, status: 'published', name: '域名测试商品', category: '工具服务', tagline: '本地验证', description: '隔离测试商品',
      image: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWQAAAABJRU5ErkJggg==',
      badge: '服务', unit: '份', duration: '一次', priceCents: 990, stock: 2, features: ['订单可查'], purchaseNote: '本地测试', deliveryInstructions: '人工交付',
      steps: [{ title: '下单', description: '核对金额' }], faq: [{ question: '如何交付？', answer: '在原订单查看。' }], fields: [], delivery: 'manual',
      payment: { label: '测试收款', instructions: '不实际收款', url: 'https://payments.example.com/pay', qr: '' },
    }, f.admin), 201)
    await f.read(f.request('/api/admin/my-shop/stores/prices', { storeId: 'store-3', plan: product.id, priceCents: 1490, enabled: true, version: 0 }, f.admin))
    const data = { ...f.orderData(1490), plan: product.id }
    const { order } = await f.read(f.send('/api/orders', data, f.buyer), 201)
    assert.equal(order.price, 14.9)
    assert.equal(f.db.prepare('SELECT owner_store_id FROM orders WHERE id=?').get(order.id)!.owner_store_id, 'store-3')
    assert.equal((await f.send('/api/orders', { ...data, key: crypto.randomUUID(), expectedPrice: 990 }, f.buyer)).status, 409)
  } finally { f.db.close() }
})

test('domain visitors are counted for the mapped shop and forwarding headers cannot choose a shop', async () => {
  const f = await fixture()
  try {
    const visitorId = crypto.randomUUID()
    for (const path of ['/', '/orders', '/product/chatgpt', '/s/store-3']) await f.read(f.send('/api/visitors', { visitorId, path }))
    assert.equal((await f.send('/api/visitors', { visitorId, path: '/s/store-2' })).status, 404)
    const stats = f.db.prepare('SELECT shop_id,SUM(page_views) views FROM visitor_days GROUP BY shop_id').all()
    assert.deepEqual(stats.map(s => ({ ...s })), [{ shop_id: 'store-3', views: 4 }])
    const catalog = await f.read(f.send('/api/catalog', undefined, '', { 'X-Forwarded-Host': 'general.example.test', Host: 'general.example.test' }, 'unmapped.example.test'))
    assert.equal(catalog.shop.id, 'platform')
  } finally { f.db.close() }
})

test('invalid domain configuration fails closed without creating orders', async () => {
  const f = await fixture()
  try {
    for (const value of ['not json', '[]', 'null', '{"general.example.test":"not-an-owner-store"}']) {
      f.env.OWNER_STOREFRONT_HOSTS = value
      assert.equal((await f.send('/api/catalog')).status, 503)
      assert.equal((await f.send('/api/orders', f.orderData(), f.buyer)).status, 503)
    }
    assert.equal(f.db.prepare('SELECT COUNT(*) n FROM orders').get()!.n, 0)
  } finally { f.db.close() }
})
