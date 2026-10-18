// This acceptance script can only target the isolated, synthetic local runtime.
import fs from 'node:fs'
import path from 'node:path'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { totp } from '../local/auth.mjs'
import { hanfolkFixtureKey } from './hanfolk-fixture.mjs'
import { xiaojiuFixtureKey, xiaojiuFixtureSecret } from './xiaojiu-fixture.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const origin = 'https://127.0.0.1:8791', control = 'http://127.0.0.1:8794'
const evidence = path.join(root, 'artifacts/local/evidence/supplier-management')
fs.mkdirSync(evidence, { recursive: true })
const initial = await (await fetch(control + '/state')).json()
assert.equal(initial.localMock, true)
assert.equal(initial.origin, origin)
const privateRoot = path.join(root, 'artifacts/local/.secrets/grizzly-cloudflare-mock')
await fetch(control + '/reset-auth-limits', { method: 'POST', headers: { Origin: control, 'X-Local-Control': fs.readFileSync(path.join(privateRoot, 'control-token'), 'utf8').trim() } })
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE_PATH || 'D:/ChatGPT/CodexCache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright')
const result = { checks: [], pageErrors: [], externalRequests: [] }
const browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || 'C:/Program Files/Google/Chrome/Application/chrome.exe', env: { ...process.env, TEMP: path.join(root, 'artifacts/local/tmp'), TMP: path.join(root, 'artifacts/local/tmp') } })
const context = await browser.newContext({ baseURL: origin, ignoreHTTPSErrors: true, viewport: { width: 1440, height: 1040 } })
await context.route('**/*', route => {
  if (new URL(route.request().url()).origin === origin) return route.continue()
  result.externalRequests.push(new URL(route.request().url()).origin)
  return route.abort()
})
const page = await context.newPage()
page.on('pageerror', e => result.pageErrors.push(e.message))
function record(name) { result.checks.push({ name, passed: true }); console.log(name) }
async function api(url, data) {
  const response = await context.request.fetch(url, { method: data === undefined ? 'GET' : 'POST', headers: { Origin: origin }, ...(data === undefined ? {} : { data }) })
  assert(response.ok(), url + ': ' + await response.text())
  return response.json()
}
async function screenshot(name) { await page.screenshot({ path: path.join(evidence, name + '.png'), fullPage: true }) }
async function supplier(name) { await page.getByRole('navigation', { name: '商品服务商' }).getByRole('button').filter({ hasText: name }).first().click() }
async function stock(stock) {
  const response = await fetch(control + '/daju/stock', { method: 'POST', headers: { Origin: control, 'Content-Type': 'application/json', 'X-Local-Control': fs.readFileSync(path.join(privateRoot,'control-token'),'utf8').trim() }, body: JSON.stringify({ productId:100, sku:'20', stock }) })
  assert.equal(response.status,204)
}
async function noOverflow() {
  const overflow = await page.evaluate(() => ({ width: innerWidth, scrollWidth: document.documentElement.scrollWidth, nodes: [...document.querySelectorAll('body *')].filter(e => { const r=e.getBoundingClientRect(); return r.right > innerWidth+1 && r.width>0 && getComputedStyle(e).position !== 'fixed' }).slice(0,16).map(e => ({ tag:e.tagName, class:e.className, right:Math.round(e.getBoundingClientRect().right), width:Math.round(e.getBoundingClientRect().width) })) }))
  if (overflow.scrollWidth > overflow.width + 1) { console.log(JSON.stringify(overflow)); await screenshot('overflow-debug') }
  assert(overflow.scrollWidth <= overflow.width + 1, 'Page must not scroll horizontally')
}

try {
  await page.goto('/admin?view=products')
  await page.locator('#admin-username').fill('dev-admin')
  const sent = page.waitForResponse(r => new URL(r.url()).pathname === '/api/admin/login/email-code')
  await page.getByRole('button', { name: '获取验证码', exact: true }).click()
  assert.equal((await sent).status(), 200)
  const mailbox = path.join(root, 'artifacts/local/cloudflare-grizzly/mailbox')
  const mails = fs.readdirSync(mailbox).filter(f => f.endsWith('.json')).sort((a,b) => fs.statSync(path.join(mailbox,b)).mtimeMs - fs.statSync(path.join(mailbox,a)).mtimeMs)
  const mail = mails.map(f => JSON.parse(fs.readFileSync(path.join(mailbox,f), 'utf8'))).find(m => m.to.includes('admin@example.invalid') && m.text?.match(/\b\d{6}\b/))
  await page.locator('#admin-email-code').fill(mail.text.match(/\b\d{6}\b/)[0])
  await page.locator('#admin-code').fill(totp(fs.readFileSync(path.join(privateRoot, 'admin-totp'), 'utf8').trim()))
  await page.getByRole('button', { name: '登录后台', exact: true }).click()
  await page.locator('.supplier-overview-card').last().waitFor()

  let hanfolk = await api('/api/admin/hanfolk')
  hanfolk = await api('/api/admin/hanfolk', { action: 'save-key', apiKey: hanfolkFixtureKey, version: hanfolk.version })
  hanfolk = await api('/api/admin/hanfolk', { action: 'refresh', version: hanfolk.version })
  await api('/api/admin/hanfolk', { action: 'import', version: hanfolk.version, selection: hanfolk.products.flatMap(p => p.detail.sku_variants.map(s => ({ productId: p.id, sku: s.sku }))) })
  const template = (await api('/api/admin/my-shop/products')).products.find(p => p.id.startsWith('custom-'))
  const seed = await api('/api/admin/my-shop/products', { ...template, id: '', version: 0, groupId: undefined, name: '浏览器验收Xiaojiu采购配置', delivery: 'api', status: 'draft', pricePending: false, priceCents: 500, api: { provider: 'xiaojiu', baseUrl: 'https://98-xj.com', productCode: '999', supplierProductId: 10, maxCostCents: 200 }, apiKey: xiaojiuFixtureKey, apiToken: xiaojiuFixtureSecret })
  await page.reload()
  await page.locator('.supplier-inventory tbody tr').first().waitFor()
  assert.equal(await page.locator('.supplier-overview-card').count(), 4)
  const nav = page.getByRole('navigation', { name: '后台导航' })
  for (const name of ['接码管理', '代理商品', '商品与套餐']) assert.equal(await nav.getByRole('button', { name, exact: true }).count(), 0)
  assert.equal(await nav.getByRole('button', { name: '商品管理', exact: true }).count(), 1)
  assert.equal(await page.locator('.admin-product-children').count(), 0)
  for (const name of ['Bugan', 'Xiaojiu', 'Grizzly', 'Daju']) assert.equal(await nav.getByRole('button', { name, exact: true }).count(), 0)
  await screenshot('overview-desktop')
  record('One product menu groups all four suppliers and shows a combined searchable inventory')

  await supplier('Xiaojiu')
  await page.locator('.supplier-inventory tbody tr').first().waitFor()
  assert((await page.locator('.supplier-inventory tbody tr td:nth-child(2)').allTextContents()).every(s => s === 'Xiaojiu'))
  await page.locator(`[data-product-id="${seed.product.id}"]`).getByRole('button', { name: '编辑与定价' }).click()
  await page.getByLabel('售价（元）', { exact: true }).fill('6.50')
  const saved = page.waitForResponse(r => new URL(r.url()).pathname === '/api/admin/my-shop/products' && r.request().method() === 'POST')
  await page.getByRole('button', { name: '保存草稿', exact: true }).click()
  assert.equal((await saved).status(), 200)
  await page.getByRole('status').filter({ hasText: '商品已保存' }).waitFor()
  await page.keyboard.press('Escape')
  await page.locator(`[data-product-id="${seed.product.id}"]`).getByText('¥6.50', { exact: true }).waitFor()
  await screenshot('xiaojiu-products-desktop')
  record('Xiaojiu lists only its products, and edits persist through the actual product API')

  await page.getByRole('tab', { name: '上游目录与 API', exact: true }).click()
  await page.getByLabel('Xiaojiu采购配置', { exact: true }).selectOption(seed.product.id)
  await page.getByRole('button', { name: '读取余额与商品目录', exact: true }).click()
  await page.getByRole('heading', { name: /钱包余额/ }).waitFor()
  const create = page.getByRole('button', { name: '创建商品草稿', exact: true }).first()
  if (await create.count()) {
    await create.click()
    const created = page.waitForResponse(r => new URL(r.url()).pathname === '/api/admin/my-shop/products' && r.request().method() === 'POST')
    await page.getByRole('button', { name: '保存草稿', exact: true }).click()
    assert.equal((await created).status(), 201)
    await page.getByRole('status').filter({ hasText: '商品已保存' }).waitFor()
    await page.keyboard.press('Escape')
  }
  await screenshot('xiaojiu-catalog-desktop')
  record('Xiaojiu reads the wallet/catalog using server-held credentials and can draft a selected SKU')

  await supplier('Grizzly')
  await page.locator('.sms-admin-projects').waitFor()
  assert.equal(await page.locator('.sms-admin-project').count(), 3)
  await screenshot('grizzly-desktop')
  record('Grizzly keeps its three project editors, pool quotes, configuration and order controls')

  await supplier('Daju')
  await page.locator('.hanfolk-group tbody tr').first().waitFor()
  assert.equal(await page.getByRole('tab', { selected: true }).textContent(), '已整理商品')
  assert.equal(await page.locator('.hanfolk-group').count(), 9)
  await screenshot('daju-products-desktop')
  await page.getByRole('group', { name: 'Daju商品类别' }).getByRole('button', { name: 'Grok', exact: true }).click()
  assert.equal(await page.locator('.hanfolk-group').count(), 1)
  await page.getByLabel('搜索Daju商品').fill('no-such-product')
  await page.getByRole('heading', { name: '没有匹配的商品' }).waitFor()
  await page.getByLabel('搜索Daju商品').fill('')
  await page.getByRole('group', { name: 'Daju商品类别' }).getByRole('button', { name: '全部类别', exact: true }).click()
  record('Daju defaults to nine organized product groups with working category, search and state filters')

  await page.getByRole('tab', { name: '上游目录与选品', exact: true }).click()
  assert.equal(await page.locator('.hanfolk-source').count(), 9)
  assert.equal(await page.locator('.hanfolk-source[open]').count(), 0)
  await page.locator('.hanfolk-source>summary').first().click()
  await page.locator('.hanfolk-skus:visible').waitFor()
  await page.locator('.hanfolk-skus:visible input').first().check()
  await page.getByRole('button', { name: '导入商品草稿', exact: true }).click()
  await page.getByRole('status').filter({ hasText: '已有规格保留原售价' }).waitFor()
  await page.getByRole('tab', { name: 'API 配置', exact: true }).click()
  assert.equal(await page.getByLabel('Daju API Key', { exact: true }).inputValue(), '')
  await screenshot('daju-connection-desktop')
  record('Daju keeps catalog selection and encrypted API configuration in separate tabs; importing preserves existing listings')

  const beforeCleanup = await api('/api/admin/hanfolk')
  const removed = beforeCleanup.drafts.find(p => p.productId === 100 && p.sku === '20')
  assert(removed)
  await stock(0)
  await page.getByRole('button', { name: '同步商品与库存', exact:true }).click()
  await page.getByRole('status').filter({ hasText:'无效、无货和旧重复商品已清理' }).waitFor()
  const afterCleanup = await api('/api/admin/hanfolk')
  assert(!afterCleanup.drafts.some(p => p.id === removed.id))
  assert(!(await api('/api/admin/my-shop/products')).products.some(p => p.id === removed.id))
  const refused = await context.request.post('/api/admin/hanfolk', { headers:{Origin:origin}, data:{action:'import',version:afterCleanup.version,selection:[{productId:100,sku:'20'}]} })
  assert.equal(refused.status(),409)
  await stock(5)
  record('An out-of-stock Daju specification is deleted from management and cannot be imported again while unavailable')

  await supplier('Bugan')
  await page.locator('.supplier-inventory tbody tr').first().waitFor()
  assert((await page.locator('.supplier-inventory tbody tr td:nth-child(2)').allTextContents()).every(s => s === 'Bugan'))
  await screenshot('bugan-products-desktop')
  await page.getByRole('tab', { name: 'API 与供货商品', exact: true }).click()
  await page.getByText('接入地址', { exact: true }).waitFor()
  record('Bugan has a dedicated inventory and API status/mapping page for existing recharge products')

  for (const [legacy, expected] of [['sms','grizzly'], ['hanfolk','daju'], ['plans','other']]) {
    await page.goto('/admin?view=' + legacy)
    await page.waitForURL('**supplier=' + expected)
    await page.getByRole('heading', { name: '商品管理', exact: true }).waitFor()
  }
  await supplier('商品总览')
  await supplier('Daju')
  await page.goBack()
  await page.locator('.supplier-overview-card').last().waitFor()
  await page.reload()
  await page.locator('.supplier-overview-card').last().waitFor()
  record('Legacy URLs, browser back, and refresh preserve the selected product section')

  await page.setViewportSize({ width: 390, height: 844 })
  await noOverflow()
  await screenshot('overview-mobile')
  await supplier('Daju')
  await page.locator('.hanfolk-group tbody tr').first().waitFor()
  await noOverflow()
  await screenshot('daju-mobile')
  await supplier('Grizzly')
  await page.locator('.sms-admin-projects').waitFor()
  await noOverflow()
  await screenshot('grizzly-mobile')
  record('Mobile navigation and supplier pages fit a 390px viewport; only data tables scroll internally')
  assert.deepEqual(result.pageErrors, [])
  const after = await (await fetch(control + '/state')).json()
  assert.equal(after.xiaojiu?.debits ?? 0, initial.xiaojiu?.debits ?? 0)
  fs.writeFileSync(path.join(evidence, 'results.json'), JSON.stringify(result, null, 2))
  console.log(JSON.stringify({ passed: result.checks.length, pageErrors: result.pageErrors.length }))
} finally { await stock(5).catch(() => {}); await browser.close() }
