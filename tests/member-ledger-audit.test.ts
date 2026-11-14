import test from 'node:test'
import assert from 'node:assert/strict'
import { operationsFixture } from './member-operations-fixture.ts'
import { auditReward, scanRewardAudits } from '../worker/member-ledger-audit.ts'
import { reconcileMemberRewards, revokeReward } from '../worker/member-rewards.ts'

test('ledger replay agrees across reservation, cancellation, capture, partial and full refund, and frozen used rewards', async t => {
  const f = await operationsFixture(t); await f.earn(2)
  const grant = String(f.db.prepare('SELECT id FROM member_reward_grants ORDER BY expires_at,created_at,id LIMIT 1').get()!.id)
  const check = async () => { const r = await auditReward(f.env, grant); assert.equal(r.state, 'matched', JSON.stringify(r)); return r }
  await check()
  let o = await f.create('operations@example.test', 1000)
  await check()
  await f.call(`/api/orders/${o.id}/promotion-cancel`, { version: o.version }, f.member.cookie)
  await check()
  o = await f.create('operations@example.test', 1000)
  f.db.prepare("UPDATE orders SET payment_status='paid' WHERE id=?").run(o.id)
  await reconcileMemberRewards(f.env); await check()
  f.db.prepare('UPDATE orders SET refunded_cents=6400 WHERE id=?').run(o.id)
  await reconcileMemberRewards(f.env); assert.equal((await check()).snapshot.restoredCents, 500)
  await revokeReward(f.env, grant, '核实异常，保留历史核销')
  await check()
  f.db.prepare('UPDATE orders SET refunded_cents=12800 WHERE id=?').run(o.id)
  await reconcileMemberRewards(f.env); assert.equal((await check()).snapshot.calculatedRemainingCents, 1000)
})

test('ledger audit detects a balance difference, deduplicates alerts and preserves every original ledger row and balance', async t => {
  const f = await operationsFixture(t); await f.earn(1)
  const id = String(f.db.prepare('SELECT id FROM member_reward_grants').get()!.id)
  const ledger = f.db.prepare('SELECT * FROM member_reward_ledger ORDER BY rowid').all()
  f.db.prepare('UPDATE member_reward_grants SET remaining_cents=999 WHERE id=?').run(id)
  const audit = await auditReward(f.env, id)
  assert.equal(audit.state, 'difference'); assert(audit.differences.includes('remaining_balance'))
  await auditReward(f.env, id)
  assert.equal(f.db.prepare("SELECT COUNT(*) n FROM member_notifications WHERE kind='ledger'").get()!.n, 1)
  assert.deepEqual(f.db.prepare('SELECT * FROM member_reward_ledger ORDER BY rowid').all(), ledger)
  assert.equal(f.db.prepare('SELECT remaining_cents FROM member_reward_grants').get()!.remaining_cents, 999)
  assert.throws(() => f.db.exec('DELETE FROM member_ledger_sequence'), /append-only/)
  assert.equal((await f.call('/api/admin/member-ops/ledger')).status, 401)
  assert.equal((await f.call('/api/admin/member-ops/ledger', { action: 'check', id }, f.admin)).status, 200)
  await scanRewardAudits(f.env)
})

test('stable insertion sequence handles equal timestamps, pending cancellation and natural-month expiry without rewriting history', async t => {
  const f = await operationsFixture(t); await f.earn(1)
  const id = String(f.db.prepare('SELECT id FROM member_reward_grants').get()!.id)
  // Move only the fixture source clock back, then rebuild its valid calendar expiry.
  const { twoCalendarMonths } = await import('../shared/member-promotions.ts')
  const eligible = Date.parse('2026-01-31T12:00:00+08:00')
  f.db.prepare('UPDATE member_reward_grants SET delivered_at=?,eligible_at=?,expires_at=? WHERE id=?').run(eligible - 86400000, eligible, twoCalendarMonths(eligible), id)
  await reconcileMemberRewards(f.env)
  assert.equal((await auditReward(f.env, id)).state, 'matched')
  const o = await f.create('pending-source@example.test', 0, f.code, 'plus', await f.buyer())
  f.db.prepare("UPDATE orders SET status='success',payment_status='paid' WHERE id=?").run(o.id)
  f.db.prepare("INSERT INTO order_events(id,order_id,actor,action,to_status,order_version,created_at) VALUES (?,?,'test','fixture-success','success',1,?)").run(crypto.randomUUID(), o.id, Date.now())
  await reconcileMemberRewards(f.env)
  f.db.prepare('UPDATE orders SET refunded_cents=price_cents WHERE id=?').run(o.id)
  await reconcileMemberRewards(f.env)
  assert.equal((await auditReward(f.env, 'invite:' + o.id)).state, 'matched')
})
