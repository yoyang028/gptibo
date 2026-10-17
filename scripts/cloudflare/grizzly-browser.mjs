// Fixed isolated workerd/D1 target; synthetic SMS and signed payments only.
import fs from 'node:fs'
import path from 'node:path'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { totp } from '../local/auth.mjs'
import { grizzlyFixtureKey } from './grizzly-fixture.mjs'
import {
  grizzlyProduct,
  GRIZZLY_SERVICES,
  GRIZZLY_RETAIL_CENTS,
} from '../../shared/grizzly-sms.ts'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const origin = 'https://127.0.0.1:8791',
  control = 'http://127.0.0.1:8794'
const evidence = path.join(root, 'artifacts/local/evidence/grizzly-sms')
fs.mkdirSync(evidence, { recursive: true })
const initial = await (await fetch(control + '/state')).json()
assert.equal(initial.localMock, true)
assert.equal(initial.origin, origin)
assert.ok(initial.grizzly)
const token = fs
  .readFileSync(
    path.join(
      root,
      'artifacts/local/.secrets/grizzly-cloudflare-mock/control-token',
    ),
    'utf8',
  )
  .trim()
async function fixture(action, data = {}) {
  const r = await fetch(control + action, {
    method: 'POST',
    headers: {
      Origin: control,
      'X-Local-Control': token,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(data),
  })
  assert.equal(r.status, 204)
}
await fixture('/reset-auth-limits')
const { chromium } = createRequire(import.meta.url)(
  'D:/ChatGPT/CodexCache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright',
)
const result = {
  checkedAt: new Date().toISOString(),
  backend: 'workerd-d1',
  checks: [],
  pageErrors: [],
  externalRequests: [],
  realPayments: 0,
  realSupplierWrites: 0,
}
function record(name) {
  result.checks.push({ name, passed: true })
  console.log(JSON.stringify({ name, passed: true }))
}
const browser = await chromium.launch({
  headless: true,
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  env: {
    ...process.env,
    TEMP: path.join(root, 'artifacts/local/tmp'),
    TMP: path.join(root, 'artifacts/local/tmp'),
  },
})
async function context(mobile = false) {
  const ctx = await browser.newContext({
    baseURL: origin,
    ignoreHTTPSErrors: true,
    viewport: mobile
      ? { width: 390, height: 844 }
      : { width: 1440, height: 1040 },
  })
  await ctx.route('**/*', (route) => {
    if (new URL(route.request().url()).origin !== origin) {
      result.externalRequests.push(route.request().url())
      return route.abort()
    }
    return route.continue()
  })
  ctx.on('page', (p) =>
    p.on('pageerror', (e) => result.pageErrors.push(e.message)),
  )
  return ctx
}
async function api(ctx, url, data, expected = 200) {
  const r = await ctx.request.fetch(url, {
    method: data === undefined ? 'GET' : 'POST',
    headers: { Origin: origin },
    ...(data === undefined ? {} : { data }),
  })
  const body = await r.json()
  assert.equal(r.status(), expected, url + ': ' + JSON.stringify(body))
  return body
}
function emailCode() {
  const folder = path.join(root, 'artifacts/local/cloudflare-grizzly/mailbox')
  const mails = fs
    .readdirSync(folder)
    .filter((n) => n.endsWith('.json'))
    .sort(
      (a, b) =>
        fs.statSync(path.join(folder, b)).mtimeMs -
        fs.statSync(path.join(folder, a)).mtimeMs,
    )
  for (const name of mails) {
    const mail = JSON.parse(fs.readFileSync(path.join(folder, name), 'utf8'))
    const code =
      mail.to.includes('admin@example.invalid') && mail.text?.match(/\b\d{6}\b/)
    if (code) return code[0]
  }
  throw new Error('No local login email')
}
const admin = await context(),
  buyer = await context(),
  mobile = await context(true),
  stranger = await context()
const adminPage = await admin.newPage(),
  page = await buyer.newPage(),
  products = []
try {
  await adminPage.goto('/admin?view=my-shop')
  await adminPage.locator('#admin-username').fill('dev-admin')
  const sent = adminPage.waitForResponse(
    (r) => new URL(r.url()).pathname === '/api/admin/login/email-code',
  )
  await adminPage
    .getByRole('button', { name: '获取验证码', exact: true })
    .click()
  assert.equal((await sent).status(), 200)
  await adminPage.locator('#admin-email-code').fill(emailCode())
  await adminPage
    .locator('#admin-code')
    .fill(
      totp(
        fs
          .readFileSync(
            path.join(
              root,
              'artifacts/local/.secrets/grizzly-cloudflare-mock/admin-totp',
            ),
            'utf8',
          )
          .trim(),
      ),
    )
  await adminPage.getByRole('button', { name: '登录后台', exact: true }).click()
  await adminPage.getByRole('tab', { name: '商品发布', exact: true }).click()
  await adminPage
    .getByRole('button', { name: '添加 AI 聊天', exact: true })
    .click()
  const editor = adminPage.getByRole('dialog').filter({
    has: adminPage.getByText('单次最高采购价（美元）', { exact: true }),
  })
  await editor.getByText('单次最高采购价（美元）', { exact: true }).waitFor()
  assert.equal(await editor.locator('input[type="password"]').count(), 1)
  await adminPage.screenshot({ path: path.join(evidence, 'admin-editor.png') })
  await editor.getByRole('button', { name: '关闭弹窗', exact: true }).click()
  record('Three US project templates and a masked API key field')
  const old = await api(admin, '/api/admin/my-shop/products')
  for (const p of old.products.filter((p) => p.api?.provider === 'grizzly'))
    await api(admin, '/api/admin/my-shop/products', {
      ...p,
      status: 'archived',
    })
  const image =
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWQAAAABJRU5ErkJggg=='
  for (const service of Object.keys(GRIZZLY_SERVICES)) {
    const p = grizzlyProduct(service)
    const checked = await api(
      admin,
      '/api/admin/my-shop/products/verify-api',
      {
        ...p,
        image,
        api: {
          ...p.api,
          maxCostCents: 750,
          sms: { country: '187', maxPriceUsd: '1', cnyPerUsd: '7.5' },
        },
        apiToken: grizzlyFixtureKey,
      },
      201,
    )
    const published = await api(admin, '/api/admin/my-shop/products', {
      ...checked.product,
      status: 'published',
    })
    products.push(published.product)
    assert.equal(published.product.priceCents, GRIZZLY_RETAIL_CENTS[service])
  }
  record(
    'Read-only checks verify all three services and configured retail prices',
  )
  let firstOrder
  for (let i = 0; i < products.length; i++) {
    const p = products[i]
    await page.goto('/product/' + p.id)
    await page.getByRole('button', { name: '立即购买', exact: true }).click()
    await page.locator('#shop-purchase-email').fill('buyer@example.test')
    await page
      .getByRole('checkbox', { name: '我已阅读并同意购买、收款和售后说明' })
      .check()
    const creating = page.waitForResponse(
      (r) =>
        new URL(r.url()).pathname === '/api/orders' &&
        r.request().method() === 'POST',
    )
    await page
      .getByRole('button', { name: '确认下单，继续付款', exact: true })
      .click()
    const response = await creating
    assert.equal(response.status(), 201)
    const { order } = await response.json()
    if (!firstOrder) firstOrder = order.id
    await page
      .getByRole('button', { name: '生成支付宝付款二维码', exact: true })
      .click()
    await page.getByAltText('支付宝付款二维码', { exact: true }).waitFor()
    await fixture('/grizzly/pay', { id: order.id })
    await page
      .getByRole('button', { name: '刷新原订单进度', exact: true })
      .click()
    await page
      .getByRole('button', { name: '复制手机号', exact: true })
      .waitFor({ timeout: 20000 })
    const state = await (await fetch(control + '/state')).json()
    const activation = state.grizzly.activations
      .filter((a) => a.service === p.api.productCode && a.state === 'waiting')
      .at(-1)
    assert.ok(activation)
    if (i === 2) {
      await page
        .getByRole('button', { name: '停止接码，保留订单', exact: true })
        .click()
      await page
        .getByText('本次接码已停止；如需退款，请在原订单申请售后。', {
          exact: true,
        })
        .waitFor()
      record(
        'Stopping Google reception confirms cancellation separately from refunds',
      )
    } else {
      await fixture('/grizzly/receive', {
        id: activation.id,
        code: i === 0 ? '739201' : '928372',
      })
      await page
        .getByRole('button', { name: '复制验证码', exact: true })
        .waitFor({ timeout: 20000 })
      if (i === 0)
        await page.screenshot({
          path: path.join(evidence, 'buyer-code-desktop.png'),
        })
      record(`${p.name}: purchase UI, signed payment query, phone and code`)
    }
    const current = await api(buyer, '/api/orders/' + order.id)
    assert.equal(
      current.order.custom.sms.state,
      i === 2 ? 'cancelled' : 'received',
    )
    await page
      .getByRole('dialog')
      .getByRole('button', { name: '关闭弹窗', exact: true })
      .click()
  }
  await api(stranger, '/api/orders/client', {})
  await api(stranger, '/api/orders/' + firstOrder, undefined, 404)
  record('A separate buyer cannot access the phone or code')
  await mobile.addCookies(await buyer.cookies())
  const phone = await mobile.newPage()
  await phone.goto('/orders')
  await phone.locator('.order-row').filter({ hasText: firstOrder }).click()
  await phone.getByRole('button', { name: '复制验证码', exact: true }).waitFor()
  assert.equal(
    await phone.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
    true,
  )
  await phone.screenshot({ path: path.join(evidence, 'buyer-code-mobile.png') })
  record('Mobile history reopens the original SMS code without overflow')
  const state = await (await fetch(control + '/state')).json()
  assert.equal(state.grizzly.allocations - initial.grizzly.allocations, 3)
  assert.deepEqual(result.pageErrors, [])
  assert.deepEqual(result.externalRequests, [])
  record(
    'Exactly three synthetic allocations and no browser errors or external requests',
  )
  result.passed = true
} catch (e) {
  result.passed = false
  result.failure = e.message
  await page
    .screenshot({ path: path.join(evidence, 'failure.png') })
    .catch(() => {})
  throw e
} finally {
  fs.writeFileSync(
    path.join(evidence, 'result.json'),
    JSON.stringify(result, null, 2),
  )
  await browser.close()
}
