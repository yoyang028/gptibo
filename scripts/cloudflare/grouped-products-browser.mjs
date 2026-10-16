// Real local Worker/D1 UI checks. Fixed loopback target; synthetic listings only.
import fs from 'node:fs'
import path from 'node:path'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { totp } from '../local/auth.mjs'
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const origin = 'https://127.0.0.1:8781',
  control = 'http://127.0.0.1:8784'
const evidence = path.join(root, 'artifacts/local/evidence/grouped-products')
fs.mkdirSync(evidence, { recursive: true })
const runtime = await (await fetch(control + '/state')).json()
assert.equal(runtime.localMock, true)
assert.equal(runtime.origin, origin)
const resetLimits = await fetch(control + '/reset-auth-limits', {
  method: 'POST', headers: { Origin: control, 'X-Local-Control': fs.readFileSync(path.join(root, 'artifacts/local/.secrets/xiaojiu-cloudflare-mock/control-token'), 'utf8').trim() },
})
assert.equal(resetLimits.status, 204, 'Reset only the authenticated isolated synthetic login budget')
const { chromium } = createRequire(import.meta.url)(
  'D:/ChatGPT/CodexCache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright',
)
const result = {
  checkedAt: new Date().toISOString(),
  checks: [],
  pageErrors: [],
  externalRequests: [],
  realPayments: 0,
  realSupplierWrites: 0,
}
const record = (name) => {
  result.checks.push({ name, passed: true })
  console.log(JSON.stringify({ name, passed: true }))
}
const browser = await chromium.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: true,
  env: {
    ...process.env,
    TEMP: path.join(root, 'artifacts/local/tmp'),
    TMP: path.join(root, 'artifacts/local/tmp'),
  },
})
async function context() {
  const ctx = await browser.newContext({
    baseURL: origin,
    ignoreHTTPSErrors: true,
    viewport: { width: 1440, height: 1040 },
  })
  await ctx.route('**/*', (route) => {
    const url = new URL(route.request().url())
    if (url.origin !== origin) {
      result.externalRequests.push(url.origin)
      return route.abort()
    }
    return route.continue()
  })
  ctx.on('page', (page) =>
    page.on('pageerror', (e) => result.pageErrors.push(e.message)),
  )
  return ctx
}
const admin = await context(),
  buyer = await context()
const adminPage = await admin.newPage(),
  page = await buyer.newPage(),
  created = []
async function api(ctx, url, data, expected = 200, retry = 2) {
  const response = await ctx.request.fetch(url, {
    method: data === undefined ? 'GET' : 'POST',
    headers: { Origin: origin },
    ...(data === undefined ? {} : { data }),
  })
  if (response.status() === 429 && retry) {
    await new Promise((r) => setTimeout(r, 31000))
    return api(ctx, url, data, expected, retry - 1)
  }
  const body = await response.json()
  assert.equal(response.status(), expected, url + ': ' + JSON.stringify(body))
  return body
}
function emailCode() {
  const directory = path.join(
    root,
    'artifacts/local/cloudflare-xiaojiu/mailbox',
  )
  for (const name of fs
    .readdirSync(directory)
    .filter((n) => n.endsWith('.json'))
    .sort(
      (a, b) =>
        fs.statSync(path.join(directory, b)).mtimeMs -
        fs.statSync(path.join(directory, a)).mtimeMs,
    )) {
    const mail = JSON.parse(fs.readFileSync(path.join(directory, name), 'utf8'))
    const code =
      mail.to.includes('admin@example.invalid') && mail.text?.match(/\b\d{6}\b/)
    if (code) return code[0]
  }
  throw new Error('No local login email')
}
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
              'artifacts/local/.secrets/xiaojiu-cloudflare-mock/admin-totp',
            ),
            'utf8',
          )
          .trim(),
      ),
    )
  await adminPage.getByRole('button', { name: '登录后台', exact: true }).click()
  await adminPage.getByRole('tab', { name: '商品发布', exact: true }).waitFor()
  const fixture = {
    id: '',
    version: 0,
    status: 'listed',
    category: 'AI 订阅',
    tagline: '本机规格分组验收',
    description: '仅用于本机验收的展示商品，不提供真实服务。',
    image:
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWQAAAABJRU5ErkJggg==',
    badge: '规格展示',
    unit: '份',
    stock: -1,
    features: ['独立规格与售价'],
    purchaseNote: '本机测试，不付款。',
    deliveryInstructions: '本机测试，不发货。',
    steps: [{ title: '核对规格', description: '只验证界面与订单保护。' }],
    faq: [{ question: '能购买吗？', answer: '仅展示，不开放购买。' }],
    fields: [],
    delivery: 'manual',
    payment: { label: '', instructions: '', url: '', qr: '' },
  }
  for (const [groupId, names, prices] of [
    [
      'claude',
      ['Claude Pro', 'Claude Max5x', 'Claude Max20x'],
      [16800, 88000, 198000],
    ],
    [
      'codex-credits',
      [
        'Codex 250 额度',
        'Codex 500 额度',
        'Codex 1000 额度',
        'Codex 2500 额度',
      ],
      [8800, 17800, 36000, 88000],
    ],
  ])
    for (let i = 0; i < names.length; i++) {
      const p = (
        await api(
          admin,
          '/api/admin/my-shop/products',
          {
            ...fixture,
            groupId,
            name: names[i],
            duration: names[i],
            priceCents: prices[i],
          },
          201,
        )
      ).product
      created.push(p.id)
    }
  await page.goto('/')
  await page.locator('[data-product-group="claude"]').waitFor()
  assert.equal(await page.locator('[data-product-group="claude"]').count(), 1)
  assert.equal(
    await page.locator('[data-product-group="codex-credits"]').count(),
    1,
  )
  for (const id of created)
    assert.equal(await page.locator(`[href="/product/${id}"]`).count(), 0)
  record(
    'Seven specifications appear as exactly one Claude card and one Codex credit card',
  )
  for (const [group, count] of [['claude', 3], ['codex-credits', 4]]) {
    const deck = page.locator(`[data-product-group="${group}"] .store-deck`)
    assert.equal(await deck.locator('[data-tier]').count(), count)
    await deck.hover()
    await page.waitForTimeout(750)
    assert.equal(await deck.getAttribute('data-phase'), 'inspect')
    const bounds = await deck.evaluate(element => {
      const deck = element.getBoundingClientRect()
      return Array.from(element.querySelectorAll('[data-tier]')).map(card => {
        const box = card.getBoundingClientRect()
        return { left: box.left - deck.left, right: box.right - deck.left, top: box.top - deck.top, bottom: box.bottom - deck.top, width: deck.width, height: deck.height }
      })
    })
    for (const box of bounds) assert(box.left >= 0 && box.right <= box.width + 1 && box.top >= 0 && box.bottom <= box.height + 1)
  }
  await page.mouse.move(5, 5)
  await page.locator('[data-product-group="claude"] .store-deck').focus()
  await page.waitForTimeout(700)
  assert.equal(await page.locator('[data-product-group="claude"] .store-deck').getAttribute('data-phase'), 'inspect')
  await page.screenshot({path:path.join(evidence,'animated-family-cards.png'),fullPage:true})
  record('Three-tier and four-tier decks expand by pointer and keyboard without clipping their specifications')
  await page.locator('[data-product-group="claude"] a').click()
  assert.equal(await page.getByRole('radio').count(), 3)
  await page.getByRole('radio', { name: /Claude Max5x/ }).check()
  await page.locator('.total-price').filter({ hasText: '¥880.00' }).waitFor()
  assert.equal(await page.locator('.summary-cta').isDisabled(), true)
  assert.match(await page.locator('.summary-cta').innerText(), /暂停售卖/)
  await page.screenshot({
    path: path.join(evidence, 'claude-specifications.png'),
    fullPage: true,
  })
  record(
    'Claude selection updates the specification and price while checkout remains disabled',
  )
  await page.goto('/product/codex-credits')
  await page.getByRole('radio', { name: /Codex 1000/ }).check()
  await page.locator('.total-price').filter({ hasText: '¥360.00' }).waitFor()
  assert.equal(await page.getByRole('radio').count(), 4)
  const catalog = await api(buyer, '/api/catalog')
  const selected = catalog.products.find(
    (p) => p.groupId === 'codex-credits' && p.priceCents === 36000,
  )
  await api(
    buyer,
    '/api/orders',
    {
      plan: selected.id,
      email: 'buyer@example.test',
      expectedPrice: selected.priceCents,
      key: crypto.randomUUID(),
      fields: {},
    },
    409,
  )
  record(
    'Codex specification prices match their individual SKU and direct purchase attempts on listings are rejected',
  )
  await page.setViewportSize({ width: 390, height: 844 })
  await page.getByRole('radio', { name: /Codex 2500/ }).check()
  await page.locator('.total-price').filter({ hasText: '¥880.00' }).waitFor()
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
    true,
  )
  await page.screenshot({
    path: path.join(evidence, 'codex-mobile.png'),
    fullPage: true,
  })
  record(
    'All four Codex specifications remain selectable on 390px mobile without horizontal overflow',
  )
  await adminPage.reload()
  await adminPage
    .getByRole('tab', { name: '商品上下架与排序', exact: true })
    .click()
  const claudeToggle = adminPage.getByRole('button', {
    name: '展开 Claude 套餐定价',
    exact: true,
  })
  await claudeToggle.waitFor({ state: 'visible' })
  assert.equal(await claudeToggle.count(), 1)
  await claudeToggle.click()
  const claudeRow = adminPage.locator('.partner-product-item').filter({
    has: adminPage.getByRole('button', {
      name: '收起 Claude 套餐定价',
      exact: true,
    }),
  })
  await claudeRow
    .getByRole('button', { name: '调整售价', exact: true })
    .first()
    .waitFor({ state: 'visible' })
  assert.equal(
    await claudeRow
      .getByRole('button', { name: '调整售价', exact: true })
      .count(),
    3,
  )
  await adminPage
    .getByRole('button', { name: '展开 Codex 额度 套餐定价', exact: true })
    .click()
  const codexRow = adminPage.locator('.partner-product-item').filter({
    has: adminPage.getByRole('button', {
      name: '收起 Codex 额度 套餐定价',
      exact: true,
    }),
  })
  await codexRow
    .getByRole('button', { name: '调整售价', exact: true })
    .first()
    .waitFor({ state: 'visible' })
  assert.equal(
    await codexRow
      .getByRole('button', { name: '调整售价', exact: true })
      .count(),
    4,
  )
  await adminPage.screenshot({
    path: path.join(evidence, 'admin-product-groups.png'),
    fullPage: true,
  })
  record(
    'Owner product sorting contains two grouped rows with three and four independently editable prices',
  )
  await adminPage.getByRole('tab', { name: '商品发布', exact: true }).click()
  await adminPage
    .locator(`[data-product-id="${created[0]}"]`)
    .getByRole('button', { name: '编辑商品', exact: true })
    .click()
  const dialog = adminPage.getByRole('dialog')
  assert.equal(
    await dialog.getByLabel('前台商品分组', { exact: false }).inputValue(),
    'claude',
  )
  await dialog
    .getByRole('button', { name: '仅展示，暂不开售', exact: true })
    .click()
  await dialog.getByText('商品已保存。', { exact: true }).waitFor()
  await dialog.getByRole('button', { name: '关闭弹窗', exact: true }).click()
  record(
    'Owner editor saves the display-only state with its group and no payment configuration',
  )
  assert.equal(
    (await (await fetch(control + '/state')).json()).xiaojiu.debits,
    runtime.xiaojiu.debits,
  )
  assert.deepEqual(result.pageErrors, [])
  assert.deepEqual(result.externalRequests, [])
  result.passed = true
} catch (error) {
  result.passed = false
  result.failure = String(error.message).slice(0, 2000)
  await page
    .screenshot({
      path: path.join(evidence, 'buyer-failure.png'),
      fullPage: true,
    })
    .catch(() => {})
  await adminPage
    .screenshot({
      path: path.join(evidence, 'admin-failure.png'),
      fullPage: true,
    })
    .catch(() => {})
  throw error
} finally {
  try {
    const products = (await api(admin, '/api/admin/my-shop/products')).products
    for (const id of created) {
      const product = products.find((p) => p.id === id)
      if (product)
        await api(admin, '/api/admin/my-shop/products', {
          ...product,
          status: 'archived',
        })
    }
    await api(admin, '/api/admin/logout', {})
    result.cleanupPassed = true
  } catch (error) {
    result.passed = false
    result.cleanupError = String(error.message).slice(0, 1000)
    process.exitCode = 1
  }
  fs.writeFileSync(
    path.join(evidence, 'result.json'),
    JSON.stringify(result, null, 2) + '\n',
  )
  await browser.close()
}
