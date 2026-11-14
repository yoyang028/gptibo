import test from 'node:test'
import assert from 'node:assert/strict'
import worker from '../worker/index.ts'
import { operationsFixture } from './member-operations-fixture.ts'
import { scanMemberRisks } from '../worker/member-risk.ts'
import { auditReward } from '../worker/member-ledger-audit.ts'

test('many unpaid guest orders trigger review only after the identity threshold; risk cases and alerts are deduplicated and versioned', async t => {
  const f = await operationsFixture(t), cookie = await f.buyer(), email = 'guest-volume@example.test'
  for (let i = 0; i < 10; i++) {
    const o = await f.create(email, 0, '', 'plus', cookie)
    assert.equal(o.promotion.reviewStatus, 'none')
  }
  const quoted = await f.call('/api/orders/promotion-quote', { plan: 'plus', email, promotion: { rewardCents: 0 } }, cookie)
  assert.equal((await quoted.json()).reviewStatus, 'required')
  await scanMemberRisks(f.env)
  const cases = f.db.prepare('SELECT * FROM member_risk_cases').all()
  assert.equal(cases.length, 2)
  const count = f.db.prepare("SELECT COUNT(*) n FROM member_notifications WHERE kind='risk'").get()!.n
  f.db.exec('UPDATE member_risk_subjects SET checked_at=0')
  await scanMemberRisks(f.env)
  assert.equal(f.db.prepare("SELECT COUNT(*) n FROM member_notifications WHERE kind='risk'").get()!.n, count)
  const c = f.db.prepare('SELECT * FROM member_risk_cases LIMIT 1').get()!
  const action = { action: 'acknowledge', id: c.id, version: c.version, note: '已按原订单核对，继续观察' }
  assert.equal((await f.call('/api/admin/member-ops/risk', action)).status, 401)
  assert.equal((await f.call('/api/admin/member-ops/risk', action, f.admin)).status, 200)
  assert.equal((await f.call('/api/admin/member-ops/risk', action, f.admin)).status, 409)
  f.db.exec("UPDATE orders SET status='cancelled';UPDATE member_risk_subjects SET checked_at=0")
  await scanMemberRisks(f.env)
  assert.equal(f.db.prepare("SELECT COUNT(*) n FROM member_risk_cases WHERE status='resolved'").get()!.n, 2)
  assert.equal(f.upstream.writes.length, 0)
})

test('repeated reserve-cancel activity requires review without confiscating rewards or changing cancellation restoration', async t => {
  const f = await operationsFixture(t); await f.earn(1)
  for (let i = 0; i < 5; i++) {
    const o = await f.create('operations@example.test', 1000)
    assert.equal((await f.call(`/api/orders/${o.id}/promotion-cancel`, { version: o.version }, f.member.cookie)).status, 200)
  }
  const q = await (await f.call('/api/orders/promotion-quote', { plan: 'plus', email: 'operations@example.test', promotion: { rewardCents: 1000 } }, f.member.cookie)).json()
  assert.equal(q.rewardCents, 1000); assert.equal(q.reviewStatus, 'required')
  const g = f.db.prepare('SELECT * FROM member_reward_grants').get()!
  assert.equal(g.remaining_cents, 1000); assert.equal(g.reserved_cents, 0)
  assert.equal((await auditReward(f.env, String(g.id))).state, 'matched')
  await scanMemberRisks(f.env)
  assert(f.db.prepare("SELECT 1 FROM member_risk_cases WHERE flags LIKE '%repeated_reservation%'").get())
  assert.equal(f.db.prepare('SELECT frozen FROM member_profiles WHERE id=?').get(f.member.id)!.frozen, 0)
  assert.equal(f.upstream.writes.length, 0)
})

test('shared IP alone never changes normal guest checkout; only rotating HMAC is stored and old auxiliary values are cleared', async t => {
  const f = await operationsFixture(t), ip = '203.0.113.42'
  const call = (path: string, data: unknown, cookie: string) => worker.fetch(new Request(f.origin + path, { method: 'POST', headers: { Origin: f.origin, 'Content-Type': 'application/json', Cookie: cookie, 'CF-Connecting-IP': ip }, body: JSON.stringify(data) }), f.env)
  for (let i = 0; i < 20; i++) {
    const cookie = await f.buyer(), data = { plan: 'plus', email: `shared-ip-${i}@example.test`, promotion: { rewardCents: 0 } }
    const quote = await (await call('/api/orders/promotion-quote', data, cookie)).json()
    assert.equal(quote.reviewStatus, 'none')
    const payload = { ...data, expectedPrice: quote.cashCents, key: crypto.randomUUID() }
    const created = await call('/api/orders', payload, cookie)
    assert.equal(created.status, 201, await created.clone().text())
    if (i === 0) assert.equal((await call('/api/orders', payload, cookie)).status, 200)
  }
  const signals = f.db.prepare('SELECT * FROM member_order_signals').all()
  assert.equal(signals.length, 20); assert(signals.every(s => /^[a-f0-9]{64}$/.test(String(s.ip_key))))
  assert.equal(JSON.stringify(signals).includes(ip), false)
  await scanMemberRisks(f.env)
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM member_risk_cases').get()!.n, 0)
  const q = await (await call('/api/orders/promotion-quote', { plan: 'plus', email: 'another-guest@example.test', promotion: { rewardCents: 0 } }, await f.buyer())).json()
  assert.equal(q.reviewStatus, 'none')
  f.db.exec('UPDATE member_order_signals SET created_at=0;UPDATE member_risk_subjects SET checked_at=0')
  await scanMemberRisks(f.env)
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM member_order_signals WHERE ip_key IS NOT NULL').get()!.n, 0)
})

test('five concurrent reward reservations require review of later activity while retaining cancellation and ledger consistency', async t => {
  const f = await operationsFixture(t); await f.earn(1)
  const orders = []
  for (let i = 0; i < 5; i++) {
    const o = await f.create('operations@example.test', 100)
    assert.equal(o.promotion.reviewStatus, 'none'); orders.push(o)
  }
  const q = await (await f.call('/api/orders/promotion-quote', { plan: 'plus', email: 'operations@example.test', promotion: { rewardCents: 100 } }, f.member.cookie)).json()
  assert.equal(q.reviewStatus, 'required'); assert.equal(q.rewardCents, 100)
  await scanMemberRisks(f.env)
  assert(f.db.prepare("SELECT 1 FROM member_risk_cases WHERE flags LIKE '%many_reserved_orders%'").get())
  for (const o of orders) assert.equal((await f.call(`/api/orders/${o.id}/promotion-cancel`, { version: o.version }, f.member.cookie)).status, 200)
  const g = f.db.prepare('SELECT * FROM member_reward_grants').get()!
  assert.equal(g.remaining_cents, 1000); assert.equal(g.reserved_cents, 0)
  assert.equal((await auditReward(f.env, String(g.id))).state, 'matched')
})

test('repeated newcomer reservations are included without consuming rewards or changing the five-yuan benefit', async t => {
  const f = await operationsFixture(t), cookie = await f.buyer()
  const data = { plan: 'plus', email: 'newcomer-risk@example.test', promotion: { inviteCode: f.code, newcomer: true, rewardCents: 0 } }
  for (let i = 0; i < 5; i++) {
    const q = await (await f.call('/api/orders/promotion-quote', data, cookie)).json()
    assert.equal(q.cashCents, 13300); assert.equal(q.reviewStatus, 'none')
    const r = await f.call('/api/orders', { ...data, expectedPrice: q.cashCents, key: crypto.randomUUID() }, cookie)
    assert.equal(r.status, 201)
    const { order } = await r.json()
    assert.equal((await f.call(`/api/orders/${order.id}/promotion-cancel`, { version: order.version }, cookie)).status, 200)
  }
  const q = await (await f.call('/api/orders/promotion-quote', data, cookie)).json()
  assert.equal(q.cashCents, 13300); assert.equal(q.newcomerEligible, true); assert.equal(q.reviewStatus, 'required')
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM member_reward_grants').get()!.n, 0)
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM member_first_purchases').get()!.n, 0)
})
