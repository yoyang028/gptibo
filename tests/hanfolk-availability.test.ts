import test from 'node:test'
import assert from 'node:assert/strict'
import { customerFixture } from './customer-fixture.ts'
import { importHanfolkDrafts } from '../worker/hanfolk/importer.ts'
import { refreshHanfolkStock } from '../worker/hanfolk/management.ts'
import type { HanfolkDetail } from '../shared/hanfolk-catalog.ts'
// @ts-ignore -- read-only loopback supplier, no live credentials.
import { createHanfolkFixture, hanfolkFixtureProducts, hanfolkFixtureKey } from '../scripts/cloudflare/hanfolk-fixture.mjs'

test('Only exact in-stock source SKUs are public; removed SKUs, missing products and old offers never fall back', async t => {
  const f = await customerFixture()
  t.after(() => f.db.close())
  const source: HanfolkDetail = { ...hanfolkFixtureProducts.find((p: HanfolkDetail) => /gmail/i.test(p.title)),
    specs: [{ title: '年份', values: [{id:'1',name:'2025'}, {id:'2',name:'2024'}, {id:'3',name:'2023'}] }],
    is_sku: true,
    sku_variants: [{sku:'1',price:1,stock:5},{sku:'2',price:2,stock:0},{sku:'3',price:3,stock:6}] }
  const importable = { ...source, sku_variants: source.sku_variants.map(v => ({ ...v, stock: Math.max(1, v.stock) })) }
  const imported = await importHanfolkDrafts(f.env, [importable], source.sku_variants.map(v => ({productId:source.id,sku:v.sku})))
  for (const id of imported.imported) {
    const row=f.db.prepare('SELECT public_json FROM shop_products WHERE id=?').get(id)!
    const p={...JSON.parse(String(row.public_json)),status:'listed',catalogPreview:true}
    f.db.prepare('UPDATE shop_products SET public_json=? WHERE id=?').run(JSON.stringify(p),id)
  }
  const cache = (detail: HanfolkDetail, key = '') => f.db.prepare('INSERT INTO hanfolk_catalog(product_id,summary,detail,key_hash,checked_at) VALUES(?,?,?,?,?) ON CONFLICT(product_id) DO UPDATE SET detail=excluded.detail,key_hash=excluded.key_hash').run(source.id,JSON.stringify(detail),JSON.stringify(detail),key,Date.now())
  const read = async () => (await (await f.request('/api/catalog')).json()) as {products:{id:string;stock:number}[]; plans:{id:string}[];managedProductGroups:string[]}
  // Import stock is not enough: a verified source cache must still contain the SKU.
  assert.equal((await read()).products.filter(p=>imported.imported.includes(p.id)).length,0)
  cache({...source,sku_variants:source.sku_variants.slice(0,2)})
  let catalog=await read()
  assert.deepEqual(catalog.products.filter(p=>imported.imported.includes(p.id)).map(p=>p.id),[imported.imported[0]])
  assert.equal(catalog.products.find(p=>p.id===imported.imported[0])!.stock,5)
  assert(catalog.managedProductGroups.includes('gmail'))
  assert(!catalog.plans.some(p=>p.id==='gmail-account'))
  cache({...source,sku_variants:[{sku:'1',price:1,stock:0}]})
  catalog=await read()
  assert.equal(catalog.products.filter(p=>imported.imported.includes(p.id)).length,0)
  assert(!catalog.products.some(p=>p.id==='gmail-account'))
  cache(source,'previous-key')
  assert.equal((await read()).products.filter(p=>imported.imported.includes(p.id)).length,0)
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM orders').get()!.n,0)
})

test('Scheduled stock refresh uses only supplier reads and preserves retail, copy and order records', async t => {
  const f=await customerFixture(), supplier=createHanfolkFixture()
  t.after(()=>f.db.close())
  const calls:Request[]=[]
  t.mock.method(globalThis,'fetch',async(input: RequestInfo|URL,init?:RequestInit)=>{const request=new Request(input,init);calls.push(request);return supplier.fetch(request)})
  await refreshHanfolkStock(f.env)
  assert.equal(calls.length,0)
  assert.equal((await f.request('/api/admin/hanfolk',{action:'save-key',version:0,apiKey:hanfolkFixtureKey},f.admin)).status,200)
  const before=f.db.prepare('SELECT * FROM catalog_plans ORDER BY id').all()
  const productsBefore=f.db.prepare('SELECT * FROM shop_products ORDER BY id').all()
  await refreshHanfolkStock(f.env)
  assert(calls.length>2)
  assert(calls.every(r=>r.method==='GET'&&['products','product','balance'].includes(new URL(r.url).searchParams.get('do')!)))
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM hanfolk_catalog WHERE detail IS NOT NULL').get()!.n,9)
  const count=calls.length
  await refreshHanfolkStock(f.env)
  assert.equal(calls.length,count,'fresh stock is reused')
  assert.deepEqual(f.db.prepare('SELECT * FROM catalog_plans ORDER BY id').all(),before)
  assert.deepEqual(f.db.prepare('SELECT * FROM shop_products ORDER BY id').all(),productsBefore)
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM orders').get()!.n,0)
})
