import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

// Invoked only by the fixed-local-origin, no-payment browser harness.
export async function checkArtworkMaterials({
  page,
  front,
  phone,
  open,
  save,
  api,
  admin,
  evidence,
  record,
}) {
  const fixtures = await page.evaluate(() => {
    const c = document.createElement('canvas')
    c.width = c.height = 256
    const g = c.getContext('2d')
    g.fillStyle = '#fff'
    g.fillRect(0, 0, 256, 256)
    const gradient = g.createLinearGradient(64, 64, 192, 192)
    gradient.addColorStop(0, '#315bef')
    gradient.addColorStop(1, '#a653d3')
    g.fillStyle = gradient
    g.beginPath()
    g.roundRect(64, 64, 128, 128, 24)
    g.fill()
    g.strokeStyle = '#fff'
    g.lineWidth = 9
    g.lineCap = 'round'
    g.lineJoin = 'round'
    g.beginPath()
    g.moveTo(99, 104)
    g.lineTo(117, 122)
    g.lineTo(99, 140)
    g.stroke()
    g.fillStyle = '#fff'
    g.fillRect(126, 132, 29, 9)
    const gradientPng = c.toDataURL('image/png')
    g.clearRect(0, 0, 256, 256)
    g.fillStyle = '#315bef'
    g.fillRect(64, 64, 128, 128)
    g.fillStyle = '#fff'
    g.fillRect(108, 108, 40, 40)
    return { gradient: gradientPng, simple: c.toDataURL('image/png') }
  })
  for (const [name, value] of Object.entries(fixtures))
    fs.writeFileSync(
      path.join(evidence, name + '.png'),
      Buffer.from(value.split(',')[1], 'base64'),
    )
  let dialog = await open()
  await dialog.getByLabel('选择商品', { exact: true }).selectOption('chatgpt')
  await dialog
    .getByLabel('展示图片', { exact: true })
    .setInputFiles(path.join(evidence, 'gradient.png'))
  await dialog
    .getByRole('status')
    .filter({ hasText: '已清理外围背景' })
    .waitFor()
  const readImage = () =>
    dialog.getByAltText('当前展示图片').getAttribute('src')
  const cleaned = await readImage()
  const samples = await page.evaluate(
    async ({ source, result }) => {
      async function pixels(value, points) {
        const i = new Image()
        i.src = value
        await i.decode()
        const c = document.createElement('canvas')
        c.width = i.width
        c.height = i.height
        const g = c.getContext('2d')
        g.drawImage(i, 0, 0)
        return {
          width: i.width,
          height: i.height,
          samples: points.map(([x, y]) => [...g.getImageData(x, y, 1, 1).data]),
        }
      }
      return {
        original: await pixels(source, [
          [80, 80],
          [140, 136],
        ]),
        processed: await pixels(result, [
          [0, 0],
          [20, 20],
          [80, 76],
        ]),
      }
    },
    { source: fixtures.gradient, result: cleaned },
  )
  assert.equal(samples.processed.width, 136)
  assert.equal(samples.processed.height, 136)
  assert.equal(samples.processed.samples[0][3], 0)
  assert.deepEqual(samples.processed.samples[1], samples.original.samples[0])
  assert.deepEqual(samples.processed.samples[2], [255, 255, 255, 255])
  await dialog
    .getByRole('button', { name: '还原上传原图', exact: true })
    .click()
  assert.equal(await readImage(), fixtures.gradient)
  await dialog.getByRole('button', { name: '撤销上一步', exact: true }).click()
  assert.equal(await readImage(), cleaned)
  await dialog
    .getByRole('checkbox', { name: '清理外围背景', exact: true })
    .uncheck()
  await dialog
    .getByRole('status')
    .filter({ hasText: '外围清理已关闭' })
    .waitFor()
  assert.equal(await readImage(), fixtures.gradient)
  await dialog.getByRole('button', { name: '撤销上一步', exact: true }).click()
  assert.equal(await readImage(), cleaned)
  await dialog.getByRole('button', { name: '尝试矢量化', exact: true }).click()
  await dialog.getByRole('status').filter({ hasText: '未强制矢量化' }).waitFor()
  assert.equal(
    await dialog
      .locator('.artwork-preview-panel svg[data-artwork-format="vector"]')
      .count(),
    0,
  )
  record(
    'Automatic perimeter cleaning/crop preserves enclosed white Codex-like symbols and exact blue-purple gradient pixels; compare/restore/undo work, complex images stay raster',
  )
  await dialog.getByRole('radio', { name: '漂浮', exact: true }).check()
  for (const [label, value] of [
    ['主体大小', '115'],
    ['水平位置', '-6'],
    ['垂直位置', '-3'],
  ])
    await dialog.getByRole('slider', { name: new RegExp(label) }).fill(value)
  await dialog.getByLabel('卡片背景', { exact: true }).selectOption('halo')
  await dialog.getByLabel('背景颜色', { exact: true }).fill('#e3dcff')
  await dialog.getByLabel('主体底托', { exact: true }).selectOption('disc')
  await dialog.getByLabel('底托颜色', { exact: true }).fill('#b9a9ea')
  const preview = dialog.locator('.artwork-preview-panel .product-artwork')
  await preview.scrollIntoViewIfNeeded()
  await page.waitForTimeout(850)
  await dialog
    .locator('[aria-label="素材处理前后对比"]')
    .screenshot({ path: path.join(evidence, 'material-comparison.png') })
  await preview.screenshot({
    path: path.join(evidence, 'material-preview.png'),
  })
  const signature = async (locator) =>
    locator.evaluate((el) => {
      const visual = el.querySelector('.artwork-visual'),
        placement = el.querySelector('.artwork-placement')
      const s = getComputedStyle(visual)
      return {
        template: el.dataset.artworkTemplate,
        image: el.querySelector('img.artwork-image')?.getAttribute('src'),
        transform: getComputedStyle(placement).transform,
        background: s.backgroundImage,
        base: el.querySelector('.artwork-pedestal')?.className,
        color: s.getPropertyValue('--artwork-pedestal'),
      }
    })
  const shown = await signature(preview)
  await save(dialog)
  const persisted = (
    await api(admin, '/api/admin/product-artwork')
  ).products.find((p) => p.id === 'chatgpt').config
  assert.equal(persisted.source, fixtures.gradient)
  assert.equal(persisted.image, cleaned)
  assert.equal(persisted.layout.scale, 115)
  assert.equal(persisted.layout.x, -6)
  assert.equal(persisted.layout.y, -3)
  assert.equal(persisted.layout.backgroundColor, '#e3dcff')
  assert.equal(persisted.layout.pedestalColor, '#b9a9ea')
  dialog = await open()
  assert.equal(
    await dialog.getByRole('slider', { name: /主体大小/ }).inputValue(),
    '115',
  )
  assert.equal(
    await dialog.getByAltText('处理前原图').getAttribute('src'),
    fixtures.gradient,
  )
  assert.equal(await readImage(), cleaned)
  await dialog.getByRole('button', { name: '关闭', exact: true }).click()
  const catalog = await (await front.request.get('/api/catalog')).json()
  assert.equal(catalog.productArtwork.chatgpt.source, undefined)
  assert.equal(catalog.productArtwork.chatgpt.processing, undefined)
  for (const url of ['/', '/product/chatgpt']) {
    await front.bringToFront()
    await front.goto(url)
    const art = front.getByRole('img', {
      name: 'ChatGPT商品展示图',
      exact: true,
    })
    await art.scrollIntoViewIfNeeded()
    await front.waitForTimeout(850)
    const actual = await signature(art)
    assert.equal(actual.image, shown.image)
    assert.equal(actual.template, shown.template)
    assert.equal(actual.base, shown.base)
    assert.equal(actual.color, shown.color)
    assert.equal(actual.background, shown.background)
    const transforms = await art
      .locator('.artwork-visual')
      .evaluate((el) =>
        ['--artwork-scale', '--artwork-x', '--artwork-y'].map((k) =>
          getComputedStyle(el).getPropertyValue(k),
        ),
      )
    assert.deepEqual(transforms, ['1.15', '-6%', '-3%'])
    if (url === '/')
      await art.screenshot({
        path: path.join(evidence, 'material-storefront.png'),
      })
  }
  await phone.bringToFront()
  await phone.goto('/product/chatgpt')
  const mobileArt = phone.getByRole('img', {
    name: 'ChatGPT商品展示图',
    exact: true,
  })
  await mobileArt.scrollIntoViewIfNeeded()
  await phone.waitForTimeout(850)
  assert.equal((await signature(mobileArt)).image, cleaned)
  assert(
    await phone.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  )
  await mobileArt.screenshot({
    path: path.join(evidence, 'material-mobile.png'),
  })
  record(
    'Material, source copy, size/position/background/pedestal save and reopen; identical finished image and settings render on catalogue, detail and 390px mobile; originals stay admin-only',
  )
  await page.bringToFront()
  dialog = await open()
  await dialog
    .getByLabel('展示图片', { exact: true })
    .setInputFiles(path.join(evidence, 'simple.png'))
  await dialog
    .getByRole('status')
    .filter({ hasText: '已保留透明背景' })
    .waitFor()
  await dialog.getByRole('button', { name: '尝试矢量化', exact: true }).click()
  await dialog
    .getByRole('status')
    .filter({ hasText: '已生成纯色矢量轮廓' })
    .waitFor()
  assert.equal(
    await dialog
      .locator('.artwork-preview-panel svg[data-artwork-format="vector"] path')
      .count(),
    2,
  )
  await save(dialog)
  dialog = await open()
  await dialog.getByRole('button', { name: '使用位图', exact: true }).waitFor()
  assert.equal(
    await dialog
      .locator('.artwork-preview-panel svg[data-artwork-format="vector"] path')
      .count(),
    2,
  )
  await dialog.getByRole('button', { name: '关闭', exact: true }).click()
  await front.bringToFront()
  await front.goto('/product/chatgpt')
  const vector = front.locator(
    '.product-artwork svg[data-artwork-format="vector"]',
  )
  await vector.waitFor()
  assert.equal(await vector.locator('path').count(), 2)
  assert.deepEqual(
    (
      await vector
        .locator('path')
        .evaluateAll((nodes) => nodes.map((n) => n.getAttribute('fill')))
    ).sort(),
    ['#315bef', '#ffffff'],
  )
  record(
    'Optional solid-colour vector logo retains its white symbol and blue fill through save/reopen and public SVG rendering, without uploaded SVG or AI',
  )
  await page.bringToFront()
  dialog = await open()
  await dialog.getByRole('button', { name: '使用位图', exact: true }).click()
  assert.equal(
    await dialog
      .locator('.artwork-preview-panel svg[data-artwork-format="vector"]')
      .count(),
    0,
  )
  await dialog.getByRole('button', { name: '撤销上一步', exact: true }).click()
  assert.equal(
    await dialog
      .locator('.artwork-preview-panel svg[data-artwork-format="vector"]')
      .count(),
    1,
  )
  await dialog.getByRole('button', { name: '使用位图', exact: true }).click()
  await dialog
    .getByRole('button', { name: '主体大小与位置复位', exact: true })
    .click()
  await page.setViewportSize({ width: 390, height: 844 })
  await dialog.getByRole('button', { name: '手机', exact: true }).click()
  await dialog.locator('.artwork-preview-panel').scrollIntoViewIfNeeded()
  assert(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  )
  const bounds = await dialog.boundingBox()
  assert(bounds.width <= 390 && bounds.x >= 0)
  await page.screenshot({
    path: path.join(evidence, 'material-admin-mobile.png'),
  })
  await page.setViewportSize({ width: 1440, height: 1040 })
  await save(dialog)
  record(
    'Vector-to-bitmap switching and undo preserve source data; layout reset and mobile admin preview work without overflow',
  )
  await page.waitForTimeout(15000)
}
