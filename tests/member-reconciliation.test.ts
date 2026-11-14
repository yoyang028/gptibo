import test from 'node:test'
import assert from 'node:assert/strict'
import { operationsFixture } from './member-operations-fixture.ts'
import { reconcilePilotOrder, scanPilotOrders, syncPilotOrder } from '../worker/member-reconciliation.ts'

test('reconciliation reports original payment, amounts and delivery without writes; safe sync and repeat do not purchase or reward twice', async t => {
  const f = await operationsFixture(t), o = await f.create()
  await f.call(`/api/orders/${o.id}/fulfillment`, { action: 'poll' }, f.member.cookie)
  const remote = [...f.upstream.remotes.values()][0], before = f.upstream.writes.length
  assert.equal((await reconcilePilotOrder(f.env, o.id)).state, 'matched')
  remote.payment_status = 'paid'; remote.fulfillment_status = 'succeeded'
  const diff = await reconcilePilotOrder(f.env, o.id)
  assert.deepEqual(diff.differences, ['payment_status', 'delivery_status'])
  assert.equal(f.db.prepare('SELECT payment_status FROM orders WHERE id=?').get(o.id)!.payment_status, 'unpaid')
  await syncPilotOrder(f.env, o.id, '核对原单交付')
  assert.equal((await reconcilePilotOrder(f.env, o.id)).state, 'matched')
  assert.equal(f.upstream.writes.length, before)
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM member_reward_grants').get()!.n, 0)
  remote.sale_amount = '138.01'; remote.supply_amount = '110.01'; remote.refunded_amount = '0.01'
  assert.deepEqual((await reconcilePilotOrder(f.env, o.id)).differences, ['cash_amount', 'supply_amount', 'refund_amount'])
  await assert.rejects(syncPilotOrder(f.env, o.id, '不得覆盖金额'), /同步未完成/)
  assert.equal(f.upstream.writes.length, before)
})

test('expected holds and unknown upstream identity are distinct; scans never create an upstream order', async t => {
  const f = await operationsFixture(t); await f.earn(14)
  const o = await f.create('operations@example.test', 14000), before = f.upstream.writes.length
  const result = await reconcilePilotOrder(f.env, o.id)
  assert.equal(result.state, 'expected'); assert.equal(result.local.cashCents, 0); assert.deepEqual(result.differences, ['awaiting_supplier'])
  await assert.rejects(syncPilotOrder(f.env, o.id, '保留锁券'))
  const unknown = await f.create()
  f.db.prepare('UPDATE recharge_orders SET attempted_at=? WHERE order_id=?').run(Date.now(), unknown.id)
  assert.deepEqual((await reconcilePilotOrder(f.env, unknown.id)).differences, ['upstream_identity_unknown'])
  await scanPilotOrders(f.env)
  assert.equal(f.upstream.writes.length, before)
  assert.equal(f.db.prepare('SELECT SUM(reserved_cents) n FROM member_reward_grants').get()!.n, 13800)
})

test('admin access, append-only handling history and in-flight reconciliation lease are enforced', async t => {
  const f = await operationsFixture(t), o = await f.create(), endpoint = '/api/admin/member-ops/reconciliation'
  assert.equal((await f.call(endpoint)).status, 401)
  assert.equal((await f.call(endpoint, { action: 'check', id: o.id }, f.admin)).status, 200)
  assert.equal((await f.call(endpoint, { action: 'note', id: o.id, note: '已向上游核对' }, f.admin)).status, 200)
  const history = await (await f.call(endpoint + '?id=' + o.id, undefined, f.admin)).json()
  assert.equal(history.history.length, 2)
  assert.throws(() => f.db.exec('DELETE FROM member_operation_events'), /append-only/)
  assert.throws(() => f.db.exec("UPDATE member_operation_events SET note='changed'"), /append-only/)
  f.db.prepare('UPDATE member_order_reconciliations SET lease_until=? WHERE order_id=?').run(Date.now() + 60000, o.id)
  assert.equal((await f.call(endpoint, { action: 'check', id: o.id }, f.admin)).status, 409)
  f.db.prepare("UPDATE orders SET owner_store_id='platform' WHERE id=?").run(o.id)
  assert.equal((await f.call(endpoint, { action: 'check', id: o.id }, f.admin)).status, 409)
})
