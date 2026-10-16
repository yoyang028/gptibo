// Real local browser -> Worker -> fixed-origin synthetic provider -> UI checks.
// No real ChatGPT credentials, payment requests or remote supplier traffic.
import fs from 'node:fs'
import path from 'node:path'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const origin = 'https://127.0.0.1:8781'
const state = await (await fetch('http://127.0.0.1:8784/state')).json()
assert.equal(state.localMock, true); assert.equal(state.origin, origin)
const evidence = path.join(root, 'artifacts/local/evidence/account-check')
fs.mkdirSync(evidence, { recursive: true })
const { chromium } = createRequire(import.meta.url)('D:/ChatGPT/CodexCache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright')
const result = { checkedAt: new Date().toISOString(), checks: [], pageErrors: [], externalRequests: [], purchaseRequests: [], realCredentials: 0, realPurchases: 0 }
const record = name => { result.checks.push({ name, passed: true }); console.log(JSON.stringify({ name, passed: true })) }
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, env: { ...process.env, TEMP: path.join(root, 'artifacts/local/tmp'), TMP: path.join(root, 'artifacts/local/tmp') } })
const contexts = []
async function fresh(width = 1440) {
  const ctx = await browser.newContext({ baseURL: origin, ignoreHTTPSErrors: true, viewport: { width, height: width < 600 ? 844 : 1100 }, locale: 'zh-CN' })
  contexts.push(ctx)
  await ctx.route('**/*', route => {
    const request = route.request(), url = new URL(request.url())
    if (url.origin !== origin) { result.externalRequests.push(url.origin); return route.abort() }
    if (request.method() === 'POST' && (url.pathname === '/api/orders' || /\/fulfillment$|\/payment$/.test(url.pathname))) { result.purchaseRequests.push(url.pathname); return route.abort() }
    return route.continue()
  })
  const page = await ctx.newPage()
  page.on('pageerror', error => result.pageErrors.push(error.message))
  await page.goto('/check', { waitUntil: 'domcontentloaded' })
  await page.getByRole('heading', { name: '账号检测', exact: true }).waitFor()
  return page
}
const fixture = (kind, extra = {}) => JSON.stringify({ user: { email: 'account@example.test' }, accessToken: 'fixture-account-' + kind, account: { id: 'account-fixture' }, expires: '2099-01-01T00:00:00Z', ...extra })
async function inspect(page, kind) {
  await page.locator('#account-check-session').fill(fixture(kind))
  await page.getByText('account@example.test', { exact: true }).waitFor()
  assert.equal(await page.locator('.check-submit').isDisabled(), true)
  await page.locator('.check-consent input').check()
  const response = page.waitForResponse(r => new URL(r.url()).pathname === '/api/tools/account-check')
  await page.locator('.check-submit').click()
  const raw = await (await response).text()
  assert.doesNotMatch(raw, /fixture-account-|account@example|account-fixture/)
  await page.locator('.check-report').waitFor()
  return JSON.parse(raw).report
}
try {
  const page = await fresh()
  assert.equal(await page.locator('.check-submit').isDisabled(), true)
  await page.locator('#account-check-session').fill('not-json')
  assert.equal(await page.locator('.check-submit').isDisabled(), true)
  await page.getByText('内容不完整，请在 Session 页全选并复制完整 JSON。', { exact: true }).waitFor()
  await page.locator('#account-check-session').fill(fixture('free', { expires: '2000-01-01T00:00:00Z' }))
  assert.equal(await page.locator('.check-submit').isDisabled(), true)
  await page.locator('#account-check-session').fill('')
  record('Empty, malformed and locally expired Sessions cannot trigger a query')
  const free = await inspect(page, 'free')
  assert.equal(free.state, 'checked'); assert.equal(free.plan, 'free')
  await page.getByText('开通与升级资格，仍需在充值时核验', { exact: true }).waitFor()
  assert.match(await page.locator('.check-report').innerText(), /未返回/)
  const stored = await page.evaluate(() => JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage } }))
  assert.doesNotMatch(stored, /fixture-account-|account@example|accessToken/)
  await page.screenshot({ path: path.join(evidence, 'free-account-desktop.png'), fullPage: true })
  record('Read-only free-account query returns through the real Worker, without claiming recharge eligibility or persisting credentials')
  await page.getByRole('button', { name: '清除检测内容', exact: true }).click()
  assert.equal(await page.locator('#account-check-session').inputValue(), '')
  assert.equal(await page.locator('.check-report').count(), 0)
  record('Explicit clearing removes input, identity and report')
  const plusPage = await fresh()
  const plus = await inspect(plusPage, 'plus')
  assert.equal(plus.plan, 'plus'); assert.equal(plus.source, 'ios'); assert.equal(plus.region, 'PH'); assert.equal(plus.autoRenew, false)
  await plusPage.getByText('iOS 内购', { exact: true }).waitFor()
  await plusPage.getByText('已关闭', { exact: true }).waitFor()
  await plusPage.screenshot({ path: path.join(evidence, 'plus-account-desktop.png'), fullPage: true })
  record('Provider-returned plan, expiry, billing channel, region and renewal state render accurately')
  for (const [kind, state, title] of [['workspace', 'checked', '请切换到个人账号后核对套餐'], ['expired', 'expired', '这份 Session 已失效'], ['blocked', 'unavailable', '这次暂时没有查到'], ['limited', 'limited', '查询暂时受限']]) {
    const scenario = await fresh()
    const report = await inspect(scenario, kind)
    assert.equal(report.state, state)
    await scenario.getByText(title, { exact: true }).waitFor()
    if (state !== 'checked') assert.equal(await scenario.locator('.check-report-facts').count(), 0)
    await scenario.context().close()
  }
  record('Workspace, expired, blocked and rate-limited replies are distinguished without false successful eligibility')
  const mobile = await fresh(390)
  await inspect(mobile, 'plus')
  assert.equal(await mobile.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true)
  await mobile.getByRole('button', { name: '切换暗色模式' }).click()
  await mobile.screenshot({ path: path.join(evidence, 'account-check-mobile-dark.png'), fullPage: true })
  await mobile.setViewportSize({ width: 320, height: 740 })
  assert.equal(await mobile.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true)
  assert.equal(await mobile.locator('.account-check-nav').isVisible(), true)
  record('390px dark mode and 320px mobile keep navigation, facts and controls within the viewport')
  const navigation = await fresh()
  await navigation.goto('/product/chatgpt', { waitUntil: 'domcontentloaded' })
  await navigation.locator('.account-check-nav').click()
  await navigation.waitForURL('**/check')
  await navigation.locator('#account-check-session').fill(fixture('free'))
  await navigation.getByRole('link', { name: '返回 ChatGPT 选择套餐', exact: true }).click()
  await navigation.locator('.account-check-nav').click()
  assert.equal(await navigation.locator('#account-check-session').inputValue(), '')
  record('ChatGPT detail navigation opens account check and leaving the page discards the input')
  const expiry = await fresh()
  await expiry.clock.install()
  await expiry.locator('#account-check-session').fill(fixture('free'))
  await expiry.clock.fastForward(180001)
  await expiry.getByText('Session 已从当前页面清除。再次检测时请重新粘贴。', { exact: true }).waitFor()
  assert.equal(await expiry.locator('#account-check-session').inputValue(), '')
  record('Unsubmitted Session input is erased automatically after three minutes')
  assert.deepEqual(result.externalRequests, []); assert.deepEqual(result.purchaseRequests, []); assert.deepEqual(result.pageErrors, [])
  record('No browser runtime errors, remote browser requests, order creation, payment or recharge actions')
  result.passed = true
} catch (error) { result.passed = false; result.error = error.message; throw error }
finally {
  fs.writeFileSync(path.join(evidence, 'result.json'), JSON.stringify(result, null, 2) + '\n')
  for (const ctx of contexts) await ctx.close().catch(() => {})
  await browser.close()
}
