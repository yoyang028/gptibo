import test from 'node:test'
import assert from 'node:assert/strict'
import { createHmac, createHash } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import { readFileSync, readdirSync } from 'node:fs'
import {
  XiaojiuPurchaseClient,
  XiaojiuPurchaseError,
  fulfillXiaojiuPurchase,
  purchaseCredentials,
  purchaseMoney,
  purchaseSignature,
} from '../worker/xiaojiu/purchase.ts'
import type { Env, Statement, Value } from '../worker/platform.ts'

const credentials = {
  key: 'a'.repeat(64),
  // Published offline vector; never an account credential.
  secret: '0123456789abcdef'.repeat(8),
}
type Context = Parameters<Parameters<typeof test>[1]>[0]
function setup(t: Context) {
  const db = new DatabaseSync(':memory:')
  t.after(() => db.close())
  for (const file of readdirSync(new URL('../migrations/', import.meta.url))
    .filter((f) => f.endsWith('.sql'))
    .sort())
    db.exec(
      readFileSync(new URL('../migrations/' + file, import.meta.url), 'utf8'),
    )
  const env = {
    XIAOJIU_PURCHASE_ENABLED: 'true',
    INTEREST_DB: {
      prepare(sql: string) {
        let values: Value[] = []
        const statement: Statement = {
          bind(...v) {
            values = v
            return this
          },
          async first<T>() {
            return (db.prepare(sql).get(...values) ?? null) as T | null
          },
          async all<T>() {
            return { results: db.prepare(sql).all(...values) as T[] }
          },
          async run() {
            return db.prepare(sql).run(...values)
          },
        }
        return statement
      },
    },
  } as Env
  const calls: { path: string; method: string; raw: string; nonce: string }[] =
    []
  let patch: (path: string, raw: string) => Response | undefined = () =>
    undefined
  const product = {
    id: 10,
    is_active: true,
    fulfillment_type: 'auto',
    skus: [
      {
        id: 123,
        is_active: true,
        price_amount: '2.00',
        stock_status: 'in_stock',
        stock_quantity: 5,
      },
    ],
  }
  const order = {
    ok: true,
    order_id: 456,
    status: 'completed',
    currency: 'CNY',
    amount: '2.00',
    refunded_amount: '0.00',
    items: [
      {
        product_id: 10,
        sku_id: 123,
        quantity: 1,
        unit_price: '2.00',
        total_price: '2.00',
        fulfillment_type: 'auto',
      },
    ],
    fulfillment: {
      type: 'auto',
      status: 'delivered',
      payload: 'PRIVATE-FIXTURE-CARD',
    },
  }
  t.mock.method(
    globalThis,
    'fetch',
    async (input: string, init: RequestInit) => {
      const url = new URL(input),
        headers = new Headers(init.headers),
        raw = String(init.body ?? '')
      assert.equal(url.origin, 'https://98-xj.com')
      assert.equal(init.redirect, 'manual')
      assert.equal(headers.get('Dujiao-Next-Api-Key'), credentials.key)
      const canonical = [
        init.method,
        url.pathname,
        headers.get('Dujiao-Next-Timestamp'),
        headers.get('Dujiao-Next-Nonce'),
        createHash('sha256').update(raw).digest('hex'),
      ].join('\n')
      assert.equal(
        headers.get('Dujiao-Next-Signature'),
        createHmac('sha256', credentials.secret)
          .update(canonical)
          .digest('hex'),
      )
      calls.push({
        path: url.pathname,
        method: String(init.method),
        raw,
        nonce: headers.get('Dujiao-Next-Nonce')!,
      })
      const override = patch(url.pathname, raw)
      if (override) return override
      if (url.pathname.endsWith('/ping'))
        return Response.json({
          ok: true,
          user_id: 1,
          balance: '100.00',
          currency: 'CNY',
        })
      if (url.pathname.endsWith('/products/10'))
        return Response.json({ ok: true, product })
      if (url.pathname.endsWith('/products'))
        return Response.json({
          ok: true,
          items: [{ ...product, title: { 'zh-CN': '本机模拟商品' } }],
          page: 1,
          page_size: 50,
          total: 1,
        })
      if (url.pathname.endsWith('/orders') && init.method === 'POST')
        return Response.json({
          ok: true,
          order_id: 456,
          downstream_order_no: JSON.parse(raw).downstream_order_no,
          amount: order.amount,
          currency: order.currency,
        })
      if (url.pathname.endsWith('/orders/456')) return Response.json(order)
      throw new Error('Unexpected path')
    },
  )
  const remembered: { id: string; cost: number }[] = []
  const options = {
    productId: 10,
    skuId: 123,
    maximum: 300,
    merchant: 'YMX-FIXTURE-001',
    remoteId: null as string | null,
    remember: async (id: string, cost: number) => {
      remembered.push({ id, cost })
    },
  }
  return {
    db,
    env,
    calls,
    product,
    order,
    options,
    remembered,
    client: new XiaojiuPurchaseClient(env, credentials),
    override: (handler: typeof patch) => {
      patch = handler
    },
  }
}

test('Xiaojiu signature matches the official v2.1 offline vector with the full UTF-8 secret', async () => {
  assert.equal(
    await purchaseSignature(
      credentials.secret,
      'POST',
      '/api/v1/upstream/ping',
      '1709625600',
      '550e8400-e29b-41d4-a716-446655440000',
    ),
    '09cf5cedb04ba4b32552c7e9d8c533368eeb48dd9ba1b72fd1e2c151e9487819',
  )
  assert.deepEqual(
    purchaseCredentials(JSON.stringify(credentials)),
    credentials,
  )
  assert.throws(
    () =>
      purchaseCredentials(
        JSON.stringify({ ...credentials, secret: 'a'.repeat(64) }),
      ),
    /完整 128/,
  )
  assert.equal(purchaseMoney('20.05'), 2005)
  for (const value of [20.05, '1e2', '-1.00', '1.001', 'NaN'])
    assert.throws(() => purchaseMoney(value))
})

test('Xiaojiu checks wallet and SKU, buys one item, saves the remote identity before retrieving its card', async (t) => {
  const s = setup(t)
  const result = await fulfillXiaojiuPurchase(s.client, s.options)
  assert.deepEqual(
    JSON.parse(s.calls.find((c) => c.path.endsWith('/orders'))!.raw),
    {
      sku_id: 123,
      quantity: 1,
      downstream_order_no: 'YMX-FIXTURE-001',
      payment_mode: 'wallet',
    },
  )
  assert.equal(result.status, 'success')
  assert.equal(result.delivery_content, 'PRIVATE-FIXTURE-CARD')
  assert.deepEqual(s.remembered, [
    { id: '456', cost: 200 },
    { id: '456', cost: 200 },
  ])
  assert.equal(new Set(s.calls.map((c) => c.nonce)).size, s.calls.length)
})

test('Xiaojiu catalog uses signed GET pagination and exposes only safe automatic-delivery SKU fields', async (t) => {
  const s = setup(t)
  const catalog = await s.client.catalog(1)
  assert.equal(catalog.items[0].productId, 10)
  assert.equal(catalog.items[0].skuId, 123)
  assert.equal(catalog.items[0].name, '本机模拟商品')
  assert.equal(catalog.items[0].priceCents, 200)
  assert.ok(!JSON.stringify(catalog).includes(credentials.key))
  assert.equal(s.calls[0].method, 'GET')
  await assert.rejects(s.client.catalog(101), { code: 'invalid_response' })
  assert.equal(s.calls.length, 1)
})

test('Xiaojiu catalog accepts bounded multilingual content and publishes the actual SKU specification without descriptions', async (t) => {
  const s = setup(t)
  s.override((path) =>
    path.endsWith('/products')
      ? Response.json({
          ok: true,
          total: 1,
          items: [
            {
              ...s.product,
              title: { 'zh-CN': '额度' },
              content: { 'zh-CN': 'x'.repeat(300000) },
              skus: [
                {
                  ...s.product.skus[0],
                  spec_values: { 'zh-CN': '500 额度', 'en-US': '500 credits' },
                },
              ],
            },
          ],
        })
      : undefined,
  )
  const catalog = await s.client.catalog()
  assert.equal(catalog.pageSize, 10)
  assert.equal(catalog.items[0].specification, '500 额度')
  assert.equal(JSON.stringify(catalog).includes('xxx'), false)
})

test('Xiaojiu unknown creation replays the original downstream order and body with a new nonce', async (t) => {
  const s = setup(t)
  let first = true
  s.override((path) => {
    if (path.endsWith('/orders') && first) {
      first = false
      throw new Error('Connection lost after supplier committed')
    }
    return undefined
  })
  await assert.rejects(fulfillXiaojiuPurchase(s.client, s.options), {
    code: 'network_unknown',
  })
  assert.equal(
    (await fulfillXiaojiuPurchase(s.client, s.options)).status,
    'success',
  )
  const creates = s.calls.filter((c) => c.path.endsWith('/orders'))
  assert.equal(creates.length, 2)
  assert.equal(creates[0].raw, creates[1].raw)
  assert.notEqual(creates[0].nonce, creates[1].nonce)
})

test('Xiaojiu known supplier orders are only queried, including when purchasing is disabled', async (t) => {
  const s = setup(t)
  s.env.XIAOJIU_PURCHASE_ENABLED = 'false'
  assert.equal(
    (await fulfillXiaojiuPurchase(s.client, { ...s.options, remoteId: '456' }))
      .status,
    'success',
  )
  assert.deepEqual(
    s.calls.map((c) => c.path),
    ['/api/v1/upstream/orders/456'],
  )
  await assert.rejects(s.client.request('POST', '/orders', {}), {
    code: 'purchase_disabled',
  })
})

test('Xiaojiu refuses insufficient balance and a price above the configured reference before spending', async (t) => {
  const s = setup(t)
  s.product.skus[0].price_amount = '4.00'
  await assert.rejects(fulfillXiaojiuPurchase(s.client, s.options), {
    code: 'price_limit',
  })
  s.product.skus[0].price_amount = '2.00'
  s.override((path) =>
    path.endsWith('/ping')
      ? Response.json({
          ok: true,
          user_id: 1,
          balance: '1.99',
          currency: 'CNY',
        })
      : undefined,
  )
  await assert.rejects(fulfillXiaojiuPurchase(s.client, s.options), {
    code: 'insufficient_balance',
  })
  assert.equal(s.calls.filter((c) => c.path.endsWith('/orders')).length, 0)
})

test('Xiaojiu saves actual charged cost and supplier ID when a concurrent price change exceeds the reference', async (t) => {
  const s = setup(t)
  s.order.amount = '4.00'
  await assert.rejects(fulfillXiaojiuPurchase(s.client, s.options), {
    code: 'cost_review',
  })
  assert.deepEqual(s.remembered, [{ id: '456', cost: 400 }])
  assert.equal(s.calls.filter((c) => c.path.endsWith('/orders/456')).length, 0)
})

test('Xiaojiu authentication failures pause the credential across calls until a successful manual ping', async (t) => {
  const s = setup(t)
  s.override(() =>
    Response.json(
      {
        ok: false,
        error_code: 'authentication_failed',
        error_message: 'PRIVATE',
      },
      { status: 401 },
    ),
  )
  await assert.rejects(s.client.ping(), { code: 'authentication_failed' })
  await assert.rejects(s.client.ping(), { code: 'authentication_failed' })
  assert.equal(s.calls.length, 1)
  s.override(() => undefined)
  await s.client.ping(true)
  await s.client.product(10, 123, 300)
  assert.equal(s.calls.length, 3)
})

test('Xiaojiu 429 applies a durable cooldown and does not return raw supplier errors or cards', async (t) => {
  const s = setup(t)
  s.override(() =>
    Response.json(
      {
        ok: false,
        error_code: 'rate_limited',
        error_message: 'PRIVATE-FIXTURE-CARD',
      },
      { status: 429, headers: { 'Retry-After': '120' } },
    ),
  )
  await assert.rejects(
    s.client.ping(),
    (e) =>
      e instanceof XiaojiuPurchaseError &&
      e.code === 'rate_limited' &&
      !e.message.includes('PRIVATE'),
  )
  await assert.rejects(s.client.ping(), { code: 'rate_limited' })
  assert.equal(s.calls.length, 1)
  assert.ok(Number(dbValue(s.db, 'retry_at')) > Date.now() + 110000)
})
function dbValue(db: DatabaseSync, column: string) {
  return db.prepare('SELECT ' + column + ' FROM xiaojiu_api_controls').get()?.[
    column
  ]
}

test('Xiaojiu rejects redirects, oversized responses, and arbitrary paths without following them', async (t) => {
  const s = setup(t)
  s.override(
    () =>
      new Response('', {
        status: 302,
        headers: { Location: 'https://other.example' },
      }),
  )
  await assert.rejects(s.client.ping(), { code: 'invalid_response' })
  s.override(() => new Response(' '.repeat(256001)))
  await assert.rejects(s.client.ping(), { code: 'invalid_response' })
  const count = s.calls.length
  await assert.rejects(s.client.request('POST', '/orders/456/cancel'), {
    code: 'invalid_response',
  })
  await assert.rejects(s.client.request('GET', '/orders/456?leak=1'), {
    code: 'invalid_response',
  })
  assert.equal(s.calls.length, count)
})

test('Xiaojiu does not deliver a refunded, mismatched, or unknown-state order', async (t) => {
  const s = setup(t)
  s.order.items[0].sku_id = 124
  await assert.rejects(
    fulfillXiaojiuPurchase(s.client, { ...s.options, remoteId: '456' }),
    { code: 'invalid_response' },
  )
  s.order.items[0].sku_id = 123
  s.order.status = 'new-unknown-status'
  await assert.rejects(
    fulfillXiaojiuPurchase(s.client, { ...s.options, remoteId: '456' }),
    { code: 'invalid_response' },
  )
  s.order.status = 'refunded'
  s.order.refunded_amount = '2.00'
  const result = await fulfillXiaojiuPurchase(s.client, {
    ...s.options,
    remoteId: '456',
  })
  assert.equal(result.status, 'failed')
  assert.equal(result.delivery_content, '')
})
