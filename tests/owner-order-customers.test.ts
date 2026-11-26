import test from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { readFileSync, readdirSync } from 'node:fs'
import { customerFixture } from './customer-fixture.ts'
import { monthAfter } from '../shared/customers.ts'

function order(db: DatabaseSync, patch: Record<string, unknown> = {}) {
  const row={id:'CRM-'+crypto.randomUUID().toUpperCase(),owner_hash:'fixture-owner',idempotency_key:crypto.randomUUID(),plan:'plus',plan_name:'Plus',price_cents:1000,mode:'live',payment_status:'unpaid',status:'pending',created_at:Date.now(),updated_at:Date.now(),last_event_id:crypto.randomUUID(),customer_email:'buyer@example.test',owner_store_id:'platform',partner_id:null,is_test:0,refunded_cents:0,...patch}
  db.prepare(`INSERT INTO orders(${Object.keys(row).join(',')}) VALUES(${Object.keys(row).map(()=>'?').join(',')})`).run(...Object.values(row) as never[])
  return row.id
}
async function json(f: Awaited<ReturnType<typeof customerFixture>>, path: string) {
  const response=await f.request(path,undefined,f.admin)
  assert.equal(response.status,200,await response.clone().text())
  return response.json() as Promise<any>
}

function rechargeReceipt(db: DatabaseSync, id: string, opened: number, accountHint: string | null) {
  db.prepare("INSERT INTO recharge_orders(order_id,account,product_code,collection_mode,create_body,payment_status,updated_at) VALUES(?,'fixture','plus','platform_collect','{}','paid',?)").run(id, opened)
  db.prepare("INSERT INTO recharge_redemptions(id,order_id,attempt_no,request_hash,credential_mode,status,account_email_masked,finished_at,created_at) VALUES(?,?,1,'fixture','session','succeeded',?,?,?)")
    .run(crypto.randomUUID(), id, accountHint, opened, opened - 60000)
  db.prepare("INSERT INTO order_events(id,order_id,actor,action,from_status,to_status,note,order_version,created_at) VALUES(?,?,'system','recharge-status','processing','success','fixture',1,?)")
    .run(crypto.randomUUID(), id, opened + 60000)
}

test('existing order contacts backfill once, reuse manual CRM contacts and preserve every original order',()=>{
  const db=new DatabaseSync(':memory:');db.exec('PRAGMA foreign_keys=ON')
  try{
    for(const file of readdirSync(new URL('../migrations/',import.meta.url)).filter(f=>f.endsWith('.sql')&&f<'0069').sort())db.exec(readFileSync(new URL('../migrations/'+file,import.meta.url),'utf8'))
    const manual=crypto.randomUUID()
    db.prepare("INSERT INTO crm_customers(id,name,email,note,source,created_at,updated_at) VALUES(?,'手工客户','Buyer@Example.Test','保留备注','老客户',1,1)").run(manual)
    const beforeCustomer=db.prepare('SELECT * FROM crm_customers').all()
    order(db);order(db,{customer_email:' BUYER@example.test ',owner_store_id:'store-3'});order(db,{customer_email:'second@example.test'})
    const beforeOrders=db.prepare('SELECT * FROM orders ORDER BY id').all()
    db.exec(readFileSync(new URL('../migrations/0069_owner_order_customers.sql',import.meta.url),'utf8'))
    assert.equal(db.prepare('SELECT COUNT(*) n FROM crm_customers').get()!.n,2)
    assert.equal(db.prepare("SELECT customer_id FROM owner_order_customers WHERE email='buyer@example.test'").get()!.customer_id,manual)
    assert.deepEqual(db.prepare('SELECT * FROM crm_customers WHERE id=?').all(manual),beforeCustomer)
    assert.deepEqual(db.prepare('SELECT * FROM orders ORDER BY id').all(),beforeOrders)
    assert.equal(db.prepare('PRAGMA foreign_key_check').all().length,0)
  }finally{db.close()}
})

test('new orders automatically deduplicate across shops; payment and refund statistics follow live order data',async t=>{
  const f=await customerFixture();t.after(()=>f.db.close())
  order(f.db,{price_cents:2000,payment_status:'paid',status:'success',refunded_cents:500})
  order(f.db,{owner_store_id:'store-3',customer_email:' BUYER@EXAMPLE.TEST ',payment_status:'paid',status:'success'})
  const pending=order(f.db,{price_cents:500})
  let view=await json(f,'/api/admin/customers?scope=owner')
  assert.equal(view.total,1)
  const id=view.customers[0].id
  assert.deepEqual([view.stats.order_count,view.stats.order_paid_cents,view.stats.order_refunded_cents,view.stats.order_net_cents],[3,3000,500,2500])
  const root=await json(f,'/api/admin/customers?scope=owner&store=platform')
  assert.deepEqual([root.stats.order_count,root.stats.order_net_cents],[2,1500])
  const general=await json(f,'/api/admin/customers?scope=owner&store=store-3')
  assert.equal(general.stats.order_count,1)
  assert.equal(general.customers[0].id,id)
  assert.equal((await json(f,'/api/admin/customers?scope=owner&store=store-2')).total,0)
  f.db.prepare("UPDATE orders SET payment_status='paid',status='success' WHERE id=?").run(pending)
  view=await json(f,'/api/admin/customers?scope=owner')
  assert.equal(view.stats.order_paid_cents,3500)
  assert.equal(view.total,1)
  const detail=await json(f,'/api/admin/customers/'+id)
  assert.equal(detail.orders.length,3)
  assert.equal(detail.orderStats.order_net_cents,3000)
  assert(!('owner_hash' in detail.orders[0]))
  assert(!('supplier_snapshot' in detail.orders[0]))
  const exported=await json(f,'/api/admin/customers/export?scope=owner&store=store-3')
  assert.equal(exported.customers[0].order_count,1)
  assert.equal(exported.customers[0].order_paid_cents,1000)
})

test('agent, demo and test orders never become owner customers; transaction rollback leaves no phantom contact',async t=>{
  const f=await customerFixture();t.after(()=>f.db.close())
  const agent=await f.agent('代理')
  order(f.db,{partner_id:agent.id});order(f.db,{mode:'demo'});order(f.db,{is_test:1})
  assert.equal((await json(f,'/api/admin/customers?scope=owner')).total,0)
  f.db.exec('BEGIN');order(f.db);f.db.exec('ROLLBACK')
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM owner_order_customers').get()!.n,0)
  const id=order(f.db,{customer_email:null})
  f.db.prepare("UPDATE orders SET customer_email='Late@Example.Test' WHERE id=?").run(id)
  assert.equal((await json(f,'/api/admin/customers?scope=owner')).total,1)
  assert.equal((await f.request('/api/partner/customers?scope=owner',undefined,agent.cookie)).status,403)
})

test('owner order overview and store filters share search, status and count rules while excluding reseller orders',async t=>{
  const f=await customerFixture();t.after(()=>f.db.close())
  const root=order(f.db),general=order(f.db,{owner_store_id:'store-3',customer_email:'other@example.test'})
  const agent=await f.agent('渠道')
  order(f.db,{partner_id:agent.id})
  const all=await json(f,'/api/admin/orders?scope=owner')
  assert.equal(all.total,2)
  assert.deepEqual(new Set(all.orders.map((o:any)=>o.id)),new Set([root,general]))
  const selected=await json(f,'/api/admin/orders?scope=owner&store=store-3&status=pending&q=other%40example.test')
  assert.equal(selected.total,1)
  assert.equal(selected.orders[0].ownerStoreName,'AI星球')
  assert.equal((await json(f,'/api/admin/orders?scope=owner&store=platform&q=other%40example.test')).total,0)
  assert.equal((await json(f,'/api/admin/orders?scope=owner&store=store-2')).total,0)
  assert.equal((await f.request('/api/admin/orders?scope=owner&store=missing',undefined,f.admin)).status,404)
})

test('presentation order changes without reassigning store IDs, domain ownership, prices or the reserved shop status',async t=>{
  const f=await customerFixture();t.after(()=>f.db.close())
  const stores=(await json(f,'/api/admin/my-shop/stores')).stores
  assert.deepEqual(stores.map((s:any)=>[s.id,s.name,s.slot]),[['platform','ScholAI',1],['store-3','AI星球',2],['store-2','备用商店',3]])
  assert.equal(stores[2].active,false)
  assert.equal(stores[1].slug,'store-3')
  assert.equal(f.db.prepare("SELECT slot FROM owner_shop_settings WHERE id='store-3'").get()!.slot,3)
})

test('customer spending uses actual promotion cash and never treats zero-cash member credit as cash received',async t=>{
  const f=await customerFixture();t.after(()=>f.db.close())
  for(const cash of [600,0]){
    const id=order(f.db,{owner_store_id:'store-3',price_cents:cash||1000,payment_status:'paid',status:'success',member_promotion:1})
    f.db.prepare("INSERT INTO member_order_promotions(order_id,store_id,customer_key,original_cents,other_cents,cash_cents,supply_cents,supplier_snapshot,request_hash,review_status,procurement_status,allocation_status,created_at,updated_at) VALUES(?,'store-3','fixture',1000,?,?,500,'{}',?,'none','ready','reserved',?,?)").run(id,1000-cash,cash,crypto.randomUUID(),Date.now(),Date.now())
  }
  const view=await json(f,'/api/admin/customers?scope=owner&store=store-3')
  assert.equal(view.stats.order_count,2)
  assert.equal(view.stats.order_paid_cents,600)
  assert.equal(view.stats.order_net_cents,600)
})

test('admin customer tabs, store detail, totals and export remain isolated even when the same contact uses both stores and an agent', async t => {
  const f = await customerFixture()
  t.after(() => f.db.close())
  const partner = await f.agent('演示代理')
  const agentCustomer = crypto.randomUUID()
  await f.request('/api/partner/customers', { key:agentCustomer,name:'代理客户档案',email:'buyer@example.test' }, partner.cookie)
  order(f.db, { owner_store_id:'store-3' })
  order(f.db)
  order(f.db, { customer_email:'other@example.test' })
  const direct = await json(f, '/api/admin/customers?scope=owner')
  assert.deepEqual(direct.stores.map((store:{name:string}) => store.name), ['ScholAI','AI星球','备用商店'])
  assert.equal(direct.total, 2)
  assert.equal(direct.stats.order_count, 3)
  const selected = await json(f, '/api/admin/customers?scope=owner&store=store-3')
  assert.equal(selected.total, 1)
  const id = selected.customers[0].id
  const detail = await json(f, `/api/admin/customers/${id}?scope=owner&store=store-3`)
  assert.deepEqual(detail.orders.map((o:{store_name:string}) => o.store_name), ['AI星球'])
  assert.equal((await json(f, `/api/admin/customers/${id}?scope=owner`)).orderStats.order_count, 2)
  assert.equal((await f.request(`/api/admin/customers/${id}?scope=owner&store=store-2`, undefined, f.admin)).status, 404)
  const agents = await json(f, '/api/admin/customers?scope=agent')
  assert.deepEqual(agents.customers.map((c:{id:string}) => c.id),[agentCustomer])
  const exported = await json(f, '/api/admin/customers/export?scope=agent')
  assert.equal(exported.customers[0].id,agentCustomer)
  assert.equal(exported.orderMemberships,undefined)
  assert.equal((await f.request(`/api/admin/customers/${agentCustomer}?scope=owner`, undefined, f.admin)).status, 404)
  assert.equal((await f.request(`/api/admin/customers/${id}?scope=agent`, undefined, f.admin)).status, 404)
  assert.equal((await f.request('/api/admin/customers?scope=agent&store=store-3', undefined, f.admin)).status, 400)
  assert.equal((await f.request('/api/partner/customers?scope=agent', undefined, partner.cookie)).status,403)
})

test('verified monthly orders appear in account, expiry and reminder filters without inventing accounts or overwriting manual records', async t => {
  const f = await customerFixture()
  t.after(() => f.db.close())
  t.mock.timers.enable({ apis:['Date'], now:Date.parse('2026-02-24T00:00:00+08:00') })
  const opened = Date.parse('2026-01-31T23:58:47.321+08:00')
  const archivedOpened = Date.parse('2025-12-31T10:30:00+08:00')
  const paid = { payment_status:'paid' }
  const pending = order(f.db,{...paid,owner_store_id:'store-3',status:'session'})
  const expired = order(f.db,{...paid,status:'success',created_at:archivedOpened-86400000})
  rechargeReceipt(f.db,expired,archivedOpened,'z***@example.test')
  const noEvidence = order(f.db,{...paid,customer_email:'unverified@example.test',status:'success'})
  const noMask = order(f.db,{...paid,customer_email:'missing-account@example.test',status:'success',created_at:opened-86400000})
  rechargeReceipt(f.db,noMask,opened,'plaintext-not-an-account-hint@example.test')
  const refunded = order(f.db,{...paid,customer_email:'refund@example.test',status:'success',refunded_cents:1000,created_at:opened-86400000})
  rechargeReceipt(f.db,refunded,opened,'r***@example.test')
  const shop = '/api/admin/customers?scope=owner&store=store-3'
  let rows = await json(f, shop)
  assert.deepEqual([rows.customers[0].ordered_plans,rows.customers[0].membership_state,rows.customers[0].expected_expiry], ['Plus','pending',null])
  assert.equal(rows.customers[0].bound_account_hints,null)

  f.db.prepare("UPDATE orders SET status='success',created_at=? WHERE id=?").run(opened-86400000,pending)
  rechargeReceipt(f.db,pending,opened,'b***@example.test')
  rows = await json(f, shop + '&plan=plus&expiry=soon')
  assert.equal(rows.total,1)
  const customer = rows.customers[0]
  assert.equal(customer.bound_account_hints,'b***@example.test')
  assert.equal(customer.expected_expiry,monthAfter(opened))
  assert.equal(customer.membership_soon,1)
  assert.equal(customer.membership_expired,0)
  assert.equal(rows.stats.soon,1)
  assert.equal((await json(f, shop + '&expiry=expired')).total,0)
  assert.equal((await json(f, shop + '&expiry=none')).total,0)
  const scoped = await json(f, `/api/admin/customers/${customer.id}?scope=owner&store=store-3`)
  assert.deepEqual(scoped.orderMemberships.map((record:{order_id:string}) => record.order_id),[pending])
  assert.equal(scoped.accounts.length,0)
  assert.equal(scoped.subscriptions.length,0)
  const all = await json(f,`/api/admin/customers/${customer.id}?scope=owner`)
  assert.equal(all.orderMemberships.length,2)
  const missing = await json(f,'/api/admin/customers?scope=owner&q=missing-account')
  assert.equal(missing.customers[0].bound_account_hints,null)
  const exported = await json(f,'/api/admin/customers/export?scope=owner')
  assert.equal(exported.orderMemberships.find((r:{order_id:string}) => r.order_id === noEvidence).state,'unverified')
  assert.equal(exported.orderMemberships.find((r:{order_id:string}) => r.order_id === refunded).expected_expiry,null)
  assert.equal(exported.orderMemberships.find((r:{order_id:string}) => r.order_id === refunded).state,'refunded')
  assert(!JSON.stringify(exported).includes('plaintext-not-an-account-hint'))
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM crm_subscriptions').get()!.n,0)
})
