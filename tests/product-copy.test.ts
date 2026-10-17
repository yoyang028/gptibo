import assert from 'node:assert/strict'
import test from 'node:test'
import { productCopyBlocks, productCopyLinks } from '../shared/product-copy.ts'
import { claudeProductCopy, codexCreditsProductCopy } from '../shared/xiaojiu-product-copy.ts'

test('Buyer copy keeps plain text and only promotes headings with a body', () => {
  assert.deepEqual(productCopyBlocks('Plain text\r\n\r\n### Details\r\nLine one\r\nLine two\r\n\r\n### No body'), [
    { title: '', text: 'Plain text' },
    { title: 'Details', text: 'Line one\nLine two' },
    { title: '', text: '### No body' },
  ])
})

test('Buyer copy accepts explicit public HTTPS references without rendering images or HTML', () => {
  const text = '<script>window.copyExecuted=true</script> ![image](https://example.com/p.png) [reference](https://example.com/read)'
  const parts = productCopyLinks(text)
  assert.deepEqual(parts.filter(p => p.href), [{ text: 'reference', href: 'https://example.com/read' }])
  assert(parts.filter(p => !p.href).map(p => p.text).join('').includes('![image](https://example.com/p.png)'))
  assert(parts.some(p => p.text.includes('<script>')))
})

test('Buyer copy rejects unsafe link targets and preserves the visible author text', () => {
  for (const url of ['javascript:alert(1)', 'data:text/html,test', '//example.com/', 'http://example.com/', 'https://user:secret@example.com/', 'https://localhost/', 'https://127.0.0.1/', 'https://service.invalid/', 'https://example.com/#secret']) {
    const text = `[reference](${url})`
    const parts = productCopyLinks(text)
    assert.equal(parts.filter(p => p.href).length, 0, url)
    assert.equal(parts.map(p => p.text).join(''), text)
  }
})

test('Public buyer copy contains no operational research or private redemption destinations', () => {
  const all = [claudeProductCopy('pro'), claudeProductCopy('max5x'), claudeProductCopy('max20x'), ...([250, 500, 1000, 2500] as const).map(codexCreditsProductCopy)]
  const allowed = ['tagline', 'description', 'duration', 'features', 'purchaseNote', 'deliveryInstructions', 'steps', 'faq'].sort()
  for (const copy of all) {
    assert.deepEqual(Object.keys(copy).sort(), allowed)
    assert(copy.description.length <= 4000)
    assert.doesNotMatch(JSON.stringify(copy), /上游|待核实|待确认|信息来源|https?:\/\/|982xj|98-xj|29 天|30 天/)
    assert.match(copy.deliveryInstructions, /付款确认.*原订单.*兑换码.*兑换入口/)
    assert.equal(copy.steps.length, 3)
  }
})

test('Buyer copy keeps account conditions and tier differences without inventing validity promises', () => {
  for (const tier of ['pro', 'max5x', 'max20x'] as const) {
    const copy = claudeProductCopy(tier)
    assert.match(copy.description, /KYC/)
    assert.match(copy.description, /Claude Code/)
    assert.match(copy.purchaseNote, /账号封禁/)
  }
  assert.match(claudeProductCopy('max5x').features[0], /5 倍/)
  assert.match(claudeProductCopy('max20x').features[0], /20 倍/)
  for (const amount of [250, 500, 1000, 2500] as const) {
    const copy = codexCreditsProductCopy(amount)
    assert.match(copy.description, /Free 账号不适用/)
    assert.match(copy.description, /有效期以账号显示为准/)
    assert.match(copy.features[0], new RegExp(String(amount)))
  }
})
