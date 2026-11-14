// Exercise the deployed Worker contract with real local D1 and a signed,
// in-memory upstream. This runner never reads production credentials.
import fs from 'node:fs'
import path from 'node:path'
import assert from 'node:assert/strict'
import {fileURLToPath} from 'node:url'
import {createRequire} from 'node:module'
import {createHash,createHmac,randomUUID} from 'node:crypto'
import {build} from 'esbuild'
import {Miniflare,convertV4MiniflareOptions} from 'miniflare'
import {RECHARGE_INPUT_VERSION,RECHARGE_INPUT_VERSION_HEADER} from '../../shared/recharge-input-version.ts'

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..')
if(process.platform==='win32')assert.match(root,/^D:\\/i)
const domainMode=process.argv.includes('--domains')
const evidence=path.join(root,'artifacts/sites/evidence',domainMode?'storefront-domains':'two-stores-checkout'),runtime=path.join(evidence,'runs',randomUUID())
fs.mkdirSync(path.join(runtime,'tmp'),{recursive:true})
Object.assign(process.env,{TEMP:path.join(runtime,'tmp'),TMP:path.join(runtime,'tmp'),XDG_CONFIG_HOME:path.join(runtime,'config'),WRANGLER_LOG_PATH:path.join(runtime,'wrangler.log'),WRANGLER_SEND_METRICS:'false'})
const {unstable_splitSqlQuery}=await import('wrangler')
const require=createRequire(import.meta.url),{chromium}=require(process.env.PLAYWRIGHT_MODULE_PATH||'D:/ChatGPT/CodexCache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright')
const origin='https://127.0.0.1:8811',upstream='https://recharge.example.invalid',secret='local-signing-fixture-only',webhookSecret='local-webhook-fixture-only'
const generalOrigin=domainMode?'https://localhost:8811':origin
const tls=path.join(root,'artifacts/local/.secrets/quefa-cloudflare-mock')
const digest=value=>createHash('sha256').update(value).digest('hex'),mac=(value,key=secret)=>createHmac('sha256',key).update(value).digest('hex')
const orders=new Map(),tasks=new Map(),orderKeys=new Map(),taskKeys=new Map()
const result={localOnly:true,realPayments:0,realUpstreamRequests:0,checks:[],pageErrors:[],externalRequests:[]}
const record=name=>{result.checks.push(name);console.log(JSON.stringify({name,passed:true}))}
const response=(data,status=200)=>Response.json({data},{status})
const sessionToken='LOCAL_ONLY_SESSION_'+randomUUID()
const outbound=async request=>{
 const url=new URL(request.url),raw=await request.text(),headers=request.headers
 assert.equal(url.origin,upstream,'All non-fixture network access is blocked')
 const canonical=[request.method,url.pathname,url.searchParams.toString(),headers.get('X-Timestamp'),headers.get('X-Nonce'),headers.get('X-Key-Id'),headers.get('Idempotency-Key')??'',digest(raw)].join('\n')
 assert.equal(headers.get('X-Signature'),mac(canonical));assert.equal(headers.get('X-Partner-Id'),'pt_local_only')
 if(url.pathname==='/v1/agent-profile')return response({merchant:{partnerId:'pt_local_only',status:'active'},profile:{customRedemptionEnabled:true},collectionModes:['platform_collect'],productSupplyPrices:{demo_plus:'11000'}})
 if(url.pathname==='/v1/products')return response([{product_code:'demo_plus',supply_price:'110.00',currency:'CNY',max_quantity:1,available:true,delivery_modes:['auto_recharge']}])
 if(url.pathname==='/v1/payment-methods')return response([{code:'alipay'}])
 if(url.pathname==='/v1/orders'&&request.method==='POST'){
  const key=headers.get('Idempotency-Key'),body=JSON.parse(raw)
  assert.equal(body.notify_url,origin+'/api/recharge/webhook');assert.equal(body.payment_channel,'alipay')
  if(!orderKeys.has(key)){
   const id='ord_'+randomUUID().replaceAll('-','')
   orders.set(id,{...body,order_id:id,payment_status:'pending',payment_scope:'retail',currency:'CNY',supply_amount:'110.00',merchant_margin:(Number(body.sale_amount)-110).toFixed(2),qr_payload:upstream+'/pay/local',expires_at:new Date(Date.now()+900000).toISOString()})
   orderKeys.set(key,id)
  }
  return response(orders.get(orderKeys.get(key)))
 }
 const orderRoute=url.pathname.match(/^\/v1\/orders\/([A-Za-z0-9_-]+)(\/payment-code|\/fulfillments)?$/)
 if(orderRoute){
  const order=orders.get(orderRoute[1]);assert(order)
  if(orderRoute[2]==='/payment-code')return response({order_id:order.order_id,merchant_order_no:order.merchant_order_no,amount:order.sale_amount,currency:'CNY',payment_status:order.payment_status,payment_code_type:'alipay_precreate',payment_code:'https://qr.alipay.com/MOCKONLY12345678',expires_at:order.expires_at})
  if(orderRoute[2]==='/fulfillments')return response([...tasks.values()].filter(t=>t.order_id===order.order_id).map(t=>({fulfillment_id:t.redemption_id,order_id:t.order_id,attempt_no:1})))
  return response(order)
 }
 if(url.pathname==='/v1/redemptions'&&request.method==='POST'){
  const body=JSON.parse(raw),key=headers.get('Idempotency-Key');assert.equal(body.credential.mode,'session');assert.equal(body.credential.session,sessionToken);assert.equal(body.credential.access_token,undefined)
  assert.equal(orders.get(body.order_id)?.payment_status,'paid')
  if(!taskKeys.has(key)){
   const id='ful_'+randomUUID().replaceAll('-','')
   tasks.set(id,{redemption_id:id,order_id:body.order_id,attempt_no:1,status:'queued',failure_code:null,fallback_recharge_available:false,account_email_masked:'d***@example.invalid',finished_at:null})
   taskKeys.set(key,id)
  }
  return response(tasks.get(taskKeys.get(key)),202)
 }
 const taskId=url.pathname.match(/^\/v1\/redemptions\/([A-Za-z0-9_-]+)$/)?.[1]
 if(taskId){assert(tasks.has(taskId));return response(tasks.get(taskId))}
 throw new Error('Unexpected local upstream path: '+url.pathname)
}
await build({entryPoints:[path.join(root,'worker/index.ts')],bundle:true,format:'esm',target:'es2023',platform:'browser',external:['node:*'],outfile:path.join(runtime,'worker.mjs'),logLevel:'silent'})
const mf=new Miniflare({...convertV4MiniflareOptions({host:'127.0.0.1',port:8811,https:true,httpsCert:fs.readFileSync(path.join(tls,'cert.pem'),'utf8'),httpsKey:fs.readFileSync(path.join(tls,'key.pem'),'utf8'),modules:true,scriptPath:path.join(runtime,'worker.mjs'),compatibilityDate:'2026-09-26',compatibilityFlags:['nodejs_compat'],cf:false,
 d1Databases:{INTEREST_DB:'two-store-checkout-fixture'},
 ratelimits:{INTEREST_LIMITER:{namespace_id:'4001',simple:{limit:30,period:60}},API_LIMITER:{namespace_id:'4002',simple:{limit:1000,period:60}},EXPENSIVE_LIMITER:{namespace_id:'4003',simple:{limit:1000,period:60}}},
 assets:{directory:path.join(root,'dist'),binding:'ASSETS',run_worker_first: ['/api/*', '/i/*'],routerConfig:{has_user_worker:true},assetConfig:{not_found_handling:'single-page-application'}},
 bindings:{...(domainMode?{OWNER_STOREFRONT_HOSTS:JSON.stringify({localhost:'store-3'})}:{}),ORDER_TESTING_ENABLED:'false',RECHARGE_API_BASE:upstream+'/v1',RECHARGE_PARTNER_ID:'pt_local_only',RECHARGE_KEY_ID:'key_local_only',RECHARGE_CLIENT_SECRET:secret,RECHARGE_WEBHOOK_SECRET:webhookSecret,RECHARGE_NOTIFY_URL:origin+'/api/recharge/webhook',RECHARGE_PRODUCT_MAP:'{"plus":"demo_plus"}',RECHARGE_COLLECTION_MODE:'platform_collect',RECHARGE_CHECKOUT_ENABLED:'true',RECHARGE_READ_ONLY:'false'},outboundService:outbound}),telemetry:{enabled:false},resourcePersistencePath:path.join(runtime,'state'),resourceTmpPath:path.join(runtime,'tmp')})
let browser,page
try{
 await mf.ready
 const db=await mf.getD1Database('INTEREST_DB')
 for(const name of fs.readdirSync(path.join(root,'migrations')).filter(n=>n.endsWith('.sql')).sort())await db.batch(unstable_splitSqlQuery(fs.readFileSync(path.join(root,'migrations',name),'utf8')).map(sql=>db.prepare(sql)))
 await db.batch([
  db.prepare("UPDATE catalog_plans SET enabled=1,price_cents=13900 WHERE id='plus'"),
  db.prepare("UPDATE owner_store_prices SET enabled=1,price_cents=14900 WHERE store_id='store-3' AND plan='plus'"),
  db.prepare("UPDATE owner_shop_settings SET settings=json_set(settings,'$.name','ScholAI','$.brandName','ScholAI','$.headline','少研究工具，多专注科研。','$.description','面向研究生与科研人员的服务') WHERE id='platform'")])
 browser=await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE||'C:/Program Files/Google/Chrome/Application/chrome.exe',env:process.env})
 const context=await browser.newContext({baseURL:origin,ignoreHTTPSErrors:true,locale:'zh-CN',viewport:{width:1440,height:1000}})
 await context.route('**/*',route=>{const url=new URL(route.request().url());if(url.protocol.startsWith('http')&&![origin,generalOrigin].includes(url.origin)){result.externalRequests.push(url.origin);return route.abort()}return route.continue()})
 page=await context.newPage();page.on('pageerror',e=>result.pageErrors.push(e.message))
 let shopOrigin=origin
 async function call(url,data,expected=200,confirmedReplay=false){
  for(let attempt=0;attempt<8;attempt++){
   const r=await context.request.fetch(new URL(url,shopOrigin).href,{method:data===undefined?'GET':'POST',headers:{Origin:shopOrigin,Connection:'close',...(data?.action==='submit'?{[RECHARGE_INPUT_VERSION_HEADER]:RECHARGE_INPUT_VERSION}:{})},...(data===undefined?{}:{data})}),body=await r.json()
   if(r.status()===409&&body.error?.includes('正在同步')&&(data===undefined||['poll','query'].includes(data.action)||confirmedReplay)){await new Promise(resolve=>setTimeout(resolve,150));continue}
   assert.equal(r.status(),expected,JSON.stringify(body));return body
  }
  throw new Error('Local reconciliation lease did not clear')
 }
 async function notice(order,type,id='evt_'+randomUUID().replaceAll('-',''),valid=true){
  const stamp=String(Math.floor(Date.now()/1000)),raw=JSON.stringify({event_id:id,type,data:{order_id:order.order_id,merchant_order_no:order.merchant_order_no}})
  const r=await mf.dispatchFetch(origin+'/api/recharge/webhook',{method:'POST',headers:{'Content-Type':'application/json','X-Quefa-Event':type,'X-Quefa-Event-Id':id,'X-Quefa-Delivery':'dlv_'+id,'X-Quefa-Timestamp':stamp,'X-Quefa-Signature':`t=${stamp},v1=${valid?mac(stamp+'.'+raw,webhookSecret):'0'.repeat(64)}`},body:raw})
  assert.equal(r.status,valid?200:400);return id
 }
 await page.goto('/s/store-2/product/chatgpt');await page.getByRole('heading',{name:'这间商店暂未开放',exact:true}).waitFor()
 assert.equal(await page.getByRole('button',{name:'立即购买',exact:true}).count(),0)
 await call('/api/orders/client',{})
 await call('/api/orders',{partner:'store-2',plan:'plus',expectedPrice:13900,email:'demo@example.invalid',key:randomUUID()},409)
 await page.screenshot({path:path.join(evidence,'reserved-store.png')})
 record('Reserved storefront shows a closed page and rejects direct order creation')
 for(const [slug,price] of [['store-3',14900],['',13900]]){
  shopOrigin=slug?generalOrigin:origin
  const base=shopOrigin+(slug&&!domainMode?'/s/'+slug:'')
  await page.goto(base+'/product/chatgpt')
  await page.getByRole('button',{name:'立即购买',exact:true}).click();await page.getByRole('button',{name:'继续下单',exact:true}).click()
  // The real checkout allows common mailbox domains. This address is never
  // contacted: this runner has no mail credentials and blocks external mail.
  await page.locator('#purchase-email').fill('local-checkout-fixture@gmail.com')
  const [r]=await Promise.all([
   page.waitForResponse(r=>new URL(r.url()).pathname==='/api/orders'&&r.request().method()==='POST'),
   page.getByRole('button',{name:'继续付款',exact:true}).click()])
  assert.equal(r.status(),201,await r.text());const order=(await r.json()).order
  assert.equal(order.mode,'live');assert.equal(order.price,price/100)
  const stored=await db.prepare('SELECT owner_store_id FROM orders WHERE id=?').bind(order.id).first();assert.equal(stored.owner_store_id,slug||'platform')
  const route='/api/orders/'+order.id
  let bound
  for(let i=0;i<10;i++){await call(route+'/fulfillment',{action:'poll'});bound=[...orders.values()].find(o=>o.merchant_order_no===order.id);if(bound)break}
  assert(bound);assert.equal(bound.sale_amount,(price/100).toFixed(2));assert.equal(bound.notify_url,origin+'/api/recharge/webhook')
  await notice(bound,'order.paid',undefined,false)
  bound.payment_status='paid';const event=await notice(bound,'order.paid')
  const notified=(await db.prepare('SELECT notify_version FROM recharge_orders WHERE order_id=?').bind(order.id).first()).notify_version
  await notice(bound,'order.paid',event)
  assert.equal((await db.prepare('SELECT notify_version FROM recharge_orders WHERE order_id=?').bind(order.id).first()).notify_version,notified)
  await call(route+'/fulfillment',{action:'poll'})
  await page.locator('#live-session').waitFor()
  const stale=await context.request.post(new URL(route+'/fulfillment',shopOrigin).href,{maxRetries:2,headers:{Origin:shopOrigin,Connection:'close'},data:{action:'submit',key:randomUUID(),customerConfirmedEmail:true,credential:{mode:'session',session:sessionToken}}})
  assert.equal(stale.status(),426)
  const raw=JSON.stringify({user:{email:'demo@example.invalid'},accessToken:'LOCAL_ONLY_UNSUPPORTED_ACCESS_TOKEN',sessionToken,featureFlags:'x'.repeat(300000)})
  await page.locator('#live-session').fill(JSON.stringify({accessToken:'LOCAL_ONLY_UNSUPPORTED_ACCESS_TOKEN'}))
  assert(await page.getByRole('button',{name:'提交并充值',exact:true}).isDisabled())
  await page.locator('#live-session').fill(raw);assert.equal(await page.locator('#live-session').inputValue(),raw)
  await page.getByRole('checkbox',{name:'我已核对账号，并授权本次充值'}).check()
  const [submit]=await Promise.all([
   page.waitForResponse(r=>new URL(r.url()).pathname===route+'/fulfillment'&&r.request().postDataJSON()?.action==='submit'),
   page.getByRole('button',{name:'提交并充值',exact:true}).click()])
  assert.equal(submit.status(),200,await submit.text())
  assert.equal(submit.request().headers()[RECHARGE_INPUT_VERSION_HEADER.toLowerCase()],RECHARGE_INPUT_VERSION)
  const requestBody=submit.request().postDataJSON();assert.equal(requestBody.credential.session,sessionToken)
  await call(route+'/fulfillment',requestBody,200,true)
  const task=[...tasks.values()].find(t=>t.order_id===bound.order_id);assert(task);assert.equal([...tasks.values()].filter(t=>t.order_id===bound.order_id).length,1)
  task.status='succeeded';task.finished_at=new Date().toISOString();await notice(bound,'redemption.succeeded')
  const final=await call(route+'/fulfillment',{action:'poll'});assert.equal(final.order.status,'success');assert.equal(final.order.paymentStatus,'paid')
  await page.getByRole('heading',{name:'充值已完成',exact:true}).waitFor()
  await page.screenshot({path:path.join(evidence,(slug?'general':'academic')+'-completed.png')})
  await page.goto(base+'/orders');await page.locator('.order-row').filter({hasText:order.id}).waitFor()
  record((slug?'General':'Academic')+' shop: UI checkout, own price, signed payment and completion callbacks, repaired Session extraction, stale-page guard and duplicate prevention all pass')
 }
 await page.goto(generalOrigin+(domainMode?'/':'/s/store-3'));await page.getByRole('button',{name:'AI星球 首页',exact:true}).waitFor()
 await page.locator('.store-intro h1').filter({hasText:'按需选择，轻松下单。'}).waitFor()
 assert.doesNotMatch(await page.locator('body').innerText(),/ScholAI|科研|研究生|学术/i)
 assert.doesNotMatch(await page.title(),/ScholAI|科研|研究生|学术/i)
 assert.equal(await page.locator('link[rel=icon]').getAttribute('href'),'/brands/shop.svg')
 await page.screenshot({path:path.join(evidence,'general-desktop.png')})
 await page.setViewportSize({width:390,height:844});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1))
 await page.screenshot({path:path.join(evidence,'general-mobile.png')})
 record('General storefront has neutral text, title and icon on desktop/mobile')
 assert.equal(orders.size,2);assert.equal(tasks.size,2)
 const history=await db.prepare('SELECT owner_store_id,status,payment_status FROM orders ORDER BY owner_store_id').all()
 assert(history.results.every(o=>o.status==='success'&&o.payment_status==='paid'));assert.deepEqual(history.results.map(o=>o.owner_store_id),['platform','store-3'])
 const persisted=JSON.stringify((await db.prepare('SELECT * FROM recharge_redemptions').all()).results)+JSON.stringify((await db.prepare('SELECT * FROM order_events').all()).results)
 assert(!persisted.includes(sessionToken));assert(!persisted.includes('LOCAL_ONLY_UNSUPPORTED_ACCESS_TOKEN'))
 assert.deepEqual(result.pageErrors,[]);assert.deepEqual(result.externalRequests,[])
 record('Real local D1 preserves both shop identities and success records without storing submitted credentials')
 result.passed=true
}catch(e){result.passed=false;result.failure=e.message;if(page){await page.screenshot({path:path.join(evidence,'failure.png')});console.error((await page.locator('body').innerText()).slice(0,2200))}throw e}
finally{fs.writeFileSync(path.join(evidence,'results.json'),JSON.stringify(result,null,2)+'\n');await browser?.close();await mf.dispose()}
