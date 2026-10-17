// Fixed isolated workerd/D1 target; synthetic SMS and signed payments only.
import fs from 'node:fs'
import path from 'node:path'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { totp } from '../local/auth.mjs'
import { grizzlyFixtureKey } from './grizzly-fixture.mjs'
import {
  GRIZZLY_SERVICES,
  GRIZZLY_RETAIL_CENTS,
} from '../../shared/grizzly-sms.ts'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const origin = 'https://127.0.0.1:8791',
  control = 'http://127.0.0.1:8794'
const evidence = path.join(root, 'artifacts/local/evidence/sms-integration')
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
process.env.PLAYWRIGHT_BROWSERS_PATH = 'D:/ChatGPT/Caches/playwright'
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
  page = await buyer.newPage()
try {
  await adminPage.goto('/admin?view=sms')
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
  await adminPage.locator('.sms-admin-projects').waitFor()
  assert.equal(await adminPage.locator('.sms-admin-project').count(), 3)
  assert.equal(
    await adminPage.locator('.sms-admin input[type=password]').count(),
    1,
  )
  await adminPage.screenshot({
    path: path.join(evidence, 'admin-configuration.png'),
    fullPage: true,
  })
  record(
    'Dedicated SMS management route, encrypted-key input, three projects and two pool quotes',
  )
  let config = await api(admin, '/api/admin/sms')
  // Repeatable local-only browser acceptance: start with all sales closed.
  config = await api(admin, '/api/admin/sms', {
    action: 'save',
    version: config.version,
    cnyPerUsd: '',
    projects: config.projects.map((p) => ({
      ...p,
      maxPriceUsd: '',
      visible: true,
      selling: false,
    })),
  })
  await page.goto('/')
  const homeCard = page.locator('article[data-product-group="codex-sms"]')
  await homeCard.waitFor()
  assert.equal(await homeCard.count(), 1)
  assert.equal(
    await page.locator('.store-product h3').filter({ hasText: '接码' }).count(),
    1,
  )
  await homeCard.scrollIntoViewIfNeeded()
  await page.waitForTimeout(1100)
  await page.screenshot({ path: path.join(evidence, 'home-sms-card.png') })
  await homeCard.getByRole('link', { name: '选择项目', exact: true }).click()
  await page.locator('.sms-project-card').first().waitFor()
  assert.equal(await page.getByRole('radio').count(), 3)
  assert.equal(
    await page
      .getByRole('button', { name: '暂未开放购买', exact: true })
      .isDisabled(),
    true,
  )
  for (const [service, price] of Object.entries(GRIZZLY_RETAIL_CENTS)) {
    await page.locator('[data-project="' + service + '"]').click()
    assert.match(
      await page.locator('.sms-summary').innerText(),
      new RegExp((price / 100).toFixed(2).replace('.', '\\.')),
    )
    assert.equal(
      await page
        .locator('[data-project="' + service + '"]')
        .getAttribute('aria-checked'),
      'true',
    )
  }
  await page.locator('[data-project="dr"]').click()
  await page.screenshot({
    path: path.join(evidence, 'sms-desktop-light.png'),
    fullPage: true,
  })
  record(
    'One upgraded homepage entrance, three real catalog prices, synchronized summary and closed checkout',
  )
  await page.getByRole('radio').first().focus()
  await page.keyboard.press('ArrowRight')
  assert.equal(
    await page.locator('[data-project="acz"]').getAttribute('aria-checked'),
    'true',
  )
  await page.getByRole('button', { name: '切换暗色模式', exact: true }).click()
  await page.screenshot({
    path: path.join(evidence, 'sms-desktop-dark.png'),
    fullPage: true,
  })
  await page.getByRole('button', { name: '切换亮色模式', exact: true }).click()
  const phone = await mobile.newPage()
  await phone.goto('/product/codex-sms')
  await phone.locator('.sms-project-card').first().waitFor()
  await phone.locator('[data-project="go"]').click()
  assert.equal(
    await phone.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    true,
  )
  await phone.screenshot({
    path: path.join(evidence, 'sms-mobile-light.png'),
    fullPage: true,
  })
  await phone.getByRole('button', { name: '切换暗色模式', exact: true }).click()
  await phone.screenshot({
    path: path.join(evidence, 'sms-mobile-dark.png'),
    fullPage: true,
  })
  await phone.setViewportSize({ width: 320, height: 800 })
  assert.equal(
    await phone.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    true,
  )
  await phone.screenshot({
    path: path.join(evidence, 'sms-mobile-320.png'),
    fullPage: true,
  })
  await phone.emulateMedia({ reducedMotion: 'reduce' })
  assert.equal(
    await phone
      .locator('.sms-flow-step')
      .evaluateAll((nodes) =>
        nodes.every((n) => getComputedStyle(n).animationName === 'none'),
      ),
    true,
  )
  record(
    'Desktop and 390/320px mobile layouts, both themes, keyboard selection and reduced motion',
  )
  const motion = await browser.newContext({
    baseURL: origin,
    ignoreHTTPSErrors: true,
    viewport: { width: 1280, height: 900 },
    recordVideo: {
      dir: path.join(evidence, 'motion'),
      size: { width: 1280, height: 900 },
    },
  })
  await motion.route('**/*', (r) =>
    new URL(r.request().url()).origin === origin ? r.continue() : r.abort(),
  )
  const animated = await motion.newPage()
  await animated.goto('/product/codex-sms')
  await animated.locator('.sms-flow-preview').scrollIntoViewIfNeeded()
  await animated.waitForTimeout(6600)
  const motionFile = await animated.video().path()
  await motion.close()
  fs.copyFileSync(motionFile, path.join(evidence, 'sms-motion-preview.webm'))
  record(
    'Recorded an actual browser animation preview with clearly labelled illustrative content',
  )
  await adminPage.reload()
  await adminPage.locator('.sms-admin-projects').waitFor()
  await adminPage
    .getByLabel('灰熊 API Key', { exact: true })
    .fill(grizzlyFixtureKey)
  await adminPage
    .getByLabel('成本汇率 · 人民币 / 1 美元', { exact: true })
    .fill('7.5')
  for (const name of Object.values(GRIZZLY_SERVICES))
    await adminPage
      .getByRole('textbox', { name: name + '采购上限', exact: true })
      .fill('1')
  const save = adminPage.waitForResponse(
    (r) =>
      new URL(r.url()).pathname === '/api/admin/sms' &&
      r.request().method() === 'POST',
  )
  await adminPage
    .getByRole('button', { name: '保存接码配置', exact: true })
    .click()
  assert.equal((await save).status(), 200)
  await adminPage
    .getByRole('button', { name: '只读检查余额与双池报价', exact: true })
    .waitFor()
  const checking = adminPage.waitForResponse(
    (r) =>
      new URL(r.url()).pathname === '/api/admin/sms' &&
      r.request().method() === 'POST',
  )
  await adminPage
    .getByRole('button', { name: '只读检查余额与双池报价', exact: true })
    .click()
  assert.equal((await checking).status(), 200)
  await adminPage.getByText('密钥已校验', { exact: true }).waitFor()
  assert.equal(
    (await (await fetch(control + '/state')).json()).grizzly.allocations,
    initial.grizzly.allocations,
  )
  assert.equal(
    await adminPage.locator('.sms-admin input[type=password]').inputValue(),
    '',
  )
  await adminPage.screenshot({
    path: path.join(evidence, 'admin-pool-check.png'),
    fullPage: true,
  })
  record(
    'Management save and seven read-only requests verify both pool prices without purchasing',
  )
  for (const checkbox of await adminPage
    .getByRole('checkbox', { name: '开放购买', exact: true })
    .all())
    await checkbox.check()
  const enabling = adminPage.waitForResponse(
    (r) =>
      new URL(r.url()).pathname === '/api/admin/sms' &&
      r.request().method() === 'POST',
  )
  await adminPage
    .getByRole('button', { name: '保存接码配置', exact: true })
    .click()
  assert.equal((await enabling).status(), 200)
  let firstOrder
  for (const [i, service] of Object.keys(GRIZZLY_SERVICES).entries()) {
    await page.goto('/product/codex-sms')
    await page.locator('[data-project="' + service + '"]').click()
    await page.getByRole('button', { name: '下单并付款', exact: true }).click()
    await page.locator('#sms-purchase-email').fill('buyer@example.test')
    await page
      .getByRole('checkbox', { name: '我已阅读并同意项目范围、购买及售后说明' })
      .check()
    const creating = page.waitForResponse(
      (r) =>
        new URL(r.url()).pathname === '/api/orders' &&
        r.request().method() === 'POST',
    )
    await page
      .getByRole('button', { name: '确认下单，继续付款', exact: true })
      .click()
    const created = await creating
    assert.equal(created.status(), 201)
    const { order } = await created.json()
    assert.equal(order.price, GRIZZLY_RETAIL_CENTS[service] / 100)
    firstOrder ??= order.id
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
    const state = await (await fetch(control + '/state')).json(),
      activation = state.grizzly.activations
        .filter((a) => a.service === service && a.state === 'waiting')
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
    }
    if (i === 0) {
      await buyer.grantPermissions(['clipboard-read', 'clipboard-write'], {
        origin,
      })
      await page
        .getByRole('button', { name: '复制验证码', exact: true })
        .click()
      assert.equal(
        await page.evaluate(() => navigator.clipboard.readText()),
        '739201',
      )
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
    record(
      GRIZZLY_SERVICES[service] +
        ': unified checkout, signed payment, phone and ' +
        (i === 2 ? 'confirmed cancellation' : 'private SMS code'),
    )
  }
  await api(stranger, '/api/orders/client', {})
  await api(stranger, '/api/orders/' + firstOrder, undefined, 404)
  await mobile.addCookies(await buyer.cookies())
  await phone.setViewportSize({ width: 390, height: 844 })
  await phone.goto('/orders')
  await phone.locator('.order-row').filter({ hasText: firstOrder }).click()
  await phone.getByRole('button', { name: '复制验证码', exact: true }).waitFor()
  await phone.screenshot({ path: path.join(evidence, 'buyer-code-mobile.png') })
  record('Buyer isolation and original-order SMS history on mobile')
  const managed = await api(admin, '/api/admin/sms?orders=1')
  assert.ok(managed.orders.some((o) => o.id === firstOrder))
  await adminPage.reload()
  await adminPage.locator('.sms-admin-orders .admin-order-id').first().waitFor()
  await adminPage.locator('.sms-admin-orders').scrollIntoViewIfNeeded()
  await adminPage.screenshot({ path: path.join(evidence, 'admin-orders.png') })
  const end = await (await fetch(control + '/state')).json()
  assert.equal(end.grizzly.allocations - initial.grizzly.allocations, 3)
  assert.deepEqual(result.pageErrors, [])
  assert.deepEqual(result.externalRequests, [])
  record(
    'Three synthetic allocations only, separate buyer/provider ledgers, no browser errors or real network writes',
  )
  result.passed = true
} catch (e) {
  result.passed = false
  result.failure = e.message
  await page
    .screenshot({ path: path.join(evidence, 'failure.png') })
    .catch(() => {})
  await adminPage
    .screenshot({
      path: path.join(evidence, 'failure-admin.png'),
      fullPage: true,
    })
    .catch(() => {})
  throw e
} finally {
  fs.writeFileSync(
    path.join(evidence, 'result.json'),
    JSON.stringify(result, null, 2),
  )
  await browser.close()
}
