// Loopback-only credential entry and read-only catalogue inspection. No purchase route.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'node:http'
import { spawnSync } from 'node:child_process'
import { DatabaseSync } from 'node:sqlite'
import {
  XiaojiuPurchaseClient,
  purchaseCredentials,
} from '../../worker/xiaojiu/purchase.ts'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
if (process.platform !== 'win32' || !/^D:\\/i.test(root))
  throw new Error(
    'This local credential tool requires Windows and a D-drive project',
  )
const origin = 'http://127.0.0.1:8787'
const privateDir = path.join(root, 'artifacts/local/.secrets/xiaojiu-purchase')
const evidenceDir = path.join(root, 'artifacts/local/evidence/xiaojiu-readonly')
fs.mkdirSync(privateDir, { recursive: true })
fs.mkdirSync(evidenceDir, { recursive: true })
const credentialFile = path.join(privateDir, 'credentials.dpapi')
const suppliedKeyFile = path.join(privateDir, 'api-key.dpapi')
const database = new DatabaseSync(':memory:')
for (const name of fs
  .readdirSync(path.join(root, 'migrations'))
  .filter((name) => name.endsWith('.sql'))
  .sort())
  database.exec(fs.readFileSync(path.join(root, 'migrations', name), 'utf8'))
const env = {
  XIAOJIU_PURCHASE_ENABLED: 'false',
  INTEREST_DB: {
    prepare(sql) {
      let values = []
      return {
        bind(...v) {
          values = v
          return this
        },
        async first() {
          return database.prepare(sql).get(...values) ?? null
        },
        async run() {
          return database.prepare(sql).run(...values)
        },
        async all() {
          return { results: database.prepare(sql).all(...values) }
        },
      }
    },
  },
}
let suppliedKey = '',
  status = {
    running: false,
    configured: fs.existsSync(credentialFile),
    keyReceived: false,
    ready: false,
    items: [],
    error: '',
    purchaseRequests: 0,
  }
function dpapi(mode, input) {
  const expression =
    mode === 'protect'
      ? '$bytes=[Text.Encoding]::UTF8.GetBytes([Console]::In.ReadToEnd());try{[Console]::Out.Write([Convert]::ToBase64String([Security.Cryptography.ProtectedData]::Protect($bytes,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser)))}finally{[Array]::Clear($bytes,0,$bytes.Length)}'
      : '$cipher=[Convert]::FromBase64String([Console]::In.ReadToEnd());$bytes=[Security.Cryptography.ProtectedData]::Unprotect($cipher,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser);try{[Console]::Out.Write([Text.Encoding]::UTF8.GetString($bytes))}finally{[Array]::Clear($bytes,0,$bytes.Length)}'
  const result = spawnSync(
    'powershell.exe',
    [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      'Add-Type -AssemblyName System.Security;' + expression,
    ],
    {
      input,
      encoding: 'utf8',
      windowsHide: true,
      timeout: 15000,
      maxBuffer: 16384,
      env: {
        ...process.env,
        TEMP: path.join(root, 'artifacts/local/tmp'),
        TMP: path.join(root, 'artifacts/local/tmp'),
      },
    },
  )
  if (result.status !== 0 || !result.stdout)
    throw new Error('Windows 加密保存失败，请保留页面并联系处理。')
  return result.stdout
}
if (fs.existsSync(suppliedKeyFile)) {
  const value = dpapi('unprotect', fs.readFileSync(suppliedKeyFile, 'utf8'))
  if (/^[a-fA-F0-9]{64}$/.test(value)) {
    suppliedKey = value
    status.keyReceived = true
  }
}
async function inspect() {
  if (status.running) return
  status = { ...status, running: true, ready: false, error: '', items: [] }
  try {
    let plain = dpapi('unprotect', fs.readFileSync(credentialFile, 'utf8'))
    const credentials = purchaseCredentials(plain)
    plain = ''
    const client = new XiaojiuPurchaseClient(env, credentials)
    const wallet = await client.ping(true)
    const items = []
    let total = 0
    for (let page = 1; page <= 100; page++) {
      if (page > 1) await new Promise((resolve) => setTimeout(resolve, 1300))
      const result = await client.catalog(page)
      items.push(...result.items)
      total = result.total
      status = {
        ...status,
        items: [...items],
        pagesRead: page,
        productsTotal: total,
      }
      if (page * result.pageSize >= total) break
    }
    status = {
      ...status,
      running: false,
      ready: true,
      configured: true,
      balanceCents: wallet.balanceCents,
      currency: 'CNY',
      checkedAt: new Date().toISOString(),
      items,
      purchaseRequests: 0,
    }
    fs.writeFileSync(
      path.join(evidenceDir, 'catalog.json'),
      JSON.stringify(status, null, 2) + '\n',
      { mode: 0o600 },
    )
    console.log(
      JSON.stringify({
        readonlyCatalogReady: true,
        skus: items.length,
        available: items.filter((item) => item.available).length,
        purchaseRequests: 0,
      }),
    )
  } catch (error) {
    status = {
      ...status,
      running: false,
      ready: false,
      error:
        error instanceof Error ? error.message : '只读查询失败，请核对凭据。',
    }
  }
}
if (process.argv.includes('--self-test')) {
  const fixture = JSON.stringify({
    key: 'a'.repeat(64),
    secret: 'b'.repeat(128),
  })
  if (dpapi('unprotect', dpapi('protect', fixture)) !== fixture)
    throw new Error('Windows encryption self-test failed')
  console.log('DPAPI credential round-trip: PASS; supplier requests: 0')
  database.close()
  process.exit(0)
}
const css = `body{margin:0;background:#f5f5fa;color:#222;font:16px/1.6 system-ui,sans-serif}main{max-width:1000px;margin:40px auto;padding:24px}form{display:grid;gap:16px;background:white;padding:24px;border-radius:16px}label{display:grid;gap:5px}input,button{font:inherit;padding:11px;border:1px solid #ccc;border-radius:8px}button{background:#5d4ad1;color:white;cursor:pointer}button:disabled{opacity:.5}#recheck{margin-top:16px}.table{overflow:auto}table{width:100%;border-collapse:collapse;background:white}th,td{text-align:left;padding:12px;border-bottom:1px solid #ddd}`
const server = createServer(async (request, response) => {
  const headers = {
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'Content-Security-Policy':
      "default-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
  }
  const json = (data, code = 200) => {
    response.writeHead(code, {
      ...headers,
      'Content-Type': 'application/json; charset=utf-8',
    })
    response.end(JSON.stringify(data))
  }
  if (request.headers.host !== '127.0.0.1:8787')
    return json({ error: '禁止访问' }, 403)
  if (request.method === 'GET') {
    if (request.url === '/api/status') return json(status)
    const assets = {
      '/': [
        fs.readFileSync(
          path.join(root, 'scripts/local/xiaojiu-connect.html'),
          'utf8',
        ),
        'text/html',
      ],
      '/app.js': [
        fs.readFileSync(
          path.join(root, 'scripts/local/xiaojiu-connect-ui.js'),
          'utf8',
        ),
        'text/javascript',
      ],
      '/style.css': [css, 'text/css'],
    }
    if (assets[request.url]) {
      response.writeHead(200, {
        ...headers,
        'Content-Type': assets[request.url][1] + '; charset=utf-8',
      })
      response.end(assets[request.url][0])
      return
    }
    return json({ error: '未找到' }, 404)
  }
  if (
    request.method !== 'POST' ||
    request.headers.origin !== origin ||
    request.headers['content-type']?.split(';')[0] !== 'application/json'
  )
    return json({ error: '请从本机配置页提交' }, 403)
  if (!['/api/connect', '/api/check', '/api/key'].includes(request.url))
    return json({ error: '未找到' }, 404)
  if (status.running) return json({ error: '正在读取，请稍候' }, 409)
  try {
    let raw = ''
    for await (const chunk of request) {
      raw += chunk
      if (Buffer.byteLength(raw) > 8192) return json({ error: '内容过长' }, 413)
    }
    const data = JSON.parse(raw)
    if (request.url === '/api/key') {
      if (typeof data.key !== 'string' || !/^[a-fA-F0-9]{64}$/.test(data.key))
        return json({ error: 'API Key 格式不正确' }, 400)
      fs.writeFileSync(suppliedKeyFile, dpapi('protect', data.key), {
        mode: 0o600,
      })
      suppliedKey = data.key
      status.keyReceived = true
      status.error = ''
      return json({ keyReceived: true })
    }
    if (request.url === '/api/connect') {
      const credentials = purchaseCredentials(
        JSON.stringify({ key: data.key || suppliedKey, secret: data.secret }),
      )
      const encrypted = dpapi('protect', JSON.stringify(credentials))
      fs.writeFileSync(credentialFile, encrypted, { mode: 0o600 })
      status.configured = true
    }
    if (!fs.existsSync(credentialFile))
      return json({ error: '请先填写并保存凭据' }, 409)
    status.error = ''
    json({ accepted: true, purchaseRequests: 0 }, 202)
    void inspect()
  } catch (error) {
    const message =
      error instanceof Error && error.message.startsWith('小久采购：')
        ? error.message
        : '配置未保存，请检查输入格式。'
    status.error = message
    json({ error: message }, 400)
  }
})
server.listen(8787, '127.0.0.1', () =>
  console.log('Read-only Xiaojiu setup: ' + origin),
)
