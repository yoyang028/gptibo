import test from 'node:test'
import assert from 'node:assert/strict'
import { operationsFixture } from './member-operations-fixture.ts'

const endpoint = '/api/admin/member-ops/simulation'
test('hypothetical previews keep full stacking, remaining credit, procurement holds and review thresholds with zero database writes', async t => {
  const f = await operationsFixture(t), before = f.db.prepare('SELECT total_changes() n').get()!.n
  for (const [plan, reward, available, cash, remaining, tier, path] of [
    ['plus',14000,14000,0,200,'manual','hold_for_supplier'],
    ['plus',3000,3000,10800,0,'automatic','hold_for_supplier'],
    ['pro-20x',3000,10000,135000,7000,'automatic','platform_collect'],
    ['pro-20x',3100,10000,134900,6900,'enhanced','platform_collect'],
    ['pro-20x',9900,10000,128100,100,'enhanced','platform_collect'],
    ['pro-20x',10000,10000,128000,0,'manual','review_then_platform_collect'],
  ] as const) {
    const r = await f.call(endpoint, { mode: 'scenario', plan, availableCents: available, rewardCents: reward }, f.admin)
    assert.equal(r.status, 200, await r.clone().text())
    const q = await r.json(); assert.equal(q.cashCents, cash); assert.equal(q.remainingCents, remaining); assert.equal(q.reviewTier, tier); assert.equal(q.procurementPath, path); assert.equal(q.sideEffects, false)
  }
  assert.equal(f.db.prepare('SELECT total_changes() n').get()!.n, before)
  assert.equal(f.upstream.writes.length, 0)
})
test('real-member preview and actual quote share calculations; preview does not create profiles, claims, orders or allocations', async t => {
  const f = await operationsFixture(t); await f.earn(4)
  const selected = { plan: 'pro-20x', email: 'operations@example.test', promotion: { rewardCents: 3100 } }
  const live = await (await f.call('/api/orders/promotion-quote', selected, f.member.cookie)).json()
  const changes = f.db.prepare('SELECT total_changes() n').get()!.n
  const simulated = await f.call(endpoint, { mode: 'member', plan: selected.plan, memberEmail: 'operations@example.test', rewardCents: 3100 }, f.admin)
  assert.equal(simulated.status, 200)
  const preview = await simulated.json()
  for (const k of ['cashCents','rewardCents','availableCents','reviewStatus','procurementStatus']) assert.equal(preview[k], live[k])
  assert.equal(f.db.prepare('SELECT total_changes() n').get()!.n, changes)
  assert.equal((await f.call(endpoint, { mode: 'member', plan: 'plus', memberEmail: 'unregistered@example.test' }, f.admin)).status, 409)
  assert.equal(f.upstream.writes.length, 0)
})
test('newcomer eligibility, exclusivity and anomaly gates remain intact in previews', async t => {
  const f = await operationsFixture(t), scenario = { mode: 'scenario', plan: 'plus', availableCents: 10000, rewardCents: 0, newcomer: true, assumeInvite: true, assumeNewCustomer: true }
  assert.equal((await f.call(endpoint, scenario)).status, 401)
  let r = await f.call(endpoint, scenario, f.admin); assert.equal(r.status, 200); assert.equal((await r.json()).cashCents, 13300)
  for (const change of [{ assumeInvite: false }, { assumeNewCustomer: false }, { rewardCents: 1000 }, { rewardCents: -1 }]) assert.equal((await f.call(endpoint, { ...scenario, ...change }, f.admin)).status >= 400, true)
  r = await f.call(endpoint, { ...scenario, newcomer: false, abnormal: true }, f.admin)
  assert.equal((await r.json()).reviewStatus, 'required')
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM orders').get()!.n, 0)
})
