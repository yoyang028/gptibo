// Fixed isolated workerd/D1 target; synthetic reseller catalog only.
import fs from 'node:fs'
import path from 'node:path'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { totp } from '../local/auth.mjs'
import { hanfolkFixtureKey } from './hanfolk-fixture.mjs'
import { HANFOLK_FAMILIES } from '../../shared/hanfolk-catalog.ts'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const origin = 'https://127.0.0.1:8791',
  control = 'http://127.0.0.1:8794'
const evidence = path.join(root, 'artifacts/local/evidence/hanfolk-catalog')
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
let contextIndex = 0
async function context(mobile = false) {
  const ctx = await browser.newContext({
    baseURL: origin,
    ignoreHTTPSErrors: true,
    extraHTTPHeaders: { 'CF-Connecting-IP': '192.0.2.' + ++contextIndex },
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
  await adminPage.goto('/admin?view=hanfolk')
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
  await adminPage.locator('.hanfolk-admin').waitFor()
  const prior = await api(admin, '/api/admin/hanfolk'),
    allPrior = await api(admin, '/api/admin/my-shop/products')
  for (const d of prior.drafts.filter(
    (d) => d.productId >= 100 && d.productId <= 108,
  )) {
    const p = allPrior.products.find((p) => p.id === d.id)
    await api(admin, '/api/admin/my-shop/products', {
      ...p,
      pricePending: true,
      priceCents: 1,
      status: 'draft',
    })
  }
  await adminPage.getByLabel('大橘 API Key').fill(hanfolkFixtureKey)
  await adminPage
    .getByRole('button', { name: '加密保存密钥', exact: true })
    .click()
  await adminPage
    .getByRole('status')
    .filter({ hasText: '密钥已在服务端加密保存' })
    .waitFor()
  await adminPage
    .getByRole('button', { name: '只读读取九类商品', exact: true })
    .click()
  await adminPage.locator('.hanfolk-source').nth(8).waitFor()
  for (let i = 0; i < 9; i++) {
    const detailResponse = adminPage.waitForResponse(
      (r) =>
        new URL(r.url()).pathname === '/api/admin/hanfolk' &&
        r.request().method() === 'POST' &&
        r.request().postDataJSON()?.action === 'detail',
    )
    await adminPage
      .locator('.hanfolk-source')
      .nth(i)
      .getByRole('button')
      .first()
      .click()
    assert.equal((await detailResponse).status(), 200)
    await adminPage
      .locator('.hanfolk-source')
      .nth(i)
      .locator('.hanfolk-skus')
      .waitFor()
    await adminPage
      .getByRole('button', { name: '只读读取九类商品', exact: true })
      .waitFor({ state: 'visible' })
  }
  await adminPage
    .getByRole('button', { name: '选择本类已读取的规格', exact: true })
    .click()
  await adminPage
    .getByRole('button', { name: '导入待定价草稿', exact: true })
    .click()
  await adminPage
    .getByRole('status')
    .filter({ hasText: '待定价草稿' })
    .waitFor()
  await adminPage.locator('.hanfolk-admin tbody tr').nth(17).waitFor()
  assert.equal(await adminPage.locator('.hanfolk-admin tbody tr').count(), 18)
  const privateData = await api(admin, '/api/admin/hanfolk')
  const drafts = privateData.drafts.filter(
    (d) => d.productId >= 100 && d.productId <= 108,
  )
  assert(drafts.every((d) => d.pricePending))
  const closed = await api(buyer, '/api/catalog')
  assert(!closed.products.some((p) => drafts.some((d) => d.id === p.id)))
  assert(!JSON.stringify(closed).includes('costCents'))
  await adminPage.screenshot({
    path: path.join(evidence, 'admin-local-fixture.png'),
  })
  record(
    'Authenticated admin imports eighteen synthetic specifications as private unpriced drafts; buyer sees no costs or drafts',
  )
  await adminPage.getByLabel('代理商品类别').selectOption('grok')
  await adminPage
    .locator('.hanfolk-admin tbody tr')
    .first()
    .getByRole('button', { name: '编辑与定价', exact: true })
    .click()
  const editor = adminPage
    .getByRole('dialog')
    .filter({ has: adminPage.getByText('商品展示', { exact: true }) })
  await editor.getByLabel('售价（元）', { exact: true }).waitFor()
  assert.equal(
    await editor.getByLabel('售价（元）', { exact: true }).inputValue(),
    '',
  )
  await editor.getByRole('button', { name: '保存草稿', exact: true }).click()
  await editor.getByRole('status').filter({ hasText: '商品已保存' }).waitFor()
  await editor.getByLabel('售价（元）', { exact: true }).fill('18.80')
  await editor
    .getByRole('button', { name: '仅展示，暂不开售', exact: true })
    .click()
  await editor.getByRole('status').filter({ hasText: '商品已保存' }).waitFor()
  await editor.getByRole('button', { name: '关闭弹窗', exact: true }).click()
  record(
    'Unpriced editor starts blank, saves drafts and accepts an explicit retail price before listing',
  )
  const managed = await api(admin, '/api/admin/my-shop/products')
  for (const [i, d] of drafts.entries()) {
    const p = managed.products.find((p) => p.id === d.id)
    await api(admin, '/api/admin/my-shop/products', {
      ...p,
      priceCents: 1880 + i * 100,
      pricePending: false,
      status: 'listed',
      badge: '规格可选',
    })
  }
  await page.goto('/')
  for (const family of Object.keys(HANFOLK_FAMILIES)) {
    await page.locator('[data-product-group="' + family + '"]').waitFor()
    assert.equal(
      await page.locator('[data-product-group="' + family + '"]').count(),
      1,
    )
    await page.goto('/product/' + family)
    await page.locator('.shop-product-variants input').first().waitFor()
    const before = await page.locator('.total-price').innerText()
    await page.locator('.shop-product-variants input').last().check()
    const after = await page.locator('.total-price').innerText()
    assert.notEqual(before, after, family + ' retail changes')
    assert.equal(await page.locator('.summary-cta').isDisabled(), true)
    if (family === 'muse')
      await page.screenshot({
        path: path.join(evidence, 'muse-detail-desktop.png'),
        fullPage: true,
      })
    await page.goto('/')
  }
  record(
    'Nine public families each have one entrance; specification selection changes price and keeps purchase disabled',
  )
  const muse = page.locator('[data-product-group=muse]')
  await muse.scrollIntoViewIfNeeded()
  const mark = muse.locator('.muse-logo-motion')
  assert.equal((await mark.innerText()).trim(), '')
  assert.equal(await mark.locator(':scope > *').count(), 1)
  assert.equal(
    await mark.evaluate((e) => getComputedStyle(e).borderWidth),
    '0px',
  )
  await page.waitForFunction(
    () =>
      document.querySelector('[data-product-group=muse] .muse-logo-motion')
        ?.dataset.active === 'true',
  )
  const transform = await mark
    .locator('img')
    .evaluate((e) => getComputedStyle(e).transform)
  await page.waitForTimeout(400)
  assert.notEqual(
    await mark.locator('img').evaluate((e) => getComputedStyle(e).transform),
    transform,
  )
  await muse.screenshot({ path: path.join(evidence, 'muse-card-light.png') })
  await page.evaluate(() => document.documentElement.classList.add('dark'))
  await muse.screenshot({ path: path.join(evidence, 'muse-card-dark.png') })
  await page.emulateMedia({ reducedMotion: 'reduce' })
  assert.equal(
    await mark
      .locator('img')
      .evaluate((e) => getComputedStyle(e).animationName),
    'none',
  )
  record(
    'Muse shows only the original vector, has no internal text or frame, animates via transform and honors reduced motion',
  )
  const phone = await mobile.newPage()
  await phone.goto('/product/muse')
  await phone.locator('.muse-logo-motion img').waitFor()
  assert(
    await phone.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  )
  await phone.screenshot({
    path: path.join(evidence, 'muse-detail-mobile.png'),
    fullPage: true,
  })
  await phone.goto('/product/apple-id')
  await phone.locator('.shop-product-variants input').last().check()
  assert(
    await phone.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  )
  await phone.screenshot({
    path: path.join(evidence, 'apple-id-mobile.png'),
    fullPage: true,
  })
  await api(stranger, '/api/admin/hanfolk', undefined, 401)
  record(
    'Mobile layouts stay within viewport; unauthenticated buyer cannot read supplier admin data',
  )
  const videoContext = await browser.newContext({
    baseURL: origin,
    ignoreHTTPSErrors: true,
    viewport: { width: 1100, height: 800 },
    recordVideo: { dir: evidence, size: { width: 1100, height: 800 } },
  })
  const motion = await videoContext.newPage()
  await motion.goto('/')
  await motion.locator('[data-product-group=muse]').scrollIntoViewIfNeeded()
  await motion.waitForTimeout(7800)
  const video = motion.video()
  await videoContext.close()
  fs.renameSync(
    await video.path(),
    path.join(evidence, 'muse-motion-local.webm'),
  )
  const end = await (await fetch(control + '/state')).json()
  assert.equal(end.grizzly.allocations, initial.grizzly.allocations)
  assert.deepEqual(result.pageErrors, [])
  result.passed = true
} catch (e) {
  result.failure = e.message
  result.passed = false
  await adminPage
    .screenshot({ path: path.join(evidence, 'failure-admin.png') })
    .catch(() => {})
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
