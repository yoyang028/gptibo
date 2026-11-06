// Browser acceptance is locked to the isolated local platform.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { latestMail } from './codes.mjs'
import { totp } from '../local/auth.mjs'
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const runtime = path.join(root, 'artifacts/sites/local'), evidence = path.join(root, 'artifacts/sites/evidence')
const ready = JSON.parse(fs.readFileSync(path.join(runtime, 'ready.json'), 'utf8'))
assert.equal(ready.localOnly, true)
assert.deepEqual(ready.sites.map(s => s.origin), ['http://localhost:8801'])
fs.mkdirSync(evidence, { recursive: true })
const require = createRequire(import.meta.url)
let chromium
try { ({ chromium } = require('playwright')) } catch { ({ chromium } = require('D:/ChatGPT/CodexCache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright')) }
const browser = await chromium.launch({ headless: true, executablePath: process.env.PREVIEW_CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', env: { ...process.env, TEMP: path.join(runtime, 'tmp'), TMP: path.join(runtime, 'tmp') } })
const result = { localOnly: true, realPayments: 0, checks: [], pageErrors: [], externalRequests: [] }
const record = name => { result.checks.push(name); console.log('PASS ' + name) }
const origin = 'http://localhost:8801'
async function context(baseURL) {
  const ctx = await browser.newContext({ baseURL, viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' })
  await ctx.route('**/*', async route => { const url = new URL(route.request().url()); if (url.origin !== baseURL && !['data:', 'blob:'].includes(url.protocol)) { result.externalRequests.push(url.origin); await route.abort(); return } await route.continue() })
  ctx.on('page', page => page.on('pageerror', e => result.pageErrors.push(e.message)))
  return ctx
}
function code(site, email) { const mail = latestMail(site, email); assert.ok(mail && Date.now() - mail.savedAt < 600000); const value = mail.text.match(/\b\d{6}\b/)?.[0]; assert.ok(value); return value }
async function get(ctx, url) { const response = await ctx.request.get(url); assert.equal(response.status(), 200, await response.text()); return response.json() }
async function post(ctx, url, data) { const response = await ctx.request.post(url, { headers: { Origin: origin }, data }); assert.ok(response.ok(), await response.text()); return response.json() }
async function noOverflow(page) { assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'Page overflows the viewport') }
async function closeDialog(page) { await page.keyboard.press('Escape'); await page.locator('[role=dialog]').waitFor({ state: 'hidden' }) }
async function choose(page, label, name) { await page.getByRole('combobox', { name: label, exact: true }).click(); await page.getByRole('option', { name, exact: true }).click() }
try {
  const admin = await context(origin), adminPage = await admin.newPage()
  await adminPage.goto('/admin')
  await adminPage.getByLabel('用户名', { exact: true }).fill('preview-admin')
  const sent = adminPage.waitForResponse(r => r.url().endsWith('/api/admin/login/email-code'))
  await adminPage.getByRole('button', { name: '获取验证码', exact: true }).click(); assert.equal((await sent).status(), 200)
  await adminPage.getByLabel('邮箱验证码', { exact: true }).fill(code('platform', 'admin@example.invalid'))
  const credentials = JSON.parse(fs.readFileSync(path.join(runtime, 'platform/credentials.json'), 'utf8'))
  assert.equal(credentials.localOnly, true)
  await adminPage.getByLabel('2FA 验证码', { exact: true }).fill(totp(credentials.totp))
  await adminPage.getByRole('button', { name: '登录后台', exact: true }).click()
  await adminPage.getByRole('button', { name: '我的店铺', exact: true }).click()
  await adminPage.locator('.store-overview-row').nth(2).waitFor()
  assert.equal(await adminPage.locator('.store-overview-row').count(), 3)
  await adminPage.getByRole('combobox', { name: '当前店铺', exact: true }).waitFor()
  await adminPage.screenshot({ path: path.join(evidence, 'owner-three-stores.png'), fullPage: true })
  record('Existing main workbench lists three owner shops in the original shop workspace')

  const before = await get(admin, '/api/admin/my-shop/stores')
  const secondRow = adminPage.locator('.store-overview-row').filter({ hasText: '商店二' })
  await secondRow.getByRole('button', { name: '编辑', exact: true }).click()
  const editor = adminPage.getByRole('dialog')
  await editor.getByLabel('首页标题', { exact: true }).fill('商店。找到适合你的服务。')
  await editor.getByLabel('商店简介').fill('数字商品、会员订阅与实用服务，在这里按需选择。')
  await editor.getByRole('button', { name: '保存商店', exact: true }).click()
  await editor.waitFor({ state: 'hidden' })
  const ownEdit = await get(admin, '/api/catalog?partner=store-2')
  assert.equal(ownEdit.shop.description, '数字商品、会员订阅与实用服务，在这里按需选择。')
  assert.equal((await get(admin, '/api/admin/my-shop/stores')).stores[0].version, before.stores[0].version)
  record('Editing one shop changes its own public parameters without changing the root shop')

  await adminPage.getByRole('button', { name: '统一修改参数', exact: true }).click()
  await choose(adminPage, '复制参数的店铺', '商店二')
  await adminPage.getByLabel('首页标题与简介', { exact: true }).check()
  assert.equal(await adminPage.getByLabel('商品售价与销售状态', { exact: true }).isChecked(), false)
  await adminPage.screenshot({ path: path.join(evidence, 'owner-bulk-settings.png'), fullPage: false })
  await adminPage.getByRole('button', { name: '同步到所选店铺', exact: true }).click()
  await adminPage.getByRole('dialog').waitFor({ state: 'hidden' })
  const synced = await get(admin, '/api/admin/my-shop/stores')
  assert.ok(synced.stores.every(s => s.settings.description === ownEdit.shop.description))
  assert.deepEqual(synced.prices.map(p => p.price_cents), before.prices.map(p => p.price_cents))
  record('Bulk UI synchronizes only selected fields; different prices remain unchanged')

  const prices = [13900,14900,15900]
  for (let i = 0; i < synced.stores.length; i++) {
    const s = synced.stores[i], quote = (await get(admin, '/api/admin/my-shop/stores')).prices.find(p => p.store_id === s.id && p.plan === 'plus')
    if (i === 1) {
      await choose(adminPage, '当前店铺', s.name)
      await adminPage.getByRole('tab', { name: '商品售价', exact: true }).click()
      const form = adminPage.locator('.store-price-row:visible').filter({ has: adminPage.getByLabel(quote.name + '售价', { exact: true }) })
      await form.getByLabel(quote.name + '售价', { exact: true }).fill((prices[i] / 100).toFixed(2))
      await form.getByRole('checkbox').check()
      const saved = adminPage.waitForResponse(r => r.url().endsWith('/api/admin/my-shop/stores/prices') && r.request().method() === 'POST')
      await form.getByRole('button', { name: '保存', exact: true }).click()
      assert.equal((await saved).status(), 200)
    } else await post(admin, '/api/admin/my-shop/stores/prices', { storeId: s.id, plan: 'plus', priceCents: prices[i], enabled: true, version: quote.version })
  }
  const customer = await context(origin), page = await customer.newPage(), styles = []
  for (const [i, slug] of ['', 'store-2', 'store-3'].entries()) {
    const base = slug ? '/s/' + slug : ''
    await page.goto(base || '/')
    await page.locator('.store-intro h1').waitFor()
    const catalog = await get(customer, '/api/catalog' + (slug ? '?partner=' + slug : ''))
    assert.equal(catalog.plans.find(p => p.id === 'plus').price_cents, prices[i])
    styles.push(await page.locator('.store-layout').evaluate(el => ({ background: getComputedStyle(el).backgroundColor, font: getComputedStyle(el).fontFamily })))
    await noOverflow(page); await page.screenshot({ path: path.join(evidence, `owner-store-${i + 1}-desktop.png`), fullPage: true })
    await page.goto(base + '/product/chatgpt'); await page.locator('.store-layout').waitFor()
    await page.setViewportSize({ width: 390, height: 844 }); await noOverflow(page)
    await page.screenshot({ path: path.join(evidence, `owner-store-${i + 1}-mobile.png`), fullPage: true })
    await page.setViewportSize({ width: 1440, height: 1000 })
  }
  assert.deepEqual(styles[0], styles[1]); assert.deepEqual(styles[1], styles[2])
  record('Three storefronts use the same desktop/mobile template and different server-validated prices')

  await post(customer, '/api/orders/client', {})
  for (const [i, slug] of ['', 'store-2', 'store-3'].entries()) {
    const response = await post(customer, '/api/orders', { partner: slug || undefined, plan: 'plus', expectedPrice: prices[i], email: 'buyer@example.invalid', key: crypto.randomUUID() })
    const id = slug || 'platform', list = await get(admin, '/api/admin/my-shop/orders?store=' + id)
    assert.ok(list.rows.some(o => o.id === response.order.id && o.owner_store_id === id))
  }
  record('Three storefront orders return to the main admin with separate shop attribution')

  await adminPage.getByRole('button', { name: '代理管理', exact: true }).click()
  await adminPage.getByRole('button', { name: '开通代理', exact: true }).first().waitFor()
  const email = 'agent-' + Date.now() + '@example.invalid'
  await adminPage.getByRole('button', { name: '开通代理', exact: true }).first().click()
  await adminPage.getByRole('dialog').getByLabel('登录邮箱', { exact: true }).fill(email)
  const created = adminPage.waitForResponse(r => r.url().endsWith('/api/admin/partners') && r.request().method() === 'POST')
  await adminPage.getByRole('button', { name: '开通并发送邀请邮件', exact: true }).click()
  const account = await (await created).json()
  assert.ok(account.id && account.slug)
  record('Main administrator creates an agent through the existing agent management screen')

  const agent = await context(origin), agentPage = await agent.newPage()
  await agentPage.goto('/partner/')
  await agentPage.getByLabel('登录邮箱', { exact: true }).fill(email)
  const agentSent = agentPage.waitForResponse(r => r.url().endsWith('/api/partner/auth/send'))
  await agentPage.getByRole('button', { name: '获取验证码', exact: true }).click(); assert.equal((await agentSent).status(), 200)
  await agentPage.getByLabel('邮箱验证码', { exact: true }).fill(code('platform', email))
  await agentPage.getByRole('button', { name: '登录工作台', exact: true }).click()
  await agentPage.locator('.store-overview-row').waitFor()
  assert.equal(await agentPage.locator('.store-overview-row').count(), 1)
  assert.equal((await agent.request.get('/api/admin/my-shop/stores')).status(), 401)
  await agentPage.screenshot({ path: path.join(evidence, 'agent-workbench.png'), fullPage: true })
  const agentData = await get(agent, '/api/partner/stores')
  const quote = agentData.prices.find(p => p.plan === 'plus')
  await post(agent, '/api/partner/stores/prices', { storeId: account.id, plan: 'plus', priceCents: quote.price_cents + 100, enabled: true, version: quote.version })
  const agentCatalog = await get(agent, '/api/catalog?partner=' + account.slug)
  assert.equal(agentCatalog.plans.find(p => p.id === 'plus').price_cents, quote.price_cents + 100)
  await page.goto('/r/' + account.slug)
  await page.locator('.store-intro h1').waitFor()
  await page.screenshot({ path: path.join(evidence, 'agent-storefront.png'), fullPage: true })
  await agentPage.setViewportSize({ width: 390, height: 844 }); await noOverflow(agentPage)
  await agentPage.screenshot({ path: path.join(evidence, 'agent-workbench-mobile.png'), fullPage: true })
  record('Original agent workbench signs in and manages its own storefront prices in the shared platform')
  assert.deepEqual(result.pageErrors, []); assert.deepEqual(result.externalRequests, [])
  record('No browser crashes or requests outside the isolated local platform')
} finally {
  fs.writeFileSync(path.join(evidence, 'acceptance.json'), JSON.stringify(result, null, 2))
  await browser.close()
}
