import test from 'node:test'
import assert from 'node:assert/strict'
import { customerFixture } from './customer-fixture.ts'

async function fixture() {
  const f = await customerFixture()
  const first = await f.agent('甲代理'), second = await f.agent('乙代理')
  f.db.prepare("UPDATE catalog_plans SET enabled=1,partner_enabled=1 WHERE id='plus'").run()
  for (const p of [first, second]) f.db.prepare("INSERT INTO partner_prices(partner_id,plan,cost_cents,price_cents) VALUES(?,'plus',1000,2000)").run(p.id)
  async function get(path: string, cookie = first.cookie) {
    const r = await f.request(path, undefined, cookie)
    assert.equal(r.status, 200, await r.clone().text())
    return r.json() as Promise<any>
  }
  const shop = async () => (await get('/api/partner/stores')).stores[0]
  const save = async (patch = {}) => f.request('/api/partner/stores', { ...await shop(), ...patch }, first.cookie)
  return { ...f, first, second, get, shop, save }
}

test('agent workspace shares the owner account registry and exposes only its own storefront', async (t) => {
  const f = await fixture()
  f.env.RESEND_API_KEY = 'fixture'; f.env.RESEND_FROM = 'test@example.test'
  t.mock.method(globalThis, 'fetch', async () => new Response('{}', { status: 503 }))
  try {
    assert.equal((await f.request('/api/partner/stores')).status, 401)
    const data = await f.get('/api/partner/stores')
    assert.equal(data.stores.length, 1)
    assert.equal(data.stores[0].id, f.first.id)
    assert.equal(data.prices[0].cost_cents, 1000)
    assert.equal((await f.get('/api/admin/partners/' + f.first.id + '/stores', f.admin)).stores[0].id, f.first.id)
    assert.equal((await f.request('/api/admin/partners/' + f.first.id + '/stores', {}, f.admin)).status, 405)
    assert.equal((await f.save({ id: f.second.id })).status, 404)
    const opened = await f.request('/api/admin/partners', { email: 'new-agent@example.test' }, f.admin)
    assert.equal(opened.status, 201)
    const account = await opened.json() as { id: string; slug: string }
    const catalog = await f.get('/api/catalog?partner=' + account.slug, '')
    assert.equal(catalog.partner.slug, account.slug)
    assert.ok((await f.get('/api/admin/partners/' + account.id + '/stores', f.admin)).stores[0])
  } finally { f.db.close() }
})

test('agent branding, contact and announcement changes reach its front end without changing other shops', async () => {
  const f = await fixture()
  try {
    const before = await f.get('/api/catalog', '')
    const settings = { brandName: '甲的小店', headline: '欢迎来逛逛', pageTitle: '甲店', email: 'help@example.test', wechat: 'shop-help', announcementTitle: '欢迎', announcement: '店铺公告', announcementPlacement: 'home' }
    assert.equal((await f.save({ name: '甲店', settings })).status, 200)
    const slug = f.db.prepare('SELECT slug FROM partners WHERE id=?').get(f.first.id)!.slug
    const own = await f.get('/api/catalog?partner=' + slug, '')
    assert.equal(own.partner.brandName, settings.brandName)
    assert.equal(own.partner.headline, settings.headline)
    assert.equal(own.supportContacts.email, settings.email)
    assert.equal(own.announcement.content, settings.announcement)
    assert.deepEqual((await f.get('/api/catalog', '')).shop, before.shop)
    assert.equal((await f.get('/api/partner/stores', f.second.cookie)).stores[0].settings.brandName, '')
    const stale = await f.shop()
    assert.equal((await f.save({ name: '新名称' })).status, 200)
    assert.equal((await f.request('/api/partner/stores', stale, f.first.cookie)).status, 409)
    assert.equal((await f.save({ settings: { logo: 'javascript:alert(1)' } })).status, 400)
  } finally { f.db.close() }
})

test('main admin supply cost and agent retail price share optimistic locking and enforce the margin floor', async () => {
  const f = await fixture()
  try {
    const update = (value: object) => f.request('/api/partner/stores/prices', { storeId: f.first.id, plan: 'plus', priceCents: 2500, enabled: true, version: 0, ...value }, f.first.cookie)
    assert.equal((await update({ storeId: f.second.id })).status, 404)
    assert.equal((await update({ priceCents: 900 })).status, 400)
    assert.equal((await f.request('/api/admin/partners/' + f.first.id + '/prices/plus', { costCents: 1500, version: 0 }, f.admin)).status, 200)
    assert.equal((await update({})).status, 409)
    assert.equal((await update({ version: 1 })).status, 200)
    const admin = await f.get('/api/admin/partners/' + f.first.id, f.admin)
    assert.equal(admin.plans.find((p: any) => p.id === 'plus').price_cents, 2500)
    assert.equal((await f.get('/api/partner/stores', f.second.cookie)).prices[0].price_cents, 2000)
  } finally { f.db.close() }
})

test('agent orders are attributed to the same platform and isolated in list, detail and storefront state', async () => {
  const f = await fixture()
  try {
    const slug = String(f.db.prepare('SELECT slug FROM partners WHERE id=?').get(f.first.id)!.slug)
    const client = await f.request('/api/orders/client', {})
    const buyer = client.headers.get('Set-Cookie')!.split(';')[0]
    const place = () => f.request('/api/orders', { plan: 'plus', partner: slug, expectedPrice: 2000, key: crypto.randomUUID(), email: 'buyer@example.test' }, buyer)
    const response = await place()
    assert.equal(response.status, 201, await response.clone().text())
    const { order } = await response.json() as any
    assert.equal((await f.get('/api/partner/orders')).total, 1)
    assert.equal((await f.get('/api/partner/orders', f.second.cookie)).total, 0)
    assert.equal((await f.get('/api/partner/orders/' + order.id)).order.id, order.id)
    assert.equal((await f.request('/api/partner/orders/' + order.id, undefined, f.second.cookie)).status, 404)
    assert.equal((await f.get('/api/admin/partners/' + f.first.id + '/orders/' + order.id, f.admin)).order.id, order.id)
    assert.equal((await f.get('/api/partner/orders?q=missing')).total, 0)
    assert.equal((await f.request('/api/partner/orders?store=' + f.second.id, undefined, f.first.cookie)).status, 404)
    assert.equal((await f.save({ active: false })).status, 200)
    assert.equal((await f.get('/api/catalog?partner=' + slug, '')).checkoutEnabled, false)
    assert.equal((await place()).status, 409)
    assert.equal((await f.save({ active: true })).status, 200)
    assert.equal((await f.request('/api/partner/stores/prices', { storeId: f.first.id, plan: 'plus', priceCents: 2000, enabled: false, version: 0 }, f.first.cookie)).status, 200)
    assert.equal((await place()).status, 409)
    assert.equal((await f.get('/api/partner/orders/' + order.id)).order.id, order.id)
  } finally { f.db.close() }
})

test('disabling an agent centrally revokes the workbench and storefront access', async () => {
  const f = await fixture()
  try {
    const p = f.db.prepare('SELECT * FROM partners WHERE id=?').get(f.first.id)!
    assert.equal((await f.request('/api/admin/partners/' + f.first.id, { name: p.name, email: p.email, active: false, version: p.version }, f.admin)).status, 200)
    assert.equal((await f.request('/api/partner/stores', undefined, f.first.cookie)).status, 401)
    assert.equal((await f.request('/api/catalog?partner=' + p.slug)).status, 404)
  } finally { f.db.close() }
})

test('payout account binding is scoped and stale confirmation cannot submit a payout', async () => {
  const f = await fixture()
  try {
    assert.equal((await f.request('/api/partner/payout-account', { phone: '13800000000', name: '演示用户', version: 0 }, f.first.cookie)).status, 200)
    assert.equal((await f.get('/api/partner/dashboard')).payoutAccount.version, 1)
    assert.equal((await f.get('/api/partner/dashboard', f.second.cookie)).payoutAccount.phone, '')
    assert.equal((await f.request('/api/partner/payout-account', { phone: '13800000001', name: '演示用户', version: 0 }, f.first.cookie)).status, 409)
    assert.equal((await f.request('/api/partner/payouts', { accountVersion: 0, key: crypto.randomUUID() }, f.first.cookie)).status, 409)
    assert.equal((await f.request('/api/partner/payouts', { accountVersion: 1, key: crypto.randomUUID() }, f.first.cookie)).status, 409)
  } finally { f.db.close() }
})
