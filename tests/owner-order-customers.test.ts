import test from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { readFileSync, readdirSync } from 'node:fs'
import { customerFixture } from './customer-fixture.ts'

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
  f.env.OWNER_STOREFRONT_HOSTS = JSON.stringify({ 'general.example.test': 'store-3' })
  const directory = await json(f, '/api/admin/my-shop/directory')
  assert.deepEqual(directory.stores.map((s:any) => [s.name, s.active, s.storefront_url]), [
    ['ScholAI', true, 'https://shop.example.invalid/'],
    ['AI星球', true, 'https://general.example.test/'],
    ['备用商店', false, 'https://shop.example.invalid/s/store-2'],
  ])
  assert.equal((await f.request('/api/admin/my-shop/directory')).status, 401)
})

test('workbench pending count matches its order drilldown and today uses Beijing order creation time', async t => {
  const f = await customerFixture()
  t.after(() => f.db.close())
  const midnight = Math.floor((Date.now() + 28800000) / 86400000) * 86400000 - 28800000
  const agent = await f.agent('代理渠道')
  const waiting = order(f.db, { status: 'session', payment_status: 'paid', created_at: midnight })
  const waitingAgent = order(f.db, { status: 'processing', payment_status: 'paid', partner_id: agent.id, created_at: midnight })
  order(f.db, { status: 'success', payment_status: 'paid', owner_store_id: 'store-3', price_cents: 900, created_at: midnight + 1 })
  order(f.db, { status: 'success', payment_status: 'paid', created_at: midnight - 1 })
  order(f.db, { status: 'failed', payment_status: 'paid', refunded_cents: 1000, created_at: midnight - 1 })
  order(f.db, { status: 'processing', payment_status: 'paid', is_test: 1, created_at: midnight })
  order(f.db, { status: 'processing', mode: 'demo', created_at: midnight })
  order(f.db, { created_at: midnight + 86400000 })
  const workbench = await json(f, '/api/admin/workbench')
  assert.deepEqual(workbench, { pendingOrders: 2, today: { orders: 2, paid: 2, cash_cents: 1900 } })
  const drilldown = await json(f, '/api/admin/orders?status=active')
  assert.equal(drilldown.total, workbench.pendingOrders)
  assert.deepEqual(new Set(drilldown.orders.map((row: { id: string }) => row.id)), new Set([waiting, waitingAgent]))
  assert.equal((await f.request('/api/admin/workbench')).status, 401)
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
