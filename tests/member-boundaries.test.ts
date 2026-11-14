import test from 'node:test'
import assert from 'node:assert/strict'
import { memberFixture } from './member-fixture.ts'
import { reconcileMemberRewards, checkRewardTarget } from '../worker/member-rewards.ts'

async function setup(t:Parameters<typeof memberFixture>[0]){
  const f=await memberFixture(t),upstream=f.enableSupplier(),member=await f.identity('boundary@example.test')
  const code=member.info.member.inviteCode
  async function create(email:string,rewardCents=0,inviteCode='',newcomer=false,plan='plus',cookie=member.cookie,key=crypto.randomUUID()){
    const data={plan,email,promotion:{inviteCode,newcomer,rewardCents}},q=await (await f.call('/api/orders/promotion-quote',data,cookie)).json()
    assert.equal(q.cashCents!==undefined,true,JSON.stringify(q))
    const payload={...data,expectedPrice:q.cashCents,key},response=await f.call('/api/orders',payload,cookie)
    assert.equal(response.status,201,await response.clone().text());return {order:(await response.json()).order,payload}
  }
  async function earn(count:number){
    for(let i=0;i<count;i++){
      const {order}=await create(crypto.randomUUID()+'@example.test',0,code,false,'plus',await f.buyer()),at=Date.now()-25*3600000
      f.db.prepare("UPDATE orders SET payment_status='paid',status='success',updated_at=? WHERE id=?").run(at,order.id)
      f.db.prepare("INSERT INTO order_events(id,order_id,actor,action,to_status,order_version,created_at) VALUES (?,?,'test','delivery','success',1,?)").run(crypto.randomUUID(),order.id,at)
    }
    await reconcileMemberRewards(f.env)
  }
  return {...f,upstream,member,code,create,earn}
}

test('review thresholds never cap credit: 30,31,99,100 yuan and mandatory review before upstream create',async t=>{
  const f=await setup(t);await f.earn(10)
  for(const [discount,review] of [[3000,'none'],[3100,'none'],[9900,'none'],[10000,'required']] as const){
    const q=await (await f.call('/api/orders/promotion-quote',{plan:'pro-20x',email:'boundary@example.test',promotion:{rewardCents:discount}},f.member.cookie)).json()
    assert.equal(q.rewardCents,discount);assert.equal(q.reviewStatus,review)
  }
  const {order}=await f.create('boundary@example.test',10000,'',false,'pro-20x')
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM recharge_orders WHERE order_id=?').get(order.id)!.n,0)
  const p=f.db.prepare('SELECT updated_at FROM member_order_promotions WHERE order_id=?').get(order.id)!
  const body={id:order.id,action:'approve',updatedAt:p.updated_at,note:'通过本地风险核对'}
  assert.equal((await f.call('/api/admin/members',body)).status,401)
  assert.equal((await f.call('/api/admin/members',body,f.admin)).status,200)
  assert.equal(f.upstream.writes.length,0)
  assert.equal((await f.call('/api/admin/members',body,f.admin)).status,409)
  await f.call(`/api/orders/${order.id}/fulfillment`,{action:'query'},f.member.cookie)
  assert.equal(f.upstream.writes.find(w=>w.path==='/v1/orders')!.body.sale_amount,'1280.00')
})

test('partial cash refunds restore proportional credit with exact cents and idempotent cumulative refunds',async t=>{
  const f=await setup(t);await f.earn(2)
  const {order}=await f.create('boundary@example.test',2000)
  f.db.prepare("UPDATE orders SET payment_status='paid' WHERE id=?").run(order.id)
  await reconcileMemberRewards(f.env)
  for(const [cash,restored] of [[5900,1000],[5901,1000],[11799,1999],[11800,2000]]){
    f.db.prepare('UPDATE orders SET refunded_cents=? WHERE id=?').run(cash,order.id)
    await reconcileMemberRewards(f.env);await reconcileMemberRewards(f.env)
    assert.equal(f.db.prepare('SELECT SUM(remaining_cents) n FROM member_reward_grants').get()!.n,restored)
  }
  assert.equal(f.db.prepare("SELECT SUM(amount_cents) n FROM member_reward_ledger WHERE kind='restored'").get()!.n,2000)
})

test('source refund in observation cancels a pending award; a normal refund after vesting leaves it active',async t=>{
  const f=await setup(t);await f.earn(1)
  const active=f.db.prepare('SELECT source_order_id FROM member_reward_grants').get()!
  f.db.prepare('UPDATE orders SET refunded_cents=price_cents WHERE id=?').run(active.source_order_id)
  await reconcileMemberRewards(f.env)
  assert.equal(f.db.prepare('SELECT status FROM member_reward_grants').get()!.status,'active')
  const {order}=await f.create('observed@example.test',0,f.code,false,'plus',await f.buyer())
  f.db.prepare("UPDATE orders SET payment_status='paid',status='success' WHERE id=?").run(order.id)
  f.db.prepare("INSERT INTO order_events(id,order_id,actor,action,to_status,order_version,created_at) VALUES (?,?,'test','delivery','success',1,?)").run(crypto.randomUUID(),order.id,Date.now())
  await reconcileMemberRewards(f.env)
  assert.equal(f.db.prepare('SELECT status FROM member_reward_grants WHERE source_order_id=?').get(order.id)!.status,'pending')
  f.db.prepare('UPDATE orders SET refunded_cents=price_cents WHERE id=?').run(order.id)
  await reconcileMemberRewards(f.env);await reconcileMemberRewards(f.env)
  assert.equal(f.db.prepare('SELECT status FROM member_reward_grants WHERE source_order_id=?').get(order.id)!.status,'cancelled')
  assert.equal(f.db.prepare("SELECT COUNT(*) n FROM member_reward_ledger WHERE kind='cancelled'").get()!.n,1)
})

test('turning off new membership activity preserves existing zero-order protections',async t=>{
  const f=await setup(t);await f.earn(14)
  const {order}=await f.create('boundary@example.test',14000)
  f.env.MEMBERSHIP_ENABLED='false'
  const existing=await (await f.call(`/api/orders/${order.id}`,undefined,f.member.cookie)).json()
  assert.equal(existing.order.price,0);assert.equal(existing.order.promotion.rewardCents,13800)
  assert.equal((await f.call(`/api/orders/${order.id}/payment`,{action:'create'},f.member.cookie)).status,409)
  assert.equal(f.upstream.writes.length,0)
  delete f.env.MEMBERSHIP_ENABLED
  assert.equal((await f.call(`/api/orders/${order.id}/payment`,{action:'create'},f.member.cookie)).status,409)
  assert.equal(f.upstream.writes.length,0)
})

test('local expiry keeps reservations until confirmed upstream closure; late paid orders require review',async t=>{
  const f=await setup(t);await f.earn(1)
  const {order}=await f.create('boundary@example.test',1000)
  await f.call(`/api/orders/${order.id}/fulfillment`,{action:'query'},f.member.cookie)
  const remote=[...f.upstream.remotes.values()][0]
  f.db.prepare('UPDATE orders SET created_at=? WHERE id=?').run(Date.now()-20*60000,order.id)
  await f.call(`/api/orders/${order.id}`,undefined,f.member.cookie)
  await reconcileMemberRewards(f.env)
  assert.equal(f.db.prepare('SELECT reserved_cents FROM member_reward_grants').get()!.reserved_cents,1000)
  remote.payment_status='expired'
  await f.call(`/api/orders/${order.id}/fulfillment`,{action:'query'},f.member.cookie);await reconcileMemberRewards(f.env)
  assert.equal(f.db.prepare('SELECT reserved_cents FROM member_reward_grants').get()!.reserved_cents,0)
  remote.payment_status='paid'
  await f.call(`/api/orders/${order.id}/fulfillment`,{action:'query'},f.member.cookie)
  const p=f.db.prepare('SELECT * FROM member_order_promotions WHERE order_id=?').get(order.id)!
  assert.equal(p.review_status,'required');assert(String(p.risk_flags).includes('late_payment'))
  assert.equal(p.allocation_status,'released')
})

test('concurrent different invitation selections cannot change one idempotent order source',async t=>{
  const f=await setup(t),other=await f.identity('other-inviter@example.test'),cookie=await f.buyer(),key=crypto.randomUUID()
  const codes=[f.code,other.info.member.inviteCode]
  const results=await Promise.all(codes.map(inviteCode=>f.call('/api/orders',{plan:'plus',email:'same-guest@example.test',key,expectedPrice:13800,promotion:{inviteCode,newcomer:false,rewardCents:0}},cookie)))
  assert.deepEqual(results.map(r=>r.status).sort(),[201,409])
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM member_order_promotions').get()!.n,1)
})

test('one target identity cannot create two referral rewards and raw credentials never persist',async t=>{
  const f=await setup(t),cookie=await f.buyer()
  const first=await f.create('first-target@example.test',0,f.code,false,'plus',cookie)
  const second=await f.create('second-target@example.test',0,f.code,false,'plus',cookie)
  const credential={mode:'session' as const,session:JSON.stringify({user:{email:'same-target@example.test'},sessionToken:'LOCAL-SECRET-NOT-FOR-STORAGE'})}
  await checkRewardTarget(f.env,first.order.id,credential)
  await assert.rejects(checkRewardTarget(f.env,second.order.id,credential),/人工审核/)
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM member_target_claims').get()!.n,1)
  const stored=JSON.stringify(f.db.prepare('SELECT * FROM member_target_uses').all())
  assert(!stored.includes('same-target@'));assert(!stored.includes('LOCAL-SECRET'))
  assert.equal(f.db.prepare('SELECT review_status FROM member_order_promotions WHERE order_id=?').get(second.order.id)!.review_status,'required')
})

test('paid target anomalies can be reviewed without charging or consuming rewards again',async t=>{
  const f=await setup(t);await f.earn(1)
  const other=await f.identity('independent-inviter@example.test'),otherCode=other.info.member.inviteCode
  const previous=await f.create('previous-target@example.test',0,f.code,false,'plus',await f.buyer())
  const {order}=await f.create('boundary@example.test',1000,otherCode)
  f.db.prepare("UPDATE orders SET payment_status='paid' WHERE id=?").run(order.id)
  await reconcileMemberRewards(f.env)
  const credential={mode:'session' as const,session:JSON.stringify({user:{email:'duplicate@example.test'}})}
  await checkRewardTarget(f.env,previous.order.id,credential)
  await assert.rejects(checkRewardTarget(f.env,order.id,credential),/人工审核/)
  const p=f.db.prepare('SELECT * FROM member_order_promotions WHERE order_id=?').get(order.id)!
  assert.equal(p.allocation_status,'captured')
  assert.equal((await f.call('/api/admin/members',{id:order.id,action:'approve',updatedAt:p.updated_at,note:'核对充值目标后放行，不发邀请奖励'},f.admin)).status,200)
  assert.equal(f.db.prepare('SELECT remaining_cents FROM member_reward_grants').get()!.remaining_cents,0)
  assert.equal(f.upstream.writes.length,0)
})

test('reward audit failures roll back revocation and reward ledger cannot be edited or deleted',async t=>{
  const f=await setup(t);await f.earn(1)
  const g=f.db.prepare('SELECT id,version FROM member_reward_grants').get()!
  f.db.exec("CREATE TRIGGER fixture_reject_audit BEFORE INSERT ON admin_audit WHEN NEW.action='member-reward-revoke' BEGIN SELECT RAISE(ABORT,'fixture audit failure'); END")
  assert.equal((await f.call('/api/admin/members',{id:g.id,version:g.version,action:'revoke',note:'核对异常'},f.admin)).status,503)
  assert.equal(f.db.prepare('SELECT status FROM member_reward_grants').get()!.status,'active')
  assert.equal(f.db.prepare('SELECT remaining_cents FROM member_reward_grants').get()!.remaining_cents,1000)
  assert.throws(()=>f.db.exec('DELETE FROM member_reward_ledger'),/append only/)
  assert.throws(()=>f.db.exec("UPDATE member_reward_ledger SET kind='changed'"),/append only/)
  assert.equal((await f.call('/api/admin/members?grant='+encodeURIComponent(String(g.id)))).status,401)
  const ledger=await f.call('/api/admin/members?grant='+encodeURIComponent(String(g.id)),undefined,f.admin)
  assert.equal(ledger.status,200)
  assert.deepEqual((await ledger.json()).ledger.map((l:{kind:string})=>l.kind).sort(),['activate','grant'])
})
