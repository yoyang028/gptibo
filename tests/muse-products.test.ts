import test from 'node:test'
import assert from 'node:assert/strict'
import { hanfolkDraft } from '../worker/hanfolk/importer.ts'
import type { HanfolkDetail } from '../shared/hanfolk-catalog.ts'
import { groupShopProducts, productProblems } from '../shared/shop-products.ts'
import { museKind, museVariants, MUSE_GUIDE_PATHS } from '../shared/muse-products.ts'
import { MUSE_EMAIL_STEPS } from '../shared/muse-guides.ts'
import { productCopyLinks } from '../shared/product-copy.ts'
import { publicBuyerProduct } from '../shared/redemption-copy.ts'
import { readStorefrontPage, storefrontHref } from '../src/lib/storefront-routing.ts'
import { customerFixture } from './customer-fixture.ts'
import { importHanfolkDrafts } from '../worker/hanfolk/importer.ts'

const source: HanfolkDetail = {
  id: 57, title: 'Muse成品账户（带有1B-31B Muse词元）', description: 'Muse 成品账号，10亿、50亿、100亿、310亿词元可选，附收件入口，可改邮箱。',
  price: 8, stock: 28, sales: 0, is_auto: true, is_sku: true, cover: 'https://example.com/fixture.png', sort_id: 0, min_qty: 1, max_qty: 0,
  specs: [{ title: '词元数量', values: ['10亿', '50亿', '100亿', '310亿'].map((name, i) => ({ id: String(61 + i), name })) }],
  sku_variants: ['61', '62', '63', '64'].map((sku, i) => ({ sku, price: 8 + i * 10, stock: [20, 5, 0, 3][i] })), required_inputs: [],
}
const invitation: HanfolkDetail = { ...source, id: 69, title: 'Muse账户 · 词元邀请（3元/1B）', description: '', is_sku: false, specs: [], sku_variants: [{ sku: '0', price: 3, stock: 99 }] }

test('Muse imports all four exact account SKUs including depleted stock, without copying source prices into retail', async () => {
  const accounts = await Promise.all(source.sku_variants.map(v => hanfolkDraft(source, v.sku)))
  assert.equal(new Set(accounts.map(p => p.id)).size, 4)
  assert.equal(accounts[2].stock, 0)
  for (const [i, product] of accounts.entries()) {
    assert.equal(product.museKind, 'account')
    assert.equal(product.pricePending, true)
    assert.equal(product.priceCents, 1)
    assert.deepEqual(productProblems(product), [])
    assert.match(product.description, /1B = 10 亿词元/)
    assert.match(product.purchaseNote, /18 岁|18岁/)
    assert.match(product.purchaseNote, /仅保障首次登录/)
    assert.doesNotMatch(product.purchaseNote, /无限|永久|30 天质保/)
    assert.match(product.deliveryInstructions, /独立.*成品账号.*收件/)
    assert.match(product.name, new RegExp(source.specs[0].values[i].name))
  }
  const both = [...accounts.reverse(), await hanfolkDraft(invitation, '0')]
  assert.equal(groupShopProducts(both).length, 1)
  assert.deepEqual(museVariants(both, 'account').map(p => p.stock), [20, 5, 0, 3])
  assert.equal(museVariants(both, 'invitation').length, 1)
})

test('Invitation metadata and editorial copy do not claim a live task API or reuse account first-login warranty', async () => {
  const product = await hanfolkDraft(invitation, '0')
  assert.equal(product.museKind, 'invitation')
  assert.equal(product.pricePending, true)
  assert.equal(product.status, 'draft')
  assert.deepEqual(productProblems(product), [])
  assert.match(product.description, /暂未开放下单/)
  assert.match(product.description, /6 位邀请码/)
  assert.doesNotMatch(product.purchaseNote, /首次登录|首登保障/)
  assert.doesNotMatch(JSON.stringify(publicBuyerProduct(product)), /dajuxai\.com|¥3|3元/)
  assert.equal(product.requiresRedemption, undefined)
  assert.deepEqual(product.fields, [])
  assert.equal(museKind({ groupId: 'muse', name: 'Muse 成品账号' }), 'account')
  assert.equal(museKind({ groupId: 'gmail', name: '邀请' }), undefined)
  assert(productProblems({ ...product, museKind: 'bad' as 'account' }).includes('Muse 商品类型'))
  assert(productProblems({ ...product, groupId: 'gmail' }).includes('Muse 商品类型'))
})

test('Both tutorials support direct reloads, anchors and partner shop attribution', () => {
  for (const path of MUSE_GUIDE_PATHS) for (const prefix of ['', '/s/my-shop', '/r/ABC123']) {
    const current = { pathname: prefix + path, search: '?source=friend', hash: '#remove-old' }
    assert.equal(readStorefrontPage(current), path.slice(1))
    assert.equal(storefrontHref(path.slice(1), current), prefix + path + '?source=friend')
    assert.equal(storefrontHref('product/muse', current), prefix + '/product/muse?source=friend')
  }
  assert.equal(readStorefrontPage({ pathname: '/guides/unapproved', search: '', hash: '' }), 'store')
})

test('Editorial links allow only the two reviewed local guides, without accepting arbitrary relative redirects', () => {
  for (const href of MUSE_GUIDE_PATHS) assert.equal(productCopyLinks(`[教程](${href})`).find(p => p.href)?.href, href)
  for (const href of ['//evil.example.com', '/admin', '/guides/../admin', '/guides/muse-change-email?redirect=evil', '/%2f%2fevil.example.com']) {
    assert.equal(productCopyLinks(`[教程](${href})`).filter(p => p.href).length, 0)
  }
})

test('Email guide explicitly tests the same account before choosing or deleting old contact information', () => {
  assert.equal(MUSE_EMAIL_STEPS.length, 15)
  assert.match(MUSE_EMAIL_STEPS[11].text, /无痕窗口.*同一个账号/)
  assert.match(MUSE_EMAIL_STEPS[12].text, /旧地址.*不是.*新邮箱/)
  assert.match(MUSE_EMAIL_STEPS[13].text, /未完成测试.*Cancel/)
  assert.match(MUSE_EMAIL_STEPS[14].text, /新邮箱仍在.*旧邮箱已消失/)
})

test('Admin persists both Muse types, all five source links and public preview without enabling sales or changing priced specs', async () => {
  const f = await customerFixture()
  const before = f.db.prepare('SELECT id,price_cents,enabled FROM catalog_plans ORDER BY id').all()
  for (const d of [source, invitation]) f.db.prepare('INSERT INTO hanfolk_catalog(product_id,summary,detail,key_hash,checked_at) VALUES(?,?,?,?,?)').run(d.id, JSON.stringify(d), JSON.stringify(d), '', Date.now())
  await importHanfolkDrafts(f.env, [source, invitation], [...source.sku_variants.map(v => ({ productId: 57, sku: v.sku })), { productId: 69, sku: '0' }])
  for (const d of [source, invitation]) for (const sku of d.sku_variants) {
    const p = await hanfolkDraft(d, sku.sku)
    const priced = sku.sku === '61'
    const saved = await f.request('/api/admin/my-shop/products', { ...p, status: 'listed', catalogPreview: true, ...(priced ? { priceCents: 3800, pricePending: false } : {}) }, f.admin)
    assert.equal(saved.status, 200, await saved.text())
  }
  const data = await (await f.request('/api/catalog')).json() as { products: typeof source[] }
  const products = data.products as unknown as Awaited<ReturnType<typeof hanfolkDraft>>[]
  const muse = products.filter(p => p.groupId === 'muse')
  assert.equal(muse.length, 5)
  assert.equal(muse.filter(p => p.museKind === 'account').length, 4)
  assert.equal(muse.find(p => p.name.includes('100亿'))?.stock, 0)
  const existing = muse.find(p => p.id === (f.db.prepare("SELECT local_id FROM hanfolk_product_links WHERE product_id=57 AND sku='61'").get()!.local_id))!
  assert.equal(existing.priceCents, 3800)
  const adminData = await (await f.request('/api/admin/my-shop/products', undefined, f.admin)).json() as { products: typeof muse }
  const invite = adminData.products.find(p => p.museKind === 'invitation')!
  assert(invite)
  assert.equal((await f.request('/api/admin/my-shop/products', { ...invite, status: 'published' }, f.admin)).status, 409)
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM catalog_plans WHERE product_id=\'muse\' AND enabled<>0').get()!.n, 0)
  for (const row of before) assert.deepEqual(f.db.prepare('SELECT id,price_cents,enabled FROM catalog_plans WHERE id=?').get(row.id), row)
})
