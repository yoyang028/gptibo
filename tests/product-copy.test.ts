import assert from 'node:assert/strict'
import test from 'node:test'
import { productCopyBlocks, productCopyLinks, DELIVERY_COPY_HEADING } from '../shared/product-copy.ts'
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

test('Reviewed supplier copy cannot silently become a price, checkout or procurement update', () => {
  const all = [claudeProductCopy('pro'), claudeProductCopy('max5x'), claudeProductCopy('max20x'), ...([250, 500, 1000, 2500] as const).map(codexCreditsProductCopy)]
  const allowed = ['tagline', 'description', 'duration', 'features', 'purchaseNote', 'deliveryInstructions', 'steps', 'faq'].sort()
  for (const copy of all) {
    assert.deepEqual(Object.keys(copy).sort(), allowed)
    assert(copy.description.length <= 4000)
    assert.equal(productCopyBlocks(copy.description).filter(b => b.title === DELIVERY_COPY_HEADING).length, 1)
    assert.match(copy.description, /当前暂停售卖/)
    assert.match(copy.description, /待核实信息/)
    assert.match(copy.description, /尚未.*充值验证/)
    assert.match(copy.deliveryInstructions, /https:\/\/982xj\.xyz\//)
    assert.equal(copy.steps.length, 4)
  }
})

test('Supplier warranty conflicts stay tier-specific and are not resolved into a guarantee', () => {
  for (const tier of ['pro', 'max20x'] as const) assert.match(claudeProductCopy(tier).description, /30 天.*29 天.*冲突/)
  assert.doesNotMatch(claudeProductCopy('max5x').description, /29 天/)
  for (const amount of [250, 500, 1000, 2500] as const) {
    const copy = codexCreditsProductCopy(amount)
    assert.match(copy.description, /Free 账号不能/)
    assert.match(copy.description, /有效期.*待核实/)
    assert.match(copy.features[0], new RegExp(String(amount)))
  }
})
