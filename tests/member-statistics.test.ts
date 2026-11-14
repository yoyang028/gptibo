import test from 'node:test'
import assert from 'node:assert/strict'
import { operationsFixture } from './member-operations-fixture.ts'
import { reconcileMemberRewards } from '../worker/member-rewards.ts'

test('inviter statistics keep paid, delivery, refunds and reward usage separate without join multiplication', async t => {
  const f = await operationsFixture(t); await f.earn(2)
  await f.create('not-paid@example.test', 0, f.code, 'plus', await f.buyer())
  const spending = await f.create('operations@example.test', 1500)
  f.db.prepare("UPDATE orders SET payment_status='paid' WHERE id=?").run(spending.id)
  await reconcileMemberRewards(f.env)
  const sources = f.db.prepare('SELECT source_order_id FROM member_reward_grants ORDER BY id').all()
  f.db.prepare('UPDATE orders SET refunded_cents=6900 WHERE id=?').run(sources[0].source_order_id)
  f.db.prepare('UPDATE orders SET refunded_cents=13800 WHERE id=?').run(sources[1].source_order_id)
  f.db.prepare('UPDATE orders SET refunded_cents=6150 WHERE id=?').run(spending.id)
  await reconcileMemberRewards(f.env)
  const response = await f.call('/api/admin/member-ops/statistics?q=operations', undefined, f.admin)
  assert.equal(response.status, 200)
  const { rows, totals } = await response.json(), row = rows[0]
  assert.equal(row.orders, 3); assert.equal(row.buyers, 3); assert.equal(row.paid_orders, 2); assert.equal(row.paid_cents, 27600)
  assert.equal(row.refunded_cents, 20700); assert.equal(row.delivered_orders, 2); assert.equal(row.converted_buyers, 1)
  assert.equal(row.issued_cents, 2000); assert.equal(row.used_cents, 750); assert.equal(row.restored_cents, 750); assert.equal(row.available_cents, 1250)
  assert.equal(totals.paid_cents, 27600)
  assert.equal((await f.call('/api/admin/member-ops/statistics')).status, 401)
})

test('date boundaries use Shanghai calendar days and invalid dates are rejected; zero-cash snapshots never report legacy original price as received', async t => {
  const f = await operationsFixture(t); await f.earn(14)
  const zero = await f.create('operations@example.test', 14000, f.code)
  const endpoint = '/api/admin/member-ops/statistics'
  let rows = (await (await f.call(endpoint, undefined, f.admin)).json()).rows
  assert.equal(rows[0].orders, 15); assert.equal(rows[0].paid_cents, 14 * 13800)
  // Isolate the zero order into a different local calendar day using only the fixture DB.
  f.db.prepare('UPDATE member_order_promotions SET created_at=? WHERE order_id=?').run(Date.parse('2026-01-01T00:00:00+08:00'), zero.id)
  rows = (await (await f.call(endpoint + '?from=2026-01-01&to=2026-01-01', undefined, f.admin)).json()).rows
  assert.equal(rows[0].orders, 1); assert.equal(rows[0].paid_cents, 0)
  for (const query of ['from=2026-02-30','from=bad','from=2026-04-03&to=2026-04-01','page=-1']) assert.equal((await f.call(endpoint + '?' + query, undefined, f.admin)).status, 400)
})
