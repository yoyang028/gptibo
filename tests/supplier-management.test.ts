import test from 'node:test'
import assert from 'node:assert/strict'
import { customerFixture } from './customer-fixture.ts'
import { adminProductRoute, productSupplier } from '../shared/admin-suppliers.ts'
import type { ShopProduct, ShopProductInput } from '../shared/shop-products.ts'
import { unseal } from '../worker/product-secrets.ts'
import { hanfolkDraft, importHanfolkDrafts } from '../worker/hanfolk/importer.ts'
import type { HanfolkDetail } from '../shared/hanfolk-catalog.ts'
// @ts-ignore -- existing browser fixture shared with Node tests.
import { hanfolkFixtureProducts } from '../scripts/cloudflare/hanfolk-fixture.mjs'

const pair = { apiKey: 'd'.repeat(64), apiToken: 'e'.repeat(128) }
async function xiaojiuDraft(): Promise<ShopProductInput> {
  const p = await hanfolkDraft((hanfolkFixtureProducts as HanfolkDetail[])[0], '10')
  return { ...p, id: 'custom-' + crypto.randomUUID().replaceAll('-', ''), name: '本机采购草稿', pricePending: false, priceCents: 500, delivery: 'api', status: 'draft', api: { provider: 'xiaojiu', baseUrl: 'https://98-xj.com', productCode: '123', supplierProductId: 10, maxCostCents: 200, configured: false, verified: false }, ...pair }
}

test('Inventory uses explicit provider/link identity, remains admin-only and never calls upstream', async t => {
  const f = await customerFixture()
  t.after(() => f.db.close())
  const sources = hanfolkFixtureProducts as HanfolkDetail[]
  const imported = await importHanfolkDrafts(f.env, sources, [{ productId: sources[0].id, sku: '10' }])
  const draft = await xiaojiuDraft()
  const saved = await f.request('/api/admin/my-shop/products', draft, f.admin)
  assert.equal(saved.status, 201, await saved.clone().text())
  f.env.RECHARGE_PRODUCT_MAP = '{"plus":"chatgpt_plus_cdk_1m"}'
  const before = f.db.prepare('SELECT * FROM catalog_plans ORDER BY id').all()
  let calls = 0
  t.mock.method(globalThis, 'fetch', async () => { calls++; throw new Error('Inventory must not contact upstream') })
  assert.equal((await f.request('/api/admin/suppliers')).status, 401)
  const agent = await f.agent('supplier-inventory-agent')
  assert.equal((await f.request('/api/admin/suppliers', undefined, agent.cookie)).status, 401)
  const response = await f.request('/api/admin/suppliers', undefined, f.admin)
  assert.equal(response.status, 200)
  const text = await response.text()
  const snapshot = JSON.parse(text)
  assert.equal(snapshot.linkedSuppliers[imported.imported[0]], 'hanfolk')
  assert.equal(snapshot.products.find((p: ShopProduct) => p.id === draft.id).api.provider, 'xiaojiu')
  assert(snapshot.plans.every((p: { id: string }) => !p.id.startsWith('custom-')))
  for (const secret of ['api_secret', 'apiToken', 'apiKey', 'redemptionGuide', pair.apiKey, pair.apiToken]) assert(!text.includes(secret), secret)
  assert.deepEqual(f.db.prepare('SELECT * FROM catalog_plans ORDER BY id').all(), before)
  assert.equal(calls, 0)
})

test('A new Xiaojiu SKU reuses only a current credential from the same provider and keeps verification separate', async t => {
  const f = await customerFixture()
  t.after(() => f.db.close())
  const original = await xiaojiuDraft()
  const saved = await f.request('/api/admin/my-shop/products', original, f.admin)
  assert.equal(saved.status, 201, await saved.clone().text())
  const { product } = await saved.json() as { product: ShopProduct }
  const next = { ...await xiaojiuDraft(), apiKey: undefined, apiToken: undefined, credentialSource: { id: product.id, version: product.version } }
  const stale = await f.request('/api/admin/my-shop/products', { ...next, credentialSource: { id: product.id, version: product.version + 1 } }, f.admin)
  assert.equal(stale.status, 409)
  const wrongProvider = await f.request('/api/admin/my-shop/products', { ...next, api: { ...next.api, provider: 'json-v1' } }, f.admin)
  assert.equal(wrongProvider.status, 409)
  const wrongOrigin = await f.request('/api/admin/my-shop/products', { ...next, api: { ...next.api, baseUrl: 'https://another.example.com' } }, f.admin)
  assert.equal(wrongOrigin.status, 409)
  const mixed = await f.request('/api/admin/my-shop/products', { ...next, ...pair }, f.admin)
  assert.equal(mixed.status, 409)
  const result = await f.request('/api/admin/my-shop/products', next, f.admin)
  assert.equal(result.status, 201, await result.clone().text())
  const created = await result.json() as { product: ShopProduct }
  assert.equal(created.product.api?.configured, true)
  assert.equal(created.product.api?.verified, false)
  assert.equal(created.product.status, 'draft')
  assert(!JSON.stringify(created).includes('credentialSource'))
  const row = f.db.prepare('SELECT api_secret FROM shop_products WHERE id=?').get(created.product.id) as { api_secret: string }
  const credential = JSON.parse(await unseal(f.env, row.api_secret))
  assert.deepEqual(credential, { key: pair.apiKey, secret: pair.apiToken })
  const mutateExisting = await f.request('/api/admin/my-shop/products', { ...created.product, credentialSource: { id: product.id, version: product.version } }, f.admin)
  assert.equal(mutateExisting.status, 409)
})

test('Supplier classification does not guess from product names or category', async () => {
  const p = await xiaojiuDraft()
  assert.equal(productSupplier(p, {}), 'xiaojiu')
  assert.equal(productSupplier(p, { [p.id]: 'hanfolk' }), 'hanfolk')
  assert.equal(productSupplier({ ...p, api: { ...p.api!, provider: 'grizzly' } }, {}), 'grizzly')
  assert.equal(productSupplier({ ...p, name: '灰熊 大橘 小久', api: undefined, delivery: 'manual' }, {}), 'other')
})

test('Bugan inspection queries only mapped authorization and catalog, without changing prices or purchasing', async t => {
  const f = await customerFixture()
  t.after(() => f.db.close())
  Object.assign(f.env, { RECHARGE_API_BASE: 'https://supplier.example.com/v1', RECHARGE_PARTNER_ID: 'fixture-partner', RECHARGE_KEY_ID: 'fixture-key', RECHARGE_CLIENT_SECRET: 'fixture-only-signature', RECHARGE_PRODUCT_MAP: '{"plus":"plus-fixture"}' })
  const calls: { path: string; method: string }[] = []
  t.mock.method(globalThis, 'fetch', async (url: string, options: RequestInit) => {
    const parsed = new URL(url)
    assert.equal(parsed.origin, 'https://supplier.example.com')
    calls.push({ path: parsed.pathname, method: options.method! })
    if (parsed.pathname === '/v1/products') return Response.json({ data: [{ product_code: 'plus-fixture', available: true }] })
    if (parsed.pathname === '/v1/agent-profile') return Response.json({ data: { merchant: { partnerId: 'fixture-partner', status: 'active' }, profile: { customRedemptionEnabled: true }, collectionModes: ['platform_collect'], productSupplyPrices: { 'plus-fixture': '11000' } } })
    throw new Error('Unexpected upstream request')
  })
  const before = f.db.prepare('SELECT * FROM catalog_plans ORDER BY id').all()
  assert.equal((await f.request('/api/admin/suppliers/bugan/check', {})).status, 401)
  const result = await f.request('/api/admin/suppliers/bugan/check', {}, f.admin)
  assert.equal(result.status, 200)
  assert.deepEqual((await result.json() as { products: unknown }).products, [{ plan: 'plus', code: 'plus-fixture', costCents: 11000, available: true }])
  assert.deepEqual(calls.sort((a,b) => a.path.localeCompare(b.path)), [{ path: '/v1/agent-profile', method: 'GET' }, { path: '/v1/products', method: 'GET' }])
  assert.deepEqual(f.db.prepare('SELECT * FROM catalog_plans ORDER BY id').all(), before)
})

test('Previous admin links resolve to the corresponding supplier within product management', () => {
  for (const [old, supplier] of [['sms', 'grizzly'], ['hanfolk', 'hanfolk'], ['plans', 'other']])
    assert.deepEqual(adminProductRoute('?view=' + old), { view: 'products', supplier })
  assert.deepEqual(adminProductRoute('?view=products&supplier=xiaojiu'), { view: 'products', supplier: 'xiaojiu' })
  assert.deepEqual(adminProductRoute('?view=products&supplier=unknown'), { view: 'products', supplier: 'all' })
  assert.deepEqual(adminProductRoute('?view=orders&supplier=hanfolk'), { view: 'orders', supplier: 'all' })
})
