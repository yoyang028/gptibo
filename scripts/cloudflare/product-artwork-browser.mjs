// Real UI checks against the isolated local workerd/D1 stack only.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { totp } from '../local/auth.mjs'
import { checkArtworkMaterials } from './artwork-material-checks.mjs'
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const origin = 'https://127.0.0.1:8771',
  control = 'http://127.0.0.1:8774'
const state = await (await fetch(control + '/state')).json()
assert.equal(state.localMock, true)
assert.equal(state.origin, origin)
const evidence = path.join(root, 'artifacts/local/evidence/product-artwork')
fs.mkdirSync(evidence, { recursive: true })
const sessionFile = path.join(
  root,
  'artifacts/local/.secrets/product-artwork-browser-session.json',
)
const require = createRequire(import.meta.url)
const {
  chromium,
} = require('D:/ChatGPT/CodexCache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright')
const browser = await chromium.launch({
  headless: true,
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  env: {
    ...process.env,
    TEMP: path.join(root, 'artifacts/local/tmp'),
    TMP: path.join(root, 'artifacts/local/tmp'),
  },
})
const results = {
  checkedAt: new Date().toISOString(),
  backend: 'local workerd/D1',
  checks: [],
  pageErrors: [],
  externalRequests: [],
  financialWrites: [],
  realPayments: 0,
  supplierWrites: 0,
}
const record = (name) => {
  results.checks.push({ name, passed: true })
  console.log(JSON.stringify({ name, passed: true }))
}
async function context(mobile = false, owner = false) {
  const ctx = await browser.newContext({
    baseURL: origin,
    ignoreHTTPSErrors: true,
    viewport: mobile
      ? { width: 390, height: 844 }
      : { width: 1440, height: 1040 },
    ...(owner && fs.existsSync(sessionFile)
      ? { storageState: sessionFile }
      : {}),
  })
  await ctx.route('**/*', async (route) => {
    const request = route.request(),
      url = new URL(request.url())
    if (!url.protocol.startsWith('http')) return route.continue()
    if (url.origin !== origin) {
      results.externalRequests.push(url.origin)
      return route.abort()
    }
    if (
      request.method() === 'POST' &&
      /^\/api\/(?:orders(?!\/client)|recharge|payments)/.test(url.pathname)
    ) {
      results.financialWrites.push(url.pathname)
      return route.abort()
    }
    return route.continue()
  })
  ctx.on('page', (page) =>
    page.on('pageerror', (e) => results.pageErrors.push(e.message)),
  )
  return ctx
}
async function api(ctx, url, data) {
  assert(url.startsWith('/api/admin/'))
  let response
  for (let attempt = 0; attempt < 3; attempt++) {
    response = await ctx.request.fetch(url, {
      method: data === undefined ? 'GET' : 'POST',
      headers: { Origin: origin },
      ...(data === undefined ? {} : { data }),
    })
    if (response.status() !== 429) break
    await new Promise((resolve) => setTimeout(resolve, 60000))
  }
  assert(
    [200, 201].includes(response.status()),
    'Local admin request: ' + url + ' ' + response.status(),
  )
  return response.json()
}
function emailCode() {
  const folder = path.join(root, 'artifacts/local/cloudflare/mailbox')
  for (const filename of fs
    .readdirSync(folder)
    .filter((f) => f.endsWith('.json'))
    .sort(
      (a, b) =>
        fs.statSync(path.join(folder, b)).mtimeMs -
        fs.statSync(path.join(folder, a)).mtimeMs,
    )) {
    const mail = JSON.parse(
      fs.readFileSync(path.join(folder, filename), 'utf8'),
    )
    const code =
      mail.to.includes('admin@example.invalid') && mail.text?.match(/\b\d{6}\b/)
    if (code) return code[0]
  }
  throw new Error('No local fixture email')
}
const admin = await context(false, true),
  buyer = await context(),
  mobile = await context(true)
const page = await admin.newPage(),
  front = await buyer.newPage(),
  phone = await mobile.newPage()
let original, custom
async function open() {
  await page.bringToFront()
  await page
    .getByRole('button', { name: '展示样式', exact: true })
    .first()
    .click()
  const dialog = page.getByRole('dialog').filter({
    has: page.getByRole('heading', { name: '商品展示样式', exact: true }),
  })
  await dialog.getByLabel('选择商品', { exact: true }).waitFor()
  return dialog
}
async function save(dialog) {
  const response = page.waitForResponse(
    (r) =>
      new URL(r.url()).pathname === '/api/admin/product-artwork' &&
      r.request().method() === 'POST',
  )
  await dialog
    .getByRole('button', { name: '保存展示样式', exact: true })
    .click()
  assert.equal((await response).status(), 200)
  await dialog
    .getByRole('status')
    .filter({ hasText: '展示样式已保存' })
    .waitFor()
  await dialog.getByRole('button', { name: '关闭', exact: true }).click()
  await dialog.waitFor({ state: 'hidden' })
}
try {
  await page.goto('/admin?view=plans')
  const existingSession = await admin.request.get('/api/admin/session')
  const authenticated =
    existingSession.ok() && (await existingSession.json()).authenticated
  if (!authenticated) {
    await page.locator('#admin-username').fill('dev-admin')
    const send = page.waitForResponse(
      (r) => new URL(r.url()).pathname === '/api/admin/login/email-code',
    )
    await page.getByRole('button', { name: '获取验证码', exact: true }).click()
    assert.equal((await send).status(), 200)
    await page.locator('#admin-email-code').fill(emailCode())
    await page
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
    await page.getByRole('button', { name: '登录后台', exact: true }).click()
  }
  await page.getByRole('navigation', { name: '后台导航' }).waitFor()
  await admin.storageState({ path: sessionFile })
  await page
    .getByRole('navigation', { name: '后台导航' })
    .getByRole('button', { name: '商品与套餐', exact: true })
    .click()
  original = (await api(admin, '/api/admin/product-artwork')).products.find(
    (p) => p.id === 'chatgpt',
  )
  if (original.config.template !== 'original')
    await api(admin, '/api/admin/product-artwork', {
      productId: 'chatgpt',
      version: original.version,
      config: { template: 'original', image: '' },
    })
  await front.bringToFront()
  await front.goto('/')
  await front.locator('.store-deck').waitFor()
  assert.equal(await front.locator('.store-deck [data-tier]').count(), 4)
  await front.locator('.scene-gemini').waitFor()
  await front.locator('.scene-duolingo').waitFor()
  record(
    'Main admin opens artwork management; original GPT deck and membership scenes are retained by default',
  )
  const pictures = await page.evaluate(() => {
    const c = document.createElement('canvas')
    c.width = 192
    c.height = 192
    const g = c.getContext('2d')
    g.fillStyle = '#6256cf'
    g.beginPath()
    g.roundRect(20, 20, 152, 152, 28)
    g.fill()
    g.fillStyle = 'white'
    g.font = 'bold 82px sans-serif'
    g.fillText('P', 70, 125)
    return {
      png: c.toDataURL('image/png'),
      jpg: c.toDataURL('image/jpeg', 0.9),
    }
  })
  const png = path.join(evidence, 'fixture.png'),
    jpg = path.join(evidence, 'fixture.jpg')
  fs.writeFileSync(png, Buffer.from(pictures.png.split(',')[1], 'base64'))
  fs.writeFileSync(jpg, Buffer.from(pictures.jpg.split(',')[1], 'base64'))
  await checkArtworkMaterials({
    page,
    front,
    phone,
    open,
    save,
    api,
    admin,
    evidence,
    record,
  })
  if (!process.argv.includes('--materials-only')) {
    for (const [template, label] of [
      ['static', '静态'],
      ['float', '漂浮'],
      ['zoom', '缩放'],
      ['shine', '扫光'],
      ['membership', '会员卡片'],
    ]) {
      let dialog = await open()
      await dialog
        .getByLabel('选择商品', { exact: true })
        .selectOption('chatgpt')
      if (template === 'static') {
        await dialog.getByLabel('展示图片', { exact: true }).setInputFiles(png)
        await dialog.getByAltText('当前展示图片').waitFor()
      }
      await dialog.getByRole('radio', { name: label, exact: true }).check()
      const preview = dialog.locator('[data-artwork-template]')
      assert.equal(
        await preview.getAttribute('data-artwork-template'),
        template,
      )
      await preview.scrollIntoViewIfNeeded()
      await page.waitForTimeout(850)
      await preview.screenshot({
        path: path.join(evidence, 'preview-' + template + '.png'),
      })
      await save(dialog)
      const persisted = (
        await api(admin, '/api/admin/product-artwork')
      ).products.find((p) => p.id === 'chatgpt')
      assert.equal(persisted.config.template, template)
      assert.match(persisted.config.image, /^data:image\/png/)
      dialog = await open()
      assert.equal(
        await dialog
          .getByRole('radio', { name: label, exact: true })
          .isChecked(),
        true,
      )
      assert.equal(
        await dialog.getByAltText('当前展示图片').getAttribute('src'),
        persisted.config.image,
      )
      await dialog.getByRole('button', { name: '关闭', exact: true }).click()
      await dialog.waitFor({ state: 'hidden' })
      await front.bringToFront()
      await front.goto('/')
      const card = front.getByRole('img', {
        name: 'ChatGPT商品展示图',
        exact: true,
      })
      await card.waitFor()
      assert.equal(await card.getAttribute('data-artwork-template'), template)
      await card.scrollIntoViewIfNeeded()
      await card.screenshot({
        path: path.join(evidence, 'storefront-' + template + '.png'),
      })
      await front.bringToFront()
      await front.goto('/product/chatgpt')
      const detail = front.getByRole('img', {
        name: 'ChatGPT商品展示图',
        exact: true,
      })
      await detail.waitFor()
      await detail.scrollIntoViewIfNeeded()
      await front.waitForFunction(
        () =>
          document.querySelector('.product-artwork')?.dataset.paused ===
          'false',
      )
      await front.waitForTimeout(850)
      const running = await detail.evaluate((el) =>
        el
          .getAnimations({ subtree: true })
          .filter((a) => a.playState === 'running')
          .map((a) => a.animationName),
      )
      if (template === 'static') assert.equal(running.length, 0)
      else
        assert(
          running.length > 0,
          template + ' has an actual running CSS animation',
        )
      record(
        label +
          ' template previews live, survives save/reopen and renders on both native catalogue and detail',
      )
      await front.waitForTimeout(15000)
    }
    const alpha = await page.evaluate(
      async (data) => {
        const img = new Image()
        img.src = data
        await img.decode()
        const c = document.createElement('canvas')
        c.width = 192
        c.height = 192
        const g = c.getContext('2d')
        g.drawImage(img, 0, 0)
        return g.getImageData(0, 0, 1, 1).data[3]
      },
      (await api(admin, '/api/admin/product-artwork')).products.find(
        (p) => p.id === 'chatgpt',
      ).config.image,
    )
    assert.equal(alpha, 0)
    let dialog = await open()
    await dialog.getByLabel('展示图片', { exact: true }).setInputFiles(jpg)
    await page.waitForFunction(
      () =>
        document.querySelector('[role="dialog"] button[type="submit"]') &&
        !document.querySelector('[role="dialog"] button[type="submit"]')
          .disabled,
    )
    await save(dialog)
    assert.match(
      (await api(admin, '/api/admin/product-artwork')).products.find(
        (p) => p.id === 'chatgpt',
      ).config.source,
      /^data:image\/jpeg;base64,/,
    )
    record(
      'PNG transparency is retained and a JPG upload is accepted, processed and saved',
    )
    await phone.bringToFront()
    await phone.goto('/product/chatgpt')
    const mobileArt = phone.getByRole('img', {
      name: 'ChatGPT商品展示图',
      exact: true,
    })
    await mobileArt.waitFor()
    await mobileArt.scrollIntoViewIfNeeded()
    assert.equal(
      await phone.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
      true,
    )
    await phone.screenshot({
      path: path.join(evidence, 'native-mobile.png'),
      fullPage: true,
    })
    await phone.emulateMedia({ reducedMotion: 'reduce' })
    assert.equal(
      await mobileArt.evaluate(
        (el) =>
          el
            .getAnimations({ subtree: true })
            .filter((a) => a.playState === 'running').length,
      ),
      0,
    )
    await phone.emulateMedia({ reducedMotion: 'no-preference' })
    await phone.evaluate(() => scrollTo(0, document.body.scrollHeight))
    await phone.waitForFunction(
      () =>
        document.querySelector('.product-artwork')?.dataset.paused === 'true',
    )
    record(
      '390px mobile has no overflow; reduced motion and offscreen visibility stop artwork animations',
    )
    custom = (
      await api(admin, '/api/admin/my-shop/products', {
        id: '',
        version: 0,
        status: 'published',
        name: '本机展示样式商品',
        category: '工具服务',
        tagline: '样式验收',
        description: '仅供本机展示样式验证',
        image: pictures.png,
        badge: '测试',
        unit: '份',
        duration: '展示测试规格',
        priceCents: 990,
        stock: -1,
        features: ['样式可编辑'],
        purchaseNote: '本机模拟，不发生真实付款。',
        deliveryInstructions: '本机模拟交付。',
        steps: [{ title: '查看', description: '查看商品展示。' }],
        faq: [{ question: '如何使用？', answer: '用于本机验证。' }],
        fields: [],
        delivery: 'manual',
        payment: {
          label: '本机',
          instructions: '仅测试展示，不付款。',
          url: 'https://payments.example.com/fixture',
          qr: '',
        },
      })
    ).product
    dialog = await open()
    await dialog.getByLabel('选择商品', { exact: true }).selectOption(custom.id)
    await dialog.getByLabel('展示图片', { exact: true }).setInputFiles(png)
    await dialog.getByRole('radio', { name: '会员卡片', exact: true }).check()
    await save(dialog)
    await front.bringToFront()
    await front.goto('/product/' + custom.id)
    await front
      .getByRole('img', { name: custom.name + '商品展示图', exact: true })
      .waitFor()
    await phone.bringToFront()
    await phone.goto('/product/' + custom.id)
    await phone
      .getByRole('img', { name: custom.name + '商品展示图', exact: true })
      .waitFor()
    assert.equal(
      await phone.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
      true,
    )
    await phone.waitForTimeout(850)
    await phone.screenshot({
      path: path.join(evidence, 'custom-mobile.png'),
      fullPage: true,
    })
    record(
      'Self-published products use the same saved artwork on desktop and mobile detail pages',
    )
  }
  const current = (
    await api(admin, '/api/admin/product-artwork')
  ).products.find((p) => p.id === 'chatgpt')
  await api(admin, '/api/admin/product-artwork', {
    productId: 'chatgpt',
    version: current.version,
    config: { template: 'original', image: '' },
  })
  await front.bringToFront()
  await front.goto('/')
  await front.locator('.store-deck').waitFor()
  assert.equal(await front.locator('.store-deck [data-tier]').count(), 4)
  record(
    'Restoring original artwork brings back the existing GPT animated deck',
  )
  assert.equal(
    (await buyer.request.get('/api/admin/product-artwork')).status(),
    401,
  )
  assert.deepEqual(results.pageErrors, [])
  assert.deepEqual(results.externalRequests, [])
  assert.deepEqual(results.financialWrites, [])
  record(
    'Management is protected; browser has zero page errors, external requests or payment/procurement writes',
  )
  results.passed = true
} catch (error) {
  results.passed = false
  results.failure = error.message
  await page
    .screenshot({
      path: path.join(evidence, 'admin-failure.png'),
      fullPage: true,
    })
    .catch(() => {})
  await front
    .screenshot({
      path: path.join(evidence, 'front-failure.png'),
      fullPage: true,
    })
    .catch(() => {})
  results.frontDiagnostic = await front
    .evaluate(() => ({
      hidden: document.hidden,
      frame: document
        .querySelector('.product-artwork')
        ?.outerHTML.slice(0, 300),
    }))
    .catch(() => null)
  throw error
} finally {
  try {
    if (original) {
      const current = (
        await api(admin, '/api/admin/product-artwork')
      ).products.find((p) => p.id === 'chatgpt')
      await api(admin, '/api/admin/product-artwork', {
        productId: 'chatgpt',
        version: current.version,
        config: original.config,
      }).catch(() => {})
    }
    const cleanup = (
      await api(admin, '/api/admin/my-shop/products')
    ).products.filter(
      (p) =>
        p.name === '本机展示样式商品' &&
        p.description === '仅供本机展示样式验证',
    )
    for (const p of cleanup)
      if (p.status !== 'archived')
        await api(admin, '/api/admin/my-shop/products', {
          ...p,
          status: 'archived',
        }).catch(() => {})
    if (results.passed) {
      await api(admin, '/api/admin/logout', {})
      if (fs.existsSync(sessionFile)) fs.unlinkSync(sessionFile)
    }
  } catch (error) {
    results.cleanupError = error.message
    results.passed = false
    process.exitCode = 1
  }
  fs.writeFileSync(
    path.join(evidence, 'result.json'),
    JSON.stringify(results, null, 2) + '\n',
  )
  await browser.close()
}
