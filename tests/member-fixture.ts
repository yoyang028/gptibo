import { customerFixture } from './customer-fixture.ts'
import worker from '../worker/index.ts'
import { MEMBER_STORE } from '../worker/member-auth.ts'
import { hash, randomToken } from '../worker/platform.ts'
import type { TestContext } from 'node:test'

export async function memberFixture(t: TestContext) {
  const f = await customerFixture(), origin = 'https://general.example.test'
  t.after(() => f.db.close())
  Object.assign(f.env, { MEMBERSHIP_ENABLED: 'true', MEMBER_AUTH_SECRET: 'member-fixture-independent-auth-secret-long-enough',
    OWNER_STOREFRONT_HOSTS: JSON.stringify({ 'general.example.test': MEMBER_STORE }), RESEND_API_KEY: 'test-only', RESEND_FROM: 'Shop <noreply@example.invalid>' })
  // Exercise Better Auth's actual native D1 dialect, including meta.changes.
  const database = f.env.INTEREST_DB, prepare = database.prepare.bind(database)
  Object.assign(database, { exec: async (sql: string) => { f.db.exec(sql); return { count: 1, duration: 0 } } })
  database.prepare = sql => {
    const statement = prepare(sql), all = statement.all.bind(statement)
    statement.all = async <T>() => {
      const result = await all<T>()
      const meta = f.db.prepare('SELECT changes() changes,last_insert_rowid() last_row_id').get()
      return { ...result, success: true, meta }
    }
    return statement
  }
  const sent: { to: string[]; text: string; subject: string; from: string; html: string }[] = []
  t.mock.method(globalThis, 'fetch', async (url: string, options: RequestInit) => {
    if (url !== 'https://api.resend.com/emails') throw new Error('Unexpected external request: ' + url)
    sent.push(JSON.parse(String(options.body)))
    return Response.json({ id: 'mail-fixture' })
  })
  const call = (path: string, data?: unknown, cookie = '', at = origin) => worker.fetch(new Request(at + path, {
    method: data === undefined ? 'GET' : 'POST', headers: { Origin: at, 'Content-Type': 'application/json', Cookie: cookie },
    body: data === undefined ? undefined : JSON.stringify(data),
  }), f.env)
  const cookieOf = (r: Response) => r.headers.getSetCookie().map(c => c.split(';')[0]).join('; ')
  const buyer = async () => cookieOf(await call('/api/orders/client', {}))
  const password = 'Safe-fixture-password-123!'
  async function register(email: string) {
    const r = await call('/api/member/auth/sign-up/email', { email, password, callbackURL: origin + '/account' })
    if (r.status !== 200) throw new Error('signup: ' + r.status + ' ' + await r.text())
    const message = sent.findLast(m => m.to[0] === email)
    if (!message) throw new Error('No verification mail')
    const otp = message.text.match(/验证码：(\d{6})/)?.[1]
    if (!otp) throw new Error('No verification code')
    const response = await call('/api/member/auth/email-otp/verify-email', { email, otp })
    if (response.status !== 200) throw new Error('verify: ' + response.status + ' ' + await response.text())
    const cookie = cookieOf(response) + '; ' + await buyer()
    const info = await (await call('/api/member/session', undefined, cookie)).json()
    if (!info.member) throw new Error('No verified member session: ' + JSON.stringify(info))
    return { cookie, info, id: info.member.id as string }
  }
  // For non-auth scenarios, seed a verified identity and real library session;
  // no repeated password hashing is needed in balance/concurrency tests.
  async function identity(email: string) {
    const id = crypto.randomUUID(), token = randomToken(), now = Date.now()
    f.db.prepare('INSERT INTO member_s3_user(id,name,email,emailVerified,createdAt,updatedAt) VALUES (?,\'会员\',?,1,?,?)').run(id, email, now, now)
    // Session cookie is signed by the library. Use register() for HTTP auth
    // tests; business tests can supply the same signed HMAC cookie contract.
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(f.env.MEMBER_AUTH_SECRET!), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
    const signature = btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(token)))))
    f.db.prepare('INSERT INTO member_s3_session(id,expiresAt,token,createdAt,updatedAt,userId) VALUES (?,?,?,?,?,?)').run(crypto.randomUUID(), now + 86400000, token, now, now, id)
    const cookie = '__Secure-scholai_s3.session_token=' + encodeURIComponent(token + '.' + signature) + '; ' + await buyer()
    const info = await (await call('/api/member/session', undefined, cookie)).json()
    if (!info.member) throw new Error('Identity cookie mismatch: ' + JSON.stringify(info))
    return { id, cookie, info }
  }
  function enableSupplier() {
    Object.assign(f.env, { ORDER_TESTING_ENABLED: 'false', RECHARGE_API_BASE: 'https://supplier.example.invalid/v1', RECHARGE_PARTNER_ID: 'test-member-shop', RECHARGE_KEY_ID: 'test-key', RECHARGE_CLIENT_SECRET: 'test-only-supplier-secret', RECHARGE_WEBHOOK_SECRET: 'test-only-webhook-secret', RECHARGE_NOTIFY_URL: 'https://shop.example.invalid/api/recharge/webhook', RECHARGE_CHECKOUT_ENABLED: 'true', RECHARGE_PRODUCT_MAP: JSON.stringify({ plus: 'plus', 'pro-5x': 'pro5', 'pro-20x': 'pro10', 'pro-25x': 'pro25' }) })
    for (const [id, price] of [['plus',13800],['pro-5x',71800],['pro-20x',138000],['pro-25x',380000]] as const) f.db.prepare('UPDATE owner_store_prices SET price_cents=?,enabled=1 WHERE store_id=\'store-3\' AND plan=?').run(price,id)
    const costs: Record<string, number> = { plus: 11000, pro5: 63800, pro10: 100000, pro25: 320000 }
    const writes: { path: string; body: Record<string, unknown>; key: string }[] = []
    const remotes = new Map<string, Record<string, unknown>>()
    t.mock.method(globalThis, 'fetch', async (input: string, options: RequestInit) => {
      const url = new URL(input), headers = new Headers(options.headers), raw = String(options.body ?? '{}')
      if (url.origin !== 'https://supplier.example.invalid') throw new Error('Unexpected external destination')
      const data = JSON.parse(raw)
      if (options.method === 'POST') writes.push({ path: url.pathname, body: data, key: headers.get('Idempotency-Key') ?? '' })
      if (url.pathname === '/v1/agent-profile') return Response.json({ data: { merchant: { partnerId: f.env.RECHARGE_PARTNER_ID, status: 'active' }, profile: { customRedemptionEnabled: true }, collectionModes: ['platform_collect'], productSupplyPrices: Object.fromEntries(Object.entries(costs).map(([k,v]) => [k,String(v)])) } })
      if (url.pathname === '/v1/products') return Response.json({ data: Object.entries(costs).map(([code,cost]) => ({ product_code: code, supply_price: (cost/100).toFixed(2), currency: 'CNY', max_quantity: 1, available: true, delivery_modes: ['auto_recharge'] })) })
      if (url.pathname === '/v1/payment-methods') return Response.json({ data: [{ code: 'alipay' }] })
      if (url.pathname === '/v1/orders' && options.method === 'POST') {
        const id = 'remote_' + String(data.merchant_order_no).replaceAll('-','')
        if (!remotes.has(id)) remotes.set(id, { ...data, order_id: id, currency: 'CNY', payment_scope: 'retail', supply_amount: (costs[data.product_code]/100).toFixed(2), merchant_margin: (Number(data.sale_amount)-costs[data.product_code]/100).toFixed(2), payment_status: 'pending', qr_payload: null, expires_at: new Date(Date.now()+900000).toISOString() })
        return Response.json({ data: remotes.get(id) })
      }
      const match = url.pathname.match(/^\/v1\/orders\/([^/]+)(\/payment-code|\/fulfillments)?$/)
      const remote = match ? remotes.get(match[1]) : null
      if (remote && match?.[2] === '/payment-code') return Response.json({ data: { order_id: remote.order_id, merchant_order_no: remote.merchant_order_no, amount: remote.sale_amount, currency: 'CNY', payment_status: remote.payment_status, payment_code_type: 'alipay_precreate', payment_code: 'https://qr.alipay.com/TESTONLY12345678', expires_at: remote.expires_at } })
      if (remote && !match?.[2]) return Response.json({ data: remote })
      if (remote && match?.[2] === '/fulfillments') return Response.json({ data: [] })
      throw new Error('Unexpected supplier path: ' + url.pathname)
    })
    return { writes, remotes, costs }
  }
  return { ...f, origin, call, buyer, sent, register, identity, password, cookieOf, hash, enableSupplier }
}
