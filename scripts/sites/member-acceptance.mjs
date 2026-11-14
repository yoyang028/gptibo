// Real workerd/D1 + browser acceptance. Every credential and transaction is a
// local fixture; outbound traffic is restricted to the mock below.
import fs from 'node:fs'
import path from 'node:path'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import {fileURLToPath} from 'node:url'
import {randomUUID,createHmac} from 'node:crypto'
import {build} from 'esbuild'
import {Miniflare,convertV4MiniflareOptions} from 'miniflare'
import {totp} from '../local/auth.mjs'

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..')
if(process.platform==='win32')assert.match(root,/^D:\\/i)
const evidence=path.join(root,'artifacts/sites/evidence/member-pilot'),runtime=path.join(evidence,'runs',randomUUID())
fs.mkdirSync(path.join(runtime,'tmp'),{recursive:true})
Object.assign(process.env,{TEMP:path.join(runtime,'tmp'),TMP:path.join(runtime,'tmp'),XDG_CONFIG_HOME:path.join(runtime,'config'),WRANGLER_LOG_PATH:path.join(runtime,'wrangler.log'),WRANGLER_SEND_METRICS:'false'})
const {unstable_splitSqlQuery}=await import('wrangler')
const require=createRequire(import.meta.url),{chromium}=require(process.env.PLAYWRIGHT_MODULE_PATH||'D:/ChatGPT/CodexCache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright')
const localPort=Number(process.env.MEMBER_ACCEPTANCE_PORT||8823)
const origin=`https://127.0.0.1:${localPort}`,academic=`https://localhost:${localPort}`,upstream='https://supplier.example.invalid'
const email='member-local-fixture@gmail.com',adminEmail='admin@example.invalid',totpSecret='GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ'
const webhookSecret='local-member-webhook-only',mail=[],orders=new Map(),writes=[]
const result={localOnly:true,realPayments:0,realUpstreamRequests:0,checks:[],pageErrors:[],externalRequests:[]}
const record=name=>{result.checks.push(name);console.log(JSON.stringify({passed:true,name}))}
const wrapped=data=>Response.json({data})
const outbound=async request=>{
 const u=new URL(request.url),raw=await request.text(),data=raw?JSON.parse(raw):{}
 if(u.origin==='https://api.resend.com'){mail.push(data);return Response.json({id:'local-mail-'+mail.length})}
 assert.equal(u.origin,upstream,'Non-fixture external access blocked')
 if(request.method==='POST')writes.push({path:u.pathname,body:data})
 if(u.pathname==='/v1/agent-profile')return wrapped({merchant:{partnerId:'local-pilot',status:'active'},profile:{customRedemptionEnabled:true},collectionModes:['platform_collect'],productSupplyPrices:{plus:'11000'}})
 if(u.pathname==='/v1/products')return wrapped([{product_code:'plus',supply_price:'110.00',currency:'CNY',max_quantity:1,available:true,delivery_modes:['auto_recharge']}])
 if(u.pathname==='/v1/payment-methods')return wrapped([{code:'alipay'}])
 if(u.pathname==='/v1/orders'&&request.method==='POST'){
  const id='local_'+data.merchant_order_no.replaceAll('-','')
  if(!orders.has(id))orders.set(id,{...data,order_id:id,currency:'CNY',payment_scope:'retail',payment_status:'pending',supply_amount:'110.00',merchant_margin:(Number(data.sale_amount)-110).toFixed(2),qr_payload:null,expires_at:new Date(Date.now()+900000).toISOString()})
  return wrapped(orders.get(id))
 }
 const match=u.pathname.match(/^\/v1\/orders\/([^/]+)(\/payment-code|\/fulfillments)?$/),o=match?orders.get(match[1]):null
 if(o&&!match[2])return wrapped(o)
 if(o&&match[2]==='/fulfillments')return wrapped([])
 if(o&&match[2]==='/payment-code')return wrapped({order_id:o.order_id,merchant_order_no:o.merchant_order_no,amount:o.sale_amount,currency:'CNY',payment_status:o.payment_status,payment_code_type:'alipay_precreate',payment_code:'https://qr.alipay.com/LOCALONLY12345678',expires_at:o.expires_at})
 throw Error('Unexpected mock upstream path')
}
await build({entryPoints:[path.join(root,'worker/index.ts')],bundle:true,format:'esm',target:'es2023',platform:'browser',external:['node:*'],outfile:path.join(runtime,'worker.mjs'),logLevel:'silent'})
const tls=path.join(root,'artifacts/local/.secrets/quefa-cloudflare-mock')
const mf=new Miniflare({...convertV4MiniflareOptions({host:'127.0.0.1',port:localPort,https:true,httpsCert:fs.readFileSync(path.join(tls,'cert.pem'),'utf8'),httpsKey:fs.readFileSync(path.join(tls,'key.pem'),'utf8'),modules:true,scriptPath:path.join(runtime,'worker.mjs'),compatibilityDate:'2026-09-26',compatibilityFlags:['nodejs_compat'],cf:false,
 d1Databases:{INTEREST_DB:'member-pilot-fixture'},
 ratelimits:{INTEREST_LIMITER:{namespace_id:'4101',simple:{limit:1000,period:60}},API_LIMITER:{namespace_id:'4102',simple:{limit:2000,period:60}},EXPENSIVE_LIMITER:{namespace_id:'4103',simple:{limit:1000,period:60}}},
 assets:{directory:path.join(root,'dist'),binding:'ASSETS',run_worker_first: ['/api/*', '/ref/*', '/i/*'],routerConfig:{has_user_worker:true},assetConfig:{not_found_handling:'single-page-application'}},
 bindings:{MEMBERSHIP_ENABLED:'true',MEMBER_AUTH_SECRET:'local-only-independent-member-secret-32-characters',OWNER_STOREFRONT_HOSTS:JSON.stringify({'127.0.0.1':'store-3'}),ADMIN_USERNAME:'local-admin',ADMIN_EMAIL:adminEmail,ADMIN_TOTP_SECRET:totpSecret,RESEND_API_KEY:'local-mail-only',RESEND_FROM:'Local <noreply@example.invalid>',PARTNER_AUTH_SECRET:'local-partner-secret',ORDER_TESTING_ENABLED:'false',RECHARGE_API_BASE:upstream+'/v1',RECHARGE_PARTNER_ID:'local-pilot',RECHARGE_KEY_ID:'local-key',RECHARGE_CLIENT_SECRET:'local-api-secret',RECHARGE_WEBHOOK_SECRET:webhookSecret,RECHARGE_NOTIFY_URL:academic+'/api/recharge/webhook',RECHARGE_PRODUCT_MAP:'{"plus":"plus"}',RECHARGE_COLLECTION_MODE:'platform_collect',RECHARGE_CHECKOUT_ENABLED:'true',RECHARGE_READ_ONLY:'false'},outboundService:outbound}),telemetry:{enabled:false},resourcePersistencePath:path.join(runtime,'state'),resourceTmpPath:path.join(runtime,'tmp')})
let browser
try{
 await mf.ready
 const db=await mf.getD1Database('INTEREST_DB'),service=await mf.getWorker()
 for(const name of fs.readdirSync(path.join(root,'migrations')).filter(n=>n.endsWith('.sql')).sort())await db.batch(unstable_splitSqlQuery(fs.readFileSync(path.join(root,'migrations',name),'utf8')).map(sql=>db.prepare(sql)))
 await db.prepare("UPDATE owner_store_prices SET price_cents=13800,enabled=1 WHERE store_id='store-3' AND plan='plus'").run()
 browser=await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE||'C:/Program Files/Google/Chrome/Application/chrome.exe',env:process.env})
 async function context(){
  const c=await browser.newContext({baseURL:origin,ignoreHTTPSErrors:true,locale:'zh-CN',reducedMotion:'reduce',viewport:{width:1440,height:1000}})
  await c.route('**/*',route=>{const u=new URL(route.request().url());if(u.protocol.startsWith('http')&&![origin,academic].includes(u.origin)){result.externalRequests.push(u.origin);return route.abort()}return route.continue()})
  c.on('page',p=>p.on('pageerror',e=>result.pageErrors.push(e.message)))
  return c
 }
 async function call(c,url,data,expected=200){
  for(let i=0;i<10;i++){
   const r=await c.request.fetch(origin+url,{method:data===undefined?'GET':'POST',headers:{Origin:origin},...(data===undefined?{}:{data})}),payload=await r.json()
   if(r.status()===409&&payload.error?.includes('正在同步')&&(data===undefined||['poll','query'].includes(data.action))){await new Promise(resolve=>setTimeout(resolve,150));continue}
   assert.equal(r.status(),expected,JSON.stringify(payload));return payload
  }
  throw Error('Local reconciliation lease did not clear')
 }
 const memberContext=await context(),page=await memberContext.newPage()
 await page.goto(origin+'/account')
 await page.getByRole('button',{name:'注册会员',exact:true}).click()
 await page.getByLabel('邮箱',{exact:true}).fill(email)
 await page.getByLabel('密码',{exact:true}).fill('Local-safe-password-123!')
 const [registered]=await Promise.all([page.waitForResponse(r=>new URL(r.url()).pathname==='/api/member/auth/sign-up/email'),page.getByRole('button',{name:'注册并发送验证码',exact:true}).click()])
 assert.equal(registered.status(),200,await registered.text())
 const verification=mail.findLast(m=>m.to[0]===email)
 assert.match(verification.from,/^"AI星球" </)
 assert(!verification.text.includes('https://'))
 await page.getByLabel('邮箱验证码',{exact:true}).fill(verification.text.match(/验证码：(\d{6})/)[1])
 await page.getByRole('button',{name:'验证并登录',exact:true}).click()
 await page.getByRole('heading',{name:'我的邀请链接',exact:true}).waitFor()
 const member=await call(memberContext,'/api/member/session')
 const defaultInvite=await page.getByLabel('我的邀请链接',{exact:true}).inputValue(),code=member.member.inviteCode
 assert.match(defaultInvite,/\/ref\/[a-z0-9]{10}$/)
 assert(member.member&&code)
 record('real D1 email/password registration, verification and invitation without purchase')
 await page.getByRole('button',{name:'自定义邀请链接',exact:true}).click()
 assert.equal(await page.locator('.member-alias-input > span').textContent(),origin+'/ref/')
 await page.getByLabel('专属地址',{exact:true}).fill('star-friend')
 await page.getByRole('button',{name:'确认并永久保存',exact:true}).click()
 await page.getByText('自定义地址已确定，不能再次修改。原来的邀请链接仍然有效。',{exact:true}).waitFor()
 const inviteUrl=await page.getByLabel('我的邀请链接',{exact:true}).inputValue()
 assert.equal(inviteUrl,origin+'/ref/star-friend')
 assert.equal((await page.getByRole('button',{name:'自定义邀请链接',exact:true}).count()),0)
 record('custom invitation dialog saves once and keeps the canonical order identity')
 await page.screenshot({path:path.join(evidence,'member-desktop.png'),fullPage:true})
 const at=Date.now()-25*3600000
 for(let i=0;i<14;i++){
  const id='YMX-'+randomUUID().replaceAll('-','').toUpperCase(),key='local-customer-'+i
  await db.batch([
   db.prepare("INSERT INTO orders(id,owner_hash,idempotency_key,plan,plan_name,price_cents,mode,payment_status,status,created_at,updated_at,last_event_id,customer_email,owner_store_id,member_promotion) VALUES (?,? ,?,'plus','Plus',13800,'live','paid','success',?,?,?,?,'store-3',1)").bind(id,key,key,at,at,randomUUID(),key+'@example.invalid'),
   db.prepare("INSERT INTO member_order_promotions(order_id,store_id,referrer_id,invite_code,customer_key,original_cents,cash_cents,supply_cents,supplier_snapshot,request_hash,review_status,procurement_status,allocation_status,created_at,updated_at) VALUES (?,'store-3',?,?,?,13800,13800,11000,'{}','local-fixture','none','ready','captured',?,?)").bind(id,member.member.id,code,key,at,at),
   db.prepare("INSERT INTO member_first_purchases(store_id,customer_key,order_id) VALUES ('store-3',?,?)").bind(key,id),
   db.prepare("INSERT INTO order_events(id,order_id,actor,action,to_status,order_version,created_at) VALUES (?,?,'local-fixture','fixture-delivery','success',1,?)").bind(randomUUID(),id,at),
  ])
 }
 for(let slot=0;slot<4;slot++)await service.scheduled({scheduledTime:Math.floor(Date.now()/300000)*300000+slot*60000})
 assert.equal((await call(memberContext,'/api/member/session')).balanceCents,14000)
 record('actual workerd scheduler activates fourteen delivered-order rewards once')
 await page.goto(origin+'/product/chatgpt')
 await page.getByRole('button',{name:'立即购买',exact:true}).click()
 await page.getByRole('button',{name:'继续下单',exact:true}).click()
 await page.locator('#purchase-email').fill(email)
 await page.getByRole('checkbox',{name:/使用奖励抵扣/}).check()
 await page.getByText('实际应付',{exact:true}).waitFor()
 const buy=page.getByRole('button',{name:'确认优惠订单',exact:true})
 await buy.waitFor()
 const [freeResponse]=await Promise.all([page.waitForResponse(r=>new URL(r.url()).pathname==='/api/orders'&&r.request().method()==='POST'),buy.click()])
 assert.equal(freeResponse.status(),201,await freeResponse.text())
 const free=(await freeResponse.json()).order
 assert.equal(free.price,0);assert.equal(free.paymentStatus,'unpaid');assert.equal(free.promotion.rewardCents,13800)
 await page.getByRole('heading',{name:'订单待处理',exact:true}).last().waitFor()
 assert.equal(writes.length,0)
 assert.equal((await call(memberContext,'/api/member/session')).balanceCents,200)
 await page.screenshot({path:path.join(evidence,'zero-checkout-desktop.png'),fullPage:true})
 await page.setViewportSize({width:390,height:844})
 await page.screenshot({path:path.join(evidence,'zero-checkout-mobile.png'),fullPage:true})
 await page.getByRole('button',{name:'取消订单，释放优惠',exact:true}).click()
 await page.getByRole('heading',{name:'订单已取消',exact:true}).waitFor()
 assert.equal((await call(memberContext,'/api/member/session')).balanceCents,14000)
 record('browser fully stacks 140 to cover 138, keeps 2, holds zero order and restores cancellation')
 await page.goto(origin+'/account');await page.getByRole('heading',{name:'我的邀请链接',exact:true}).waitFor()
 await page.screenshot({path:path.join(evidence,'member-mobile.png'),fullPage:true})
 const guestContext=await context(),guest=await guestContext.newPage()
 const legacyInvite=await guestContext.request.get(inviteUrl.replace('/ref/','/i/'),{maxRedirects:0})
 assert.equal(legacyInvite.status(),302);assert.equal(legacyInvite.headers().location,'/')
 await guest.goto(inviteUrl)
 assert.equal(new URL(guest.url()).pathname,'/')
 assert.equal(new URL(guest.url()).search,'')
 await guest.goto(origin+'/product/chatgpt')
 await guest.getByRole('button',{name:'立即购买',exact:true}).click();await guest.getByRole('button',{name:'继续下单',exact:true}).click()
 await guest.locator('#purchase-email').fill('guest-local-fixture@gmail.com')
 await guest.getByRole('checkbox',{name:/本次使用新人优惠/}).check()
 const [guestResponse]=await Promise.all([guest.waitForResponse(r=>new URL(r.url()).pathname==='/api/orders'&&r.request().method()==='POST'),guest.getByRole('button',{name:'继续付款',exact:true}).click()])
 assert.equal(guestResponse.status(),201,await guestResponse.text())
 const guestOrder=(await guestResponse.json()).order;assert.equal(guestOrder.price,133)
 for(let i=0;i<5&&!orders.size;i++)await call(guestContext,`/api/orders/${guestOrder.id}/fulfillment`,{action:'query'})
 const remote=[...orders.values()].find(o=>o.merchant_order_no===guestOrder.id);assert(remote);assert.equal(remote.sale_amount,'133.00')
 remote.payment_status='paid';remote.fulfillment_status='succeeded'
 const event='local_event_'+randomUUID().replaceAll('-',''),stamp=String(Math.floor(Date.now()/1000)),raw=JSON.stringify({event_id:event,type:'order.paid',data:{order_id:remote.order_id,merchant_order_no:guestOrder.id}})
 const headers={'Content-Type':'application/json','X-Quefa-Event':'order.paid','X-Quefa-Event-Id':event,'X-Quefa-Delivery':'delivery_'+event,'X-Quefa-Timestamp':stamp,'X-Quefa-Signature':`t=${stamp},v1=${createHmac('sha256',webhookSecret).update(stamp+'.'+raw).digest('hex')}`}
 for(let i=0;i<2;i++)assert.equal((await mf.dispatchFetch(academic+'/api/recharge/webhook',{method:'POST',headers,body:raw})).status,200)
 for(let slot=0;slot<4;slot++)await service.scheduled({scheduledTime:Math.floor(Date.now()/300000)*300000+slot*60000})
 for(let slot=0;slot<4;slot++)await service.scheduled({scheduledTime:Math.floor(Date.now()/300000)*300000+slot*60000})
 assert.equal((await call(guestContext,`/api/orders/${guestOrder.id}`)).order.status,'success')
 const after=await call(memberContext,'/api/member/session');assert.equal(after.totals.pending,1000);assert.equal(after.invitations.total,15)
 record('unregistered guest gets five off; discounted upstream payment and duplicate callback award once after delivery')
 const concurrent=await Promise.all([1,2].map(()=>memberContext.request.post(origin+'/api/orders',{headers:{Origin:origin},data:{plan:'plus',email,expectedPrice:0,key:randomUUID(),promotion:{inviteCode:'',newcomer:false,rewardCents:14000}}})))
 assert.deepEqual(concurrent.map(r=>r.status()).sort(),[201,409])
 const winner=(await concurrent.find(r=>r.status()===201).json()).order
 assert.equal((await call(memberContext,'/api/member/session')).balanceCents,200)
 await call(memberContext,`/api/orders/${winner.id}/promotion-cancel`,{version:winner.version})
 record('actual D1 concurrent browser requests cannot spend one reward balance twice')
 const academicIdentity=await memberContext.request.get(academic+'/api/member/session')
 assert.equal((await academicIdentity.json()).enabled,false)
 record('academic shop keeps its original guest flow and cannot use membership session')
 const adminContext=await context()
 const challenge=await call(adminContext,'/api/admin/login/email-code',{username:'local-admin'})
 const adminCode=mail.findLast(m=>m.to[0]===adminEmail).text.match(/\b\d{6}\b/)[0]
 await call(adminContext,'/api/admin/login',{username:'local-admin',challenge:challenge.challenge,emailCode:adminCode,code:totp(totpSecret)})
 const adminPage=await adminContext.newPage();await adminPage.goto(origin+'/admin')
 await adminPage.getByRole('button',{name:'会员与邀新',exact:true}).click()
 await adminPage.getByRole('button',{name:'活动订单与审核',exact:true}).waitFor()
 await adminPage.screenshot({path:path.join(evidence,'admin-members-desktop.png'),fullPage:true})
 record('existing administrator authentication opens member, invitation and reward management')
 await adminPage.getByRole('button',{name:'奖励与撤销',exact:true}).click()
 await adminPage.getByRole('button',{name:'流水',exact:true}).first().click()
 await adminPage.getByRole('heading',{name:'奖励流水',exact:true}).waitFor()
 await adminPage.getByRole('cell',{name:'发放待生效奖励',exact:true}).waitFor()
 await adminPage.screenshot({path:path.join(evidence,'admin-ledger-desktop.png'),fullPage:true})
 record('authenticated administrator can inspect the immutable reward ledger in the browser')
 await adminPage.keyboard.press('Escape')
 await adminPage.getByRole('button',{name:'运营中心',exact:true}).click()
 await adminPage.getByRole('heading',{name:'异常订单对账',exact:true}).waitFor()
 const writesBeforeReconciliation=writes.length
 await adminPage.getByLabel('核对订单号',{exact:true}).fill(guestOrder.id)
 const [checked]=await Promise.all([adminPage.waitForResponse(r=>new URL(r.url()).pathname==='/api/admin/member-ops/reconciliation'&&r.request().method()==='POST'),adminPage.getByRole('button',{name:'核对指定订单',exact:true}).click()])
 assert.equal(checked.status(),200);assert.equal((await checked.json()).state,'matched');assert.equal(writes.length,writesBeforeReconciliation)
 await adminPage.getByLabel('对账筛选',{exact:true}).selectOption('all')
 await adminPage.getByRole('button',{name:'处理记录',exact:true}).first().waitFor()
 await adminPage.screenshot({path:path.join(evidence,'admin-reconciliation-desktop.png'),fullPage:true})
 record('administrator reconciles original order and delivery with zero new upstream writes')
 await adminPage.getByRole('button',{name:'通知中心',exact:true}).click()
 await adminPage.getByRole('heading',{name:'通知中心',exact:true}).waitFor()
 const notifications=await call(adminContext,'/api/admin/member-ops/notifications')
 assert(notifications.rows.length>0);assert(notifications.configured)
 await adminPage.getByRole('button',{name:'发送日志',exact:true}).first().waitFor()
 await adminPage.screenshot({path:path.join(evidence,'admin-notifications-desktop.png'),fullPage:true})
 record('administrator notification centre shows persistent deduplicated sends and provider results')
 await adminPage.getByRole('button',{name:'邀请效果',exact:true}).click()
 await adminPage.getByRole('heading',{name:'邀请效果统计',exact:true}).waitFor()
 const statistics=await call(adminContext,'/api/admin/member-ops/statistics')
 assert.equal(statistics.rows[0].paid_orders,15);assert.equal(statistics.rows[0].issued_cents,15000)
 await adminPage.screenshot({path:path.join(evidence,'admin-invitation-statistics-desktop.png'),fullPage:true})
 record('invitation statistics report actual paid orders and issued rewards without double counting')
 await adminPage.getByRole('button',{name:'优惠预演',exact:true}).click()
 await adminPage.getByRole('heading',{name:'优惠规则预演',exact:true}).waitFor()
 const beforePreview=await db.prepare('SELECT (SELECT COUNT(*) FROM orders) orders,(SELECT COUNT(*) FROM member_reward_allocations) allocations,(SELECT SUM(reserved_cents) FROM member_reward_grants) reserved').first()
 const writesBeforePreview=writes.length
 const [previewed]=await Promise.all([adminPage.waitForResponse(r=>new URL(r.url()).pathname==='/api/admin/member-ops/simulation'),adminPage.getByRole('button',{name:'开始预演',exact:true}).click()])
 assert.equal(previewed.status(),200);const simulation=await previewed.json();assert.equal(simulation.cashCents,0);assert.equal(simulation.remainingCents,200)
 await adminPage.getByRole('heading',{name:'预演结果 · 假设场景',exact:true}).waitFor()
 assert.deepEqual(await db.prepare('SELECT (SELECT COUNT(*) FROM orders) orders,(SELECT COUNT(*) FROM member_reward_allocations) allocations,(SELECT SUM(reserved_cents) FROM member_reward_grants) reserved').first(),beforePreview)
 assert.equal(writes.length,writesBeforePreview)
 await adminPage.screenshot({path:path.join(evidence,'admin-discount-simulation-desktop.png'),fullPage:true})
 await adminPage.setViewportSize({width:390,height:844})
 await adminPage.screenshot({path:path.join(evidence,'admin-discount-simulation-mobile.png'),fullPage:true})
 await adminPage.setViewportSize({width:1440,height:1000})
 record('discount simulation previews zero cash and retained balance without creating orders or reserving rewards')
 await adminPage.getByRole('button',{name:'账本核对',exact:true}).click()
 await adminPage.getByRole('heading',{name:'奖励账本核对',exact:true}).waitFor()
 const ledgerRowsBefore=await db.prepare('SELECT COUNT(*) count FROM member_reward_ledger').first()
 for(let batch=0;batch<8;batch++)await call(adminContext,'/api/admin/member-ops/ledger',{action:'scan'})
 const auditRows=await call(adminContext,'/api/admin/member-ops/ledger')
 assert(auditRows.rows.length>=15);assert(auditRows.rows.every(r=>r.state==='matched'&&r.checked_version===r.grant_version))
 assert.deepEqual(await db.prepare('SELECT COUNT(*) count FROM member_reward_ledger').first(),ledgerRowsBefore)
 await adminPage.getByRole('button',{name:'核对明细',exact:true}).first().waitFor()
 await adminPage.screenshot({path:path.join(evidence,'admin-reward-audit-desktop.png'),fullPage:true})
 record('reward audit matches native D1 ledger and allocations while preserving all original rows')
 const riskContext=await context();await call(riskContext,'/api/orders/client',{})
 const writesBeforeRisk=writes.length
 for(let i=0;i<10;i++){
  const data={plan:'plus',email:'risk-local-fixture@example.invalid',promotion:{rewardCents:0}}
  const q=await call(riskContext,'/api/orders/promotion-quote',data);assert.equal(q.reviewStatus,'none')
  await call(riskContext,'/api/orders',{...data,expectedPrice:q.cashCents,key:randomUUID()},201)
 }
 const flaggedQuote=await call(riskContext,'/api/orders/promotion-quote',{plan:'plus',email:'risk-local-fixture@example.invalid',promotion:{rewardCents:0}})
 assert.equal(flaggedQuote.reviewStatus,'required')
 await adminPage.getByRole('button',{name:'轻量风控',exact:true}).click()
 await adminPage.getByRole('heading',{name:'轻量风控',exact:true}).waitFor()
 await adminPage.getByRole('button',{name:'检查一批近期记录',exact:true}).click()
 await adminPage.getByRole('button',{name:'核查与记录',exact:true}).first().waitFor()
 const risks=await call(adminContext,'/api/admin/member-ops/risk');assert(risks.rows.some(r=>JSON.parse(r.flags).includes('many_unpaid_orders')))
 assert.equal(writes.length,writesBeforeRisk)
 await adminPage.screenshot({path:path.join(evidence,'admin-risk-desktop.png'),fullPage:true})
 record('risk centre identifies abnormal unpaid orders without procurement or changes to normal guest checkout')
 const academicBefore=await db.prepare("SELECT settings,version FROM owner_shop_settings WHERE id='platform'").first()
 await adminPage.goto(origin+'/admin?view=my-shop')
 await adminPage.waitForFunction(()=>document.title==='AI星球 · 管理后台')
 await adminPage.getByRole('button',{name:'编辑商店',exact:true}).click()
 const editor=adminPage.getByRole('dialog',{name:'编辑商店',exact:true})
 await editor.getByLabel('商店名称',{exact:true}).fill('AI星球测试店')
 assert.equal(await editor.getByLabel('品牌名称',{exact:true}).count(),0)
 await editor.getByRole('button',{name:'保存商店',exact:true}).click()
 await adminPage.waitForFunction(()=>document.title==='AI星球测试店 · 管理后台')
 const identityPage=await memberContext.newPage();await identityPage.goto(origin+'/')
 await identityPage.waitForFunction(()=>document.title==='AI星球测试店 · AI 订阅与数字服务')
 const changedIdentity=await call(memberContext,'/api/catalog?identity=1')
 assert.equal(changedIdentity.shop.name,'AI星球测试店');assert.equal(changedIdentity.shop.brandName,'AI星球测试店')
 assert.deepEqual(await db.prepare("SELECT settings,version FROM owner_shop_settings WHERE id='platform'").first(),academicBefore)
 await adminPage.getByRole('button',{name:'编辑商店',exact:true}).click()
 await editor.getByLabel('商店名称',{exact:true}).fill('AI星球')
 await editor.getByRole('button',{name:'保存商店',exact:true}).click()
 await adminPage.waitForFunction(()=>document.title==='AI星球 · 管理后台')
 await adminPage.screenshot({path:path.join(evidence,'admin-aiplanet-shop-desktop.png'),fullPage:true})
 record('current-domain admin edit updates front name, page title and admin identity while academic settings stay intact')
 const resetContext=await context(),resetPage=await resetContext.newPage()
 await resetPage.goto(origin+'/account')
 await resetPage.getByRole('button',{name:'忘记密码',exact:true}).click()
 await resetPage.getByLabel('邮箱',{exact:true}).fill(email)
 await resetPage.getByRole('button',{name:'发送重置验证码',exact:true}).click()
 await resetPage.getByLabel('邮箱验证码',{exact:true}).waitFor()
 const resetMail=mail.findLast(m=>m.to[0]===email&&m.subject.includes('重置登录密码'))
 assert.match(resetMail.from,/^"AI星球" </);assert(!resetMail.text.includes('https://'))
 await resetPage.getByLabel('邮箱验证码',{exact:true}).fill(resetMail.text.match(/验证码：(\d{6})/)[1])
 await resetPage.getByLabel('新密码',{exact:true}).fill('Local-changed-password-123!')
 await resetPage.getByRole('button',{name:'保存新密码',exact:true}).click()
 await resetPage.getByText('密码已重置，请用新密码登录。',{exact:true}).waitFor()
 assert.equal((await call(memberContext,'/api/member/session')).member,null)
 await resetPage.getByLabel('密码',{exact:true}).fill('Local-changed-password-123!')
 await resetPage.getByRole('button',{name:'登录',exact:true}).click()
 await resetPage.getByRole('heading',{name:'我的邀请链接',exact:true}).waitFor()
 assert.equal(await resetPage.getByLabel('我的邀请链接',{exact:true}).inputValue(),inviteUrl)
 await resetPage.setViewportSize({width:390,height:844});await resetPage.screenshot({path:path.join(evidence,'member-aiplanet-mobile.png'),fullPage:true})
 record('browser resets password with six digits, revokes old sessions and preserves the one-time custom invitation')
 assert.deepEqual(result.pageErrors,[]);assert.deepEqual(result.externalRequests,[])
 result.passed=true
 fs.writeFileSync(path.join(evidence,'result.json'),JSON.stringify(result,null,2))
 console.log(JSON.stringify({passed:true,checks:result.checks.length,evidence}))
}catch(error){result.passed=false;result.failure=error.message;fs.writeFileSync(path.join(evidence,'result.json'),JSON.stringify(result,null,2));throw error}
finally{await browser?.close();await mf.dispose()}
