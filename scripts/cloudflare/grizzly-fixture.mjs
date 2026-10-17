// Local-only synthetic wallet + signed Alipay gateway. No network forwarding.
import { generateKeyPairSync, sign, verify } from 'node:crypto'
export const grizzlyFixtureKey = 'local-grizzly-fixture-never-a-real-api-key'
const canonical = (params, excluded = ['sign']) =>
  Object.keys(params)
    .filter(
      (k) =>
        !excluded.includes(k) && params[k] !== undefined && params[k] !== '',
    )
    .sort()
    .map((k) => `${k}=${params[k]}`)
    .join('&')
export function createGrizzlyFixture(origin) {
  const idBase = Date.now() * 1000
  const keys = generateKeyPairSync('rsa', { modulusLength: 2048 }),
    payments = new Map(),
    activations = new Map()
  let allocations = 0,
    requests = 0
  const bindings = {
    GRIZZLY_SMS_ENABLED: 'true',
    PAYMENT_CHECKOUT_ENABLED: 'true',
    PAYMENT_PROVIDER: 'alipay',
    PAYMENT_NOTIFY_ORIGIN: origin,
    ALIPAY_APP_ID: '2026000000000000',
    ALIPAY_SELLER_ID: '2088000000000000',
    ALIPAY_APP_PRIVATE_KEY: keys.privateKey
      .export({ type: 'pkcs8', format: 'pem' })
      .toString(),
    ALIPAY_PUBLIC_KEY: keys.publicKey
      .export({ type: 'spki', format: 'pem' })
      .toString(),
  }
  const signed = (method, data) => {
    const raw = JSON.stringify(data)
    return new Response(
      `{"${method.replaceAll('.', '_')}_response":${raw},"sign":"${sign('RSA-SHA256', Buffer.from(raw), keys.privateKey).toString('base64')}"}`,
    )
  }
  return {
    bindings,
    stats: () => ({
      allocations,
      requests,
      activations: [...activations.values()].map((a) => ({
        id: a.id,
        service: a.service,
        state: a.state,
      })),
      payments: [...payments.entries()].map(([id, p]) => ({
        id,
        status: p.status,
      })),
    }),
    receive(id, code) {
      const a = activations.get(String(id))
      if (!a || a.state !== 'waiting' || !/^\d{6}$/.test(code))
        throw new Error('Invalid synthetic SMS')
      a.code = code
      a.state = 'received'
    },
    pay(id) {
      const p = payments.get(id)
      if (!p) throw new Error('No synthetic payment')
      p.status = 'paid'
    },
    async fetch(request) {
      const url = new URL(request.url)
      if (
        url.origin === 'https://openapi.alipay.com' &&
        url.pathname === '/gateway.do'
      ) {
        const values = Object.fromEntries(
          new URLSearchParams(await request.text()),
        )
        if (
          !verify(
            'RSA-SHA256',
            Buffer.from(canonical(values)),
            keys.publicKey,
            Buffer.from(values.sign, 'base64'),
          )
        )
          throw new Error('Synthetic payment signature invalid')
        const biz = JSON.parse(values.biz_content),
          id = biz.out_trade_no
        if (values.method === 'alipay.trade.precreate') {
          if (!payments.has(id))
            payments.set(id, { amount: biz.total_amount, status: 'pending' })
          return signed(values.method, {
            code: '10000',
            out_trade_no: id,
            qr_code: 'https://qr.alipay.com/localgrizzlyfixture',
          })
        }
        const p = payments.get(id)
        if (!p)
          return signed(values.method, {
            code: '40004',
            sub_code: 'ACQ.TRADE_NOT_EXIST',
          })
        if (values.method === 'alipay.trade.query')
          return signed(values.method, {
            code: '10000',
            out_trade_no: id,
            total_amount: p.amount,
            seller_id: bindings.ALIPAY_SELLER_ID,
            trade_status:
              p.status === 'paid' ? 'TRADE_SUCCESS' : 'WAIT_BUYER_PAY',
            trade_no: '202610170000000001' + id.slice(-4),
          })
        if (values.method === 'alipay.trade.close' && p.status !== 'paid') {
          p.status = 'closed'
          return signed(values.method, { code: '10000', out_trade_no: id })
        }
        throw new Error('Unexpected synthetic payment method')
      }
      if (
        url.origin !== 'https://api.grizzlysms.com' ||
        url.pathname !== '/stubs/handler_api.php' ||
        url.searchParams.get('api_key') !== grizzlyFixtureKey
      )
        throw new Error('Only synthetic Grizzly requests are allowed')
      requests++
      const params = url.searchParams,
        action = params.get('action'),
        service = params.get('service')
      if (action === 'getBalance') return new Response('ACCESS_BALANCE:100.00')
      if (action === 'getPrices')
        return Response.json({ 187: { [service]: { cost: 0.13, count: 100 } } })
      if (action === 'getNumberV2') {
        if (
          params.get('country') !== '187' ||
          !['dr', 'acz', 'go'].includes(service) ||
          Number(params.get('maxPrice')) < 0.13
        )
          throw new Error('Invalid synthetic US allocation')
        const id = String(idBase + ++allocations),
          phone = '120255501' + String(allocations % 100).padStart(2, '0')
        activations.set(id, {
          id,
          phone,
          service,
          state: 'waiting',
          code: null,
        })
        return Response.json({
          activationId: Number(id),
          phoneNumber: phone,
          activationCost: 0.13,
          currency: 840,
          countryCode: '187',
        })
      }
      const a = activations.get(params.get('id'))
      if (!a) return new Response('NO_ACTIVATION')
      if (action === 'getStatus')
        return new Response(
          a.code
            ? 'STATUS_OK:' + a.code
            : a.state === 'cancelled'
              ? 'STATUS_CANCEL'
              : 'STATUS_WAIT_CODE',
        )
      if (action === 'setStatus' && params.get('status') === '8' && !a.code) {
        a.state = 'cancelled'
        return new Response('ACCESS_CANCEL')
      }
      if (action === 'setStatus' && params.get('status') === '6' && a.code)
        return new Response('ACCESS_ACTIVATION')
      return new Response('BAD_STATUS')
    },
  }
}
