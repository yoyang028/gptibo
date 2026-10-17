import test from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { generateKeyPairSync, sign } from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'
import worker from '../worker/index.ts'
import { canonical } from '../worker/payments/alipay.ts'
import { fulfillCustomOrder } from '../worker/shop-products.ts'
import { reconcileSms } from '../worker/grizzly/service.ts'
import { GrizzlyClient } from '../worker/grizzly/client.ts'
import {
  grizzlyCostCents,
  grizzlyProduct,
  SMS_PRODUCT_IDS,
  type GrizzlyService,
} from '../shared/grizzly-sms.ts'
import type { ShopProduct } from '../shared/shop-products.ts'
import type { Env, Statement, Value } from '../worker/platform.ts'
import { seedAdminEmailCode } from './admin-email-fixture.ts'
import { totpCode } from '../worker/totp.ts'

type Context = Parameters<Parameters<typeof test>[1]>[0]
const apiKey = 'fixture-grizzly-key-not-a-real-credential'
const keys = generateKeyPairSync('rsa', { modulusLength: 2048 })
const signature = (value: string) =>
  sign('RSA-SHA256', Buffer.from(value), keys.privateKey).toString('base64')
const image =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWQAAAABJRU5ErkJggg=='
async function setup(t: Context, service: GrizzlyService = 'dr', auto = false) {
  const db = new DatabaseSync(':memory:')
  t.after(() => db.close())
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
    ADMIN_TOTP_SECRET: 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ',
    PARTNER_AUTH_SECRET: 'fixture-grizzly-encryption-secret-not-live',
    GRIZZLY_SMS_ENABLED: 'true',
    PAYMENT_CHECKOUT_ENABLED: 'true',
    ORDER_TESTING_ENABLED: 'false',
    PAYMENT_NOTIFY_ORIGIN: 'https://shop.example.com',
    ALIPAY_APP_ID: '2026000000000000',
    ALIPAY_SELLER_ID: '2088000000000000',
    ALIPAY_APP_PRIVATE_KEY: keys.privateKey
      .export({ type: 'pkcs8', format: 'pem' })
      .toString(),
    ALIPAY_PUBLIC_KEY: keys.publicKey
      .export({ type: 'spki', format: 'pem' })
      .toString(),
    INTEREST_LIMITER: { limit: async () => ({ success: true }) },
    API_LIMITER: { limit: async () => ({ success: true }) },
    EXPENSIVE_LIMITER: { limit: async () => ({ success: true }) },
    INTEREST_DB: {
      prepare(sql) {
        const state = { sql, values: [] as Value[] }
        const statement: Statement = {
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
        bound.set(statement, state)
        return statement
      },
      async batch(statements) {
        db.exec('BEGIN')
        try {
          const values = statements.map((s) => {
            const v = bound.get(s)!
            return db.prepare(v.sql).run(...v.values)
          })
          db.exec('COMMIT')
          return values
        } catch (e) {
          db.exec('ROLLBACK')
          throw e
        }
      },
    },
  }
  const calls: URL[] = []
  const controls = {
    number: 'ok',
    status: 'STATUS_WAIT_CODE',
    cancel: 'ACCESS_CANCEL',
    finish: 'ACCESS_ACTIVATION',
    cost: 0.13,
    currency: 840,
    country: '187',
    numberByCountry: {} as Record<string, string>,
    prices: {
      '187': { cost: 0.13, count: 100 },
      '12': { cost: 0.09, count: 100 },
    } as Record<string, { cost: number; count: number }>,
    hold: undefined as Promise<void> | undefined,
  }
  t.mock.method(
    globalThis,
    'fetch',
    async (input: string, init: RequestInit) => {
      const url = new URL(String(input))
      calls.push(url)
      assert.equal(init.redirect, 'manual')
      if (url.origin === 'https://openapi.alipay.com') {
        const values = Object.fromEntries(
            new URLSearchParams(String(init.body)),
          ),
          method = values.method,
          biz = JSON.parse(values.biz_content)
        const data =
          method === 'alipay.trade.precreate'
            ? {
                code: '10000',
                out_trade_no: biz.out_trade_no,
                qr_code: 'https://qr.alipay.com/fixturegrizzly123',
              }
            : method === 'alipay.trade.close'
              ? { code: '10000', out_trade_no: biz.out_trade_no }
              : { code: '40004', sub_code: 'ACQ.TRADE_NOT_EXIST' }
        const raw = JSON.stringify(data)
        return new Response(
          `{"${method.replaceAll('.', '_')}_response":${raw},"sign":"${signature(raw)}"}`,
        )
      }
      assert.equal(url.origin, 'https://api.grizzlysms.com')
      assert.equal(url.pathname, '/stubs/handler_api.php')
      assert.equal(url.searchParams.get('api_key'), apiKey)
      const action = url.searchParams.get('action')
      if (action === 'getBalance') return new Response('ACCESS_BALANCE:100.00')
      if (action === 'getPrices')
        return Response.json({
          [url.searchParams.get('country')!]: {
            [url.searchParams.get('service')!]:
              controls.prices[url.searchParams.get('country')!],
          },
        })
      if (action === 'getNumberV2') {
        assert.equal(url.searchParams.get('service'), service)
        const selectedCountry = url.searchParams.get('country')!
        assert.ok(['187', '12'].includes(selectedCountry))
        assert.equal(url.searchParams.get('maxPrice'), '1')
        await controls.hold
        const outcome =
          controls.numberByCountry[selectedCountry] ?? controls.number
        if (outcome === 'timeout') throw new Error('Synthetic lost response')
        if (outcome === 'redirect')
          return new Response(null, {
            status: 302,
            headers: { Location: 'https://evil.example.test/' },
          })
        if (outcome !== 'ok') return new Response(outcome)
        return Response.json({
          activationId: 1234567,
          phoneNumber: '12025550147',
          activationCost: auto
            ? controls.prices[selectedCountry].cost
            : controls.cost,
          currency: controls.currency,
          countryCode: auto ? selectedCountry : controls.country,
        })
      }
      assert.equal(url.searchParams.get('id'), '1234567')
      if (action === 'getStatus') return new Response(controls.status)
      if (action === 'setStatus')
        return new Response(
          url.searchParams.get('status') === '8'
            ? controls.cancel
            : controls.finish,
        )
      throw new Error('Unexpected fixture operation')
    },
  )
  const request = (path: string, data?: unknown, cookie = '') =>
    worker.fetch(
      new Request('https://shop.example.com' + path, {
        method: data === undefined ? 'GET' : 'POST',
        headers: {
          Origin: 'https://shop.example.com',
          'Content-Type': 'application/json',
          Cookie: cookie,
        },
        ...(data === undefined ? {} : { body: JSON.stringify(data) }),
      }),
      env,
    )
  const login = await request('/api/admin/login', {
    username: 'owner',
    code: await totpCode(env.ADMIN_TOTP_SECRET!),
    ...(await seedAdminEmailCode(db, env)),
  })
  assert.equal(login.status, 200)
  const admin = login.headers.get('Set-Cookie')!.split(';')[0]
  const buyer = async () =>
    (await request('/api/orders/client', {})).headers
      .get('Set-Cookie')!
      .split(';')[0]
  const owner = await buyer()
  const draft = {
    ...grizzlyProduct(service),
    image,
    priceCents: 1000,
    api: {
      ...grizzlyProduct(service).api!,
      maxCostCents: 750,
      sms: {
        country: auto ? 'auto-us' : '187',
        maxPriceUsd: '1',
        cnyPerUsd: '7.5',
      },
    },
    apiToken: apiKey,
  }
  const verified = await request(
    '/api/admin/my-shop/products/verify-api',
    draft,
    admin,
  )
  assert.equal(verified.status, 201, await verified.clone().text())
  const product = (await verified.json()).product as ShopProduct
  const published = await request(
    '/api/admin/my-shop/products',
    { ...product, status: 'published' },
    admin,
  )
  assert.equal(published.status, 200, await published.clone().text())
  const active = (await published.json()).product as ShopProduct
  const create = (cookie = owner, key = crypto.randomUUID()) =>
    request(
      '/api/orders',
      {
        plan: active.id,
        email: 'buyer@example.test',
        key,
        expectedPrice: 1000,
      },
      cookie,
    )
  const response = await create()
  assert.equal(response.status, 201, await response.clone().text())
  const id = (await response.json()).order.id as string
  const pay = () =>
    request(`/api/orders/${id}/payment`, { action: 'create' }, owner)
  const notify = (patch: Record<string, string> = {}, valid = true) => {
    const data = {
      app_id: env.ALIPAY_APP_ID!,
      seller_id: env.ALIPAY_SELLER_ID!,
      sign_type: 'RSA2',
      out_trade_no: id,
      total_amount: '10.00',
      trade_status: 'TRADE_SUCCESS',
      trade_no: '202610170000000001',
      ...patch,
    }
    const form = new URLSearchParams({
      ...data,
      sign: valid
        ? signature(canonical(data, ['sign', 'sign_type']))
        : 'invalid',
    })
    return worker.fetch(
      new Request('https://shop.example.com/api/payments/notify/alipay', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: form,
      }),
      env,
    )
  }
  const get = async (cookie = owner) =>
    await request('/api/orders/' + id, undefined, cookie)
  const order = async () => (await (await get()).json()).order
  const due = () =>
    db
      .prepare('UPDATE grizzly_activations SET next_poll_at=0 WHERE order_id=?')
      .run(id)
  const allocations = () =>
    calls.filter((u) => u.searchParams.get('action') === 'getNumberV2').length
  return {
    db,
    env,
    request,
    admin,
    owner,
    buyer,
    id,
    active,
    calls,
    controls,
    create,
    pay,
    notify,
    get,
    order,
    due,
    allocations,
  }
}

test('USD sub-cent arithmetic rounds CNY costs up without exponent, negative or overprecision input', () => {
  assert.equal(grizzlyCostCents('0.13', '7.5'), 98)
  assert.equal(grizzlyCostCents('0.000001', '7.1234'), 1)
  for (const value of ['1e2', '-1', 'NaN', '0.0000001', '0'])
    assert.throws(() => grizzlyCostCents(value, '7.5'))
})
for (const service of ['dr', 'acz', 'go'] as const)
  test(`${service}: signed payment → one US number → private SMS code and completion`, async (t) => {
    const s = await setup(t, service)
    assert.equal(s.allocations(), 0)
    assert.equal(
      (
        await s.request(
          `/api/orders/${s.id}/custom-action`,
          { action: 'claim-payment', reference: 'not-proof', version: 0 },
          s.owner,
        )
      ).status,
      409,
    )
    assert.equal(s.allocations(), 0)
    assert.equal((await s.pay()).status, 200)
    assert.equal((await s.notify({}, false)).status, 400)
    assert.equal((await s.notify({ total_amount: '9.99' })).status, 400)
    assert.equal(s.allocations(), 0)
    assert.equal((await s.notify()).status, 200)
    assert.equal(s.allocations(), 1)
    assert.equal((await s.order()).custom.sms.phone, '+12025550147')
    assert.equal((await s.notify()).status, 200)
    assert.equal(s.allocations(), 1)
    const stranger = await s.buyer()
    assert.equal((await s.get(stranger)).status, 404)
    s.controls.status = 'STATUS_OK:739201'
    s.due()
    const received = await s.order()
    assert.equal(received.status, 'success')
    assert.equal(received.custom.sms.code, '739201')
    assert.equal(
      s.db.prepare('SELECT cost_cents FROM orders WHERE id=?').get(s.id)!
        .cost_cents,
      98,
    )
    assert.ok(
      s.db
        .prepare(
          'SELECT completed_at FROM grizzly_activations WHERE order_id=?',
        )
        .get(s.id)!.completed_at,
    )
    const raw = await (await s.request('/api/catalog')).text()
    assert.ok(!raw.includes(apiKey))
    assert.ok(!raw.includes('maxPriceUsd'))
    assert.ok(!raw.includes('739201'))
    assert.ok(
      !String(
        s.db
          .prepare('SELECT api_secret FROM shop_products WHERE id=?')
          .get(s.active.id)!.api_secret,
      ).includes(apiKey),
    )
    s.env.GRIZZLY_SMS_ENABLED = 'false'
    assert.equal((await s.order()).custom.sms.code, '739201')
    assert.equal((await s.create(s.owner)).status, 409)
  })
test('a lost allocation response stays unknown across callback retries, queries and cron', async (t) => {
  const s = await setup(t)
  s.controls.number = 'timeout'
  await s.pay()
  await s.notify()
  assert.equal((await s.order()).custom.sms.state, 'unknown')
  await s.notify()
  s.due()
  await Promise.all([
    s.get(),
    fulfillCustomOrder(s.env, s.id, true),
    reconcileSms(s.env),
  ])
  assert.equal(s.allocations(), 1)
  const current = await s.order()
  assert.equal(
    (
      await s.request(
        `/api/orders/${s.id}/refunds`,
        {
          key: crypto.randomUUID(),
          version: current.version,
          reason: '未收到号码，申请退款',
        },
        s.owner,
      )
    ).status,
    409,
  )
})
test('concurrent callbacks and buyer queries share a durable allocation lease', async (t) => {
  const s = await setup(t)
  await s.pay()
  let release!: () => void
  s.controls.hold = new Promise<void>((resolve) => {
    release = resolve
  })
  const first = s.notify()
  while (!s.allocations())
    await new Promise((resolve) => setTimeout(resolve, 1))
  await Promise.all([s.notify(), s.get(), reconcileSms(s.env)])
  assert.equal(s.allocations(), 1)
  release()
  await first
  assert.equal((await s.order()).custom.sms.state, 'waiting')
})
for (const error of ['NO_NUMBERS', 'NO_BALANCE', 'BAD_KEY', 'redirect'])
  test(`allocation ${error} never produces a phone or another purchase`, async (t) => {
    const s = await setup(t)
    s.controls.number = error
    await s.pay()
    await s.notify()
    const o = await s.order()
    assert.equal(o.custom.sms.phone, null)
    assert.equal(
      o.custom.sms.state,
      error === 'redirect' ? 'unknown' : 'failed',
    )
    s.due()
    await s.notify()
    await reconcileSms(s.env)
    assert.equal(s.allocations(), 1)
  })
for (const patch of [{ cost: 2 }, { currency: 643 }, { country: '12' }])
  test(`mismatched allocation ${JSON.stringify(patch)} retains provider ID for review`, async (t) => {
    const s = await setup(t)
    Object.assign(s.controls, patch)
    await s.pay()
    await s.notify()
    assert.equal((await s.order()).custom.sms.state, 'review')
    assert.equal(
      s.db
        .prepare(
          'SELECT activation_id FROM grizzly_activations WHERE order_id=?',
        )
        .get(s.id)!.activation_id,
      '1234567',
    )
    await s.notify()
    assert.equal(s.allocations(), 1)
  })
test('stopping waits for provider confirmation before allowing a separate refund request', async (t) => {
  const s = await setup(t)
  await s.pay()
  await s.notify()
  let o = await s.order()
  const refund = () =>
    s.request(
      `/api/orders/${s.id}/refunds`,
      {
        key: crypto.randomUUID(),
        version: o.version,
        reason: '没有收到短信申请售后',
      },
      s.owner,
    )
  assert.equal((await refund()).status, 409)
  s.controls.cancel = 'BAD_STATUS'
  s.due()
  assert.equal(
    (
      await s.request(
        `/api/orders/${s.id}/custom-action`,
        { action: 'stop-sms', version: o.version },
        s.owner,
      )
    ).status,
    200,
  )
  o = await s.order()
  assert.equal(o.custom.sms.state, 'waiting')
  assert.equal((await refund()).status, 409)
  s.controls.cancel = 'ACCESS_CANCEL'
  s.due()
  o = await s.order()
  assert.equal(o.custom.sms.state, 'cancelled')
  assert.equal((await refund()).status, 201)
  assert.equal(
    s.db.prepare('SELECT refunded_cents FROM orders WHERE id=?').get(s.id)!
      .refunded_cents,
    0,
  )
  assert.equal((await s.order()).custom.sms.phone, null)
})
test('an SMS arriving during stop is delivered before any cancellation', async (t) => {
  const s = await setup(t)
  await s.pay()
  await s.notify()
  const o = await s.order()
  s.controls.status = 'STATUS_OK:928372'
  await s.request(
    `/api/orders/${s.id}/custom-action`,
    { action: 'stop-sms', version: o.version },
    s.owner,
  )
  assert.equal((await s.order()).custom.sms.code, '928372')
  assert.equal(
    s.calls.filter((u) => u.searchParams.get('status') === '8').length,
    0,
  )
})
test('expiry cancels the original activation while disabled procurement still permits queries', async (t) => {
  const s = await setup(t)
  await s.pay()
  await s.notify()
  s.env.GRIZZLY_SMS_ENABLED = 'false'
  s.db
    .prepare(
      'UPDATE grizzly_activations SET expires_at=1,next_poll_at=0 WHERE order_id=?',
    )
    .run(s.id)
  assert.equal((await s.order()).custom.sms.state, 'cancelled')
  assert.equal(s.allocations(), 1)
})
test('unknown upstream status and unsuccessful completion never invent or erase a code', async (t) => {
  const s = await setup(t)
  await s.pay()
  await s.notify()
  s.controls.status = 'STATUS_BOGUS'
  s.due()
  assert.equal((await s.order()).custom.sms.code, null)
  s.controls.status = 'STATUS_OK:837294'
  s.controls.finish = 'BAD_STATUS'
  s.due()
  assert.equal((await s.order()).custom.sms.code, '837294')
  assert.equal(
    s.db
      .prepare('SELECT completed_at FROM grizzly_activations WHERE order_id=?')
      .get(s.id)!.completed_at,
    null,
  )
  s.controls.finish = 'ACCESS_ACTIVATION'
  s.due()
  await reconcileSms(s.env)
  assert.ok(
    s.db
      .prepare('SELECT completed_at FROM grizzly_activations WHERE order_id=?')
      .get(s.id)!.completed_at,
  )
})
test('order config and credentials are snapshots; low retail prices and manual fulfillment are rejected', async (t) => {
  const s = await setup(t)
  await s.pay()
  const row = s.db
    .prepare('SELECT public_json,version FROM shop_products WHERE id=?')
    .get(s.active.id)!
  const changed = {
    ...JSON.parse(String(row.public_json)),
    version: row.version,
    status: 'draft',
    api: { ...s.active.api, productCode: 'go' },
  }
  assert.equal(
    (await s.request('/api/admin/my-shop/products', changed, s.admin)).status,
    200,
  )
  await s.notify()
  assert.equal(s.allocations(), 1)
  const o = await s.order()
  assert.equal(
    (
      await s.request(
        `/api/admin/my-shop/orders/${s.id}`,
        {
          action: 'deliver',
          note: '人工内容替换',
          content: 'not-a-code',
          version: o.version,
        },
        s.admin,
      )
    ).status,
    409,
  )
  const bad = {
    ...grizzlyProduct('go'),
    image,
    priceCents: 1,
    status: 'published',
    api: { ...s.active.api, verified: true, configured: true },
    apiToken: apiKey,
  }
  assert.equal(
    (await s.request('/api/admin/my-shop/products', bad, s.admin)).status,
    400,
  )
})
test('client never follows redirects or accepts an unconfigured key', async (t) => {
  const s = await setup(t)
  assert.throws(() => new GrizzlyClient(s.env, ''))
  const noKey = await s.request(
    '/api/admin/my-shop/products/verify-api',
    { ...grizzlyProduct('dr'), image },
    s.admin,
  )
  assert.equal(noKey.status, 400)
})

test('uncertain allocation closes only with admin ledger evidence, leaving a separate refund review', async (t) => {
  const s = await setup(t)
  s.controls.number = 'timeout'
  await s.pay()
  await s.notify()
  let o = await s.order()
  const data = {
    action: 'confirm-sms-closed',
    note: '已核对上游无活动号码',
    reference: 'SUPPORT-FIXTURE-001',
    version: o.version,
  }
  const path = `/api/admin/my-shop/orders/${s.id}`
  assert.equal((await s.request(path, data, s.owner)).status, 401)
  assert.equal(
    (await s.request(path, { ...data, reference: '' }, s.admin)).status,
    409,
  )
  assert.equal((await s.request(path, data, s.admin)).status, 200)
  o = await s.order()
  assert.equal(o.custom.sms.state, 'cancelled')
  assert.equal(
    s.db
      .prepare(
        "SELECT COUNT(*) n FROM admin_audit WHERE action='sms-manual-closed'",
      )
      .get()!.n,
    1,
  )
  assert.equal(
    (
      await s.request(
        `/api/orders/${s.id}/refunds`,
        {
          key: crypto.randomUUID(),
          version: o.version,
          reason: '无活动号码申请退款',
        },
        s.owner,
      )
    ).status,
    201,
  )
  assert.equal(
    s.db.prepare('SELECT refunded_cents FROM orders WHERE id=?').get(s.id)!
      .refunded_cents,
    0,
  )
  assert.equal(s.allocations(), 1)
})
test('reviewed known number stays hidden and needs confirmed upstream cancellation before closure', async (t) => {
  const s = await setup(t)
  s.controls.cost = 2
  await s.pay()
  await s.notify()
  let o = await s.order()
  assert.equal(o.custom.sms.phone, null)
  assert.equal(o.custom.sms.activationId, undefined)
  const adminView = await s.request(
    `/api/admin/orders/${s.id}`,
    undefined,
    s.admin,
  )
  assert.equal(adminView.status, 200)
  assert.equal(
    (await adminView.json()).order.custom.sms.activationId,
    '1234567',
  )
  s.controls.cancel = 'BAD_STATUS'
  const data = {
    action: 'confirm-sms-closed',
    note: '已核对超额成本并取消',
    reference: 'LEDGER-FIXTURE-002',
    version: o.version,
  }
  assert.equal(
    (await s.request(`/api/admin/my-shop/orders/${s.id}`, data, s.admin))
      .status,
    409,
  )
  assert.equal((await s.order()).custom.sms.state, 'review')
  s.controls.cancel = 'ACCESS_CANCEL'
  assert.equal(
    (await s.request(`/api/admin/my-shop/orders/${s.id}`, data, s.admin))
      .status,
    200,
  )
  o = await s.order()
  assert.equal(o.custom.sms.state, 'cancelled')
  assert.equal(s.allocations(), 1)
})

test('a crash after saving a number identity cannot expose an unvalidated allocation', async (t) => {
  const s = await setup(t)
  await s.pay()
  await s.notify()
  s.db
    .prepare(
      "UPDATE grizzly_activations SET state='allocating',verified=0,next_poll_at=0 WHERE order_id=?",
    )
    .run(s.id)
  s.controls.status = 'STATUS_OK:123456'
  const o = await s.order()
  assert.equal(o.custom.sms.state, 'review')
  assert.equal(o.custom.sms.phone, null)
  assert.equal(o.custom.sms.code, null)
  assert.equal(s.allocations(), 1)
})
test('a stored code survives audit failure and completes the original order on recovery', async (t) => {
  const s = await setup(t)
  await s.pay()
  await s.notify()
  s.controls.status = 'STATUS_OK:817293'
  s.due()
  s.db.exec(
    "CREATE TRIGGER fixture_sms_audit_failure BEFORE INSERT ON order_events WHEN NEW.action='sms-status' BEGIN SELECT RAISE(ABORT,'fixture audit failure'); END",
  )
  await s.get()
  assert.equal(
    s.db
      .prepare('SELECT code FROM grizzly_activations WHERE order_id=?')
      .get(s.id)!.code,
    '817293',
  )
  s.db.exec('DROP TRIGGER fixture_sms_audit_failure')
  s.due()
  const o = await s.order()
  assert.equal(o.status, 'success')
  assert.equal(o.custom.sms.code, '817293')
  assert.equal(s.allocations(), 1)
})

test('missing payment configuration permits read-only setup and display but never paid checkout', async (t) => {
  const s = await setup(t)
  s.env.ALIPAY_APP_PRIVATE_KEY = undefined
  s.env.GRIZZLY_SMS_ENABLED = 'false'
  const p = {
    ...s.active,
    version: Number(
      s.db
        .prepare('SELECT version FROM shop_products WHERE id=?')
        .get(s.active.id)!.version,
    ),
    status: 'draft',
  }
  const check = await s.request(
    '/api/admin/my-shop/products/verify-api',
    p,
    s.admin,
  )
  assert.equal(check.status, 200)
  const result = await check.json()
  assert.equal(result.supplierQuote.priceUsd, '0.13')
  const shown = await s.request(
    '/api/admin/my-shop/products',
    { ...result.product, status: 'listed' },
    s.admin,
  )
  assert.equal(shown.status, 200)
  const catalog = await (await s.request('/api/catalog')).json()
  assert.ok(catalog.products.some((v: { id: string }) => v.id === p.id))
  assert.equal(
    catalog.plans.find((v: { id: string }) => v.id === p.id).enabled,
    0,
  )
  assert.equal((await s.create()).status, 409)
  assert.equal((await s.pay()).status, 503)
  assert.equal(s.allocations(), 0)
})

for (const service of ['dr', 'acz', 'go'] as const)
  test(
    service +
      ': compares both live US pools and chooses the cheaper in-stock capped pool',
    async (t) => {
      const s = await setup(t, service, true)
      await s.pay()
      await s.notify()
      const purchases = s.calls.filter(
        (u) => u.searchParams.get('action') === 'getNumberV2',
      )
      assert.equal(purchases.length, 1)
      assert.equal(purchases[0].searchParams.get('country'), '12')
      assert.equal(purchases[0].searchParams.get('maxPrice'), '1')
      assert.deepEqual(
        s.db
          .prepare(
            'SELECT country,state FROM sms_allocation_attempts WHERE order_id=?',
          )
          .all(s.id)
          .map((r) => ({ ...r })),
        [{ country: '12', state: 'received' }],
      )
      assert.equal((await s.order()).custom.sms.phone, '+12025550147')
      assert.equal(
        s.db
          .prepare(
            "SELECT amount_usd FROM sms_supplier_events WHERE order_id=? AND kind='purchase'",
          )
          .get(s.id)!.amount_usd,
        '0.09',
      )
    },
  )
test('only explicit NO_NUMBERS falls back once; simultaneous queries cannot purchase either pool twice', async (t) => {
  const s = await setup(t, 'dr', true)
  s.controls.numberByCountry['12'] = 'NO_NUMBERS'
  await s.pay()
  await Promise.all([s.notify(), s.notify(), s.get(), s.get()])
  assert.equal((await s.order()).custom.sms.state, 'waiting')
  assert.deepEqual(
    s.calls
      .filter((u) => u.searchParams.get('action') === 'getNumberV2')
      .map((u) => u.searchParams.get('country')),
    ['12', '187'],
  )
  assert.deepEqual(
    s.db
      .prepare(
        'SELECT country,state FROM sms_allocation_attempts WHERE order_id=? ORDER BY created_at,country',
      )
      .all(s.id)
      .map((r) => ({ ...r })),
    [
      { country: '12', state: 'no_numbers' },
      { country: '187', state: 'received' },
    ],
  )
  await s.notify()
  s.due()
  await s.order()
  assert.equal(s.allocations(), 2)
})
test('a lost cheaper-pool reply never buys from the alternative pool on retries or cron', async (t) => {
  const s = await setup(t, 'dr', true)
  s.controls.numberByCountry['12'] = 'timeout'
  await s.pay()
  await s.notify()
  assert.equal((await s.order()).custom.sms.state, 'unknown')
  for (let i = 0; i < 3; i++) {
    s.due()
    await s.notify()
    await s.get()
    await fulfillCustomOrder(s.env, s.id)
  }
  assert.equal(s.allocations(), 1)
  assert.equal(
    s.db
      .prepare('SELECT state FROM sms_allocation_attempts WHERE order_id=?')
      .get(s.id)!.state,
    'unknown',
  )
})
test('both pools sold out or above the cap cause no purchase and retain the paid order', async (t) => {
  const s = await setup(t, 'dr', true)
  s.controls.prices['12'].count = 0
  s.controls.prices['187'].cost = 2
  await s.pay()
  await s.notify()
  assert.equal(s.allocations(), 0)
  const order = await s.order()
  assert.equal(order.id, s.id)
  assert.equal(order.paymentStatus, 'paid')
  assert.equal(order.custom.sms.state, 'failed')
})

test('central SMS management is private, encrypted, read-only on checks and requires complete conditions to sell', async (t) => {
  const s = await setup(t)
  assert.equal((await s.request('/api/admin/sms')).status, 401)
  let view = await (
    await s.request('/api/admin/sms', undefined, s.admin)
  ).json()
  const save = async (patch: Record<string, unknown> = {}) =>
    s.request(
      '/api/admin/sms',
      {
        action: 'save',
        version: view.version,
        cnyPerUsd: '7.5',
        projects: view.projects.map((p: any) => ({ ...p, maxPriceUsd: '1' })),
        ...patch,
      },
      s.admin,
    )
  assert.equal(view.configured, false)
  let catalog = await (await s.request('/api/catalog')).json()
  assert.deepEqual(
    catalog.sms.projects.map((p: any) => [p.name, p.priceCents, p.enabled]),
    [
      ['codex', 1580, false],
      ['Claude', 1980, false],
      ['Google/Gmail', 2580, false],
    ],
  )
  assert.equal(
    (
      await save({
        projects: view.projects.map((p: any) => ({
          ...p,
          maxPriceUsd: '1',
          selling: true,
        })),
      })
    ).status,
    409,
  )
  const saved = await save({ apiKey })
  assert.equal(saved.status, 200, await saved.clone().text())
  view = await saved.json()
  assert.equal(view.configured, true)
  assert.equal(JSON.stringify(view).includes(apiKey), false)
  assert.ok(
    !String(
      s.db
        .prepare("SELECT api_secret FROM sms_settings WHERE id='grizzly'")
        .get()!.api_secret,
    ).includes(apiKey),
  )
  const checked = await s.request(
    '/api/admin/sms',
    { action: 'check', version: view.version },
    s.admin,
  )
  assert.equal(checked.status, 200)
  view = await checked.json()
  assert.equal(view.credentialVerified, true)
  assert.equal(
    view.projects.every((p: any) => p.pools.length === 2),
    true,
  )
  assert.equal(s.allocations(), 0)
  const enabled = await save({
    projects: view.projects.map((p: any) => ({
      ...p,
      maxPriceUsd: '1',
      selling: true,
    })),
  })
  assert.equal(enabled.status, 200, await enabled.clone().text())
  view = await enabled.json()
  catalog = await (await s.request('/api/catalog')).json()
  assert.equal(
    catalog.sms.projects.every((p: any) => p.enabled),
    true,
  )
  const canonical = await s.request(
    '/api/orders',
    {
      plan: SMS_PRODUCT_IDS.dr,
      email: 'canonical@example.test',
      key: crypto.randomUUID(),
      expectedPrice: 1580,
    },
    s.owner,
  )
  assert.equal(canonical.status, 201, await canonical.clone().text())
  const id = (await canonical.json()).order.id
  assert.equal(s.allocations(), 0)
  assert.equal(
    (
      await s.request(
        '/api/orders/' + id + '/payment',
        { action: 'create' },
        s.owner,
      )
    ).status,
    200,
  )
  // Capture the cap on this immutable order; fixture checks always require maxPrice=1.
  assert.equal(
    (await s.notify({ out_trade_no: id, total_amount: '15.80' })).status,
    200,
  )
  assert.equal(s.allocations(), 1)
  assert.equal(
    (await s.request('/api/orders/' + id, undefined, await s.buyer())).status,
    404,
  )
  const managed = await (
    await s.request('/api/admin/sms?orders=1', undefined, s.admin)
  ).json()
  assert.ok(managed.orders.some((o: any) => o.id === id))
  assert.equal(
    (
      await s.request(
        '/api/admin/sms',
        {
          action: 'save',
          version: 0,
          cnyPerUsd: '7.5',
          projects: view.projects,
        },
        s.admin,
      )
    ).status,
    409,
  )
  const canonicalRow = await s.request(
    '/api/admin/my-shop/products',
    { ...grizzlyProduct('dr'), id: SMS_PRODUCT_IDS.dr, status: 'listed' },
    s.admin,
  )
  assert.equal(canonicalRow.status, 409)
  s.env.ALIPAY_APP_PRIVATE_KEY = ''
  catalog = await (await s.request('/api/catalog')).json()
  assert.equal(
    catalog.sms.projects.every((p: any) => !p.enabled),
    true,
  )
  assert.equal(
    (
      await s.request(
        '/api/orders',
        {
          plan: SMS_PRODUCT_IDS.dr,
          email: 'blocked@example.test',
          key: crypto.randomUUID(),
          expectedPrice: 1580,
        },
        s.owner,
      )
    ).status,
    409,
  )
  assert.equal(s.allocations(), 1)
})
test('supplier wallet refund is evidence-gated and separate from the unchanged buyer payment ledger', async (t) => {
  const s = await setup(t)
  await s.pay()
  await s.notify()
  const action = (extra: Record<string, unknown> = {}) =>
    s.request(
      '/api/admin/my-shop/orders/' + s.id,
      {
        action: 'confirm-supplier-refund',
        note: 'checked synthetic provider ledger',
        reference: 'fixture-wallet-refund',
        amountUsd: '0.13',
        version: 0,
        ...extra,
      },
      s.admin,
    )
  assert.equal((await action()).status, 409)
  await s.request(
    '/api/orders/' + s.id + '/custom-action',
    { action: 'stop-sms', version: (await s.order()).version },
    s.owner,
  )
  s.due()
  await s.order()
  assert.ok(
    s.db
      .prepare(
        'SELECT supplier_cancelled_at FROM grizzly_activations WHERE order_id=?',
      )
      .get(s.id)!.supplier_cancelled_at,
  )
  assert.equal(
    (await action({ amountUsd: '0.14', version: (await s.order()).version }))
      .status,
    400,
  )
  const version = (await s.order()).version
  const results = await Promise.all([action({ version }), action({ version })])
  assert.equal(results.filter((r) => r.status === 200).length, 1)
  assert.equal(
    s.db
      .prepare(
        "SELECT COUNT(*) n FROM sms_supplier_events WHERE order_id=? AND kind='refund-confirmed'",
      )
      .get(s.id)!.n,
    1,
  )
  const order = await s.order()
  assert.equal(order.paymentStatus, 'paid')
  assert.equal(
    s.db.prepare('SELECT refunded_cents FROM orders WHERE id=?').get(s.id)!
      .refunded_cents,
    0,
  )
})
