import test from 'node:test'
import assert from 'node:assert/strict'
import {customerFixture} from './customer-fixture.ts'
import {hanfolkFamily,type HanfolkDetail} from '../shared/hanfolk-catalog.ts'
import {hanfolkBuyerCopy} from '../shared/hanfolk-buyer-copy.ts'
import {hanfolkDraft,importHanfolkDrafts} from '../worker/hanfolk/importer.ts'
import {geminiKind,geminiVariants,geminiDefault,GEMINI_STUDENT_GUIDE,GEMINI_ACTIVATION_GUIDE,GEMINI_REGION_GUIDE,GEMINI_EXTENSION_GUIDE} from '../shared/gemini-products.ts'
import {publicBuyerProduct} from '../shared/redemption-copy.ts'
import {productCopyLinks} from '../shared/product-copy.ts'
import {readStorefrontPage,storefrontHref} from '../src/lib/storefront-routing.ts'

// Synthetic costs and inventory; the actual source ID and SKU structure only.
function source(id:3|36|70):HanfolkDetail {
 return {id,title:id===70?'Sheerid · 自助Google学生认证':id===36?'Google AI Pro18个月兑换链接（无需绑卡）（Jio渠道）':'Gemini Pro（Pixel/Jio开通）成品账号',description:id===70?'':id===36?'CDK 兑换 18个月 AI Pro，5TB，自己账号，无需绑卡。':'Google AI Pro 成品账号，用于 Gemini。',price:2,stock:2,sales:0,is_auto:true,cover:'https://example.com/fixture.svg',sort_id:0,is_sku:id===3,min_qty:1,max_qty:0,required_inputs:[],specs:id===3?[{title:'地区',values:[{id:'11',name:'随机'}]},{title:'年份',values:[{id:'29',name:'2009-2017'}]}]:[],sku_variants:[{sku:id===3?'11-29':'0',price:2,stock:id===3?0:2}]}
}
test('Exact SheerID Google student category is recognized without changing OpenAI students or Gmail',async()=>{
 assert.equal(hanfolkFamily(source(70).title),'gemini')
 assert.equal(hanfolkFamily('Google Gmail 账户'),'gmail')
 assert.equal(hanfolkFamily('Plus 学生认证'),undefined)
 const student=await hanfolkDraft(source(70),'0'),activation=await hanfolkDraft(source(36),'0'),account=await hanfolkDraft(source(3),'11-29')
 const all=[{...account,pricePending:false,priceCents:8800},{...student,status:'listed' as const,catalogPreview:true},{...activation,pricePending:false,priceCents:2800}],before=structuredClone(all)
 assert.deepEqual(geminiVariants(all).map(geminiKind),['student','activation','account'])
 assert.equal(geminiDefault(all),activation.id)
 assert.deepEqual(all,before)
 assert.match(student.deliveryInstructions,/资格|认证/)
 assert.doesNotMatch(student.deliveryInstructions,/兑换码|账号密码/)
})
test('Gemini copy separates genuine eligibility, monthly overwrite, CDK expiry and account years',()=>{
 const student=hanfolkBuyerCopy(source(70),'0'),activation=hanfolkBuyerCopy(source(36),'0'),account=hanfolkBuyerCopy(source(3),'11-29')
 assert.match(student.description,/本人.*资格/);assert.match(student.features.join(' '),/不直接交付会员/);assert.match(student.description,/信用卡/)
 assert.match(student.name,/12 个月.*学生资格认证.*推荐/);assert.match(student.duration,/12 个月学生优惠.*单次认证/)
 assert.match(student.description,/不代表保证永不掉订阅/);assert.match(student.description,/不是.*12 个月认证保障/)
 assert.match(activation.purchaseNote,/覆盖.*不按.*叠加/);assert.match(activation.purchaseNote,/未兑出.*退款/);assert.match(activation.purchaseNote,/链接.*到期/)
 assert.match(activation.faq.map(f=>f.answer).join(' '),/不会消耗/)
 assert.match(activation.description,/持续保持有效 5G 套餐/);assert.match(activation.description,/中途掉订阅风险/)
 assert.match(account.description,/不套用 18 个月/)
 assert.match(account.purchaseNote,/不承诺固定 12 个月/);assert.match(account.purchaseNote,/可能导致掉订阅/)
 for(const p of [student,activation,account])assert.doesNotMatch(JSON.stringify(p),/暂未开放|准备中|尚未提供|待核实|上游/)
})

test('Approved student ¥58 and activation ¥38 persist across source rereads without opening sales or rewriting other retails',async()=>{
 const f=await customerFixture(),before=f.db.prepare('SELECT id,name,price_cents,enabled FROM catalog_plans ORDER BY id').all()
 const ids:string[]=[]
 for(const[id,price]of [[70,5800],[36,3800]] as const){
  const d=source(id),p=await hanfolkDraft(d,'0');ids.push(p.id)
  await importHanfolkDrafts(f.env,[d],[{productId:id,sku:'0'}])
  const body={...p,priceCents:price,pricePending:false,catalogPreview:false,status:'listed'}
  assert.equal((await f.request('/api/admin/my-shop/products',body,f.admin)).status,200)
  assert.equal((await f.request('/api/admin/my-shop/products',{...body,status:'published'},f.admin)).status,409)
  const changed={...d,price:6,stock:8,sku_variants:[{sku:'0',price:6,stock:8}]}
  assert.deepEqual(await importHanfolkDrafts(f.env,[changed],[{productId:id,sku:'0'}]),{imported:[],existing:[p.id]})
  const row=f.db.prepare('SELECT price_cents,enabled FROM catalog_plans WHERE id=?').get(p.id)!
  assert.equal(row.price_cents,price);assert.equal(row.enabled,0)
 }
 const c=await(await f.request('/api/catalog')).json() as {products:{id:string;priceCents:number;pricePending:boolean}[];plans:{id:string;enabled:number}[]}
 assert.deepEqual(ids.map(id=>c.products.find(p=>p.id===id)?.priceCents),[5800,3800])
 assert(ids.every(id=>c.products.find(p=>p.id===id)?.pricePending===false&&!c.plans.some(p=>p.id===id&&p.enabled)))
 const cookie=(await f.request('/api/orders/client',{})).headers.get('Set-Cookie')!.split(';')[0]
 const blocked=await Promise.all([5800,3800,5800,3800].map((price,i)=>f.request('/api/orders',{plan:ids[i%2],email:'buyer@example.test',fields:{},expectedPrice:price,key:crypto.randomUUID()},cookie)))
 assert(blocked.every(r=>r.status===409));assert.equal(f.db.prepare('SELECT COUNT(*) n FROM orders').get()!.n,0)
 assert.deepEqual(f.db.prepare('SELECT id,name,price_cents,enabled FROM catalog_plans ORDER BY id').all().filter(p=>!ids.includes(p.id as string)),before)
})
test('Student preview remains public, unpriced and unpurchasable; rereads preserve retail and source mapping',async()=>{
 const f=await customerFixture(),d=source(70),p=await hanfolkDraft(d,'0')
 f.db.prepare('INSERT INTO hanfolk_catalog(product_id,summary,detail,key_hash,checked_at) VALUES(?,?,?,?,?)').run(70,JSON.stringify(d),JSON.stringify(d),'',Date.now())
 await importHanfolkDrafts(f.env,[d],[{productId:70,sku:'0'}])
 assert.equal((await f.request('/api/admin/my-shop/products',{...p,status:'listed',catalogPreview:true},f.admin)).status,200)
 const catalog=await(await f.request('/api/catalog')).json() as {products:{id:string;pricePending:boolean}[];plans:{id:string}[]}
 assert.equal(catalog.products.find(v=>v.id===p.id)?.pricePending,true);assert(!catalog.plans.some(v=>v.id===p.id))
 const client=await f.request('/api/orders/client',{}),cookie=client.headers.get('Set-Cookie')!.split(';')[0]
 const responses=await Promise.all(Array.from({length:4},()=>f.request('/api/orders',{plan:p.id,email:'student@example.test',fields:{},expectedPrice:1,key:crypto.randomUUID()},cookie)))
 assert(responses.every(r=>r.status===409));assert.equal(f.db.prepare('SELECT COUNT(*) n FROM orders').get()!.n,0)
 assert.deepEqual(await importHanfolkDrafts(f.env,[d],[{productId:70,sku:'0'}]),{imported:[],existing:[p.id]})
})
test('Public student text cannot expose a private processing address or promise a CDK delivery',async()=>{
 const p=await hanfolkDraft(source(70),'0'),url='https://private.example.com/student-work'
 const publicCopy=publicBuyerProduct({...p,description:p.description+'\n[办理]('+url+')',deliveryInstructions:url})
 assert.equal(publicCopy.requiresRedemption,true);assert(!JSON.stringify(publicCopy).includes(url))
 assert(!JSON.stringify(publicCopy.steps).includes('兑换码'));assert.match(publicCopy.deliveryInstructions,/本人验证链接/)
})
test('All reviewed Gemini guide routes preserve tenant attribution and internal links',()=>{
 for(const guide of [GEMINI_STUDENT_GUIDE,GEMINI_ACTIVATION_GUIDE,GEMINI_REGION_GUIDE,GEMINI_EXTENSION_GUIDE]){
  const location={pathname:'/r/ABC123/product/gemini',search:'?source=friend',hash:''}
  assert.equal(storefrontHref(guide.slice(1),location),'/r/ABC123'+guide+'?source=friend')
  assert.equal(readStorefrontPage({...location,pathname:'/r/ABC123'+guide}),guide.slice(1))
  assert(productCopyLinks('[教程]('+guide+')').some(p=>p.href===guide))
 }
 assert(!productCopyLinks('[link](/guides/gemini-arbitrary)').some(p=>p.href))
})
test('Gemini private instructions release only after paid delivery and remain isolated to the buyer snapshot',async()=>{
 const f=await customerFixture(),raw=await hanfolkDraft(source(36),'0'),url='https://redeem.example.com/gemini-fixture'
 const p={...raw,status:'published',pricePending:false,priceCents:2800,payment:{label:'Fixture only',instructions:'No payment occurs',url:'https://example.com/checkout',qr:''},redemptionGuide:'### 本单入口\n[兑换]('+url+')'}
 assert.equal((await f.request('/api/admin/my-shop/products',p,f.admin)).status,201)
 const first=await f.request('/api/orders/client',{}),cookie=first.headers.get('Set-Cookie')!.split(';')[0]
 const created=await f.request('/api/orders',{plan:p.id,email:'buyer@example.test',fields:{},expectedPrice:2800,key:crypto.randomUUID()},cookie);assert.equal(created.status,201)
 const {order}=await created.json() as {order:{id:string}},read=async()=>await(await f.request('/api/orders/'+order.id,undefined,cookie)).text()
 assert(!(await read()).includes(url))
 f.db.prepare("UPDATE orders SET payment_status='paid',mode='live',status='processing' WHERE id=?").run(order.id)
 assert(!(await read()).includes(url))
 f.db.prepare("UPDATE orders SET status='success' WHERE id=?").run(order.id)
 assert(!(await read()).includes(url))
 f.db.prepare("UPDATE shop_order_details SET delivery_content='SYNTHETIC-CDK' WHERE order_id=?").run(order.id)
 assert((await read()).includes(url))
 const other=await f.request('/api/orders/client',{}),stranger=other.headers.get('Set-Cookie')!.split(';')[0]
 assert.equal((await f.request('/api/orders/'+order.id,undefined,stranger)).status,404)
 const row=f.db.prepare('SELECT public_json,version FROM shop_products WHERE id=?').get(p.id)!,current=JSON.parse(row.public_json as string)
 assert.equal((await f.request('/api/admin/my-shop/products',{...current,version:row.version,redemptionGuide:'https://new.example.com/later'},f.admin)).status,200)
 assert((await read()).includes(url));assert(!(await read()).includes('new.example.com'))
 f.db.prepare('UPDATE orders SET refund_hold=1 WHERE id=?').run(order.id);assert(!(await read()).includes(url))
})
