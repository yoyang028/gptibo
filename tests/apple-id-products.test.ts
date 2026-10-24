import test from 'node:test'
import assert from 'node:assert/strict'
import { APPLE_ID_REGION_GROUPS, appleIdVariants, appleIdRegionGroup, appleIdVariantNote } from '../shared/apple-id-products.ts'
import { hanfolkBuyerCopy, SourceCopyChanged } from '../shared/hanfolk-buyer-copy.ts'
import { hanfolkDraft, importHanfolkDrafts } from '../worker/hanfolk/importer.ts'
import type { HanfolkDetail } from '../shared/hanfolk-catalog.ts'
import { APPLE_ID_GUIDE } from '../shared/storefront-guides.ts'
import { productCopyLinks } from '../shared/product-copy.ts'
import { readStorefrontPage, storefrontHref, canonicalStorefrontUrl } from '../src/lib/storefront-routing.ts'
import { customerFixture } from './customer-fixture.ts'

// Synthetic prices/stocks, with the source's verified region and SKU structure.
export const appleSources: HanfolkDetail[] = [
  [15, '美国'], [16, '美国'], [50, '香港'], [14, '日本'], [4, '土耳其'], [5, '尼日利亚'],
].map(([id, region]) => ({
  id: Number(id), title: region + ' Apple ID ' + (id === 16 ? '已购小火箭独享成品' : '带密保可改密'),
  description: region + '区独享账号，附密保资料。' + (id === 16 ? '可用于下载 Shadowrocket。' : ''),
  cover: 'https://example.com/apple.svg', price: 2, stock: 0, is_sku: id !== 16,
  specs: id === 16 ? [] : [{ title: '账号', values: [{ id: '13', name: '新号（已养号1月以上）' }, { id: '14', name: '老号（注册时间5年以上）' }] }],
  sku_variants: id === 16 ? [{ sku: '0', price: 2, stock: 0 }] : [{ sku: '13', price: 2, stock: 2 }, { sku: '14', price: 3, stock: 0 }],
  require_inputs: [], min_qty: 1, max_qty: 0,
})) as HanfolkDetail[]

test('Apple region grouping sorts explicit source types without mutating prices, stock or the input', async () => {
  const products = (await Promise.all(appleSources.map(d => Promise.all(d.sku_variants.map(v => hanfolkDraft(d, v.sku)))))).flat()
  const before = structuredClone(products), sorted = appleIdVariants([...products].reverse())
  assert.deepEqual(APPLE_ID_REGION_GROUPS.map(g => g.name), ['美国', '香港', '日本', '其他'])
  assert.deepEqual(sorted.map(p => appleIdRegionGroup(p)), ['us','us','us','hk','hk','jp','jp','other','other','other','other'])
  assert.match(sorted[0].name, /美国.*新号/)
  assert.match(sorted[1].name, /美国.*老号/)
  assert.match(sorted[2].name, /Shadowrocket/)
  assert.match(sorted[7].name, /土耳其.*新号/)
  assert.match(appleIdVariantNote(sorted[0]), /已养号1月以上/)
  assert.equal(appleIdRegionGroup({ name: '未注明地区的 Apple ID' }), 'other')
  assert.deepEqual(products, before)
})

test('Apple buyer profiles keep delivery, account age, app rights and warranty separate', () => {
  for (const d of appleSources) for (const v of d.sku_variants) {
    const p = hanfolkBuyerCopy(d, v.sku), text = JSON.stringify(p)
    assert.match(p.description, /无需前往卡密兑换站/)
    assert.match(p.purchaseNote, /3 天.*质量保障/)
    assert.match(p.purchaseNote, /质保期内保留原登录邮箱/)
    assert.match(text, /媒体与购买项目/)
    assert.match(text, /原下载\/购买账号|原 App 的下载\/购买记录/)
    assert.match(text, /备份/)
    assert.doesNotMatch(text, /暂未|未开放|待核实|上游|永久|保证恢复/)
    assert(productCopyLinks(p.description).some(p => p.href === APPLE_ID_GUIDE))
    if (d.id === 16) assert.match(p.description, /这档账号含 Shadowrocket 已购记录/)
    else assert.match(p.description, /时间不是会员时长/)
  }
  assert.throws(() => hanfolkBuyerCopy({ ...appleSources[0], description: '改为香港共享账号' }, '13'), SourceCopyChanged)
})

test('Reviewed Apple guide links preserve storefront attribution and reject arbitrary internal paths', () => {
  for (const base of ['', '/s/my-shop', '/r/ABC123']) {
    const location = { pathname: base + '/product/apple-id', search: '?source=friend', hash: '' }
    assert.equal(storefrontHref('guides/apple-id', location), base + '/guides/apple-id?source=friend')
    assert.equal(readStorefrontPage({ ...location, pathname: base + APPLE_ID_GUIDE, hash: '#guide' }), 'guides/apple-id')
    assert.equal(canonicalStorefrontUrl({ ...location, pathname: base + APPLE_ID_GUIDE, hash: '#guide' }), null)
  }
  assert.equal(productCopyLinks('[教程](/guides/apple-id)').find(p => p.href)?.href, APPLE_ID_GUIDE)
  for (const path of ['/guides/arbitrary', '/guides/apple-id/redirect', '//evil.example/path', '/api/admin']) assert(!productCopyLinks(`[link](${path})`).some(p => p.href))
})

test('Zero-stock missing Apple SKU imports privately, preserves existing retail and cannot purchase', async () => {
  const f = await customerFixture(), d = appleSources.find(d => d.id === 4)!
  f.db.prepare('INSERT INTO hanfolk_catalog(product_id,summary,detail,key_hash,checked_at) VALUES(?,?,?,?,?)').run(d.id, JSON.stringify(d), JSON.stringify(d), '', Date.now())
  const result = await importHanfolkDrafts(f.env, [d], [{ productId: 4, sku: '13' }, { productId: 4, sku: '14' }])
  assert.equal(result.imported.length, 2)
  const p = await hanfolkDraft(d, '13'), old = await hanfolkDraft(d, '14')
  const saved = await f.request('/api/admin/my-shop/products', { ...p, status: 'listed', priceCents: 2800, pricePending: false }, f.admin)
  assert.equal(saved.status, 200)
  assert.deepEqual(await importHanfolkDrafts(f.env, [d], [{ productId: 4, sku: '13' }, { productId: 4, sku: '14' }]), { imported: [], existing: [p.id, old.id] })
  const catalog = await (await f.request('/api/catalog')).json() as { products: { id: string; priceCents: number }[] }
  assert.equal(catalog.products.find(v => v.id === p.id)?.priceCents, 2800)
  assert(!catalog.products.some(v => v.id === old.id))
  const row = f.db.prepare('SELECT public_json FROM shop_products WHERE id=?').get(old.id)!
  const stored = JSON.parse(row.public_json as string)
  assert.equal(stored.pricePending, true); assert.equal(stored.status, 'draft'); assert.equal(stored.stock, 0)
  const client = await f.request('/api/orders/client', {}), cookie = client.headers.get('Set-Cookie')!.split(';')[0]
  assert.equal((await f.request('/api/orders', { plan: old.id, email: 'buyer@example.test', fields: {}, key: crypto.randomUUID() }, cookie)).status, 409)
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM orders').get()!.n, 0)
})
