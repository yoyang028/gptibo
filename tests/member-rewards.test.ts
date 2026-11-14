import test from 'node:test'
import assert from 'node:assert/strict'
import { memberFixture } from './member-fixture.ts'
import { reconcileMemberRewards, revokeReward } from '../worker/member-rewards.ts'
import { twoCalendarMonths } from '../shared/member-promotions.ts'

async function fixture(t: Parameters<typeof memberFixture>[0]) {
  const f = await memberFixture(t), upstream = f.enableSupplier()
  const create = async (email: string, selection: { inviteCode?: string; newcomer?: boolean; rewardCents?: number }, cookie: string, key = crypto.randomUUID(), plan = 'plus') => {
    const data = { plan, email, promotion: { inviteCode: '', newcomer: false, rewardCents: 0, ...selection } }
    const quote = await f.call('/api/orders/promotion-quote', data, cookie)
    if (quote.status !== 200) throw new Error('quote: ' + quote.status + ' ' + await quote.text())
    const q = await quote.json()
    const payload = { ...data, expectedPrice: q.cashCents, key }
    const response = await f.call('/api/orders', payload, cookie)
    assert.equal(response.status, 201, await response.clone().text())
    return { order: (await response.json()).order, payload, quote: q }
  }
  const codeOf = (m: Awaited<ReturnType<typeof f.identity>>) => m.info.member.inviteCode
  async function earn(m: Awaited<ReturnType<typeof f.identity>>, count: number) {
    for (let i=0;i<count;i++) {
      const {order} = await create(crypto.randomUUID()+'@example.test',{inviteCode:codeOf(m)},await f.buyer())
      const at=Date.now()-25*3600000
      // Synthetic authoritative delivery fact, confined to the in-memory fixture.
      f.db.prepare("UPDATE orders SET payment_status='paid',status='success',updated_at=? WHERE id=?").run(at,order.id)
      f.db.prepare("INSERT INTO order_events(id,order_id,actor,action,to_status,order_version,created_at) VALUES (?,?,'test','fixture-delivery','success',1,?)").run(crypto.randomUUID(),order.id,at)
    }
    await reconcileMemberRewards(f.env)
  }
  return { ...f, upstream, create, codeOf, earn }
}

test('guest can decline newcomer discount and still earn one delayed reward after real delivery', async t => {
  const f=await fixture(t), inviter=await f.identity('inviter@example.test'), cookie=await f.buyer()
  const {order}=await f.create('guest@example.test',{inviteCode:f.codeOf(inviter)},cookie)
  assert.equal(order.price,138)
  assert.equal(f.db.prepare('SELECT referrer_id FROM member_order_promotions WHERE order_id=?').get(order.id)!.referrer_id,inviter.id)
  await f.call(`/api/orders/${order.id}/fulfillment`,{action:'poll'},cookie)
  assert.equal(f.upstream.writes.filter(w=>w.path==='/v1/orders').length,1)
  const remote=[...f.upstream.remotes.values()][0]
  remote.payment_status='paid'
  await f.call(`/api/orders/${order.id}/fulfillment`,{action:'query'},cookie)
  await reconcileMemberRewards(f.env)
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM member_reward_grants').get()!.n,0)
  remote.fulfillment_status='succeeded'
  await f.call(`/api/orders/${order.id}/fulfillment`,{action:'query'},cookie)
  await reconcileMemberRewards(f.env); await reconcileMemberRewards(f.env)
  const g=f.db.prepare('SELECT * FROM member_reward_grants').get()!
  assert.equal(g.status,'pending');assert.equal(g.amount_cents,1000)
  assert.equal(Number(g.eligible_at)-Number(g.delivered_at),24*3600000)
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM member_reward_grants').get()!.n,1)
  assert.equal((await (await f.call('/api/member/session',undefined,inviter.cookie)).json()).balanceCents,0)
  f.db.prepare('UPDATE member_reward_grants SET eligible_at=?').run(Date.now()-1)
  await reconcileMemberRewards(f.env)
  assert.equal((await (await f.call('/api/member/session',undefined,inviter.cookie)).json()).balanceCents,1000)
})

test('newcomer five-yuan discount is optional, exclusive, reserved once and isolated by store',async t=>{
  const f=await fixture(t), inviter=await f.identity('one@example.test'), cookie=await f.buyer(), code=f.codeOf(inviter)
  const {order,payload}=await f.create('new@example.test',{inviteCode:code,newcomer:true},cookie)
  assert.equal(order.price,133);assert.equal(order.promotion.newcomerCents,500)
  assert.equal((await f.call('/api/orders',payload,cookie)).status,200)
  assert.equal((await f.call('/api/orders',{...payload,promotion:{...payload.promotion,newcomer:false}},cookie)).status,409)
  assert.equal((await f.call('/api/orders/promotion-quote',{plan:'plus',email:'new@example.test',promotion:{inviteCode:code,newcomer:true}},await f.buyer())).status,409)
  assert.equal((await f.call('/api/orders/promotion-quote',{plan:'plus',email:'other@example.test',promotion:{inviteCode:code,newcomer:true,rewardCents:100}},cookie)).status,409)
  assert.equal((await f.call('/api/orders',{...payload,key:crypto.randomUUID(),partner:'store-3'},cookie,'https://shop.example.invalid')).status,409)
  const cancelled=await f.call(`/api/orders/${order.id}/promotion-cancel`,{version:order.version},cookie)
  assert.equal(cancelled.status,200,await cancelled.clone().text())
  assert.equal((await f.call('/api/orders/promotion-quote',{plan:'plus',email:'new@example.test',promotion:{inviteCode:code,newcomer:true}},cookie)).status,200)
})

test('fourteen rewards fully cover 138, retain two yuan, require review and never call the supplier',async t=>{
  const f=await fixture(t), member=await f.identity('redeemer@example.test')
  await f.earn(member,14)
  const {order}=await f.create('redeemer@example.test',{rewardCents:14000},member.cookie)
  assert.equal(order.price,0);assert.equal(order.paymentStatus,'unpaid');assert.equal(order.status,'pending')
  assert.equal(order.promotion.rewardCents,13800);assert.equal(order.promotion.reviewStatus,'required')
  assert.equal(order.promotion.procurementStatus,'awaiting_supplier')
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM recharge_orders WHERE order_id=?').get(order.id)!.n,0)
  assert.equal(f.db.prepare("SELECT SUM(remaining_cents-reserved_cents) amount FROM member_reward_grants WHERE member_id=?").get(member.id)!.amount,200)
  assert.equal(f.upstream.writes.length,0)
  await f.call(`/api/orders/${order.id}/fulfillment`,{action:'poll'},member.cookie)
  await f.call(`/api/orders/${order.id}/payment`,{action:'create'},member.cookie)
  assert.equal(f.upstream.writes.length,0)
  assert.equal((await f.call(`/api/orders/${order.id}/promotion-cancel`,{version:order.version},member.cookie)).status,200)
  assert.equal((await (await f.call('/api/member/session',undefined,member.cookie)).json()).balanceCents,14000)
})

test('discount below cost remains available without creating upstream procurement and cancels safely',async t=>{
  const f=await fixture(t), member=await f.identity('below@example.test');await f.earn(member,4)
  const {order}=await f.create('below@example.test',{rewardCents:4000},member.cookie)
  assert.equal(order.price,98);assert.equal(order.promotion.procurementStatus,'awaiting_supplier')
  assert.equal(order.promotion.reviewStatus,'none')
  assert.equal(f.db.prepare('SELECT SUM(reserved_cents) n FROM member_reward_grants').get()!.n,4000)
  assert.equal(f.upstream.writes.length,0)
  await f.call(`/api/orders/${order.id}/promotion-cancel`,{version:order.version},member.cookie)
  assert.equal(f.db.prepare('SELECT SUM(reserved_cents) n FROM member_reward_grants').get()!.n,0)
})

test('two concurrent orders cannot overspend the same grant and failures roll back the whole order',async t=>{
  const f=await fixture(t), member=await f.identity('race@example.test');await f.earn(member,1)
  const payload={plan:'plus',email:'race@example.test',expectedPrice:12800,promotion:{inviteCode:'',newcomer:false,rewardCents:1000}}
  const results=await Promise.all([1,2].map(()=>f.call('/api/orders',{...payload,key:crypto.randomUUID()},member.cookie)))
  assert.equal(results.filter(r=>r.status===201).length,1)
  assert.equal(f.db.prepare('SELECT SUM(reserved_cents) n FROM member_reward_grants').get()!.n,1000)
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM member_order_promotions WHERE member_id=?').get(member.id)!.n,1)
})

test('cash payment uses discounted amount and confirmed full refund restores exactly the spent credit once',async t=>{
  const f=await fixture(t), member=await f.identity('refund@example.test');await f.earn(member,1)
  const {order}=await f.create('refund@example.test',{rewardCents:1000},member.cookie)
  await f.call(`/api/orders/${order.id}/fulfillment`,{action:'poll'},member.cookie)
  const remote=[...f.upstream.remotes.values()][0];assert.equal(remote.sale_amount,'128.00')
  remote.payment_status='paid'
  await f.call(`/api/orders/${order.id}/fulfillment`,{action:'query'},member.cookie)
  await reconcileMemberRewards(f.env)
  assert.equal(f.db.prepare('SELECT remaining_cents FROM member_reward_grants').get()!.remaining_cents,0)
  f.db.prepare('UPDATE orders SET refunded_cents=price_cents WHERE id=?').run(order.id)
  await reconcileMemberRewards(f.env);await reconcileMemberRewards(f.env)
  assert.equal(f.db.prepare('SELECT remaining_cents FROM member_reward_grants').get()!.remaining_cents,1000)
  assert.equal(f.db.prepare("SELECT COUNT(*) n FROM member_reward_ledger WHERE kind='restored'").get()!.n,1)
})

test('expired reserved credit is retained for its order but cancellation does not extend expiry',async t=>{
  const f=await fixture(t), member=await f.identity('expire@example.test');await f.earn(member,1)
  const {order}=await f.create('expire@example.test',{rewardCents:1000},member.cookie)
  f.db.prepare('UPDATE member_reward_grants SET expires_at=?').run(Date.now()-1)
  await reconcileMemberRewards(f.env)
  assert.equal(f.db.prepare('SELECT reserved_cents FROM member_reward_grants').get()!.reserved_cents,1000)
  await f.call(`/api/orders/${order.id}/promotion-cancel`,{version:order.version},member.cookie)
  await reconcileMemberRewards(f.env)
  assert.equal((await (await f.call('/api/member/session',undefined,member.cookie)).json()).balanceCents,0)
  assert.equal(f.db.prepare('SELECT remaining_cents FROM member_reward_grants').get()!.remaining_cents,0)
})

test('revoking a used reward keeps capture history and freezes abnormal benefits',async t=>{
  const f=await fixture(t), member=await f.identity('abnormal@example.test');await f.earn(member,1)
  const g=f.db.prepare('SELECT id FROM member_reward_grants').get()!
  const {order}=await f.create('abnormal@example.test',{rewardCents:1000},member.cookie)
  f.db.prepare("UPDATE orders SET payment_status='paid' WHERE id=?").run(order.id)
  await reconcileMemberRewards(f.env)
  await revokeReward(f.env,String(g.id),'confirmed anomaly fixture')
  assert.equal(f.db.prepare('SELECT frozen FROM member_profiles WHERE id=?').get(member.id)!.frozen,1)
  assert.equal(f.db.prepare("SELECT COUNT(*) n FROM member_reward_ledger WHERE kind='captured'").get()!.n,1)
  assert.equal(f.db.prepare('SELECT remaining_cents FROM member_reward_grants').get()!.remaining_cents,0)
})

test('two calendar months preserve Shanghai clock time and clamp month ends',()=>{
  assert.equal(new Date(twoCalendarMonths(Date.parse('2026-12-31T15:30:00+08:00'))).toISOString(),'2027-02-28T07:30:00.000Z')
})
