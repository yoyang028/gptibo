import test from 'node:test'
import assert from 'node:assert/strict'
import { operationsFixture } from './member-operations-fixture.ts'

function notices(f: Awaited<ReturnType<typeof operationsFixture>>, memberId: string, count: number) {
  for (let i=0;i<count;i++) {
    const id=crypto.randomUUID()
    f.db.prepare("INSERT INTO member_notifications(id,event_key,kind,target_id,member_id,mail_body,created_at) VALUES (?,?,'pagination-fixture',?,?,?,?)")
      .run(id,id,'notice-'+i,memberId,JSON.stringify({subject:'通知 '+i,text:'本地分页验证'}),Date.now()+i)
  }
}

test('member records have independent ten-row pages, complete boundaries and unchanged reward totals', async t => {
  const f=await operationsFixture(t);await f.earn(11);notices(f,f.member.id,21)
  const other=await f.identity('other-pagination@example.test');notices(f,other.id,2)
  const ledgerBefore=f.db.prepare('SELECT * FROM member_reward_ledger ORDER BY id').all()
  const read=async(query='')=>{
    const response=await f.call('/api/member/session'+query,undefined,f.member.cookie)
    assert.equal(response.status,200,await response.clone().text());return response.json()
  }
  const first=await read()
  for(const key of ['rewards','ledger','notifications']){
    assert.equal(first[key].length,10);assert.deepEqual(first.pagination[key],{page:1,hasNext:true})
  }
  assert.equal(first.pagination.pageSize,10)
  const mixed=await read('?rewardsPage=2&ledgerPage=2&notificationsPage=3')
  assert.equal(mixed.rewards.length,1);assert.equal(mixed.ledger.length,10);assert.equal(mixed.notifications.length,1)
  assert.deepEqual(mixed.pagination.rewards,{page:2,hasNext:false});assert.deepEqual(mixed.pagination.notifications,{page:3,hasNext:false})
  assert.equal(mixed.balanceCents,first.balanceCents);assert.deepEqual(mixed.totals,first.totals)
  for(const key of ['rewards','ledger','notifications'])assert(first[key].every((row:{id:string})=>!mixed[key].some((next:{id:string})=>next.id===row.id)))
  const middle=await read('?notificationsPage=2'),last=await read('?ledgerPage=3')
  assert.equal(last.ledger.length,2);assert.equal(last.pagination.ledger.hasNext,false)
  assert.deepEqual(middle.rewards,first.rewards);assert.deepEqual(middle.ledger,first.ledger)
  const received=[...first.notifications,...middle.notifications,...mixed.notifications].map(n=>n.id)
  assert.equal(new Set(received).size,21)
  const expected=f.db.prepare("SELECT id FROM member_notifications WHERE member_id=? AND status<>'cancelled' ORDER BY created_at DESC,id").all(f.member.id).map(n=>n.id)
  assert.deepEqual(received,expected)
  assert.deepEqual(f.db.prepare('SELECT * FROM member_reward_ledger ORDER BY id').all(),ledgerBefore)
})

test('member pagination validates each section, preserves legacy page queries and keeps store isolation', async t => {
  const f=await operationsFixture(t)
  for(const key of ['rewardsPage','ledgerPage','notificationsPage'])for(const page of ['0','-1','1.5','NaN','100001'])assert.equal((await f.call('/api/member/session?'+key+'='+page,undefined,f.member.cookie)).status,400)
  const legacy=await(await f.call('/api/member/session?page=2',undefined,f.member.cookie)).json()
  for(const key of ['rewards','ledger','notifications'])assert.deepEqual(legacy.pagination[key],{page:2,hasNext:false})
  const isolated=await(await f.call('/api/member/session?notificationsPage=2',undefined,f.member.cookie,'https://shop.example.invalid')).json()
  assert.equal(isolated.enabled,false);assert.equal(isolated.member,null)
})

test('a full final page does not offer a false next page and cancelled notices are excluded', async t => {
  const f=await operationsFixture(t);notices(f,f.member.id,11)
  f.db.prepare("UPDATE member_notifications SET status='cancelled' WHERE member_id=? AND target_id='notice-0'").run(f.member.id)
  const response=await(await f.call('/api/member/session',undefined,f.member.cookie)).json()
  assert.equal(response.notifications.length,10);assert.deepEqual(response.pagination.notifications,{page:1,hasNext:false})
  assert.equal(response.rewards.length,0);assert.equal(response.ledger.length,0)
})
