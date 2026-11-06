import test from 'node:test'
import assert from 'node:assert/strict'
import { prepareSite } from '../scripts/sites/prepare.mjs'
import { customerFixture } from './customer-fixture.ts'
import { ownerShop } from '../worker/owner-shop.ts'

test('the two new storefront deployments build separate assets and resource identities with sales closed', () => {
  const general = prepareSite('general', 'retail.example.com', '11111111-1111-1111-1111-111111111111')
  const wholesale = prepareSite('wholesale', 'trade.example.com', '22222222-2222-2222-2222-222222222222')
  assert.notEqual(general.name, wholesale.name)
  assert.notEqual(general.assets.directory, wholesale.assets.directory)
  assert.notEqual(general.d1_databases[0].database_name, wholesale.d1_databases[0].database_name)
  assert.equal(general.vars.STOREFRONT_KIND, 'general')
  assert.equal(wholesale.vars.STOREFRONT_KIND, 'wholesale')
  assert.equal(wholesale.vars.WHOLESALE_PAYMENT_INSTRUCTIONS, '')
  for (const c of [general, wholesale]) {
    assert.equal(c.vars.PAYMENT_CHECKOUT_ENABLED, 'false')
    assert.equal(c.vars.RECHARGE_CHECKOUT_ENABLED, 'false')
    assert.equal(c.vars.RECHARGE_READ_ONLY, 'true')
    assert.equal(c.workers_dev, false)
  }
  assert.throws(() => prepareSite('../scholai', 'test.example.com'), /Select/)
})
test('brand defaults belong to each deployment while stored branding remains authoritative', async () => {
  const f = await customerFixture()
  try {
    const original = await ownerShop(f.env)
    f.env.STOREFRONT_KIND = 'general'
    assert.equal((await ownerShop(f.env)).brandName, '通用商店')
    f.env.STOREFRONT_KIND = 'wholesale'
    assert.equal((await ownerShop(f.env)).brandName, '代理供货中心')
    delete f.env.STOREFRONT_KIND
    assert.deepEqual(await ownerShop(f.env), original)
    f.db.prepare("UPDATE owner_shop_settings SET settings=? WHERE id='platform'").run(JSON.stringify({ name: 'Custom', brandName: 'Custom brand' }))
    f.env.STOREFRONT_KIND = 'general'
    assert.equal((await ownerShop(f.env)).brandName, 'Custom brand')
  } finally { f.db.close() }
})
