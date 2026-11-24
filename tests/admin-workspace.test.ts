import test from 'node:test'
import assert from 'node:assert/strict'
import { adminWorkspaceRoute, adminWorkspaceUrl } from '../shared/admin-workspace.ts'

test('old admin bookmarks open their new workspace without inheriting an unrelated shop filter', () => {
  const cases = [
    ['?view=orders&store=store-3', '/admin?view=orders&tab=list&scope=all'],
    ['?view=customers&store=store-3', '/admin?view=customers&tab=directory&scope=all'],
    ['?view=members&store=store-3', '/admin?view=customers&tab=members&store=store-3'],
    ['?view=refunds&store=store-2', '/admin?view=orders&tab=refunds'],
    ['?view=accounting&store=store-3', '/admin?view=reports&tab=profit'],
    ['?view=invoices', '/admin?view=reports&tab=invoices'],
    ['?view=visitors', '/admin?view=reports&tab=visitors&scope=all'],
    ['?view=interest', '/admin?view=customers&tab=interest'],
    ['?view=tickets', '/admin?view=partners&tab=tickets'],
    ['?view=contacts', '/admin?view=my-shop&tab=stores&edit=platform'],
    ['?view=integrations', '/admin?view=settings&tab=services'],
    ['?view=security', '/admin?view=settings&tab=security'],
    ['?view=sms', '/admin?view=products&tab=catalog&supplier=grizzly'],
    ['?view=hanfolk', '/admin?view=products&tab=catalog&supplier=daju'],
    ['?view=plans', '/admin?view=products&tab=catalog&supplier=other'],
  ]
  for (const [oldQuery, url] of cases) {
    const route = adminWorkspaceRoute(oldQuery)
    assert.equal(adminWorkspaceUrl(route.view, route), url)
    assert.deepEqual(adminWorkspaceRoute(url.slice('/admin'.length)), route)
  }
})

test('new order and report links keep valid scopes and global pages discard irrelevant scopes', () => {
  const orders = adminWorkspaceRoute('?view=orders&tab=list')
  assert.equal(orders.scope, 'owner')
  const store = adminWorkspaceRoute('?view=orders&tab=list&store=store-3')
  assert.equal(store.store, 'store-3')
  assert.equal(store.scope, undefined)
  const invalid = adminWorkspaceRoute('?view=customers&tab=directory&store=missing')
  assert.equal(invalid.scope, 'owner')
  const settlement = adminWorkspaceRoute('?view=reports&tab=accounting&store=store-3&scope=owner')
  assert.equal(adminWorkspaceUrl(settlement.view, settlement), '/admin?view=reports&tab=accounting')
})
