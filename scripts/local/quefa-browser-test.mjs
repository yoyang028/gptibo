// Exercises the original checkout through the Go API, PostgreSQL and loopback supplier.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import {createRequire} from 'node:module'
import {fileURLToPath} from 'node:url'
import {latestCode, totp} from './auth.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const origin = 'http://127.0.0.1:5176'
const control = 'http://127.0.0.1:8765'
const evidence = path.join(root, 'artifacts/local/evidence/quefa-round1')
fs.mkdirSync(evidence, {recursive: true})
const require = createRequire(import.meta.url)
const {chromium} = require(process.env.PLAYWRIGHT_MODULE_PATH || 'D:/ChatGPT/CodexCache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright')
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || 'D:/ChatGPT/Caches/playwright/chromium-1234/chrome-win64/chrome.exe'
const results = {checkedAt: new Date().toISOString(), checks: [], pageErrors: [], externalRequests: []}
const record = (name, details = {}) => {results.checks.push({name, passed: true, ...details}); console.log(JSON.stringify(results.checks.at(-1)))}
const pause = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds))
async function waitFor(read, predicate, description, timeout = 30000) {
  const deadline = Date.now() + timeout
  do {
    const value = await read()
    if (predicate(value)) return value
    await pause(750)
  } while (Date.now() < deadline)
  throw new Error('Timed out: ' + description)
}
async function api(context, route, data, expected = 200) {
  const response = await context.request.fetch(route, {method: data === undefined ? 'GET' : 'POST', ...(data === undefined ? {} : {data}), headers: {Origin: origin}})
  const body = await response.json()
  // The worker and visible checkout share a lease. A poll may legitimately
  // lose that race; read the saved order while the owning worker finishes.
  if (response.status() === 409 && expected === 200 && ['poll', 'query'].includes(data?.action) && route.endsWith('/fulfillment')) {
    return api(context, route.slice(0, -'/fulfillment'.length))
  }
  assert.equal(response.status(), expected, route + ': ' + JSON.stringify(body))
  return body
}
async function mockState() {
  const state = await (await fetch(control + '/state')).json()
  assert.equal(state.localMock, true, 'test may only use the local simulator')
  return state
}
async function act(order, action) {
  const response = await fetch(control + '/control', {method: 'POST', headers: {'Content-Type': 'application/json', Origin: control}, body: JSON.stringify({order, action})})
  assert.equal(response.status, 200, 'mock control: ' + action)
}
function session() {
  const exp = Math.floor(Date.now()/1000) + 86400
  const token = Buffer.from('{"alg":"none"}').toString('base64url') + '.' + Buffer.from(JSON.stringify({exp, nonce: crypto.randomUUID()})).toString('base64url') + '.MOCKONLY'
  return JSON.stringify({user: {email: 'demo@example.invalid'}, accessToken: token, expires: new Date(exp*1000).toISOString()})
}
const browser = await chromium.launch({headless: true, executablePath, env: {...process.env, TEMP: path.join(root, 'artifacts/local/tmp'), TMP: path.join(root, 'artifacts/local/tmp')}})
const customer = await browser.newContext({baseURL: origin, locale: 'zh-CN', viewport: {width: 1440, height: 1000}})
const page = await customer.newPage()
page.on('pageerror', error => results.pageErrors.push(error.message))
page.on('request', request => {if (/^https?:/.test(request.url()) && ![origin, control].includes(new URL(request.url()).origin)) results.externalRequests.push(new URL(request.url()).origin)})
let admin
try {
  await mockState()
  await act('', 'activate')
  await page.goto('/product/chatgpt')
  await page.getByRole('button', {name: '立即购买', exact: true}).click()
  await page.getByRole('button', {name: '继续下单', exact: true}).click()
  const email = 'quefa-local-' + crypto.randomUUID().slice(0, 8) + '@gmail.com'
  await page.locator('#purchase-email').fill(email)
  const creating = page.waitForResponse(response => new URL(response.url()).pathname === '/api/orders' && response.request().method() === 'POST')
  await page.getByRole('button', {name: '继续付款', exact: true}).click()
  const created = await creating
  assert.equal(created.status(), 201, await created.text())
  const initial = (await created.json()).order
  assert.equal(initial.mode, 'live', 'exercise the supplier adapter, not the demo state machine')
  const route = '/api/orders/' + initial.id
  const read = async () => (await api(customer, route)).order
  const poll = async () => (await api(customer, route + '/fulfillment', {action: 'poll'})).order
  const ready = await waitFor(poll, order => order.fulfillment?.paymentQr, 'signed payment code')
  assert.match(ready.fulfillment.paymentQr, /^https:\/\/qr\.alipay\.com\/MOCKONLY/)
  record('UI creates one Plus order and receives its signed, bound mock payment code', {orderId: initial.id})
  await api(customer, route + '/fulfillment', {action: 'submit', key: crypto.randomUUID(), customerConfirmedEmail: true, credential: {mode: 'session', session: session()}}, 409)
  record('Unpaid order refuses recharge submission')
  let upstream = (await mockState()).orders.find(item => item.order.merchant_order_no === initial.id)
  assert(upstream)
  await act(upstream.order.order_id, 'pay')
  await waitFor(poll, order => order.paymentStatus === 'paid', 'verified mock payment')
  await page.locator('#live-session').waitFor({timeout: 15000})
  async function submit(label) {
    await page.locator('#live-session').fill(session())
    await page.getByRole('checkbox', {name: '我已核对账号，并授权本次充值'}).check()
    const submitting = page.waitForResponse(response => new URL(response.url()).pathname === route + '/fulfillment' && response.request().postDataJSON()?.action === 'submit')
    await page.getByRole('button', {name: label, exact: true}).click()
    const response = await submitting
    assert.equal(response.status(), 200, await response.text())
    const body = response.request().postDataJSON()
    await api(customer, route + '/fulfillment', body)
    return body
  }
  const firstSubmission = await submit('提交并充值')
  await waitFor(read, order => order.fulfillment?.rechargeStatus === 'queued', 'queued task')
  upstream = (await mockState()).orders.find(item => item.order.merchant_order_no === initial.id)
  assert.equal(upstream.tasks.length, 1)
  record('Payment unlocks UI Session confirmation; HTTP 202 remains queued; identical request creates one task')
  await act(upstream.order.order_id, 'pause')
  await waitFor(poll, order => order.fulfillment?.paused, 'paused task')
  await page.getByText('充值结果待核对', {exact: true}).waitFor({timeout: 15000})
  assert.equal(await page.locator('#live-session').count(), 0)
  await api(customer, route + '/fulfillment', {action: 'submit', key: crypto.randomUUID(), customerConfirmedEmail: true, credential: {mode: 'session', session: session()}}, 409)
  await page.screenshot({path: path.join(evidence, 'paused.png'), fullPage: true})
  record('Paused result reaches UI and refuses a new recharge attempt')
  await act(upstream.order.order_id, 'fail')
  await waitFor(async () => (await api(customer, route + '/fulfillment', {action: 'query'})).order, order => order.fulfillment?.canSubmit && order.status === 'failed', 'explicit failure permits manual retry')
  await page.getByRole('button', {name: '刷新进度', exact: true}).click()
  await page.locator('#live-session').waitFor()
  await submit('重新提交 Session')
  upstream = (await mockState()).orders.find(item => item.order.merchant_order_no === initial.id)
  assert.equal(upstream.tasks.length, 2, 'mock requires retry_confirmation for the second task')
  assert.equal(upstream.order.payment_status, 'paid')
  await api(customer, route + '/fulfillment', firstSubmission, 409)
  await act(upstream.order.order_id, 'replay')
  const second = await poll()
  assert.equal(second.fulfillment.attemptNo, 2)
  assert.equal(second.status, 'processing')
  await waitFor(mockState, state => state.callbackStatus === 200, 'signed webhook acknowledgement')
  record('Manual retry retains original paid order, creates attempt 2, and rejects stale submission and callback')
  await act(upstream.order.order_id, 'success')
  await waitFor(poll, order => order.status === 'success', 'verified fulfillment success')
  await page.getByRole('heading', {name: '充值已完成', exact: true}).waitFor({timeout: 15000})
  await page.screenshot({path: path.join(evidence, 'completed.png'), fullPage: true})
  await page.goto('/orders')
  await page.locator('.order-row').filter({hasText: initial.id}).waitFor()
  record('Final success renders and the order remains visible after navigating to order history')
  const outsider = await browser.newContext({baseURL: origin})
  await api(outsider, '/api/orders/client', {})
  await api(outsider, route, undefined, 404)
  await api(outsider, '/api/admin/plans', undefined, 401)
  const recovery = await api(outsider, '/api/orders/recovery/send', {email})
  await api(outsider, '/api/orders/recovery/verify', {email, challenge: recovery.challenge, code: latestCode(email).code})
  assert.equal((await api(outsider, route)).order.id, initial.id)
  await outsider.close()
  record('Buyer isolation and local email recovery work for supplier-backed orders')
  admin = await browser.newContext({baseURL: origin, locale: 'zh-CN', viewport: {width: 1440, height: 1000}})
  const adminPage = await admin.newPage()
  adminPage.on('pageerror', error => results.pageErrors.push(error.message))
  await adminPage.goto('/admin')
  await adminPage.locator('#admin-username').fill('dev-admin')
  const sending = adminPage.waitForResponse(response => new URL(response.url()).pathname === '/api/admin/login/email-code')
  await adminPage.getByRole('button', {name: '获取验证码', exact: true}).click()
  assert.equal((await sending).status(), 200)
  await adminPage.locator('#admin-email-code').fill(latestCode('admin@example.invalid').code)
  await adminPage.locator('#admin-code').fill(totp(fs.readFileSync(path.join(root, 'artifacts/local/.secrets/admin-totp'), 'utf8')))
  await adminPage.getByRole('button', {name: '登录后台', exact: true}).click()
  await adminPage.getByRole('navigation', {name: '后台导航'}).waitFor()
  const detail = await api(admin, '/api/admin/orders/' + initial.id)
  assert.equal(detail.order.status, 'success')
  await adminPage.getByRole('navigation', {name: '后台导航'}).getByRole('button', {name: '订单管理', exact: true}).click()
  await adminPage.getByText(initial.id, {exact: true}).first().waitFor()
  await adminPage.screenshot({path: path.join(evidence, 'admin-orders.png'), fullPage: true})
  record('Admin email and TOTP login can inspect the completed original order')
  const refundOrder = (await api(customer, '/api/orders', {plan: 'plus', email, key: crypto.randomUUID(), expectedPrice: 13900}, 201)).order
  const refundRoute = '/api/orders/' + refundOrder.id
  await api(customer, refundRoute + '/fulfillment', {action: 'poll'})
  const refundable = (await mockState()).orders.find(item => item.order.merchant_order_no === refundOrder.id)
  await act(refundable.order.order_id, 'pay')
  const paid = await waitFor(async () => (await api(customer, refundRoute + '/fulfillment', {action: 'poll'})).order, order => order.paymentStatus === 'paid', 'second order paid')
  await api(customer, refundRoute + '/refunds', {action: 'request', key: crypto.randomUUID(), reason: '本地模拟验收：未提交充值，申请全额退款', version: paid.version}, 201)
  const refunded = await waitFor(async () => (await api(customer, refundRoute)).order, order => order.refundedCents === 13900, 'verified refund', 45000)
  assert.equal(refunded.fulfillment.canSubmit, false)
  await api(customer, refundRoute + '/fulfillment', {action: 'submit', key: crypto.randomUUID(), customerConfirmedEmail: true, credential: {mode: 'session', session: session()}}, 409)
  record('Customer refund reaches simulated supplier, final refund is reconciled, and recharge remains closed', {orderId: refundOrder.id})
  await api(admin, '/api/admin/logout', {})
  assert.equal((await api(admin, '/api/admin/session')).authenticated, false)
  assert.deepEqual(results.pageErrors, [])
  assert.deepEqual(results.externalRequests, [])
  record('Browser completes with zero page errors and zero external browser requests')
} catch (error) {
  results.failure = String(error)
  process.exitCode = 1
  await page.screenshot({path: path.join(evidence, 'failure.png'), fullPage: true}).catch(() => {})
} finally {
  await admin?.close()
  await customer.close()
  await browser.close()
  fs.writeFileSync(path.join(evidence, 'results.json'), JSON.stringify(results, null, 2))
  console.log(JSON.stringify({checks: results.checks.length, failure: results.failure ?? null}))
}
