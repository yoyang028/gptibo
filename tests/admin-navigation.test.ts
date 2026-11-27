import assert from 'node:assert/strict'
import test from 'node:test'
import { readAdminRoute, writeAdminRoute } from '../shared/admin-navigation.ts'

test('old ticket bookmarks resolve to the partner ticket tab and retain the store context', () => {
  const params = new URLSearchParams('view=tickets&store=store-3')
  const route = readAdminRoute(params.toString())
  assert.deepEqual(route, { view: 'partners', supplier: 'all', partnerTab: 'tickets' })
  writeAdminRoute(params, route)
  assert.equal(params.get('view'), 'partners')
  assert.equal(params.get('tab'), 'tickets')
  assert.equal(params.get('store'), 'store-3')
  assert.deepEqual(readAdminRoute(params.toString()), route)
})

test('partner tabs and supplier links round-trip with only the active section in the URL', () => {
  const params = new URLSearchParams('view=partners&tab=defaults&supplier=grizzly')
  const defaults = readAdminRoute(params.toString())
  assert.equal(defaults.partnerTab, 'defaults')
  writeAdminRoute(params, defaults)
  assert.equal(params.get('supplier'), null)
  const products = readAdminRoute('?view=hanfolk')
  writeAdminRoute(params, products)
  assert.equal(params.get('view'), 'products')
  assert.equal(params.get('supplier'), 'daju')
  assert.equal(params.get('tab'), null)
  assert.equal(readAdminRoute('?view=partners&tab=bogus').partnerTab, 'partners')
})
