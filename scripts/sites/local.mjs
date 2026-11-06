// One isolated platform with three owner storefronts, real workerd/D1, and a file-only mailbox.
// No production configuration or credentials are read by this runner.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomBytes, randomUUID } from 'node:crypto'
import { build } from 'esbuild'
import { Miniflare, convertV4MiniflareOptions } from 'miniflare'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
if (process.platform === 'win32' && !/^D:\\/i.test(root)) throw new Error('Preview data must stay on D:')
const runtime = path.join(root, 'artifacts/sites/local')
fs.mkdirSync(runtime, { recursive: true })
fs.mkdirSync(path.join(runtime, 'tmp'), { recursive: true })
process.env.TEMP = path.join(runtime, 'tmp'); process.env.TMP = path.join(runtime, 'tmp')
process.env.XDG_CONFIG_HOME = path.join(runtime, 'config')
process.env.WRANGLER_LOG_PATH = path.join(runtime, 'wrangler.log')
process.env.WRANGLER_SEND_METRICS = 'false'
const { unstable_splitSqlQuery } = await import('wrangler')
for (const site of ['platform']) if (!fs.existsSync(path.join(root, `artifacts/sites/${site}/dist/index.html`))) throw new Error('Run npm run sites:build before preview')
await build({ entryPoints: [path.join(root, 'worker/index.ts')], bundle: true, format: 'esm', target: 'es2023', platform: 'browser', external: ['node:*'], outfile: path.join(runtime, 'worker.mjs'), logLevel: 'silent' })
const instances = []
const origins = { platform: 'http://localhost:8801' }
const rules = {}; let current
for (const line of fs.readFileSync(path.join(root, 'public/_headers'), 'utf8').split(/\r?\n/)) {
  if (line.startsWith('/')) { current = line.trim(); rules[current] = { set: {} } }
  else if (line.trim() && current) { const colon = line.indexOf(':'); rules[current].set[line.slice(0, colon).trim()] = line.slice(colon + 1).trim() }
}
async function start(site, port) {
  const directory = path.join(runtime, site), mailbox = path.join(directory, 'mailbox')
  fs.mkdirSync(mailbox, { recursive: true })
  const credentialsPath = path.join(directory, 'credentials.json')
  if (!fs.existsSync(credentialsPath)) fs.writeFileSync(credentialsPath, JSON.stringify({ localOnly: true, secret: randomBytes(32).toString('hex'), totp: Array.from(randomBytes(32), b => 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'[b & 31]).join('') }), { mode: 0o600, flag: 'wx' })
  const credentials = JSON.parse(fs.readFileSync(credentialsPath, 'utf8'))
  if (credentials.localOnly !== true) throw new Error('Refusing non-preview credentials')
  const bindings = {
    ADMIN_USERNAME: 'preview-admin', ADMIN_EMAIL: 'admin@example.invalid', ADMIN_TOTP_SECRET: credentials.totp,
    PARTNER_AUTH_SECRET: credentials.secret, RESEND_API_KEY: 'local-file-mailbox-only', RESEND_FROM: 'Preview <preview@example.invalid>',
    RECHARGE_CHECKOUT_ENABLED: 'false', PAYMENT_CHECKOUT_ENABLED: 'false', PAYMENT_TEST_ENABLED: 'false', ORDER_TESTING_ENABLED: 'true', RECHARGE_READ_ONLY: 'true',
  }
  const mf = new Miniflare({ ...convertV4MiniflareOptions({
    host: '127.0.0.1', port, cf: false, modules: true, scriptPath: path.join(runtime, 'worker.mjs'), compatibilityDate: '2026-09-26', compatibilityFlags: ['nodejs_compat','service_binding_extra_handlers'],
    d1Databases: { INTEREST_DB: `gptibo-${site}-preview` },
    ratelimits: { INTEREST_LIMITER: { namespace_id: '3001', simple: { limit: 30, period: 60 } }, API_LIMITER: { namespace_id: '3002', simple: { limit: 120, period: 60 } }, EXPENSIVE_LIMITER: { namespace_id: '3003', simple: { limit: 90, period: 60 } } },
    assets: { directory: path.join(root, `artifacts/sites/${site}/dist`), binding: 'ASSETS', run_worker_first: ['/api/*'], routerConfig: { has_user_worker: true }, assetConfig: { not_found_handling: 'single-page-application', headers: { version: 2, rules } } }, bindings,
    outboundService: async request => {
      const url = new URL(request.url)
      if (url.href === 'https://api.resend.com/emails' && request.method === 'POST') {
        const mail = await request.json()
        if (!Array.isArray(mail.to) || mail.to.some(email => !/^[^@\s]+@example\.invalid$/.test(email))) throw new Error('Only synthetic preview recipients are allowed')
        const id = randomUUID()
        fs.writeFileSync(path.join(mailbox, id + '.json'), JSON.stringify({ ...mail, savedAt: Date.now() }), { mode: 0o600 })
        return Response.json({ id })
      }
      throw new Error('Preview blocked external network request')
    },
  }), telemetry: { enabled: false }, resourcePersistencePath: path.join(directory, 'state'), resourceTmpPath: path.join(directory, 'tmp') })
  instances.push(mf)
  await mf.ready
  const db = await mf.getD1Database('INTEREST_DB')
  await db.exec('CREATE TABLE IF NOT EXISTS local_migrations(name TEXT PRIMARY KEY, applied_at INTEGER NOT NULL)')
  const applied = new Set((await db.prepare('SELECT name FROM local_migrations').all()).results.map(r => r.name))
  for (const name of fs.readdirSync(path.join(root, 'migrations')).filter(f => f.endsWith('.sql')).sort()) {
    if (applied.has(name)) continue
    await db.batch([...unstable_splitSqlQuery(fs.readFileSync(path.join(root, 'migrations', name), 'utf8')).map(sql => db.prepare(sql)), db.prepare('INSERT INTO local_migrations VALUES(?,?)').bind(name, Date.now())])
  }
  const agentId = '00000000-0000-4000-8000-000000000001'
  if (!await db.prepare('SELECT id FROM partners WHERE id=?').bind(agentId).first()) {
    const now = Date.now()
    await db.batch([
      db.prepare('INSERT INTO partners(id,slug,name,email,created_at,updated_at) VALUES(?,?,?,?,?,?)').bind(agentId, 'AGENT1', '演示代理商店', 'agent@example.invalid', now, now),
      db.prepare('INSERT INTO partner_prices(partner_id,plan,cost_cents,price_cents) SELECT ?,id,price_cents,price_cents FROM catalog_plans WHERE partner_enabled=1').bind(agentId),
      db.prepare("UPDATE owner_shop_settings SET settings=json_set(settings,'$.name','ScholAI 演示店','$.brandName','ScholAI 演示店') WHERE id='platform'"),
    ])
  }
  console.log('主后台: ' + origins[site] + '/admin')
  console.log('三家自营前台: ' + origins[site] + '/ | /s/store-2 | /s/store-3')
  console.log('代理后台: ' + origins[site] + '/partner；演示代理前台: /r/AGENT1')
  return { site, origin: origins[site], directory }
}
async function shutdown() { await Promise.allSettled(instances.map(mf => mf.dispose())); process.exit(0) }
process.on('SIGINT', shutdown); process.on('SIGTERM', shutdown)
try {
  const sites = []
  sites.push(await start('platform', 8801))
  fs.writeFileSync(path.join(runtime, 'ready.json'), JSON.stringify({ localOnly: true, sites, startedAt: Date.now() }, null, 2))
  console.log('代理邮箱: agent@example.invalid；管理员: preview-admin；后台路径: /admin')
  console.log('点击获取验证码后运行 npm run sites:codes 查看本地模拟邮箱与 2FA。所有邮件与交易仅在本机模拟。')
} catch (error) { await Promise.allSettled(instances.map(mf => mf.dispose())); throw error }
