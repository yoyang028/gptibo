import test from 'node:test'
import assert from 'node:assert/strict'
import { customerFixture } from './customer-fixture.ts'
import { ownerShop, ownerPublicSettings } from '../worker/owner-shop.ts'
import { sendVerificationEmail, prepareShopEmail, membershipDeliveryMessage } from '../worker/email.ts'
import { synchronizeOwnerIdentity } from '../shared/owner-identity.ts'
import { DatabaseSync } from 'node:sqlite'
import { readFileSync, readdirSync } from 'node:fs'

test('AI planet migration changes only the general store identity and preserves operator settings and prices', () => {
  const db = new DatabaseSync(':memory:')
  try {
    for (const file of readdirSync(new URL('../migrations/', import.meta.url)).filter(n => n.endsWith('.sql') && n < '0067').sort()) db.exec(readFileSync(new URL('../migrations/' + file, import.meta.url), 'utf8'))
    db.prepare("UPDATE owner_shop_settings SET settings=json_set(settings,'$.logo','operator-logo','$.email','operator@example.test','$.headline','保留我的首页文案') WHERE id='store-3'").run()
    const other = db.prepare("SELECT * FROM owner_shop_settings WHERE id<>'store-3' ORDER BY id").all()
    const prices = db.prepare('SELECT * FROM owner_store_prices ORDER BY store_id,plan').all()
    const original = JSON.parse(String(db.prepare("SELECT settings FROM owner_shop_settings WHERE id='store-3'").get()!.settings))
    db.exec(readFileSync(new URL('../migrations/0067_member_identity_experience.sql', import.meta.url), 'utf8'))
    const actual = JSON.parse(String(db.prepare("SELECT settings FROM owner_shop_settings WHERE id='store-3'").get()!.settings))
    assert.deepEqual(actual, { ...original, name: 'AI星球', brandName: 'AI星球', pageTitle: 'AI星球 · AI 订阅与数字服务' })
    assert.deepEqual(db.prepare("SELECT * FROM owner_shop_settings WHERE id<>'store-3' ORDER BY id").all(), other)
    assert.deepEqual(db.prepare('SELECT * FROM owner_store_prices ORDER BY store_id,plan').all(), prices)
  } finally { db.close() }
})

test('renaming from the admin API updates the storefront, default page title, sender and selected-store preview without changing other stores', async t => {
  const f = await customerFixture(); t.after(() => f.db.close())
  Object.assign(f.env, { OWNER_STOREFRONT_HOSTS: '{"general.example.test":"store-3"}', RESEND_API_KEY: 'test-only', RESEND_FROM: 'Old <noreply@example.invalid>' })
  const academic = await ownerShop(f.env), current = await ownerShop(f.env, 'store-3')
  const response = await f.request('/api/admin/my-shop/stores', { id: 'store-3', version: current.version, name: '我的星球', active: current.active, settings: current }, f.admin)
  assert.equal(response.status, 200, await response.clone().text())
  const shop = await ownerShop(f.env, 'store-3')
  assert.equal(shop.name, '我的星球'); assert.equal(shop.brandName, '我的星球')
  assert.equal(shop.pageTitle, '我的星球 · AI 订阅与数字服务')
  const identity = await (await f.request('/api/admin/my-shop/identity?store=store-3', undefined, f.admin)).json()
  assert.equal(identity.shop.brandName, '我的星球')
  assert.equal(identity.storefront_url, 'https://general.example.test/')
  assert.equal((await f.request('/api/admin/my-shop/identity?store=store-3')).status, 401)
  assert.equal((await f.request('/api/admin/my-shop/identity?store=foreign', undefined, f.admin)).status, 404)
  assert.equal((await ownerPublicSettings(f.env, 'store-3')).shop.pageTitle, shop.pageTitle)
  const sent: { from: string; subject: string; html: string; text: string }[] = []
  t.mock.method(globalThis, 'fetch', async (_input: string, options: RequestInit) => { sent.push(JSON.parse(String(options.body))); return Response.json({ id: 'test-mail' }) })
  await sendVerificationEmail(f.env, 'order-recovery', 'buyer@example.test', '123456', 'test-challenge', 'store-3')
  assert.match(sent[0].from, /^"我的星球" <noreply@example.invalid>$/)
  assert.match(sent[0].subject, /^我的星球/)
  assert(!sent[0].html.includes('>GPTibo<'))
  const delivery = await prepareShopEmail(f.env, membershipDeliveryMessage('link', 'test-order', 'https://example.com/claim/test', '本人交付说明', 'gemini-pro-18m'), 'store-3')
  assert.match(delivery.from!, /^"我的星球" /)
  assert.match(delivery.html, />我的星球</)
  assert(delivery.text.includes('本人交付说明'))
  assert.deepEqual(await ownerShop(f.env), academic)
})

test('explicit page titles stay editable while unchanged branded defaults follow a rename', () => {
  const current = { name: '旧店', brandName: '旧店', pageTitle: '旧店 · AI 订阅' }
  assert.equal(synchronizeOwnerIdentity(current, { name: '新店', brandName: '旧店', pageTitle: current.pageTitle }).pageTitle, '新店 · AI 订阅')
  assert.equal(synchronizeOwnerIdentity(current, { name: '新店', brandName: '新店', pageTitle: '我自己设置的页面标题' }).pageTitle, '我自己设置的页面标题')
  assert.equal(synchronizeOwnerIdentity(current, { name: '新店', pageTitle: '' }).pageTitle, '')
})
