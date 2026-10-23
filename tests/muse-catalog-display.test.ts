import test from 'node:test'
import assert from 'node:assert/strict'
import { customerFixture } from './customer-fixture.ts'
import { hanfolkDraft, importHanfolkDrafts } from '../worker/hanfolk/importer.ts'
import { createCustomOrder } from '../worker/shop-products.ts'
import { hash } from '../worker/platform.ts'
import { museInvitationCopy } from '../shared/muse-buyer-copy.ts'
import { museVariants } from '../shared/muse-products.ts'
import { productSupplier } from '../shared/admin-suppliers.ts'
import type { HanfolkDetail } from '../shared/hanfolk-catalog.ts'
import type { ShopProduct } from '../shared/shop-products.ts'

const account: HanfolkDetail = {
  id: 57, title: 'Muse成品账户', description: 'Muse 成品账号，10亿、50亿、100亿、310亿词元可选，附收件入口，可改邮箱。',
  price: 1, stock: 24, sales: 0, is_auto: true, is_sku: true, cover: 'https://example.com/fixture.png', sort_id: 0, min_qty: 1, max_qty: 0,
  specs: [{ title: '词元数量', values: ['10亿词元', '50亿词元', '100亿词元', '310亿词元'].map((name, i) => ({ id: String(61 + i), name })) }],
  sku_variants: ['61', '62', '63', '64'].map((sku, i) => ({ sku, price: i + 1, stock: [12, 10, 0, 2][i] })), required_inputs: [],
}
const invitation: HanfolkDetail = { ...account, id: 69, title: 'Muse账户 · 词元邀请', description: '', specs: [], is_sku: false, sku_variants: [{ sku: '0', price: 3, stock: 99 }] }

test('Eight priced Muse variants persist across public/admin catalogs, without fake source mappings or purchase access', async () => {
  const f = await customerFixture()
  const existing = f.db.prepare('SELECT id,price_cents,enabled FROM catalog_plans ORDER BY id').all()
  for (const d of [account, invitation]) f.db.prepare('INSERT INTO hanfolk_catalog(product_id,summary,detail,key_hash,checked_at) VALUES(?,?,?,?,?)').run(d.id, JSON.stringify(d), JSON.stringify(d), '', Date.now())
  const selection = [...account.sku_variants.map(s => ({ productId: 57, sku: s.sku })), { productId: 69, sku: '0' }]
  await importHanfolkDrafts(f.env, [account, invitation], selection)
  const variants: ShopProduct[] = []
  async function save(p: ShopProduct) {
    const r = await f.request('/api/admin/my-shop/products', p, f.admin)
    assert([200, 201].includes(r.status), await r.clone().text())
    const saved = (await r.json() as { product: ShopProduct }).product
    variants.push(saved)
  }
  for (const [i, s] of account.sku_variants.entries()) await save({ ...await hanfolkDraft(account, s.sku), status: 'listed', pricePending: false, priceCents: [2800, 5800, 8800, 12800][i] })
  const base = await hanfolkDraft(invitation, '0')
  for (const [i, amount] of ([1, 5, 10, 30] as const).entries()) await save({
    ...base, ...museInvitationCopy(amount),
    id: amount === 1 ? base.id : 'custom-' + (await hash('muse:invitation-preview:' + amount)).slice(0, 32),
    stock: amount === 1 ? base.stock : -1, status: 'listed', catalogPreview: true, pricePending: false, priceCents: [800, 2800, 5800, 12800][i],
  })
  const catalog = await (await f.request('/api/catalog')).json() as { products: ShopProduct[] }
  const muse = catalog.products.filter(p => p.groupId === 'muse')
  assert.equal(muse.length, 8)
  assert.deepEqual(museVariants(muse, 'account').map(p => p.priceCents), [2800, 5800, 8800, 12800])
  assert.deepEqual(museVariants(muse, 'invitation').map(p => p.priceCents), [800, 2800, 5800, 12800])
  assert.equal(museVariants(muse, 'account')[2].stock, 0)
  assert(muse.every(p => !p.pricePending && p.status === 'listed'))
  const state = await (await f.request('/api/admin/hanfolk', undefined, f.admin)).json() as { drafts: { id: string; productId: number | null; sku: string; costCents: number | null; sourceStock: number | null }[] }
  const managed = state.drafts.filter(d => muse.some(p => p.id === d.id))
  assert.equal(managed.length, 8)
  assert.equal(managed.filter(d => d.productId === 69 && d.sku === '0').length, 1)
  const previews = managed.filter(d => d.productId === null)
  assert.equal(previews.length, 3)
  assert(previews.every(d => d.sku === '' && d.costCents === null && d.sourceStock === null))
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM hanfolk_product_links').get()!.n, 5)
  const invitations = variants.filter(p => p.museKind === 'invitation')
  for (const p of invitations) {
    assert.equal(productSupplier(p, {}), 'daju')
    assert.equal((await f.request('/api/admin/my-shop/products', { ...p, status: 'published' }, f.admin)).status, 409)
    // Even a damaged enabled/status row must not bypass the missing task contract.
    f.db.prepare('UPDATE shop_products SET public_json=? WHERE id=?').run(JSON.stringify({ ...p, status: 'published' }), p.id)
    f.db.prepare('UPDATE catalog_plans SET enabled=1 WHERE id=?').run(p.id)
    const before = f.db.prepare('SELECT COUNT(*) n FROM orders').get()!.n
    await Promise.all(Array.from({ length: 3 }, () => assert.rejects(createCustomOrder(f.env, { plan: p.id, fields: {}, expectedPrice: p.priceCents, key: crypto.randomUUID() }, 'buyer-hash', 'buyer@example.test'), /该词元规格暂不可购买/)))
    assert.equal(f.db.prepare('SELECT COUNT(*) n FROM orders').get()!.n, before)
  }
  for (const row of existing) assert.deepEqual(f.db.prepare('SELECT id,price_cents,enabled FROM catalog_plans WHERE id=?').get(row.id), row)
  assert.equal((await f.request('/api/admin/hanfolk')).status, 401)
  f.db.close()
})
