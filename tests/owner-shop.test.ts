import test from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { readFileSync, readdirSync } from 'node:fs'
import worker from '../worker/index.ts'
import { seedAdminEmailCode } from './admin-email-fixture.ts'
import { totpCode } from '../worker/totp.ts'
import { type Env, type Statement, type Value } from '../worker/platform.ts'
import { sendOwnerOrderNotifications } from '../worker/owner-shop.ts'
import type { ShopProduct } from '../shared/shop-products.ts'
import { sendVerificationEmail } from '../worker/email.ts'
import { fulfillCustomOrder } from '../worker/shop-products.ts'
import { reconcileShopProducts } from '../worker/shop-products.ts'
import {
  ARTWORK_TEMPLATES,
  defaultLayout,
  defaultProcessing,
} from '../shared/product-artwork.ts'

const credential = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ'
const image =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWQAAAABJRU5ErkJggg=='
async function setup() {
  const db = new DatabaseSync(':memory:')
  for (const file of readdirSync(new URL('../migrations/', import.meta.url))
    .filter((f) => f.endsWith('.sql'))
    .sort())
    db.exec(
      readFileSync(new URL('../migrations/' + file, import.meta.url), 'utf8'),
    )
  const bound = new WeakMap<Statement, { sql: string; values: Value[] }>()
  const env: Env = {
    ASSETS: { fetch: async () => new Response('asset') },
    ADMIN_USERNAME: 'owner',
    ADMIN_EMAIL: 'owner@example.test',
    ADMIN_TOTP_SECRET: credential,
    PARTNER_AUTH_SECRET: 'fixture-owner-credential-encryption-secret-not-live',
    INTEREST_LIMITER: { limit: async () => ({ success: true }) },
    API_LIMITER: { limit: async () => ({ success: true }) },
    EXPENSIVE_LIMITER: { limit: async () => ({ success: true }) },
    INTEREST_DB: {
      prepare(sql) {
        const state = { sql, values: [] as Value[] }
        const s: Statement = {
          bind(...v) {
            state.values = v
            return this
          },
          async first<T>() {
            return (db.prepare(sql).get(...state.values) ?? null) as T | null
          },
          async all<T>() {
            return { results: db.prepare(sql).all(...state.values) as T[] }
          },
          async run() {
            return db.prepare(sql).run(...state.values)
          },
        }
        bound.set(s, state)
        return s
      },
      async batch(statements) {
        db.exec('BEGIN')
        try {
          const result = statements.map((s) => {
            const state = bound.get(s)!
            return /^\s*SELECT\b/.test(state.sql)
              ? { results: db.prepare(state.sql).all(...state.values) }
              : db.prepare(state.sql).run(...state.values)
          })
          db.exec('COMMIT')
          return result
        } catch (e) {
          db.exec('ROLLBACK')
          throw e
        }
      },
    },
  }
  const request = (
    path: string,
    data?: unknown,
    cookie = '',
    origin = 'https://shop.example.com',
  ) =>
    worker.fetch(
      new Request('https://shop.example.com' + path, {
        method: data === undefined ? 'GET' : 'POST',
        headers: {
          Origin: origin,
          'Content-Type': 'application/json',
          Cookie: cookie,
        },
        ...(data !== undefined ? { body: JSON.stringify(data) } : {}),
      }),
      env,
    )
  const login = async () => {
    const response = await request('/api/admin/login', {
      username: 'owner',
      code: await totpCode(credential),
      ...(await seedAdminEmailCode(db, env)),
    })
    assert.equal(response.status, 200, await response.clone().text())
    return response.headers.get('set-cookie')!.split(';')[0]
  }
  const buyer = async () =>
    (await request('/api/orders/client', {})).headers
      .get('set-cookie')!
      .split(';')[0]
  const admin = await login()
  const saveProduct = async (product: ShopProduct, action = '') => {
    const response = await request(
      '/api/admin/my-shop/products' + action,
      product,
      admin,
    )
    assert.ok(response.ok, await response.clone().text())
    return (await response.json()).product as ShopProduct
  }
  const create = async (
    product: ShopProduct,
    cookie: string,
    fields: Record<string, string> = {},
    key = crypto.randomUUID(),
  ) =>
    request(
      '/api/orders',
      {
        plan: product.id,
        email: 'customer@example.com',
        fields,
        expectedPrice: product.priceCents,
        key,
      },
      cookie,
    )
  return { db, env, request, admin, buyer, saveProduct, create }
}
function product(overrides: Partial<ShopProduct> = {}): ShopProduct {
  return {
    id: '',
    version: 0,
    status: 'published',
    name: '测试订阅',
    category: '工具服务',
    tagline: '完整信息测试',
    description: '用于本地验证的商品，非真实供货。',
    image,
    badge: '自营商品',
    unit: '份',
    duration: '1 个月',
    priceCents: 990,
    stock: 5,
    features: ['订单可查'],
    purchaseNote: '测试商品；交付前可申请售后。',
    deliveryInstructions: '确认收款后提供领取信息。',
    steps: [{ title: '下单', description: '填写邮箱并核对付款。' }],
    faq: [{ question: '如何交付？', answer: '在订单中领取。' }],
    fields: [],
    delivery: 'manual',
    payment: {
      label: '测试收款',
      instructions: '核对店主收款和订单金额。',
      url: 'https://payments.example.com/pay',
      qr: '',
    },
    ...overrides,
  }
}

async function xiaojiuFixture(t: Parameters<Parameters<typeof test>[1]>[0]) {
  const s = await setup()
  t.after(() => s.db.close())
  s.env.XIAOJIU_PURCHASE_ENABLED = 'true'
  const key = 'b'.repeat(64),
    secret = 'c'.repeat(128)
  const calls: { path: string; body: string }[] = []
  let loseCreate = false,
    actual = '2.00',
    authFailure = false
  let merchant = ''
  t.mock.method(globalThis, 'fetch', async (input, init) => {
    const url = new URL(String(input)),
      raw = String(init?.body ?? '')
    assert.equal(url.origin, 'https://98-xj.com')
    assert.equal(new Headers(init?.headers).get('Dujiao-Next-Api-Key'), key)
    calls.push({ path: url.pathname, body: raw })
    if (url.pathname.endsWith('/ping'))
      return Response.json({
        ok: true,
        user_id: 1,
        balance: '100.00',
        currency: 'CNY',
      })
    if (url.pathname.endsWith('/products/10'))
      return Response.json({
        ok: true,
        product: {
          id: 10,
          is_active: true,
          fulfillment_type: 'auto',
          skus: [
            {
              id: 123,
              is_active: true,
              price_amount: '2.00',
              stock_status: 'in_stock',
              stock_quantity: 20,
            },
          ],
        },
      })
    if (url.pathname.endsWith('/orders')) {
      merchant = JSON.parse(raw).downstream_order_no
      if (authFailure)
        return Response.json(
          { ok: false, error_code: 'authentication_failed' },
          { status: 401 },
        )
      if (loseCreate) {
        loseCreate = false
        throw new Error('Response lost after debit')
      }
      return Response.json({
        ok: true,
        order_id: 456,
        amount: actual,
        currency: 'CNY',
        downstream_order_no: merchant,
      })
    }
    assert.equal(url.pathname, '/api/v1/upstream/orders/456')
    return Response.json({
      ok: true,
      order_id: 456,
      amount: actual,
      refunded_amount: '0.00',
      currency: 'CNY',
      status: 'completed',
      items: [
        {
          product_id: 10,
          sku_id: 123,
          quantity: 1,
          unit_price: actual,
          total_price: actual,
          fulfillment_type: 'auto',
        },
      ],
      fulfillment: {
        type: 'auto',
        status: 'delivered',
        payload: 'XIAOJIU-PRIVATE-FIXTURE-CARD',
      },
    })
  })
  const verified = await s.request(
    '/api/admin/my-shop/products/verify-api',
    {
      ...product({
        status: 'draft',
        delivery: 'api',
        api: {
          provider: 'xiaojiu',
          baseUrl: 'https://98-xj.com',
          productCode: '123',
          supplierProductId: 10,
          maxCostCents: 300,
          configured: false,
          verified: false,
        },
      }),
      apiKey: key,
      apiToken: secret,
    },
    s.admin,
  )
  assert.equal(verified.status, 201, await verified.clone().text())
  const p = await s.saveProduct({
    ...(await verified.json()).product,
    status: 'published',
  })
  const buyer = await s.buyer()
  const create = async () => {
    const response = await s.create(p, buyer)
    assert.equal(response.status, 201, await response.clone().text())
    return (await response.json()).order
  }
  const confirm = async (order: { id: string; version: number }) => {
    await s.request(
      '/api/orders/' + order.id + '/custom-action',
      {
        action: 'claim-payment',
        reference: 'fixture-payment-123',
        version: order.version,
      },
      buyer,
    )
    const response = await s.request(
      '/api/admin/my-shop/orders/' + order.id,
      {
        action: 'confirm-payment',
        version: order.version,
        note: '已核对本机模拟到账',
      },
      s.admin,
    )
    assert.equal(response.status, 200, await response.clone().text())
    return (await response.json()).order
  }
  return {
    ...s,
    key,
    secret,
    p,
    buyerCookie: buyer,
    calls,
    createXiaojiu: create,
    confirm,
    loseNextCreate: () => {
      loseCreate = true
    },
    raiseActualCost: () => {
      actual = '4.00'
    },
    rejectAuth: () => {
      authFailure = true
    },
  }
}

test('Xiaojiu product credentials are encrypted, checks spend nothing, and only owner-confirmed payment buys and delivers', async (t) => {
  const s = await xiaojiuFixture(t)
  assert.equal(s.calls.filter((c) => c.path.endsWith('/orders')).length, 0)
  const stored = s.db
    .prepare('SELECT api_secret FROM shop_products WHERE id=?')
    .get(s.p.id)!.api_secret as string
  assert.ok(!stored.includes(s.key) && !stored.includes(s.secret))
  const catalog = await (await s.request('/api/catalog')).text()
  assert.ok(!catalog.includes(s.key) && !catalog.includes(s.secret))
  const order = await s.createXiaojiu()
  assert.equal(s.calls.filter((c) => c.path.endsWith('/orders')).length, 0)
  const delivered = await s.confirm(order)
  assert.equal(delivered.status, 'success')
  assert.equal(delivered.custom.deliveryContent, 'XIAOJIU-PRIVATE-FIXTURE-CARD')
  assert.equal(
    s.db.prepare('SELECT cost_cents FROM orders WHERE id=?').get(order.id)!
      .cost_cents,
    200,
  )
  await Promise.all([
    fulfillCustomOrder(s.env, order.id),
    fulfillCustomOrder(s.env, order.id),
  ])
  assert.equal(s.calls.filter((c) => c.path.endsWith('/orders')).length, 1)
  assert.equal(
    (await s.request('/api/orders/' + order.id, undefined, await s.buyer()))
      .status,
    404,
  )
})

test('Xiaojiu durable uncertain-creation recovery reuses the same business number instead of buying another card', async (t) => {
  const s = await xiaojiuFixture(t),
    order = await s.createXiaojiu()
  s.loseNextCreate()
  const pending = await s.confirm(order)
  assert.equal(pending.custom.supplierState, 'unknown')
  assert.equal(
    s.db
      .prepare(
        'SELECT supplier_attempted FROM shop_order_details WHERE order_id=?',
      )
      .get(order.id)!.supplier_attempted,
    1,
  )
  await fulfillCustomOrder(s.env, order.id)
  const creates = s.calls.filter((c) => c.path.endsWith('/orders'))
  assert.equal(creates.length, 2)
  assert.equal(creates[0].body, creates[1].body)
  const recovered = (
    await (
      await s.request('/api/orders/' + order.id, undefined, s.buyerCookie)
    ).json()
  ).order
  assert.equal(recovered.status, 'success')
  assert.equal(recovered.custom.deliveryContent, 'XIAOJIU-PRIVATE-FIXTURE-CARD')
})

test('Xiaojiu actual over-limit charges retain cost and remote ID without delivering, repurchasing, or hiding the issue from admin', async (t) => {
  const s = await xiaojiuFixture(t),
    order = await s.createXiaojiu()
  s.raiseActualCost()
  const result = await s.confirm(order)
  assert.equal(result.custom.supplierState, 'review')
  assert.match(result.custom.supplierError, /实际扣款/)
  assert.equal(result.custom.deliveryContent, null)
  assert.equal(
    s.db.prepare('SELECT cost_cents FROM orders WHERE id=?').get(order.id)!
      .cost_cents,
    400,
  )
  assert.equal(
    s.db
      .prepare('SELECT supplier_id FROM shop_order_details WHERE order_id=?')
      .get(order.id)!.supplier_id,
    '456',
  )
  await reconcileShopProducts(s.env)
  await fulfillCustomOrder(s.env, order.id)
  assert.equal(s.calls.filter((c) => c.path.endsWith('/orders')).length, 1)
  const deliver = () =>
    s.request(
      '/api/admin/my-shop/orders/' + order.id,
      {
        action: 'deliver',
        version: result.version,
        note: '核对中的订单不能直接补发',
        content: 'MUST-NOT-DELIVER',
      },
      s.admin,
    )
  assert.equal((await deliver()).status, 409)
  assert.equal(
    (
      await s.request(
        '/api/orders/' + order.id + '/refunds',
        {
          action: 'request',
          version: result.version,
          key: crypto.randomUUID(),
          reason: '采购结果仍在核对',
          amountCents: result.priceCents,
        },
        s.buyerCookie,
      )
    ).status,
    409,
  )
  // A reconciliation result can change after the initial admin precheck.
  // The transaction must recheck the hold before marking delivery successful.
  s.db
    .prepare(
      "UPDATE shop_order_details SET supplier_state='failed' WHERE order_id=?",
    )
    .run(order.id)
  const batch = s.env.INTEREST_DB.batch.bind(s.env.INTEREST_DB)
  s.env.INTEREST_DB.batch = async (statements) => {
    s.db
      .prepare(
        "UPDATE shop_order_details SET supplier_state='review' WHERE order_id=?",
      )
      .run(order.id)
    return batch(statements)
  }
  assert.equal((await deliver()).status, 409)
  assert.equal(
    s.db.prepare('SELECT status FROM orders WHERE id=?').get(order.id)!.status,
    'processing',
  )
  assert.equal(
    s.db
      .prepare(
        'SELECT delivery_content FROM shop_order_details WHERE order_id=?',
      )
      .get(order.id)!.delivery_content,
    '',
  )
})

test('Xiaojiu sales are unavailable when spending is disabled and auth failures remain paused for background reconciliation', async (t) => {
  const s = await xiaojiuFixture(t)
  s.env.XIAOJIU_PURCHASE_ENABLED = 'false'
  const catalog = await (await s.request('/api/catalog')).json()
  assert.equal(
    catalog.products.some((p: ShopProduct) => p.id === s.p.id),
    false,
  )
  assert.equal((await s.create(s.p, s.buyerCookie)).status, 409)
  s.env.XIAOJIU_PURCHASE_ENABLED = 'true'
  const order = await s.createXiaojiu()
  s.rejectAuth()
  const result = await s.confirm(order)
  assert.equal(result.custom.supplierState, 'review')
  assert.match(result.custom.supplierError, /凭据/)
  const count = s.calls.length
  await reconcileShopProducts(s.env)
  await fulfillCustomOrder(s.env, order.id, true)
  assert.equal(s.calls.length, count)
  assert.equal(
    s.db.prepare('SELECT paused FROM xiaojiu_api_controls').get()!.paused,
    1,
  )
})

test('owner workspace requires main-admin session and rejects cross-origin writes', async () => {
  const s = await setup(),
    buyer = await s.buyer()
  assert.equal((await s.request('/api/admin/my-shop/stores')).status, 401)
  assert.equal(
    (await s.request('/api/admin/my-shop/products', undefined, buyer)).status,
    401,
  )
  assert.equal(
    (
      await s.request(
        '/api/admin/my-shop/products',
        product(),
        s.admin,
        'https://elsewhere.example.com',
      )
    ).status,
    403,
  )
  const stores = await (
    await s.request('/api/admin/my-shop/stores', undefined, s.admin)
  ).json()
  assert.equal(stores.stores.length, 1)
  assert.equal(stores.stores[0].id, 'platform')
  assert.equal(
    (await s.request('/api/admin/my-shop/domain', undefined, s.admin)).status,
    200,
  )
})
test('owner brand, contacts, announcement and root visibility persist without creating a reseller', async () => {
  const s = await setup()
  const response = await s.request(
    '/api/admin/my-shop/stores',
    {
      id: 'platform',
      version: 0,
      name: '我的商店',
      active: true,
      settings: {
        brandName: '星辰商店',
        logo: image,
        headline: '找到适合你的服务',
        description: '自营店铺',
        announcementTitle: '营业公告',
        announcement: '测试通知',
        email: 'support@example.com',
        qq: '123456',
        wechat: 'shop-test',
      },
    },
    s.admin,
  )
  assert.equal(response.status, 200, await response.clone().text())
  const catalog = await (await s.request('/api/catalog')).json()
  assert.equal(catalog.shop.brandName, '星辰商店')
  assert.equal(catalog.shop.logo, image)
  assert.equal(catalog.announcement.content, '测试通知')
  assert.equal(catalog.supportContacts.email, 'support@example.com')
  assert.equal(s.db.prepare('SELECT COUNT(*) n FROM partners').get()!.n, 0)
  assert.equal(
    (
      await s.request(
        '/api/admin/my-shop/stores',
        { id: 'platform', version: 0, name: 'old', active: true, settings: {} },
        s.admin,
      )
    ).status,
    409,
  )
  const invalid = await s.request(
    '/api/admin/my-shop/stores',
    {
      id: 'platform',
      version: 1,
      name: 'bad',
      active: true,
      settings: { email: 'not-an-email' },
    },
    s.admin,
  )
  assert.equal(invalid.status, 400)
  assert.equal(
    (await (await s.request('/api/catalog')).json()).shop.brandName,
    '星辰商店',
  )
  const ids = catalog.productOrder
  assert.equal(
    (
      await s.request(
        '/api/admin/my-shop/product-order',
        {
          version: 1,
          productIds: [...ids].reverse(),
          hiddenProductIds: ['gmail'],
        },
        s.admin,
      )
    ).status,
    200,
  )
  assert.deepEqual(
    (await (await s.request('/api/catalog')).json()).hiddenProductIds,
    ['gmail'],
  )
})
test('publishing validates all detail fields and keeps drafts off the storefront', async () => {
  const s = await setup()
  const draft = await s.saveProduct(
    product({
      status: 'draft',
      description: '',
      image: '',
      steps: [],
      faq: [],
      purchaseNote: '',
    }),
  )
  const publicDraftCatalog = await (await s.request('/api/catalog')).json()
  assert.equal(publicDraftCatalog.products.length, 0)
  assert.equal(
    publicDraftCatalog.plans.some((p: { id: string }) => p.id === draft.id),
    false,
  )
  const response = await s.request(
    '/api/admin/my-shop/products',
    { ...draft, status: 'published' },
    s.admin,
  )
  assert.equal(response.status, 400)
  assert.match((await response.json()).error, /发布前|补全/)
  const published = await s.saveProduct({
    ...product(),
    id: draft.id,
    version: draft.version,
  })
  assert.equal(
    (await (await s.request('/api/catalog')).json()).products[0].id,
    published.id,
  )
  assert.equal(
    (await (await s.request('/api/catalog')).json()).plans.some(
      (p: { id: string }) => p.id === published.id,
    ),
    true,
  )
  assert.equal(
    (
      await s.request(
        '/api/admin/my-shop/products',
        { ...published, image: 'data:image/svg+xml;base64,PHN2Zz4=' },
        s.admin,
      )
    ).status,
    400,
  )
})
test('listed product groups expose specifications without enabling collection or purchases and share one visibility control', async () => {
  const s = await setup()
  const emptyPayment = { label: '', instructions: '', url: '', qr: '' }
  const first = await s.saveProduct(
    product({
      name: 'Claude Pro',
      groupId: 'claude',
      status: 'listed',
      payment: emptyPayment,
    }),
  )
  const second = await s.saveProduct(
    product({
      name: 'Claude Max',
      groupId: 'claude',
      status: 'listed',
      payment: emptyPayment,
      priceCents: 2000,
    }),
  )
  const codex = await s.saveProduct(
    product({
      name: 'Codex 250',
      groupId: 'codex-credits',
      status: 'listed',
      payment: emptyPayment,
    }),
  )
  const catalog = await (await s.request('/api/catalog')).json()
  assert.equal(catalog.products.length, 3)
  assert.equal(catalog.checkoutEnabled, false)
  assert.deepEqual(
    catalog.plans
      .filter((p: { id: string }) => [first.id, second.id].includes(p.id))
      .map((p: { product_id: string }) => p.product_id),
    ['claude', 'claude'],
  )
  assert.equal(
    catalog.plans.some(
      (p: { id: string; enabled: number }) =>
        [first.id, second.id, codex.id].includes(p.id) && p.enabled,
    ),
    false,
  )
  const buyer = await s.buyer()
  assert.equal((await s.create(first, buyer)).status, 409)
  // An independent price editor cannot make an unconfigured listing purchasable.
  s.db.prepare('UPDATE catalog_plans SET enabled=1 WHERE id=?').run(first.id)
  assert.equal((await s.create(first, buyer)).status, 409)
  const refreshed = await (await s.request('/api/catalog')).json()
  assert.equal(
    refreshed.plans.find((p: { id: string }) => p.id === first.id).enabled,
    0,
  )
  const order = await (
    await s.request('/api/admin/my-shop/product-order', undefined, s.admin)
  ).json()
  assert.equal(
    order.productIds.filter((id: string) => id === 'claude').length,
    1,
  )
  assert.equal(order.productIds.includes(first.id), false)
  assert.equal(order.productIds.includes(second.id), false)
  const hidden = await s.request(
    '/api/admin/my-shop/product-order',
    { ...order, hiddenProductIds: ['claude'] },
    s.admin,
  )
  assert.equal(hidden.status, 200, await hidden.clone().text())
  const hiddenCatalog = await (await s.request('/api/catalog')).json()
  assert.equal(
    hiddenCatalog.products.some((p: ShopProduct) => p.groupId === 'claude'),
    false,
  )
  assert.equal(
    hiddenCatalog.products.some((p: ShopProduct) => p.id === codex.id),
    true,
  )
  assert.equal(s.db.prepare('SELECT COUNT(*) n FROM orders').get()!.n, 0)
  assert.equal(
    (await s.saveProduct({ ...first, groupId: 'claude', status: 'archived' }))
      .id,
    first.id,
  )
  const activePrices = (
    await (
      await s.request('/api/admin/my-shop/stores', undefined, s.admin)
    ).json()
  ).prices
  assert.equal(
    activePrices.some((p: { plan: string }) => p.plan === first.id),
    false,
  )
  assert.equal(
    activePrices.some((p: { plan: string }) => p.plan === second.id),
    true,
  )
})

test('regrouping a specification keeps its order identity and original delivery snapshot', async () => {
  const s = await setup()
  const original = await s.saveProduct(
    product({ groupId: 'claude', name: 'Original specification' }),
  )
  const buyer = await s.buyer()
  const response = await s.create(original, buyer)
  assert.equal(response.status, 201)
  const order = (await response.json()).order
  const edited = await s.saveProduct({
    ...original,
    version: Number(
      s.db
        .prepare('SELECT version FROM shop_products WHERE id=?')
        .get(original.id)!.version,
    ),
    groupId: 'codex-credits',
    name: 'Updated specification',
  })
  assert.equal(edited.id, original.id)
  assert.equal(
    s.db
      .prepare('SELECT product_id FROM catalog_plans WHERE id=?')
      .get(original.id)!.product_id,
    'codex-credits',
  )
  const oldOrder = (
    await (await s.request('/api/orders/' + order.id, undefined, buyer)).json()
  ).order
  assert.equal(oldOrder.plan, original.id)
  assert.equal(oldOrder.custom.productName, 'Original specification')
  const snapshot = JSON.parse(
    String(
      s.db
        .prepare('SELECT snapshot FROM shop_order_details WHERE order_id=?')
        .get(order.id)!.snapshot,
    ),
  )
  assert.equal(snapshot.groupId, 'claude')
})

test('custom order snapshots survive edits; buyer payment declarations do not confirm money or deliver', async () => {
  const s = await setup(),
    p = await s.saveProduct(
      product({
        fields: [{ key: 'account', label: '账号邮箱', required: true }],
      }),
    ),
    buyer = await s.buyer()
  assert.equal((await s.create(p, buyer)).status, 400)
  const response = await s.create(p, buyer, { account: 'account@example.com' })
  assert.equal(response.status, 201, await response.clone().text())
  const order = (await response.json()).order
  assert.equal(order.paymentStatus, 'unpaid')
  assert.equal(order.custom.deliveryContent, null)
  const claim = await s.request(
    `/api/orders/${order.id}/custom-action`,
    {
      action: 'claim-payment',
      reference: 'transaction-123',
      version: order.version,
    },
    buyer,
  )
  assert.equal(claim.status, 200)
  assert.equal((await claim.json()).order.paymentStatus, 'unpaid')
  const current = await s.db
    .prepare('SELECT version FROM shop_products WHERE id=?')
    .get(p.id)
  await s.saveProduct({
    ...p,
    version: current!.version as number,
    payment: { ...p.payment, label: '新收款方式' },
  })
  const view = (
    await (await s.request('/api/orders/' + order.id, undefined, buyer)).json()
  ).order
  assert.equal(view.custom.payment.label, '测试收款')
  const other = await s.buyer()
  assert.equal(
    (await s.request('/api/orders/' + order.id, undefined, other)).status,
    404,
  )
  assert.equal(
    (
      await s.request(
        '/api/admin/my-shop/orders/' + order.id,
        {
          action: 'confirm-payment',
          version: order.version,
          note: '已核对到账',
        },
        buyer,
      )
    ).status,
    401,
  )
  const paid = await s.request(
    '/api/admin/my-shop/orders/' + order.id,
    {
      action: 'confirm-payment',
      version: order.version,
      note: '已核对原收款记录真实到账',
    },
    s.admin,
  )
  assert.equal(paid.status, 200, await paid.clone().text())
  const paidOrder = (await paid.json()).order
  assert.equal(paidOrder.paymentStatus, 'paid')
  const delivered = await s.request(
    '/api/admin/my-shop/orders/' + order.id,
    {
      action: 'deliver',
      version: paidOrder.version,
      note: '已交付测试领取链接',
      content: 'https://delivery.example.com/claim',
    },
    s.admin,
  )
  assert.equal(delivered.status, 200, await delivered.clone().text())
  assert.equal((await delivered.json()).order.status, 'success')
  assert.equal(
    (
      await (
        await s.request('/api/orders/' + order.id, undefined, buyer)
      ).json()
    ).order.custom.deliveryContent,
    'https://delivery.example.com/claim',
  )
})
test('limited stock, idempotency and stale product edits do not oversell', async () => {
  const s = await setup(),
    p = await s.saveProduct(product({ stock: 1 })),
    buyer = await s.buyer(),
    key = crypto.randomUUID()
  const first = await s.create(p, buyer, {}, key)
  assert.equal(first.status, 201, await first.clone().text())
  const id = (await first.json()).order.id
  const again = await s.create(p, buyer, {}, key)
  assert.equal(again.status, 201)
  assert.equal((await again.json()).order.id, id)
  assert.equal((await s.create(p, await s.buyer())).status, 409)
  assert.equal(
    (
      await s.request(
        '/api/admin/my-shop/products',
        { ...p, description: 'stale' },
        s.admin,
      )
    ).status,
    409,
  )
  const cancelled = await s.request(
    '/api/orders/' + id + '/custom-action',
    { action: 'cancel', version: 0 },
    buyer,
  )
  assert.equal(cancelled.status, 200)
  assert.equal(
    s.db
      .prepare('SELECT stock_remaining FROM shop_products WHERE id=?')
      .get(p.id)!.stock_remaining,
    1,
  )
  assert.equal((await s.create(p, await s.buyer())).status, 201)
})
test('API credentials remain encrypted and private; only a verified compatible catalog can publish', async () => {
  const s = await setup(),
    original = globalThis.fetch,
    secret = 'fixture-supplier-token-not-a-live-key'
  let calls = 0
  globalThis.fetch = async (input, init) => {
    calls++
    assert.equal(String(input), 'https://supplier.example.com/v1/products')
    assert.equal(init?.method, 'GET')
    assert.equal(
      new Headers(init?.headers).get('Authorization'),
      'Bearer ' + secret,
    )
    return Response.json({
      products: [{ product_code: 'fixture-plan', available: true }],
    })
  }
  try {
    const input = {
      ...product({
        status: 'draft',
        delivery: 'api',
        api: {
          baseUrl: 'https://supplier.example.com/v1',
          productCode: 'fixture-plan',
          maxCostCents: 500,
          configured: false,
          verified: false,
        },
      }),
      apiToken: secret,
    }
    const checked = await s.request(
      '/api/admin/my-shop/products/verify-api',
      input,
      s.admin,
    )
    assert.equal(checked.status, 201, await checked.clone().text())
    const p = (await checked.json()).product
    assert.equal(p.api.verified, true)
    assert.equal(calls, 1)
    const stored = s.db
      .prepare('SELECT api_secret FROM shop_products WHERE id=?')
      .get(p.id)!.api_secret as string
    assert.notEqual(stored, secret)
    assert.ok(stored.length > 40)
    const published = await s.saveProduct({ ...p, status: 'published' })
    const catalog = await (await s.request('/api/catalog')).json()
    assert.equal(catalog.products[0].api, undefined)
    assert.ok(!JSON.stringify(catalog).includes(secret))
    const invalid = await s.request(
      '/api/admin/my-shop/products/verify-api',
      {
        ...published,
        status: 'draft',
        api: { ...published.api, baseUrl: 'https://127.0.0.1/v1' },
      },
      s.admin,
    )
    assert.equal(invalid.status, 400)
    assert.equal(calls, 1)
  } finally {
    globalThis.fetch = original
  }
})
test('API delivery waits for confirmed payment; transport uncertainty queries the original order without another purchase', async () => {
  const s = await setup(),
    original = globalThis.fetch
  let posts = 0,
    queries = 0,
    id = ''
  globalThis.fetch = async (input, init) => {
    const url = String(input)
    if (url.endsWith('/products'))
      return Response.json({
        products: [{ product_code: 'fixture-plan', available: true }],
      })
    if (init?.method === 'POST') {
      posts++
      id = JSON.parse(String(init.body)).merchant_order_no
      throw new Error('simulated transport interruption')
    }
    queries++
    assert.ok(url.endsWith('/orders/' + id))
    return Response.json({
      merchant_order_no: id,
      cost_cents: 100,
      order_id: 'supplier-order-1',
      status: 'success',
      delivery_content: 'TEST-DELIVERY',
    })
  }
  try {
    const response = await s.request(
      '/api/admin/my-shop/products/verify-api',
      {
        ...product({
          status: 'draft',
          delivery: 'api',
          api: {
            baseUrl: 'https://supplier.example.com/v1',
            productCode: 'fixture-plan',
            maxCostCents: 500,
            configured: false,
            verified: false,
          },
        }),
        apiToken: 'fixture-api-token',
      },
      s.admin,
    )
    const p = await s.saveProduct({
      ...(await response.json()).product,
      status: 'published',
    })
    const buyer = await s.buyer(),
      created = await s.create(p, buyer),
      order = (await created.json()).order
    await s.request(
      `/api/orders/${order.id}/custom-action`,
      { action: 'claim-payment', reference: 'payment-123', version: 0 },
      buyer,
    )
    assert.equal(posts, 0)
    const paid = await s.request(
      '/api/admin/my-shop/orders/' + order.id,
      { action: 'confirm-payment', note: '核实真实到账记录', version: 0 },
      s.admin,
    )
    assert.equal(paid.status, 200, await paid.clone().text())
    assert.equal(posts, 1)
    assert.equal((await paid.json()).order.custom.supplierState, 'unknown')
    const result = await s.request('/api/orders/' + order.id, undefined, buyer)
    assert.equal(result.status, 200, await result.clone().text())
    const success = (await result.json()).order
    assert.equal(success.status, 'success')
    assert.equal(success.custom.deliveryContent, 'TEST-DELIVERY')
    assert.equal(posts, 1)
    assert.equal(queries, 1)
  } finally {
    globalThis.fetch = original
  }
})
test('closed owner store prevents new built-in and custom purchases while preserving existing order access', async () => {
  const s = await setup(),
    p = await s.saveProduct(product()),
    buyer = await s.buyer(),
    created = await s.create(p, buyer),
    id = (await created.json()).order.id
  assert.equal(
    (
      await s.request(
        '/api/admin/my-shop/stores',
        {
          id: 'platform',
          version: 0,
          name: '测试商店',
          active: false,
          settings: {},
        },
        s.admin,
      )
    ).status,
    200,
  )
  const catalog = await (await s.request('/api/catalog')).json()
  assert.equal(catalog.checkoutEnabled, false)
  assert.ok(catalog.plans.every((p: { enabled: number }) => p.enabled === 0))
  assert.equal((await s.create(p, buyer)).status, 409)
  assert.equal(
    (await s.request('/api/orders/' + id, undefined, buyer)).status,
    200,
  )
})
test('coupon reservations are atomic with order insertion and enforce per-email and total usage', async () => {
  const s = await setup()
  s.env.ORDER_TESTING_ENABLED = 'true'
  const coupon = {
    id: '',
    version: 0,
    code: 'WELCOME',
    discountCents: 1000,
    startsAt: new Date(Date.now() - 60000).toISOString(),
    endsAt: new Date(Date.now() + 3600000).toISOString(),
    maxUses: 1,
    oncePerEmail: true,
    active: true,
    targets: [{ storeId: 'platform', plan: 'plus' }],
  }
  assert.equal(
    (await s.request('/api/admin/my-shop/coupons', coupon, s.admin)).status,
    200,
  )
  const quote = await s.request(
    '/api/orders/coupon-quote',
    { plan: 'plus', email: 'customer@example.com', code: 'WELCOME' },
    await s.buyer(),
  )
  assert.equal(quote.status, 200)
  assert.equal((await quote.json()).priceCents, 12900)
  const buyer = await s.buyer(),
    response = await s.request(
      '/api/orders',
      {
        plan: 'plus',
        email: 'customer@example.com',
        key: crypto.randomUUID(),
        expectedPrice: 12900,
        couponCode: 'WELCOME',
      },
      buyer,
    )
  assert.equal(response.status, 201, await response.clone().text())
  assert.equal((await response.json()).order.price, 129)
  assert.equal(
    (
      await s.request(
        '/api/orders/coupon-quote',
        { plan: 'plus', email: 'customer@example.com', code: 'WELCOME' },
        buyer,
      )
    ).status,
    409,
  )
  assert.equal(
    s.db.prepare('SELECT COUNT(*) n FROM shop_coupon_uses').get()!.n,
    1,
  )
})
test('order completion notices are opt-in, avoid customer secrets, and deduplicate sent messages', async () => {
  const s = await setup(),
    original = globalThis.fetch
  let calls = 0
  s.env.RESEND_API_KEY = 'fixture-mail-api-key'
  s.env.RESEND_FROM = 'shop@example.test'
  const toggle = await s.request(
    '/api/admin/my-shop/notification-settings',
    { version: 0, orderCompletedEmail: true },
    s.admin,
  )
  assert.equal(toggle.status, 200)
  const p = await s.saveProduct(product()),
    buyer = await s.buyer(),
    created = await s.create(p, buyer),
    order = (await created.json()).order
  s.db
    .prepare(
      "UPDATE orders SET status='success',payment_status='paid',created_at=? WHERE id=?",
    )
    .run(Date.now() + 10, order.id)
  globalThis.fetch = async (input, init) => {
    calls++
    assert.equal(String(input), 'https://api.resend.com/emails')
    const mail = JSON.parse(String(init?.body))
    assert.deepEqual(mail.to, ['owner@example.test'])
    assert.ok(!mail.text.includes('TEST-SECRET'))
    return Response.json({ id: 'fixture-message' })
  }
  try {
    await sendOwnerOrderNotifications(s.env)
    await sendOwnerOrderNotifications(s.env)
    assert.equal(calls, 1)
  } finally {
    globalThis.fetch = original
  }
})

test('simultaneous custom orders reserve one stock slot and reject shared keys used for another product', async () => {
  const s = await setup(),
    p = await s.saveProduct(product({ stock: 1 })),
    a = await s.buyer(),
    b = await s.buyer()
  const results = await Promise.all([s.create(p, a), s.create(p, b)])
  assert.deepEqual(results.map((r) => r.status).sort(), [201, 409])
  assert.equal(
    s.db
      .prepare('SELECT stock_remaining FROM shop_products WHERE id=?')
      .get(p.id)!.stock_remaining,
    0,
  )
  const second = await s.saveProduct(product()),
    third = await s.saveProduct(product()),
    key = crypto.randomUUID()
  const reused = await Promise.all([
    s.create(second, a, {}, key),
    s.create(third, a, {}, key),
  ])
  assert.deepEqual(reused.map((r) => r.status).sort(), [201, 409])
})
test('manual delivery and its content roll back together if the audit insert fails', async () => {
  const s = await setup(),
    p = await s.saveProduct(product()),
    buyer = await s.buyer(),
    order = (await (await s.create(p, buyer)).json()).order
  s.db
    .prepare(
      "UPDATE orders SET payment_status='paid',status='processing' WHERE id=?",
    )
    .run(order.id)
  s.db.exec(
    "CREATE TRIGGER reject_fixture_delivery BEFORE INSERT ON order_events WHEN NEW.action='custom-delivered' BEGIN SELECT RAISE(ABORT,'fixture rejects audit'); END",
  )
  const response = await s.request(
    '/api/admin/my-shop/orders/' + order.id,
    {
      action: 'deliver',
      version: 0,
      note: '人工交付测试',
      content: 'SECRET-DELIVERY',
    },
    s.admin,
  )
  assert.ok(response.status >= 400)
  assert.equal(
    s.db.prepare('SELECT status FROM orders WHERE id=?').get(order.id)!.status,
    'processing',
  )
  assert.equal(
    s.db
      .prepare(
        'SELECT delivery_content FROM shop_order_details WHERE order_id=?',
      )
      .get(order.id)!.delivery_content,
    '',
  )
})
test('manual collection refunds require approval and a real refund reference, and hide delivered content', async () => {
  const s = await setup(),
    p = await s.saveProduct(product()),
    buyer = await s.buyer(),
    order = (await (await s.create(p, buyer)).json()).order
  s.db
    .prepare(
      "UPDATE orders SET payment_status='paid',status='success' WHERE id=?",
    )
    .run(order.id)
  s.db
    .prepare(
      'UPDATE shop_order_details SET delivery_content=? WHERE order_id=?',
    )
    .run('DELIVERED-FIXTURE', order.id)
  const submitted = await s.request(
    `/api/orders/${order.id}/refunds`,
    { key: crypto.randomUUID(), version: 0, reason: '申请退还测试商品款项' },
    buyer,
  )
  assert.equal(submitted.status, 201, await submitted.clone().text())
  const row = s.db
    .prepare('SELECT id,version FROM refund_cases WHERE order_id=?')
    .get(order.id)!
  assert.equal(
    (
      await s.request(
        '/api/admin/refunds/' + row.id,
        {
          action: 'approve',
          version: row.version,
          amountCents: 990,
          note: '审核测试退款',
        },
        s.admin,
      )
    ).status,
    200,
  )
  assert.equal(
    (
      await s.request(
        '/api/admin/refunds/' + row.id,
        { action: 'complete', version: 1, note: '核对实际退还记录' },
        s.admin,
      )
    ).status,
    400,
  )
  const completed = await s.request(
    '/api/admin/refunds/' + row.id,
    {
      action: 'complete',
      version: 1,
      note: '核实人工退款记录',
      reference: 'MANUAL-REFUND-FIXTURE',
    },
    s.admin,
  )
  assert.equal(completed.status, 200, await completed.clone().text())
  const final = (
    await (await s.request('/api/orders/' + order.id, undefined, buyer)).json()
  ).order
  assert.equal(final.refundedCents, 990)
  assert.equal(final.custom.deliveryContent, null)
})
test('custom-product coupons reserve usage and optional fields can remain empty', async () => {
  const s = await setup(),
    p = await s.saveProduct(
      product({
        fields: [{ key: 'note', label: '补充说明', required: false }],
      }),
    ),
    buyer = await s.buyer()
  const coupon = {
    id: '',
    version: 0,
    code: 'SELF2026',
    discountCents: 100,
    startsAt: new Date(Date.now() - 60000).toISOString(),
    endsAt: new Date(Date.now() + 3600000).toISOString(),
    maxUses: 1,
    oncePerEmail: true,
    active: true,
    targets: [{ storeId: 'platform', plan: p.id }],
  }
  assert.equal(
    (await s.request('/api/admin/my-shop/coupons', coupon, s.admin)).status,
    200,
  )
  const created = await s.request(
    '/api/orders',
    {
      plan: p.id,
      email: 'customer@example.com',
      fields: {},
      key: crypto.randomUUID(),
      expectedPrice: 890,
      couponCode: 'SELF2026',
    },
    buyer,
  )
  assert.equal(created.status, 201, await created.clone().text())
  assert.equal((await created.json()).order.price, 8.9)
  assert.equal(
    (
      await s.request(
        '/api/orders/coupon-quote',
        { plan: p.id, email: 'other@example.com', code: 'SELF2026' },
        buyer,
      )
    ).status,
    409,
  )
})
test('main-shop email identity uses escaped brand and the real domain without replacing product delivery text', async () => {
  const s = await setup(),
    original = globalThis.fetch
  await s.request(
    '/api/admin/my-shop/stores',
    {
      id: 'platform',
      version: 0,
      name: '品牌店铺',
      active: true,
      settings: { brandName: '星辰 & 商店' },
    },
    s.admin,
  )
  s.env.RESEND_API_KEY = 'fixture-email-only'
  s.env.RESEND_FROM = 'shop@example.test'
  s.env.RECHARGE_NOTIFY_URL = 'https://shop.example.com/api/recharge/webhook'
  let captured: Record<string, string> | null = null
  globalThis.fetch = async (_input, init) => {
    captured = JSON.parse(String(init?.body))
    return Response.json({ id: 'fixture' })
  }
  try {
    await sendVerificationEmail(
      s.env,
      'admin-login',
      'owner@example.test',
      '123456',
      'fixture-challenge',
    )
    assert.ok(captured)
    assert.match(captured.subject, /星辰 & 商店/)
    assert.match(captured.from, /星辰 & 商店/)
    assert.ok(!captured.html.includes('shop.example.invalid'))
    assert.ok(captured.html.includes('shop.example.com'))
    assert.match(captured.text, /123456/)
  } finally {
    globalThis.fetch = original
  }
})

test('same-millisecond fulfillment requests share one exclusive supplier purchase lease', async () => {
  const s = await setup(),
    original = globalThis.fetch,
    originalNow = Date.now
  let posts = 0
  globalThis.fetch = async (input, init) => {
    if (String(input).endsWith('/products'))
      return Response.json({
        products: [{ product_code: 'fixture-plan', available: true }],
      })
    assert.equal(init?.method, 'POST')
    posts++
    const id = JSON.parse(String(init?.body)).merchant_order_no
    await new Promise((resolve) => setTimeout(resolve, 10))
    return Response.json({
      merchant_order_no: id,
      cost_cents: 100,
      order_id: 'fixture-single-purchase',
      status: 'pending',
    })
  }
  try {
    const checked = await s.request(
      '/api/admin/my-shop/products/verify-api',
      {
        ...product({
          status: 'draft',
          delivery: 'api',
          api: {
            baseUrl: 'https://supplier.example.com/v1',
            productCode: 'fixture-plan',
            maxCostCents: 500,
            configured: false,
            verified: false,
          },
        }),
        apiToken: 'fixture-only-token',
      },
      s.admin,
    )
    const p = await s.saveProduct({
        ...(await checked.json()).product,
        status: 'published',
      }),
      order = (await (await s.create(p, await s.buyer())).json()).order
    s.db
      .prepare(
        "UPDATE orders SET payment_status='paid',status='processing' WHERE id=?",
      )
      .run(order.id)
    const fixed = Date.now()
    Date.now = () => fixed
    await Promise.all([
      fulfillCustomOrder(s.env, order.id),
      fulfillCustomOrder(s.env, order.id),
    ])
    assert.equal(posts, 1)
    assert.equal(
      s.db
        .prepare(
          'SELECT supplier_state FROM shop_order_details WHERE order_id=?',
        )
        .get(order.id)!.supplier_state,
      'pending',
    )
  } finally {
    Date.now = originalNow
    globalThis.fetch = original
  }
})

test('owner product order includes new products and hiding prevents both listing and direct purchases', async () => {
  const s = await setup(),
    p = await s.saveProduct(product()),
    buyer = await s.buyer()
  const settings = await (
    await s.request('/api/admin/my-shop/product-order', undefined, s.admin)
  ).json()
  assert.ok(settings.productIds.includes(p.id))
  const reordered = [
    p.id,
    ...settings.productIds.filter((id: string) => id !== p.id),
  ]
  assert.equal(
    (
      await s.request(
        '/api/admin/my-shop/product-order',
        {
          productIds: reordered,
          hiddenProductIds: [],
          version: settings.version,
        },
        s.admin,
      )
    ).status,
    200,
  )
  assert.equal(
    (await (await s.request('/api/catalog')).json()).productOrder[0],
    p.id,
  )
  assert.equal(
    (
      await s.request(
        '/api/admin/my-shop/product-order',
        {
          productIds: reordered,
          hiddenProductIds: [p.id],
          version: settings.version + 1,
        },
        s.admin,
      )
    ).status,
    200,
  )
  assert.ok(
    !(await (await s.request('/api/catalog')).json()).products.some(
      (v: { id: string }) => v.id === p.id,
    ),
  )
  assert.equal((await s.create(p, buyer)).status, 409)
})
test('concurrent buyers can consume separate finite slots and unlimited stock without spurious version conflicts', async () => {
  const s = await setup(),
    p = await s.saveProduct(product({ stock: 2 })),
    a = await s.buyer(),
    b = await s.buyer()
  assert.deepEqual(
    (await Promise.all([s.create(p, a), s.create(p, b)])).map((r) => r.status),
    [201, 201],
  )
  const unlimited = await s.saveProduct(product({ stock: -1 }))
  assert.deepEqual(
    (await Promise.all([s.create(unlimited, a), s.create(unlimited, b)])).map(
      (r) => r.status,
    ),
    [201, 201],
  )
})
test('closing the root store during precheck blocks an in-flight new order atomically', async () => {
  const s = await setup(),
    p = await s.saveProduct(product()),
    buyer = await s.buyer(),
    batch = s.env.INTEREST_DB.batch.bind(s.env.INTEREST_DB)
  s.env.INTEREST_DB.batch = async (statements) => {
    s.db
      .prepare(
        "UPDATE owner_shop_settings SET settings=json_set(settings,'$.active',json('false')) WHERE id='platform'",
      )
      .run()
    return batch(statements)
  }
  assert.equal((await s.create(p, buyer)).status, 409)
  assert.equal(s.db.prepare('SELECT COUNT(*) n FROM orders').get()!.n, 0)
})

test('owner can close an abandoned custom order and release stock but cannot close a payment awaiting verification', async () => {
  const s = await setup(),
    p = await s.saveProduct(product({ stock: 1 })),
    buyer = await s.buyer(),
    first = (await (await s.create(p, buyer)).json()).order
  assert.equal(
    (
      await s.request(
        '/api/admin/my-shop/orders/' + first.id,
        {
          action: 'close-unpaid',
          version: 0,
          note: '已核对收款账户未到账，关闭弃单',
        },
        s.admin,
      )
    ).status,
    200,
  )
  const second = (await (await s.create(p, buyer)).json()).order
  await s.request(
    `/api/orders/${second.id}/custom-action`,
    { action: 'claim-payment', reference: 'fixture-receipt', version: 0 },
    buyer,
  )
  assert.equal(
    (
      await s.request(
        '/api/admin/my-shop/orders/' + second.id,
        { action: 'close-unpaid', version: 0, note: '不应关闭待核对订单' },
        s.admin,
      )
    ).status,
    409,
  )
  assert.equal(
    s.db
      .prepare('SELECT stock_remaining FROM shop_products WHERE id=?')
      .get(p.id)!.stock_remaining,
    0,
  )
})

test('API products require a cost limit, pass it upstream and refuse an over-limit result without another purchase', async () => {
  const s = await setup(),
    original = globalThis.fetch
  let purchases = 0
  globalThis.fetch = async (input, init) => {
    if (String(input).endsWith('/products'))
      return Response.json({
        products: [{ product_code: 'fixture-plan', available: true }],
      })
    if (init?.method === 'POST') purchases++
    const sent = init?.body ? JSON.parse(String(init.body)) : null
    if (sent) assert.equal(sent.max_cost_cents, 500)
    const id = sent?.merchant_order_no ?? String(input).split('/').at(-1)
    return Response.json({
      merchant_order_no: id,
      order_id: 'over-budget-fixture',
      status: 'success',
      cost_cents: 501,
      delivery_content: 'MUST-NOT-BE-DELIVERED',
    })
  }
  try {
    const input = {
      ...product({
        status: 'draft',
        delivery: 'api',
        api: {
          baseUrl: 'https://supplier.example.com/v1',
          productCode: 'fixture-plan',
          configured: false,
          verified: false,
        },
      }),
      apiToken: 'fixture-limit-token',
    }
    assert.equal(
      (
        await s.request(
          '/api/admin/my-shop/products/verify-api',
          input,
          s.admin,
        )
      ).status,
      400,
    )
    const checked = (
      await (
        await s.request(
          '/api/admin/my-shop/products/verify-api',
          { ...input, api: { ...input.api, maxCostCents: 500 } },
          s.admin,
        )
      ).json()
    ).product
    const p = await s.saveProduct({ ...checked, status: 'published' }),
      buyer = await s.buyer(),
      created = (await (await s.create(p, buyer)).json()).order
    await s.request(
      `/api/orders/${created.id}/custom-action`,
      { action: 'claim-payment', version: 0, reference: 'fixture-payment' },
      buyer,
    )
    const paid = await s.request(
      '/api/admin/my-shop/orders/' + created.id,
      { action: 'confirm-payment', version: 0, note: '核对本机模拟到账' },
      s.admin,
    )
    assert.equal(paid.status, 200)
    assert.equal((await paid.json()).order.status, 'processing')
    const result = (
      await (
        await s.request('/api/orders/' + created.id, undefined, buyer)
      ).json()
    ).order
    assert.notEqual(result.status, 'success')
    assert.equal(result.custom.deliveryContent, null)
    assert.equal(purchases, 1)
  } finally {
    globalThis.fetch = original
  }
})

test('invalid coupon expiry and duplicate codes are rejected before changing coupon records', async () => {
  const s = await setup()
  const input = {
    id: '',
    version: 0,
    code: 'DUPLICATE',
    discountCents: 100,
    startsAt: new Date(Date.now() - 1000).toISOString(),
    endsAt: 'invalid-date',
    maxUses: 1,
    oncePerEmail: true,
    active: true,
    targets: [{ storeId: 'platform', plan: 'plus' }],
  }
  assert.equal(
    (await s.request('/api/admin/my-shop/coupons', input, s.admin)).status,
    400,
  )
  const valid = {
    ...input,
    endsAt: new Date(Date.now() + 3600000).toISOString(),
  }
  assert.equal(
    (await s.request('/api/admin/my-shop/coupons', valid, s.admin)).status,
    200,
  )
  assert.equal(
    (await s.request('/api/admin/my-shop/coupons', valid, s.admin)).status,
    409,
  )
  assert.equal(s.db.prepare('SELECT COUNT(*) n FROM shop_coupons').get()!.n, 1)
})

test('product artwork persists all templates and restores the original without changing catalogue, supply or payments', async () => {
  const s = await setup()
  const before = s.db.prepare('SELECT * FROM catalog_plans ORDER BY id').all()
  const configBefore = JSON.stringify(s.env.RECHARGE_PRODUCT_MAP)
  let version = 0
  for (const template of ARTWORK_TEMPLATES.filter((t) => t.id !== 'original')) {
    const config = { template: template.id, image }
    const saved = await s.request(
      '/api/admin/product-artwork',
      { productId: 'chatgpt', version, config },
      s.admin,
    )
    assert.equal(saved.status, 200, await saved.clone().text())
    const result = (await saved.json()).product
    assert.deepEqual(result.config, config)
    assert.equal(result.version, ++version)
    const read = await (
      await s.request('/api/admin/product-artwork', undefined, s.admin)
    ).json()
    assert.deepEqual(
      read.products.find((p: { id: string }) => p.id === 'chatgpt'),
      result,
    )
    const catalog = await (await s.request('/api/catalog')).json()
    assert.deepEqual(catalog.productArtwork.chatgpt, config)
    assert.equal(
      (
        await s.request(
          '/api/admin/product-artwork',
          {
            productId: 'chatgpt',
            version: version - 1,
            config: { template: 'static', image },
          },
          s.admin,
        )
      ).status,
      409,
    )
  }
  const reset = await s.request(
    '/api/admin/product-artwork',
    { productId: 'chatgpt', version, config: { template: 'original', image } },
    s.admin,
  )
  assert.equal(reset.status, 200)
  assert.equal(
    (await (await s.request('/api/catalog')).json()).productArtwork.chatgpt,
    undefined,
  )
  assert.equal((await reset.json()).product.config.image, image)
  assert.deepEqual(
    s.db.prepare('SELECT * FROM catalog_plans ORDER BY id').all(),
    before,
  )
  assert.equal(JSON.stringify(s.env.RECHARGE_PRODUCT_MAP), configBefore)
  assert.equal(s.db.prepare('SELECT COUNT(*) n FROM orders').get()!.n, 0)
  assert.equal(
    s.db.prepare('SELECT COUNT(*) n FROM recharge_orders').get()!.n,
    0,
  )
  assert.equal(
    s.db
      .prepare(
        "SELECT COUNT(*) n FROM admin_audit WHERE action='product-artwork'",
      )
      .get()!.n,
    6,
  )
})

test('artwork administration rejects buyers, foreign origins, stale versions and unsupported image contents', async () => {
  const s = await setup(),
    buyer = await s.buyer()
  const data = {
    productId: 'chatgpt',
    version: 0,
    config: { template: 'float', image },
  }
  for (const cookie of ['', buyer]) {
    assert.equal(
      (await s.request('/api/admin/product-artwork', undefined, cookie)).status,
      401,
    )
    assert.equal(
      (await s.request('/api/admin/product-artwork', data, cookie)).status,
      401,
    )
  }
  assert.equal(
    (
      await s.request(
        '/api/admin/product-artwork',
        data,
        s.admin,
        'https://foreign.example.com',
      )
    ).status,
    403,
  )
  for (const config of [
    { template: 'unknown', image },
    { template: 'static', image: '' },
    { template: 'float', image: 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=' },
    { template: 'shine', image: 'data:image/png;base64,PHN2Zz48L3N2Zz4=' },
    { template: 'zoom', image: 'https://image.example.com/p.png' },
    {
      template: 'membership',
      image: 'data:image/png;base64,' + 'A'.repeat(350000),
    },
  ])
    assert.equal(
      (
        await s.request(
          '/api/admin/product-artwork',
          { ...data, config },
          s.admin,
        )
      ).status,
      400,
    )
  assert.equal(
    (
      await s.request(
        '/api/admin/product-artwork',
        { ...data, version: 1 },
        s.admin,
      )
    ).status,
    409,
  )
  assert.equal(
    (
      await s.request(
        '/api/admin/product-artwork',
        { ...data, productId: 'missing-product' },
        s.admin,
      )
    ).status,
    404,
  )
  assert.equal(
    s.db.prepare('SELECT COUNT(*) n FROM product_artwork').get()!.n,
    0,
  )
})

test('custom artwork survives ordinary product edits and hides unpublished product images from the public catalogue', async () => {
  const s = await setup()
  let p = await s.saveProduct(product({ status: 'draft' }))
  const config = { template: 'membership', image }
  assert.equal(
    (
      await s.request(
        '/api/admin/product-artwork',
        { productId: p.id, version: 0, config },
        s.admin,
      )
    ).status,
    200,
  )
  assert.equal(
    (await (await s.request('/api/catalog')).json()).productArtwork[p.id],
    undefined,
  )
  p = await s.saveProduct({ ...p, status: 'published' })
  assert.deepEqual(
    (await (await s.request('/api/catalog')).json()).productArtwork[p.id],
    config,
  )
  p = await s.saveProduct({ ...p, name: '更新后的商品名称' })
  assert.deepEqual(
    (await (await s.request('/api/catalog')).json()).productArtwork[p.id],
    config,
  )
  p = await s.saveProduct({ ...p, status: 'archived' })
  assert.equal(
    (await (await s.request('/api/catalog')).json()).productArtwork[p.id],
    undefined,
  )
  const read = await (
    await s.request('/api/admin/product-artwork', undefined, s.admin)
  ).json()
  assert.deepEqual(
    read.products.find((row: { id: string }) => row.id === p.id).config,
    config,
  )
})

test('processed artwork saves originals and layout for editing but only publishes the finished image and safe geometry', async () => {
  const s = await setup()
  const catalogue = s.db
    .prepare('SELECT * FROM catalog_plans ORDER BY id')
    .all()
  const config = {
    template: 'float',
    image,
    source: image,
    processing: defaultProcessing(),
    layout: {
      ...defaultLayout(),
      scale: 120,
      x: -8,
      y: 6,
      background: 'halo',
      pedestal: 'disc',
    },
    vector: {
      width: 32,
      height: 32,
      paths: [{ fill: '#3c46eb', d: 'M2,2L30,2L30,30L2,30Z' }],
    },
    discardedProperty: 'not part of artwork settings',
  }
  const saved = await s.request(
    '/api/admin/product-artwork',
    { productId: 'chatgpt', version: 0, config },
    s.admin,
  )
  assert.equal(saved.status, 200, await saved.clone().text())
  const stored = (await saved.json()).product.config
  const { discardedProperty: _unused, ...expected } = config
  assert.deepEqual(stored, expected)
  const read = await (
    await s.request('/api/admin/product-artwork', undefined, s.admin)
  ).json()
  assert.deepEqual(
    read.products.find((p) => p.id === 'chatgpt').config,
    expected,
  )
  const exposed = (await (await s.request('/api/catalog')).json())
    .productArtwork.chatgpt
  assert.deepEqual(exposed, {
    template: config.template,
    image,
    layout: config.layout,
    vector: config.vector,
  })
  assert.equal('source' in exposed, false)
  assert.equal('processing' in exposed, false)
  assert.deepEqual(
    s.db.prepare('SELECT * FROM catalog_plans ORDER BY id').all(),
    catalogue,
  )
  assert.equal(s.db.prepare('SELECT COUNT(*) n FROM orders').get()!.n, 0)
  assert.equal(
    s.db.prepare('SELECT COUNT(*) n FROM recharge_orders').get()!.n,
    0,
  )
})

test('artwork endpoint rejects malformed processing, injected vector paths and excessive payloads without database writes', async () => {
  const s = await setup()
  for (const config of [
    { template: 'float', image, source: 'data:image/svg+xml;base64,PHN2Zy8+' },
    { template: 'float', image, layout: { ...defaultLayout(), y: 999 } },
    {
      template: 'float',
      image,
      processing: { ...defaultProcessing(), tolerance: -1 },
    },
    {
      template: 'float',
      image,
      vector: {
        width: 32,
        height: 32,
        paths: [{ fill: '#ffffff', d: 'M0,0L1,1Z" onload="alert(1)' }],
      },
    },
    {
      template: 'float',
      image,
      vector: {
        width: 32,
        height: 32,
        paths: [{ fill: '#ffffff', d: 'M0,0L1,1Z'.repeat(11000) }],
      },
    },
    {
      template: 'float',
      image,
      source: 'data:image/png;base64,' + 'A'.repeat(600001),
    },
  ]) {
    assert.equal(
      (
        await s.request(
          '/api/admin/product-artwork',
          { productId: 'chatgpt', version: 0, config },
          s.admin,
        )
      ).status,
      400,
    )
  }
  assert.equal(
    (
      await s.request(
        '/api/admin/product-artwork',
        {
          productId: 'chatgpt',
          version: 0,
          config: { template: 'float', image, source: 'x'.repeat(1300001) },
        },
        s.admin,
      )
    ).status,
    413,
  )
  assert.equal(
    s.db.prepare('SELECT COUNT(*) n FROM product_artwork').get()!.n,
    0,
  )
})
