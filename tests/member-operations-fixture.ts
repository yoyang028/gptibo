import assert from 'node:assert/strict'
import { memberFixture } from './member-fixture.ts'
import { reconcileMemberRewards } from '../worker/member-rewards.ts'

export async function operationsFixture(t: Parameters<typeof memberFixture>[0]) {
  const f = await memberFixture(t), upstream = f.enableSupplier(), member = await f.identity('operations@example.test')
  const code = member.info.member.inviteCode
  async function create(email = crypto.randomUUID() + '@example.test', rewardCents = 0, inviteCode = '', plan = 'plus', cookie = member.cookie) {
    const data = { plan, email, promotion: { inviteCode, newcomer: false, rewardCents } }
    const q = await f.call('/api/orders/promotion-quote', data, cookie)
    assert.equal(q.status, 200, await q.clone().text())
    const quote = await q.json()
    const r = await f.call('/api/orders', { ...data, expectedPrice: quote.cashCents, key: crypto.randomUUID() }, cookie)
    assert.equal(r.status, 201, await r.clone().text())
    return (await r.json()).order
  }
  async function earn(count: number) {
    for (let i = 0; i < count; i++) {
      const o = await create(crypto.randomUUID() + '@example.test', 0, code, 'plus', await f.buyer()), at = Date.now() - 25 * 3600000
      f.db.prepare("UPDATE orders SET payment_status='paid',status='success',updated_at=? WHERE id=?").run(at, o.id)
      f.db.prepare("INSERT INTO order_events(id,order_id,actor,action,to_status,order_version,created_at) VALUES (?,?,'test','fixture-delivery','success',1,?)").run(crypto.randomUUID(), o.id, at)
    }
    await reconcileMemberRewards(f.env)
  }
  return { ...f, upstream, member, code, create, earn }
}
