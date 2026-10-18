import test from 'node:test'
import assert from 'node:assert/strict'
import { customerFixture } from './customer-fixture.ts'
import { prepareDajuCleanup } from '../worker/hanfolk/cleanup.ts'
import { importHanfolkDrafts } from '../worker/hanfolk/importer.ts'
import { refreshHanfolkStock } from '../worker/hanfolk/management.ts'
import { customOrderSummary } from '../worker/shop-products.ts'
import { getOrder } from '../worker/order-state.ts'
import type { HanfolkDetail } from '../shared/hanfolk-catalog.ts'
// @ts-ignore -- shared isolated supplier fixture, without live credentials.
import { createHanfolkFixture, hanfolkFixtureProducts, hanfolkFixtureKey } from '../scripts/cloudflare/hanfolk-fixture.mjs'

type Fixture = Awaited<ReturnType<typeof customerFixture>>
const sources = hanfolkFixtureProducts as HanfolkDetail[]
async function seed(f: Fixture, details = sources.slice(0,3)) {
  return (await importHanfolkDrafts(f.env, details, details.flatMap(p => p.sku_variants.map(s => ({ productId:p.id,sku:s.sku }))))).imported
}
async function cleanup(f: Fixture, details: HanfolkDetail[]) {
  const event = crypto.randomUUID()
  const statements = await prepareDajuCleanup(f.env,details,event)
  await f.env.INTEREST_DB.batch([f.env.INTEREST_DB.prepare("UPDATE hanfolk_settings SET change_id=? WHERE id='main'").bind(event),...statements])
  return (f.db.prepare('SELECT plan_id FROM catalog_deletions WHERE change_id=?').all(event) as {plan_id:string}[]).map(p=>p.plan_id)
}

test('Daju cleanup physically removes unavailable and retired duplicates from active tables, while preserving valid products and other suppliers', async t => {
  const f=await customerFixture();t.after(()=>f.db.close())
  const ids=await seed(f)
  const original=f.db.prepare('SELECT * FROM shop_products WHERE id=?').get(ids[0])!
  const product=JSON.parse(String(original.public_json))
  const legacyId='custom-'+crypto.randomUUID().replaceAll('-','')
  const unrelatedId='custom-'+crypto.randomUUID().replaceAll('-','')
  for(const [id,provider] of [[legacyId,null],[unrelatedId,'xiaojiu']]) {
    const copy={...product,id,status:'archived',...(provider?{api:{provider,configured:false,verified:false,baseUrl:'https://98-xj.com',productCode:'123'}}:{})}
    f.db.prepare('INSERT INTO catalog_plans(id,product_id,name,price_cents,enabled,updated_at) VALUES(?,?,?,?,0,0)').run(id,product.groupId,copy.name,500)
    f.db.prepare('INSERT INTO shop_products(id,public_json,updated_at,change_id) VALUES(?,?,0,?)').run(id,JSON.stringify(copy),'fixture')
  }
  f.db.prepare("INSERT INTO product_artwork(product_id,settings,updated_at,change_id) VALUES(?,'{}',0,'fixture')").run(product.groupId)
  f.db.prepare("INSERT INTO product_artwork(product_id,settings,updated_at,change_id) VALUES(?,'{}',0,'fixture')").run(ids[1])
  const fresh=sources.slice(0,2).map((p,i)=>i===0?{...p,sku_variants:p.sku_variants.map((s,j)=>({...s,stock:j===1?0:7}))}:p)
  const valid=f.db.prepare('SELECT * FROM shop_products WHERE id IN (?,?,?) ORDER BY id').all(ids[0],ids[2],ids[3])
  const removed=await cleanup(f,fresh)
  assert.deepEqual(new Set(removed),new Set([ids[1],ids[4],ids[5],legacyId]))
  for(const id of removed) {
    for(const [table,column]of [['shop_products','id'],['hanfolk_product_links','local_id'],['catalog_plans','id'],['shop_redemption_guides','product_id']])
      assert.equal(f.db.prepare(`SELECT COUNT(*) n FROM ${table} WHERE ${column}=?`).get(id)!.n,0,table)
  }
  assert.deepEqual(f.db.prepare('SELECT * FROM shop_products WHERE id IN (?,?,?) ORDER BY id').all(ids[0],ids[2],ids[3]),valid)
  assert(f.db.prepare('SELECT id FROM shop_products WHERE id=?').get(unrelatedId))
  assert(f.db.prepare('SELECT product_id FROM product_artwork WHERE product_id=?').get(product.groupId))
  assert(!f.db.prepare('SELECT product_id FROM product_artwork WHERE product_id=?').get(ids[1]))
  const inventory=await (await f.request('/api/admin/suppliers',undefined,f.admin)).text()
  for(const id of removed) assert(!inventory.includes(id))
  assert.equal(f.db.prepare('PRAGMA foreign_key_check').all().length,0)
})

test('Deleted products retain order and CRM history but never return to catalog or management pickers',async t=>{
  const f=await customerFixture();t.after(()=>f.db.close())
  const ids=await seed(f,sources.slice(0,1))
  const row=f.db.prepare('SELECT public_json FROM shop_products WHERE id=?').get(ids[0])!
  const snapshot=String(row.public_json)
  const orderId='DAJU-HISTORY-TEST'
  f.db.prepare("INSERT INTO orders(id,owner_hash,idempotency_key,plan,plan_name,price_cents,mode,payment_status,status,created_at,updated_at,last_event_id) VALUES(?,'fixture-owner','fixture-key',?,'Historical Daju',500,'live','paid','success',1,1,'fixture')").run(orderId,ids[0])
  f.db.prepare("INSERT INTO shop_order_details(order_id,product_id,snapshot,fields,delivery_content) VALUES(?,?,?,'{}','HISTORICAL-DELIVERY')").run(orderId,ids[0],snapshot)
  f.db.prepare("INSERT INTO crm_customers(id,name,email,created_at,updated_at) VALUES('history-customer','Fixture','fixture@example.test',0,0)").run()
  f.db.prepare("INSERT INTO crm_accounts(id,customer_id,account,created_at,updated_at) VALUES('history-account','history-customer','fixture',0,0)").run()
  f.db.prepare("INSERT INTO crm_subscriptions(id,account_id,plan,plan_name,kind,paid_cents,opened_at,expires_at,created_at) VALUES('history-subscription','history-account',?,'Historical CRM','open',500,0,1000,0)").run(ids[1])
  for(const id of ids)f.db.prepare('INSERT INTO accounting_costs(plan,cost_cents) VALUES(?,100)').run(id)
  const beforeOrders=f.db.prepare('SELECT * FROM orders').all()
  const beforeDetails=f.db.prepare('SELECT * FROM shop_order_details').all()
  const fresh=[{...sources[0],sku_variants:sources[0].sku_variants.map(s=>({...s,stock:0}))}]
  await cleanup(f,fresh)
  for(const id of ids){
    assert.equal(f.db.prepare('SELECT enabled FROM catalog_plans WHERE id=?').get(id)!.enabled,0)
    assert(!f.db.prepare('SELECT id FROM shop_products WHERE id=?').get(id))
  }
  assert.deepEqual(f.db.prepare('SELECT * FROM orders').all(),beforeOrders)
  assert.deepEqual(f.db.prepare('SELECT * FROM shop_order_details').all(),beforeDetails)
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM crm_subscriptions').get()!.n,1)
  const view=await customOrderSummary(f.env,await getOrder(f.env,orderId))
  assert.equal(view?.deliveryContent,'HISTORICAL-DELIVERY')
  for(const route of ['/api/admin/suppliers','/api/admin/plans','/api/admin/my-shop/products','/api/admin/product-artwork']) {
    const response=await f.request(route,undefined,f.admin);assert.equal(response.status,200,route)
    const text=await response.text();for(const id of ids)assert(!text.includes(id),route)
  }
  assert.equal(f.db.prepare('PRAGMA foreign_key_check').all().length,0)
  // Restocking can be deliberately imported again without changing the old order.
  await importHanfolkDrafts(f.env,[sources[0]],[{productId:sources[0].id,sku:sources[0].sku_variants[0].sku}])
  assert(f.db.prepare('SELECT id FROM shop_products WHERE id=?').get(ids[0]))
  assert(!f.db.prepare('SELECT plan_id FROM catalog_deletions WHERE plan_id=?').get(ids[0]))
  assert.deepEqual(f.db.prepare('SELECT * FROM shop_order_details').all(),beforeDetails)
})

test('A stale source transaction or concurrent product edit cannot delete an item',async t=>{
  const f=await customerFixture();t.after(()=>f.db.close())
  const ids=await seed(f,sources.slice(0,1))
  const event=crypto.randomUUID()
  const statements=await prepareDajuCleanup(f.env,[],event)
  await f.env.INTEREST_DB.batch(statements)
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM shop_products WHERE id IN (?,?)').get(...ids)!.n,2)
  f.db.prepare('UPDATE shop_products SET version=version+1 WHERE id=?').run(ids[0])
  await f.env.INTEREST_DB.batch([f.env.INTEREST_DB.prepare("UPDATE hanfolk_settings SET change_id=? WHERE id='main'").bind(event),...statements])
  assert(f.db.prepare('SELECT id FROM shop_products WHERE id=?').get(ids[0]))
  assert(!f.db.prepare('SELECT id FROM shop_products WHERE id=?').get(ids[1]))
})

test('Supplier transport failure never replaces the last successful catalog or deletes products',async t=>{
  const f=await customerFixture();t.after(()=>f.db.close())
  await seed(f,sources.slice(0,1))
  assert.equal((await f.request('/api/admin/hanfolk',{action:'save-key',version:0,apiKey:hanfolkFixtureKey},f.admin)).status,200)
  const supplier=createHanfolkFixture()
  t.mock.method(globalThis,'fetch',async(input:RequestInfo|URL,init?:RequestInit)=>{
    const request=new Request(input,init)
    return new URL(request.url).searchParams.get('do')==='product'?new Response('',{status:503}):supplier.fetch(request)
  })
  const before=f.db.prepare('SELECT * FROM shop_products ORDER BY id').all()
  await assert.rejects(refreshHanfolkStock(f.env))
  assert.deepEqual(f.db.prepare('SELECT * FROM shop_products ORDER BY id').all(),before)
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM catalog_deletions').get()!.n,0)
})

test('Daju imports reject zero-stock and absent upstream specifications before creating any rows',async t=>{
  const f=await customerFixture();t.after(()=>f.db.close())
  const before=f.db.prepare('SELECT * FROM shop_products ORDER BY id').all()
  const soldOut={...sources[0],sku_variants:sources[0].sku_variants.map(v=>({...v,stock:0}))}
  await assert.rejects(importHanfolkDrafts(f.env,[soldOut],[{productId:soldOut.id,sku:soldOut.sku_variants[0].sku}]),/无货/)
  await assert.rejects(importHanfolkDrafts(f.env,[sources[0]],[{productId:sources[0].id,sku:'removed-sku'}]),/规格缓存已变化/)
  assert.deepEqual(f.db.prepare('SELECT * FROM shop_products ORDER BY id').all(),before)
})
