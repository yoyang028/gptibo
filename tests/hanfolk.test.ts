import test from 'node:test'
import assert from 'node:assert/strict'
import { customerFixture } from './customer-fixture.ts'
import {
  hanfolkFamily,
  hanfolkMoney,
  skuName,
  supplierText,
  type HanfolkDetail,
} from '../shared/hanfolk-catalog.ts'
import {
  hanfolkDraft,
  importHanfolkDrafts,
} from '../worker/hanfolk/importer.ts'
import { HanfolkClient } from '../worker/hanfolk/client.ts'
import { productProblems } from '../shared/shop-products.ts'
import { unseal } from '../worker/product-secrets.ts'
import { defaultSupplySettings } from '../worker/partner-default-prices.ts'
// @ts-ignore -- Node test runtime imports the shared browser fixture directly.
import {
  createHanfolkFixture,
  hanfolkFixtureKey,
  hanfolkFixtureProducts,
} from '../scripts/cloudflare/hanfolk-fixture.mjs'

const source = hanfolkFixtureProducts as HanfolkDetail[]
test('Nine families match actual naming, source SKU order, amounts and safe text', () => {
  assert.equal(new Set(source.map((p) => hanfolkFamily(p.title))).size, 9)
  assert.equal(hanfolkFamily('Super Duoingo 12个月会员兑换'), 'duolingo')
  assert.equal(hanfolkFamily('30天长效 OpenAI SMS接码'), undefined)
  assert.equal(hanfolkMoney('19.80'), 1980)
  for (const bad of ['1.001', '-1', 'Infinity', '1e3'])
    assert.throws(() => hanfolkMoney(bad))
  assert.equal(
    skuName(
      {
        ...source[0],
        specs: [
          { title: '地区', values: [{ id: '2', name: '美国' }] },
          { title: '周期', values: [{ id: '5', name: '月卡' }] },
        ],
      },
      '2-5',
    ),
    '美国 · 月卡',
  )
  assert.throws(() => skuName(source[0], 'unknown'))
  assert.equal(
    supplierText(
      '<script>steal()</script><h2>说明</h2><p>&lt;img onerror=x&gt;<br>安全</p>',
    ),
    '### 说明\n<img onerror=x>\n安全',
  )
})
test('Read-only client pins host, headers, methods and refuses redirects or reflected secrets', async (t) => {
  const requests: Request[] = [],
    fixture = createHanfolkFixture()
  t.mock.method(
    globalThis,
    'fetch',
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const r = new Request(input, init)
      requests.push(r)
      return fixture.fetch(r)
    },
  )
  const client = new HanfolkClient(
    { API_LIMITER: { limit: async () => ({ success: true }) } },
    hanfolkFixtureKey,
  )
  assert.equal((await client.balance()).balanceCents, 12345)
  assert.equal((await client.products()).length, 9)
  assert.equal((await client.detail(100)).id, 100)
  assert(
    requests.every(
      (r) =>
        r.method === 'GET' &&
        !r.url.includes(hanfolkFixtureKey) &&
        r.headers.get('X-API-Key') === hanfolkFixtureKey,
    ),
  )
  t.mock.method(
    globalThis,
    'fetch',
    async () =>
      new Response(null, {
        status: 302,
        headers: { Location: 'https://example.invalid' },
      }),
  )
  await assert.rejects(client.balance(), /暂未响应/)
  t.mock.method(globalThis, 'fetch', async () =>
    Response.json({ success: true, balance: 1, reflected: hanfolkFixtureKey }),
  )
  await assert.rejects(client.balance(), /格式未通过/)
  t.mock.method(globalThis, 'fetch', async () =>
    Response.json({
      success: true,
      product: {
        ...source[0],
        sku_variants: [{ sku: 'missing', price: 3.21, stock: 1 }],
      },
    }),
  )
  await assert.rejects(client.detail(100), /格式未通过/)
})
test('Draft import keeps source costs private and does not alter existing catalog or enable sales', async () => {
  const f = await customerFixture(),
    before = f.db.prepare('SELECT * FROM catalog_plans ORDER BY id').all()
  const selection = source.flatMap((p) =>
    p.sku_variants.map((v) => ({ productId: p.id, sku: v.sku })),
  )
  const r = await importHanfolkDrafts(f.env, source, selection)
  assert.equal(r.imported.length, 18)
  assert.deepEqual(
    f.db
      .prepare(
        'SELECT * FROM catalog_plans WHERE id NOT IN (SELECT local_id FROM hanfolk_product_links) ORDER BY id',
      )
      .all(),
    before,
  )
  const p = await hanfolkDraft(source[0], '10')
  assert.equal(p.pricePending, true)
  assert.deepEqual(productProblems(p), [])
  assert(productProblems({ ...p, status: 'listed' }).length > 0)
  assert(productProblems({ ...p, status: 'published' }).length > 0)
  const publicCatalog = (await (await f.request('/api/catalog')).json()) as {
    products: { id: string }[]
    plans: { id: string }[]
  }
  assert(!publicCatalog.products.some((p) => r.imported.includes(p.id)))
  assert(!publicCatalog.plans.some((p) => r.imported.includes(p.id)))
  assert(
    !(await defaultSupplySettings(f.env)).plans.some((p) =>
      r.imported.includes(p.id),
    ),
  )
  assert.equal((await f.request('/api/admin/hanfolk')).status, 401)
  for (const cookie of ['', f.admin]) {
    const response = await f.request(
      '/api/orders',
      { plan: p.id, email: 'test@example.test', key: crypto.randomUUID() },
      cookie,
    )
    assert.notEqual(response.status, 200)
    assert.notEqual(response.status, 201)
  }
  const edited = {
    ...p,
    priceCents: 1980,
    pricePending: false,
    status: 'listed',
  }
  assert.equal(
    (await f.request('/api/admin/my-shop/products', edited, f.admin)).status,
    200,
  )
  const again = await importHanfolkDrafts(f.env, source, selection)
  assert.equal(again.imported.length, 0)
  assert.equal(again.existing.length, 18)
  const after = f.db
    .prepare('SELECT price_cents,enabled FROM catalog_plans WHERE id=?')
    .get(p.id)
  assert.deepEqual({ ...after }, { price_cents: 1980, enabled: 0 })
  assert.equal(
    (
      await f.request(
        '/api/admin/my-shop/products',
        {
          ...edited,
          version: 1,
          status: 'published',
          payment: {
            label: 'test',
            instructions: 'test',
            url: 'https://example.com',
            qr: '',
          },
        },
        f.admin,
      )
    ).status,
    409,
  )
})
test('Invalid bulk selection is rejected before writing; concurrent imports stay unique', async () => {
  const f = await customerFixture()
  await assert.rejects(
    importHanfolkDrafts(f.env, source, [
      { productId: 100, sku: '10' },
      { productId: 99999, sku: '10' },
    ]),
  )
  assert.equal(
    f.db.prepare('SELECT COUNT(*) n FROM hanfolk_product_links').get()?.n,
    0,
  )
  const results = await Promise.all([
    importHanfolkDrafts(f.env, source, [{ productId: 100, sku: '10' }]),
    importHanfolkDrafts(f.env, source, [{ productId: 100, sku: '10' }]),
  ])
  assert.equal(
    f.db.prepare('SELECT COUNT(*) n FROM hanfolk_product_links').get()?.n,
    1,
  )
  assert.equal(
    results.reduce((n, r) => n + r.imported.length, 0),
    1,
  )
})
test('Admin key encryption, optimistic versions, read-only refresh, real specs and redacted state', async (t) => {
  const f = await customerFixture(),
    fixture = createHanfolkFixture()
  t.mock.method(
    globalThis,
    'fetch',
    (input: RequestInfo | URL, init?: RequestInit) =>
      fixture.fetch(new Request(input, init)),
  )
  async function action(data: unknown, status = 200) {
    const r = await f.request('/api/admin/hanfolk', data, f.admin)
    assert.equal(r.status, status)
    return (await r.json()) as {
      version: number
      products: unknown[]
      result: { imported: string[] }
    }
  }
  const saved = await action({
    action: 'save-key',
    apiKey: hanfolkFixtureKey,
    version: 0,
  })
  assert(!JSON.stringify(saved).includes(hanfolkFixtureKey))
  const encrypted = f.db
    .prepare('SELECT api_secret FROM hanfolk_settings')
    .get()?.api_secret as string
  assert.notEqual(encrypted, hanfolkFixtureKey)
  assert.equal(await unseal(f.env, encrypted), hanfolkFixtureKey)
  await action({ action: 'refresh', version: 0 }, 409)
  const refreshed = await action({ action: 'refresh', version: 1 })
  assert.equal(refreshed.products.length, 9)
  await action({ action: 'detail', version: 2, productId: 9999 }, 409)
  await action({ action: 'detail', version: 2, productId: 100 })
  const imported = await action({
    action: 'import',
    version: 2,
    selection: [{ productId: 100, sku: '10' }],
  })
  assert.equal(imported.result.imported.length, 1)
  assert.equal(fixture.stats().reads, 3)
  assert.equal(fixture.stats().writes, 0)
})
