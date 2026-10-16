// Local workerd + real D1 bindings. Every outbound request is restricted to the
// independent loopback supplier or the file-only simulated mailbox.
import fs from 'node:fs'
import path from 'node:path'
import https from 'node:https'
import { createServer } from 'node:http'
import { fileURLToPath } from 'node:url'
import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import { build } from 'esbuild'
import { Miniflare, convertV4MiniflareOptions } from 'miniflare'
import { createXiaojiuFixture } from './xiaojiu-fixture.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
if (process.platform === 'win32' && !/^D:\\/i.test(root)) throw new Error('Local artifacts must stay on D:')
const xiaojiuVariant = process.env.GPTIBO_LOCAL_VARIANT === 'xiaojiu'
const runtime = path.join(root, xiaojiuVariant ? 'artifacts/local/cloudflare-xiaojiu' : 'artifacts/local/cloudflare')
const privateRoot = path.join(root, xiaojiuVariant ? 'artifacts/local/.secrets/xiaojiu-cloudflare-mock' : 'artifacts/local/.secrets/quefa-cloudflare-mock')
const tlsRoot = path.join(root, 'artifacts/local/.secrets/quefa-cloudflare-mock')
const port = xiaojiuVariant ? 8781 : 8771, controlPort = xiaojiuVariant ? 8784 : 8774
const origin = 'https://127.0.0.1:' + port
fs.mkdirSync(privateRoot, { recursive: true })
fs.mkdirSync(runtime, { recursive: true })
process.env.XDG_CONFIG_HOME = path.join(runtime, 'config')
process.env.WRANGLER_LOG_PATH = path.join(runtime, 'wrangler.log')
process.env.WRANGLER_SEND_METRICS = 'false'
const { unstable_splitSqlQuery } = await import('wrangler')
const mailbox = path.join(runtime, 'mailbox')
fs.mkdirSync(mailbox, { recursive: true })
const authPath = path.join(privateRoot, 'admin-totp')
if (!fs.existsSync(authPath)) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
  fs.writeFileSync(authPath, Array.from(randomBytes(32), b => alphabet[b & 31]).join(''), { mode: 0o600, flag: 'wx' })
}
const ca = fs.readFileSync(path.join(tlsRoot, 'cert.pem'))
const key = fs.readFileSync(path.join(tlsRoot, 'key.pem'), 'utf8')
await build({ entryPoints: [path.join(root, 'worker/index.ts')], bundle: true, format: 'esm', target: 'es2023', platform: 'browser', external: ['node:*'], outfile: path.join(runtime, 'worker.mjs'), logLevel: 'silent' })
let supplierRequests = 0
const genericOrders = new Map()
const xiaojiuFixture = createXiaojiuFixture()
const outbound = async request => {
  const url = new URL(request.url)
  if (url.origin === 'https://98-xj.com') return xiaojiuFixture.fetch(request)
  if(url.origin==='https://fixture-supplier.example.com') {
    // Isolated JSON v1 fixture for owner-published products. Never forwards to a network.
    if(url.pathname==='/v1/products'&&request.method==='GET')return Response.json({products:[{product_code:'fixture-subscription',available:true}]})
    if(url.pathname==='/v1/orders'&&request.method==='POST') {
      const input=await request.json()
      if(request.headers.get('Idempotency-Key')!==input.merchant_order_no)return Response.json({}, {status:400})
      const order={order_id:input.merchant_order_no,merchant_order_no:input.merchant_order_no,status:'pending',cost_cents:100,delivery_content:'LOCAL-FIXTURE-DELIVERY'}
      if(!genericOrders.has(order.order_id))genericOrders.set(order.order_id,order)
      return Response.json(genericOrders.get(order.order_id))
    }
    const id=url.pathname.match(/^\/v1\/orders\/([A-Z0-9-]+)$/)?.[1],order=genericOrders.get(id)
    if(order&&request.method==='GET')return Response.json({...order,status:'success'})
    return Response.json({}, {status:404})
  }
  if (url.origin === 'https://api.resend.com' && url.pathname === '/emails' && request.method === 'POST') {
    const mail = await request.json()
    if (!Array.isArray(mail.to) || mail.to.length !== 1 || !/^[^@\s]+@(?:example\.(?:invalid|test)|gmail\.com)$/.test(mail.to[0])) throw new Error('Unexpected local mailbox recipient')
    const id = randomUUID()
    fs.writeFileSync(path.join(mailbox, id + '.json'), JSON.stringify({ id, savedAt: new Date().toISOString(), ...mail }), { mode: 0o600 })
    return Response.json({ id })
  }
  if (url.origin !== 'https://127.0.0.1:8773' || !url.pathname.startsWith('/v1/')) throw new Error('Local fixture blocked an external request')
  supplierRequests++
  const raw = Buffer.from(await request.arrayBuffer())
  return new Promise((resolve, reject) => {
    const upstream = https.request(url, { method: request.method, headers: Object.fromEntries(request.headers), ca, timeout: 12000 }, response => {
      const chunks = []; let size = 0
      response.on('data', chunk => { size += chunk.length; if (size > 256000) response.destroy(new Error('Fixture response too large')); else chunks.push(chunk) })
      response.on('error', reject)
      response.on('end', () => resolve(new Response(Buffer.concat(chunks), { status: response.statusCode, headers: Object.fromEntries(Object.entries(response.headers).filter(([, value]) => typeof value === 'string')) })))
    })
    upstream.on('error', reject); upstream.on('timeout', () => upstream.destroy(new Error('Fixture timeout')))
    upstream.end(raw)
  })
}
// The same _headers file is interpreted by Cloudflare's asset service in a
// deployment. Pass its rules explicitly to the local asset service as well.
const rules = {}; let current
for (const line of fs.readFileSync(path.join(root, 'public/_headers'), 'utf8').split(/\r?\n/)) {
  if (line.startsWith('/')) { current = line.trim(); rules[current] = { set: {} } }
  else if (line.trim() && current) {
    const separator = line.indexOf(':')
    rules[current].set[line.slice(0, separator).trim()] = line.slice(separator + 1).trim()
  }
}
const config = {
  host: '127.0.0.1', port, https: true, httpsCert: ca.toString(), httpsKey: key,
  modules: true, scriptPath: path.join(runtime, 'worker.mjs'), compatibilityDate: '2026-09-26', compatibilityFlags: ['nodejs_compat', 'service_binding_extra_handlers'],
  d1Databases: { INTEREST_DB: xiaojiuVariant ? 'gptibo-cloudflare-xiaojiu-local' : 'gptibo-cloudflare-local' },
  ratelimits: {
    INTEREST_LIMITER: { namespace_id: '2001', simple: { limit: 30, period: 60 } },
    API_LIMITER: { namespace_id: '2002', simple: { limit: 120, period: 60 } },
    EXPENSIVE_LIMITER: { namespace_id: '2003', simple: { limit: 90, period: 60 } },
  },
  assets: { directory: path.join(root, 'dist'), binding: 'ASSETS', run_worker_first: ['/api/*'], routerConfig: { has_user_worker: true }, assetConfig: { not_found_handling: 'single-page-application', headers: { version: 2, rules } } },
  bindings: {
    ADMIN_USERNAME: 'dev-admin', ADMIN_EMAIL: 'admin@example.invalid', ADMIN_TOTP_SECRET: fs.readFileSync(authPath, 'utf8').trim(),
    RESEND_API_KEY: 'local_mailbox_only', RESEND_FROM: 'GPTibo Local <noreply@example.invalid>', PARTNER_AUTH_SECRET: 'local_cloudflare_partner_fixture_not_a_real_secret_32',
    ORDER_TESTING_ENABLED: 'false', EMAIL_PRODUCTS_ENABLED: 'false', PAYMENT_CHECKOUT_ENABLED: 'false', PAYMENT_TEST_ENABLED: 'false', XGIFT_CHECKOUT_ENABLED: 'false', ACCOUNT_SUPPLIER_CHECKOUT_ENABLED: 'false', DELIVERY_SUPPLIER_CHECKOUT_ENABLED: 'false',
    XIAOJIU_PURCHASE_ENABLED: 'true', // Only the isolated outbound fixture above is reachable.
    RECHARGE_API_BASE: 'https://127.0.0.1:8773/v1', RECHARGE_PARTNER_ID: 'pt_local_mock', RECHARGE_KEY_ID: 'key_local_mock',
    RECHARGE_CLIENT_SECRET: 'local_mock_signing_not_a_real_credential', RECHARGE_WEBHOOK_SECRET: 'local_mock_webhook_not_a_real_credential',
    RECHARGE_NOTIFY_URL: origin + '/api/recharge/webhook', RECHARGE_PRODUCT_MAP: '{"plus":"chatgpt_plus_cdk_1m"}', RECHARGE_COLLECTION_MODE: 'platform_collect', RECHARGE_CHECKOUT_ENABLED: 'true', RECHARGE_READ_ONLY: 'false',
  }, outboundService: outbound,
}
const mf = new Miniflare({ ...convertV4MiniflareOptions({ ...config, cf: false }), telemetry: { enabled: false }, resourcePersistencePath: path.join(runtime, 'state'), resourceTmpPath: path.join(runtime, 'tmp') })
let cron
let control
try {
  await mf.ready
  const db = await mf.getD1Database('INTEREST_DB')
  await db.exec('CREATE TABLE IF NOT EXISTS local_migrations (name TEXT PRIMARY KEY, applied_at INTEGER NOT NULL)')
  const applied = new Set((await db.prepare('SELECT name FROM local_migrations').all()).results.map(row => row.name))
  for (const name of fs.readdirSync(path.join(root, 'migrations')).filter(name => name.endsWith('.sql')).sort()) {
    if (applied.has(name)) continue
    // D1 exec treats newlines as statement boundaries. Use Wrangler's SQL
    // parser so multiline DDL and trigger bodies remain intact and atomic.
    const statements = unstable_splitSqlQuery(fs.readFileSync(path.join(root, 'migrations', name), 'utf8'))
    await db.batch([...statements.map(sql => db.prepare(sql)), db.prepare('INSERT INTO local_migrations VALUES (?,?)').bind(name, Date.now())])
  }
  const worker = await mf.getWorker()
  cron = setInterval(() => worker.scheduled({ scheduledTime: Date.now() }).catch(() => console.error('Local scheduled reconciliation failed')), 60000)
  fs.writeFileSync(path.join(runtime, 'ready.json'), JSON.stringify({ origin, startedAt: new Date().toISOString(), backend: 'workerd-d1', mode: 'loopback-fixtures-only', migrations: fs.readdirSync(path.join(root, 'migrations')).filter(n => n.endsWith('.sql')).length }))
  console.log('Local Cloudflare acceptance runtime ready: ' + origin)
  const shutdown = async () => {
    clearInterval(cron)
    fs.writeFileSync(path.join(runtime, 'last-run.json'), JSON.stringify({ stoppedAt: new Date().toISOString(), supplierRequests }))
    control?.close()
    await mf.dispose(); process.exit(0)
  }
  const token = randomBytes(32).toString('hex')
  fs.writeFileSync(path.join(privateRoot, 'control-token'), token, { mode: 0o600 })
  control = createServer(async (request, response) => {
    const supplied = Buffer.from(request.headers['x-local-control'] ?? '')
    const authorized = supplied.length === token.length && timingSafeEqual(supplied, Buffer.from(token))
    if (request.headers.host !== '127.0.0.1:' + controlPort) { response.writeHead(403).end(); return }
    if (request.url === '/state' && request.method === 'GET') {
      response.setHeader('Content-Type', 'application/json'); response.setHeader('Cache-Control', 'no-store')
      response.end(JSON.stringify({ localMock: true, origin, supplierRequests, xiaojiu: xiaojiuFixture.stats() })); return
    }
    if (request.method !== 'POST' || request.headers.origin !== 'http://127.0.0.1:' + controlPort || !authorized) { response.writeHead(403).end(); return }
    if (request.url === '/shutdown') { response.writeHead(204).end(); await shutdown(); return }
    if (request.url === '/scheduled') {
      try { await worker.scheduled({ scheduledTime: Math.floor(Date.now() / 300000) * 300000 }); response.writeHead(204).end() }
      catch { response.writeHead(503).end() }
      return
    }
    if (request.url === '/audit') {
      let raw = ''; for await (const chunk of request) { raw += chunk; if (raw.length > 200) { response.writeHead(413).end(); return } }
      const { needle = '' } = JSON.parse(raw || '{}')
      const tables = ['orders', 'order_events', 'recharge_orders', 'recharge_redemptions', 'recharge_webhooks', 'admin_audit', 'refund_cases']
      const counts = {}; let credentialStored = false
      for (const table of tables) {
        const { results } = await db.prepare('SELECT * FROM ' + table).all()
        counts[table] = results.length
        if (needle && JSON.stringify(results).includes(needle)) credentialStored = true
      }
      const paymentEvents = await db.prepare("SELECT COUNT(*) n FROM order_events WHERE action='payment-confirmed'").first()
      response.setHeader('Content-Type', 'application/json'); response.setHeader('Cache-Control', 'no-store')
      response.end(JSON.stringify({ counts, credentialStored, paymentConfirmedEvents: paymentEvents.n })); return
    }
    response.writeHead(404).end()
  }).listen(controlPort, '127.0.0.1')
  process.on('SIGINT', shutdown); process.on('SIGTERM', shutdown)
} catch (error) {
  clearInterval(cron); await mf.dispose()
  fs.writeFileSync(path.join(runtime, 'startup-error.txt'), String(error.stack))
  throw new Error('Local Cloudflare startup failed; check schema and fixture runtime')
}
