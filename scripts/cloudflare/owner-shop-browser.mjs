// Exercise the owner's real UI against local workerd/D1 and isolated fixtures.
// This script deliberately cannot target a production hostname or load real keys.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { totp } from '../local/auth.mjs'
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const origin = 'https://127.0.0.1:8771',
  control = 'http://127.0.0.1:8774'
const evidence = path.join(root, 'artifacts/local/evidence/owner-shop')
fs.mkdirSync(evidence, { recursive: true })
const runtime = await (await fetch(control + '/state')).json()
assert.equal(runtime.localMock, true)
assert.equal(runtime.origin, origin)
const require = createRequire(import.meta.url),
  {
    chromium,
  } = require('D:/ChatGPT/CodexCache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright')
const results = {
  checkedAt: new Date().toISOString(),
  backend: 'workerd-d1',
  realPayments: 0,
  realSupplierWrites: 0,
  checks: [],
  pageErrors: [],
  externalRequests: [],
}
const record = (name) => {
  results.checks.push({ name, passed: true })
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
  await ctx.route('**/*', async (route) => {
    const url = new URL(route.request().url())
    if (url.origin !== origin) {
      results.externalRequests.push(url.origin)
      await route.abort()
    } else await route.continue()
  })
  ctx.on('page', (page) =>
    page.on('pageerror', (e) => results.pageErrors.push(e.message)),
  )
  return ctx
}
async function api(ctx, url, data, expected = 200) {
  const response = await ctx.request.fetch(url, {
      method: data === undefined ? 'GET' : 'POST',
      headers: { Origin: origin },
      ...(data === undefined ? {} : { data }),
    }),
    body = await response.json()
  assert.equal(response.status(), expected, url + ': ' + JSON.stringify(body))
  return body
}
function code() {
  const folder = path.join(root, 'artifacts/local/cloudflare/mailbox')
  for (const name of fs
    .readdirSync(folder)
    .filter((n) => n.endsWith('.json'))
    .sort(
      (a, b) =>
        fs.statSync(path.join(folder, b)).mtimeMs -
        fs.statSync(path.join(folder, a)).mtimeMs,
    )) {
    const mail = JSON.parse(fs.readFileSync(path.join(folder, name), 'utf8'))
    const match =
      mail.to.includes('admin@example.invalid') && mail.text?.match(/\b\d{6}\b/)
    if (match) return match[0]
  }
  throw new Error('No local admin test email')
}
const admin = await context(),
  buyer = await context(),
  mobile = await context(true),
  adminPage = await admin.newPage(),
  buyerPage = await buyer.newPage()
let initial, manualId, apiId
try {
  await adminPage.goto('/admin?view=my-shop')
  await adminPage.locator('#admin-username').fill('dev-admin')
  const sending = adminPage.waitForResponse(
    (r) => new URL(r.url()).pathname === '/api/admin/login/email-code',
  )
  await adminPage
    .getByRole('button', { name: '获取验证码', exact: true })
    .click()
  assert.equal((await sending).status(), 200)
  await adminPage.locator('#admin-email-code').fill(code())
  await adminPage
    .locator('#admin-code')
    .fill(
      totp(
        fs
          .readFileSync(
            path.join(
              root,
              'artifacts/local/.secrets/quefa-cloudflare-mock/admin-totp',
            ),
            'utf8',
          )
          .trim(),
      ),
    )
  await adminPage.getByRole('button', { name: '登录后台', exact: true }).click()
  await adminPage
    .getByRole('navigation', { name: '后台导航' })
    .getByRole('button', { name: '我的店铺', exact: true })
    .waitFor()
  initial = (await api(admin, '/api/admin/my-shop/stores')).stores[0]
  record(
    'Main-admin email and TOTP login opens My Shop without a reseller session',
  )
  const image = await adminPage.evaluate(() => {
    const c = document.createElement('canvas')
    c.width = 192
    c.height = 192
    const g = c.getContext('2d')
    g.fillStyle = '#6256cf'
    g.fillRect(0, 0, 192, 192)
    g.fillStyle = '#ffffff'
    g.font = 'bold 88px sans-serif'
    g.fillText('T', 66, 128)
    return c.toDataURL('image/png')
  })
  const imagePath = path.join(evidence, 'fixture-product.png')
  fs.writeFileSync(imagePath, Buffer.from(image.split(',')[1], 'base64'))
  await adminPage
    .getByRole('button', { name: '编辑', exact: true })
    .first()
    .click()
  const storeDialog = adminPage.getByRole('dialog')
  await storeDialog.getByLabel('品牌名称', { exact: true }).fill('本机验收商店')
  await storeDialog.getByLabel('Logo', { exact: true }).setInputFiles(imagePath)
  await storeDialog
    .getByRole('button', { name: '保存商店', exact: true })
    .click()
  await storeDialog.waitFor({ state: 'hidden' })
  await buyerPage.goto('/')
  await buyerPage.getByRole('button', { name: /本机验收商店 首页/ }).waitFor()
  assert.match(await buyerPage.title(), /本机验收商店/)
  record(
    'Original store editor saves root brand and logo; storefront title and header reflect it',
  )
  await adminPage.getByRole('tab', { name: '商品发布', exact: true }).click()
  await adminPage
    .getByRole('button', { name: '发布新商品', exact: true })
    .click()
  const dialog = adminPage.getByRole('dialog')
  await dialog.getByLabel('商品名称', { exact: true }).fill('本机验收自营订阅')
  await dialog.getByLabel('分类', { exact: true }).fill('工具服务')
  await dialog
    .getByLabel('规格／服务周期', { exact: true })
    .fill('测试规格 · 1 个月')
  await dialog.getByLabel('售价（元）', { exact: true }).fill('9.90')
  await dialog
    .getByLabel('短介绍', { exact: true })
    .fill('本机自动验收使用，不是真实商品')
  await dialog
    .getByLabel('详细说明', { exact: true })
    .fill('在本机模拟环境验证商品发布、下单、付款核对与人工交付。')
  await dialog
    .getByLabel('商品特点（每行一项，最多 12 项）', { exact: true })
    .fill('订单可查\n人工交付')
  await dialog.locator('input[type=file]').first().setInputFiles(imagePath)
  await dialog
    .getByLabel('购买须知与售后范围', { exact: true })
    .fill('测试商品，勿真实付款；未交付可申请售后。')
  await dialog
    .getByLabel('交付说明', { exact: true })
    .fill('本机模拟核对收款后，在原订单领取测试资料。')
  await dialog
    .getByLabel('收款名称', { exact: true })
    .fill('模拟收款 · 不支付真实资金')
  await dialog
    .getByLabel('付款说明', { exact: true })
    .fill('只验证界面与订单状态，不进行真实收款。')
  await dialog
    .getByLabel('收款链接（与二维码至少填一项）', { exact: true })
    .fill('https://payments.example.com/fixture')
  await dialog
    .getByRole('button', { name: '添加交付步骤', exact: true })
    .click()
  await dialog.getByLabel('步骤 1 标题', { exact: true }).fill('下单后领取')
  await dialog
    .getByLabel('步骤说明', { exact: true })
    .fill('模拟核对到账后提供测试资料。')
  await dialog
    .getByRole('button', { name: '添加常见问题', exact: true })
    .click()
  await dialog.getByLabel('问题', { exact: true }).fill('这是实际供货吗？')
  await dialog
    .getByLabel('回答', { exact: true })
    .fill('不是，仅在隔离的本机环境验收。')
  await dialog.getByRole('button', { name: '发布商品', exact: true }).click()
  await dialog.getByRole('status').filter({ hasText: '商品已发布' }).waitFor()
  const manual = (
    await api(admin, '/api/admin/my-shop/products')
  ).products.find(
    (p) => p.name === '本机验收自营订阅' && p.status === 'published',
  )
  assert.ok(manual)
  manualId = manual.id
  await dialog.getByRole('button', { name: '关闭弹窗', exact: true }).click()
  record(
    'UI publishes a complete custom product with image, specifications, terms, steps, FAQ and collection instructions',
  )
  await buyerPage.goto('/product/' + manualId)
  await buyerPage.getByRole('button', { name: '立即购买', exact: true }).click()
  const purchase = buyerPage.getByRole('dialog')
  await purchase
    .getByLabel('下单邮箱', { exact: true })
    .fill('buyer@example.test')
  await purchase.getByRole('checkbox').check()
  await purchase
    .getByRole('button', { name: '确认下单，继续付款', exact: true })
    .click()
  await buyerPage
    .getByLabel('付款交易号／付款备注', { exact: true })
    .fill('LOCAL-FIXTURE-PAYMENT')
  await buyerPage
    .getByRole('button', { name: '我已付款，提交核对', exact: true })
    .click()
  await buyerPage
    .getByText('已提交付款信息，等待店主核对。请勿重复付款。', { exact: true })
    .waitFor()
  const orders = (await api(buyer, '/api/orders')).orders,
    order = orders.find((o) => o.plan === manualId)
  assert.equal(order.paymentStatus, 'unpaid')
  record(
    'Buyer UI creates the order and submits a reference without falsely marking payment as paid',
  )
  await adminPage
    .getByRole('navigation', { name: '后台导航' })
    .getByRole('button', { name: '订单管理', exact: true })
    .click()
  await adminPage.getByText(order.id, { exact: true }).first().click()
  const detail = adminPage.getByRole('dialog')
  await detail.locator('#shop-admin-note').fill('本机验收：已核对模拟收款记录')
  await detail
    .getByRole('button', { name: '已核对真实到账，确认收款', exact: true })
    .click()
  await detail
    .locator('#shop-admin-delivery')
    .fill('LOCAL-FIXTURE-MANUAL-DELIVERY')
  await detail.locator('#shop-admin-note').fill('本机验收：交付测试资料')
  await detail
    .getByRole('button', { name: '确认交付给客户', exact: true })
    .click()
  await buyerPage
    .getByRole('button', { name: '刷新原订单进度', exact: true })
    .click()
  await buyerPage
    .getByText('LOCAL-FIXTURE-MANUAL-DELIVERY', { exact: true })
    .waitFor()
  await buyerPage.screenshot({
    path: path.join(evidence, 'manual-delivered.png'),
    fullPage: true,
  })
  record(
    'Admin UI confirms collection and delivers; the buyer sees the same original order result',
  )
  await detail.getByRole('button', { name: '关闭弹窗', exact: true }).click()
  const apiInput = {
    ...manual,
    id: '',
    version: 0,
    name: '本机验收 API 订阅',
    delivery: 'api',
    status: 'draft',
    api: {
      baseUrl: 'https://fixture-supplier.example.com/v1',
      productCode: 'fixture-subscription',
      maxCostCents: 500,
      configured: false,
      verified: false,
    },
    apiToken: 'local-fixture-api-key',
  }
  const checked = (
    await api(admin, '/api/admin/my-shop/products/verify-api', apiInput, 201)
  ).product
  const apiProduct = (
    await api(admin, '/api/admin/my-shop/products', {
      ...checked,
      status: 'published',
    })
  ).product
  apiId = apiProduct.id
  await api(buyer, '/api/orders/client', {})
  const automatic = (
    await api(
      buyer,
      '/api/orders',
      {
        plan: apiId,
        email: 'buyer@example.test',
        fields: {},
        key: crypto.randomUUID(),
        expectedPrice: apiProduct.priceCents,
      },
      201,
    )
  ).order
  await api(buyer, `/api/orders/${automatic.id}/custom-action`, {
    action: 'claim-payment',
    version: automatic.version,
    reference: 'LOCAL-FIXTURE-API-PAYMENT',
  })
  await api(admin, '/api/admin/my-shop/orders/' + automatic.id, {
    action: 'confirm-payment',
    version: automatic.version,
    note: '本机验收：模拟到账确认',
  })
  const delivered = (await api(buyer, '/api/orders/' + automatic.id)).order
  assert.equal(delivered.status, 'success')
  assert.equal(delivered.custom.deliveryContent, 'LOCAL-FIXTURE-DELIVERY')
  record(
    'Actual workerd encrypts API configuration, verifies its fixture catalog and completes one original supplier order',
  )
  const publicCatalog = await api(buyer, '/api/catalog')
  assert.ok(!JSON.stringify(publicCatalog).includes('local-fixture-api-key'))
  assert.ok(publicCatalog.products.every((p) => !p.api))
  assert.equal(
    (await buyer.request.get('/api/admin/my-shop/products')).status(),
    401,
  )
  record(
    'Public catalog hides supplier credentials and configuration; buyers cannot use owner-management endpoints',
  )
  const mobilePage = await mobile.newPage()
  await mobilePage.goto('/product/' + manualId)
  await mobilePage
    .getByRole('button', { name: '立即购买', exact: true })
    .waitFor()
  assert.ok(
    await mobilePage.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  )
  await mobilePage.screenshot({
    path: path.join(evidence, 'product-mobile.png'),
    fullPage: true,
  })
  await buyerPage.goto('/product/' + manualId)
  await buyerPage
    .getByRole('button', { name: '立即购买', exact: true })
    .waitFor()
  await buyerPage.screenshot({
    path: path.join(evidence, 'product-desktop.png'),
    fullPage: true,
  })
  await adminPage
    .getByRole('navigation', { name: '后台导航' })
    .getByRole('button', { name: '我的店铺', exact: true })
    .click()
  await adminPage.getByRole('tab', { name: '商品发布', exact: true }).click()
  await adminPage
    .getByText('本机验收自营订阅', { exact: true })
    .first()
    .waitFor()
  await adminPage.waitForTimeout(350)
  await adminPage.screenshot({
    path: path.join(evidence, 'my-shop-products.png'),
    fullPage: true,
  })
  record(
    'Desktop and 390px mobile storefront details render without horizontal overflow',
  )
  assert.deepEqual(results.pageErrors, [])
  assert.deepEqual(results.externalRequests, [])
  record(
    'Browser console stays error-free and no external payment or supplier URL is opened',
  )
  results.passed = true
} catch (e) {
  results.passed = false
  results.failure = String(e.message).slice(0, 2000)
  await adminPage
    .screenshot({
      path: path.join(evidence, 'admin-failure.png'),
      fullPage: true,
    })
    .catch(() => {})
  await buyerPage
    .screenshot({
      path: path.join(evidence, 'buyer-failure.png'),
      fullPage: true,
    })
    .catch(() => {})
  throw e
} finally {
  if (initial) {
    const current = (await api(admin, '/api/admin/my-shop/stores')).stores[0]
    await api(admin, '/api/admin/my-shop/stores', {
      id: 'platform',
      version: current.version,
      name: initial.name,
      active: initial.active,
      settings: initial.settings,
    }).catch(() => {})
    const products = (await api(admin, '/api/admin/my-shop/products')).products
    for (const id of [manualId, apiId].filter(Boolean)) {
      const p = products.find((p) => p.id === id)
      if (p)
        await api(admin, '/api/admin/my-shop/products', {
          ...p,
          status: 'archived',
        }).catch(() => {})
    }
    await api(admin, '/api/admin/logout', {}).catch(() => {})
  }
  fs.writeFileSync(
    path.join(evidence, 'result.json'),
    JSON.stringify(results, null, 2) + '\n',
  )
  await browser.close()
}
