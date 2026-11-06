// Two isolated loopback sites, real workerd/D1, and a file-only mailbox.
// No production configuration or credentials are read by this runner.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { build } from 'esbuild'
import { Miniflare, convertV4MiniflareOptions } from 'miniflare'
import { seal } from '../../worker/product-secrets.ts'

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
for (const site of ['general','wholesale']) if (!fs.existsSync(path.join(root, `artifacts/sites/${site}/dist/index.html`))) throw new Error('Run npm run sites:build before preview')
await build({ entryPoints: [path.join(root, 'worker/index.ts')], bundle: true, format: 'esm', target: 'es2023', platform: 'browser', external: ['node:*'], outfile: path.join(runtime, 'worker.mjs'), logLevel: 'silent' })
const instances = []
const origins = { general: 'http://localhost:8801', wholesale: 'http://127.0.0.1:8802' }
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
    STOREFRONT_KIND: site, ADMIN_USERNAME: 'preview-admin', ADMIN_EMAIL: 'admin@example.invalid', ADMIN_TOTP_SECRET: credentials.totp,
    PARTNER_AUTH_SECRET: credentials.secret, RESEND_API_KEY: 'local-file-mailbox-only', RESEND_FROM: 'Preview <preview@example.invalid>',
    WHOLESALE_PAYMENT_INSTRUCTIONS: '本地演示环境，不要实际付款。可提交模拟付款备注，并在本地管理后台核对演示入账。',
    RECHARGE_CHECKOUT_ENABLED: 'false', PAYMENT_CHECKOUT_ENABLED: 'false', PAYMENT_TEST_ENABLED: 'false', ORDER_TESTING_ENABLED: 'false', RECHARGE_READ_ONLY: 'true',
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
  if (site === 'wholesale' && !await db.prepare("SELECT id FROM partners WHERE id='preview-agent'").first()) {
    const now = Date.now()
    await db.batch([
      db.prepare('INSERT INTO partners(id,slug,name,email,created_at,updated_at) VALUES(?,?,?,?,?,?)').bind('preview-agent', 'preview-agent', '演示代理', 'agent@example.invalid', now, now),
      ...[
        ['demo-tool-30d', '效率工具月卡', '效率工具', 1290, 'stock', '本地演示商品 · 30 天使用期。使用模拟卡密展示自动扣款与交付，不对应真实服务。'],
        ['demo-learning-90d', '语言学习季卡', '学习成长', 3900, 'stock', '本地演示商品 · 90 天使用期。采购后在订单中查看演示卡密与交付结果。'],
        ['demo-setup', '软件配置服务', '技术服务', 5900, 'manual', '本地演示商品 · 按需求提供配置协助。填写需求备注后，由店主人工交付。'],
      ].map(([id, name, category, price, fulfillment, description]) => db.prepare('INSERT INTO wholesale_products(id,name,category,price_cents,fulfillment,description,active,updated_at) VALUES(?,?,?,?,?,?,1,?)').bind(id, name, category, price, fulfillment, description, now)),
    ])
    const stock = []
    for (const product of ['demo-tool-30d','demo-learning-90d']) for (let n = 1; n <= 12; n++) {
      const value = `PREVIEW-ONLY-${product}-${n}-${randomBytes(4).toString('hex')}`
      stock.push(db.prepare('INSERT INTO wholesale_stock(id,product_id,content_cipher,content_hash,created_at) VALUES(?,?,?,?,?)').bind(randomUUID(), product, await seal(bindings, value), createHash('sha256').update(credentials.secret + ':wholesale-stock:' + value).digest('hex'), now))
    }
    await db.batch(stock)
  }
  console.log(`${site === 'general' ? '通用商店' : '代理供货中心'}: ${origins[site]}`)
  return { site, origin: origins[site], directory }
}
async function shutdown() { await Promise.allSettled(instances.map(mf => mf.dispose())); process.exit(0) }
process.on('SIGINT', shutdown); process.on('SIGTERM', shutdown)
try {
  const sites = []
  sites.push(await start('general', 8801)); sites.push(await start('wholesale', 8802))
  fs.writeFileSync(path.join(runtime, 'ready.json'), JSON.stringify({ localOnly: true, sites, startedAt: Date.now() }, null, 2))
  console.log('代理邮箱: agent@example.invalid；管理员: preview-admin；后台路径: /admin')
  console.log('点击获取验证码后运行 npm run sites:codes 查看本地模拟邮箱与 2FA。所有邮件与交易仅在本机模拟。')
} catch (error) { await Promise.allSettled(instances.map(mf => mf.dispose())); throw error }
