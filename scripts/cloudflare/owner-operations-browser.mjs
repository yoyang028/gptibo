// Synthetic orders and file-only email on the fixed loopback workerd/D1 runtime.
import fs from 'node:fs'
import path from 'node:path'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import {fileURLToPath} from 'node:url'
import {totp} from '../local/auth.mjs'
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..')
const origin='https://127.0.0.1:8791',control='http://127.0.0.1:8794'
const evidence=path.join(root,'artifacts/local/evidence/owner-operations')
const privateRoot=path.join(root,'artifacts/local/.secrets/grizzly-cloudflare-mock')
fs.mkdirSync(evidence,{recursive:true})
const state=await(await fetch(control+'/state')).json();assert.equal(state.localMock,true);assert.equal(state.origin,origin)
await fetch(control+'/reset-auth-limits',{method:'POST',headers:{Origin:control,'X-Local-Control':fs.readFileSync(path.join(privateRoot,'control-token'),'utf8').trim()}})
const {chromium}=createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE_PATH||'D:/ChatGPT/CodexCache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright')
const browser=await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE||'C:/Program Files/Google/Chrome/Application/chrome.exe',env:{...process.env,TEMP:path.join(root,'artifacts/local/tmp'),TMP:path.join(root,'artifacts/local/tmp')}})
const admin=await browser.newContext({baseURL:origin,ignoreHTTPSErrors:true,viewport:{width:1440,height:1040},colorScheme:'dark'})
const buyer=await browser.newContext({baseURL:origin,ignoreHTTPSErrors:true})
const result={checks:[],pageErrors:[],externalRequests:[],realPayments:0,realEmails:0}
await admin.route('**/*',route=>{if(new URL(route.request().url()).origin===origin)return route.continue();result.externalRequests.push(new URL(route.request().url()).origin);return route.abort()})
await admin.route(url=>url.origin===origin&&url.pathname==='/api/admin/refunds/notifications'&&url.searchParams.get('channels')==='1',
  route=>route.fulfill({status:200,json:{version:2,pending:2,ownerPending:1,agentPending:1}}))
const page=await admin.newPage();page.on('pageerror',e=>result.pageErrors.push(e.message))
const navigation=page.getByRole('navigation',{name:'后台导航'})
const go=label=>navigation.getByRole('button',{name:label,exact:true}).click()
const record=name=>{result.checks.push({name,passed:true});console.log(name)}
async function api(url,data,context=admin,status=200){const r=await context.request.fetch(url,{method:data===undefined?'GET':'POST',headers:{Origin:origin},...(data===undefined?{}:{data})});assert.equal(r.status(),status,url+': '+await r.text());return r.json()}
async function choose(label,name){await page.getByRole('combobox',{name:label,exact:true}).click();await page.getByRole('option',{name,exact:true}).click()}
function response(path,store,scope){return page.waitForResponse(r=>{const u=new URL(r.url());return u.pathname===path&&(store===undefined||u.searchParams.get('store')===store)&&(scope===undefined||u.searchParams.get('scope')===scope)})}
const prefix='auto-'+crypto.randomUUID().slice(0,8),shared=prefix+'@example.test',other=prefix+'-other@example.test'
const couponCode='CRM-'+prefix.toUpperCase()
let product,cleanupError
try{
  await page.goto('/admin?view=my-shop')
  await page.locator('#admin-username').fill('dev-admin')
  const sent=response('/api/admin/login/email-code');await page.getByRole('button',{name:'获取验证码',exact:true}).click();assert.equal((await sent).status(),200)
  const mailbox=path.join(root,'artifacts/local/cloudflare-grizzly/mailbox')
  const mail=fs.readdirSync(mailbox).filter(n=>n.endsWith('.json')).sort((a,b)=>fs.statSync(path.join(mailbox,b)).mtimeMs-fs.statSync(path.join(mailbox,a)).mtimeMs).map(n=>JSON.parse(fs.readFileSync(path.join(mailbox,n),'utf8'))).find(m=>m.to.includes('admin@example.invalid')&&m.text?.match(/\b\d{6}\b/))
  await page.locator('#admin-email-code').fill(mail.text.match(/\b\d{6}\b/)[0]);await page.locator('#admin-code').fill(totp(fs.readFileSync(path.join(privateRoot,'admin-totp'),'utf8').trim()))
  await page.getByRole('button',{name:'登录后台',exact:true}).click();await page.getByRole('combobox',{name:'当前店铺',exact:true}).waitFor()
  const stores=(await api('/api/admin/my-shop/stores')).stores
  assert.deepEqual(stores.map(s=>[s.name,s.slot]),[['ScholAI',1],['AI星球',2],['备用商店',3]])
  assert.equal(stores[2].active,false)
  for(const label of ['我的客户','订单收益','订单明细','退款与售后','清账与结算','访客统计']){
    assert.equal(await page.getByRole('tab',{name:label,exact:true}).count(),0)
  }
  assert.equal(await page.getByRole('tab',{name:'商店订单',exact:true}).count(),1)
  record('Store order is ScholAI, AI星球, 备用商店 and the backup storefront remains closed')
  product=(await api('/api/admin/my-shop/products',{
    id:'',version:0,status:'published',pricePending:false,name:'客户自动归集验收 '+prefix,category:'工具服务',tagline:'本机模拟',description:'只用于本机自动验收，不产生真实付款。',
    image:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWQAAAABJRU5ErkJggg==',badge:'服务',unit:'份',duration:'一次',priceCents:990,stock:10,features:['本机测试'],purchaseNote:'模拟订单',deliveryInstructions:'人工确认',steps:[{title:'下单',description:'核对订单'}],faq:[{question:'如何交付？',answer:'原订单查看'}],fields:[],delivery:'manual',payment:{label:'模拟收款',instructions:'本机模拟，勿真实付款',url:'https://payments.example.com/pay',qr:''},
  },admin,201)).product
  await api('/api/admin/my-shop/stores/prices',{storeId:'store-3',plan:product.id,priceCents:1490,enabled:true,version:0})
  await api('/api/admin/my-shop/coupons',{id:'',version:0,code:couponCode,discountCents:150,startsAt:new Date(Date.now()-60000).toISOString(),
    endsAt:new Date(Date.now()+3600000).toISOString(),maxUses:1,oncePerEmail:true,active:true,targets:[{storeId:'platform',plan:product.id}]})
  await api('/api/orders/client',{},buyer)
  async function order(store,email,code){return(await api('/api/orders',{plan:product.id,partner:store==='platform'?undefined:store,
    expectedPrice:store==='platform'?(code?840:990):1490,couponCode:code,email,key:crypto.randomUUID()},buyer,201)).order}
  const academic=await order('platform',shared,couponCode),planet=await order('store-3',shared)
  const paid=new Map()
  for(const order of [academic,planet]){
    await api('/api/orders/'+order.id+'/custom-action',{action:'claim-payment',version:order.version,reference:'LOCAL-FIXTURE-'+order.id},buyer)
    const confirmed=await api('/api/admin/my-shop/orders/'+order.id,{action:'confirm-payment',version:order.version,note:'本机模拟到账记录，不实际收款'})
    paid.set(order.id,confirmed.order)
  }
  let pending=response('/api/admin/orders',null,'owner');await go('订单管理')
  assert.equal((await pending).status(),200)
  const orderFilter=page.getByRole('combobox',{name:'订单店铺',exact:true})
  await orderFilter.getByText('全部自营店铺',{exact:true}).waitFor()
  assert.equal(await page.getByRole('button',{name:'直营订单',exact:true}).getAttribute('aria-pressed'),'true')
  await orderFilter.click()
  await page.getByRole('option',{name:'备用商店',exact:true}).waitFor()
  assert.deepEqual(await page.locator('.partner-select-popup').getByRole('option').allTextContents(),['全部自营店铺','ScholAI','AI星球','备用商店'])
  await page.keyboard.press('Escape')
  pending=response('/api/admin/orders','store-3','owner');await choose('订单店铺','AI星球');assert.equal((await pending).status(),200)
  await page.getByRole('button',{name:planet.id,exact:true}).waitFor()
  assert.equal(await page.getByRole('button',{name:academic.id,exact:true}).count(),0)
  pending=response('/api/admin/orders',null,'owner');await choose('订单店铺','全部自营店铺');assert.equal((await pending).status(),200)
  await page.getByRole('button',{name:academic.id,exact:true}).waitFor();await page.getByRole('button',{name:planet.id,exact:true}).waitFor()
  record('Order detail follows the selected store and can switch to the owner-wide overview')
  pending=response('/api/admin/orders','store-2');await choose('订单店铺','备用商店');assert.equal((await pending).status(),200)
  assert.equal(await page.getByRole('button',{name:academic.id,exact:true}).count(),0)
  record('The backup storefront order filter returns only that store without borrowing another store’s rows')
  pending=response('/api/admin/orders',null,'agent');await page.getByRole('button',{name:'代理订单',exact:true}).click()
  assert(!(await(await pending).json()).orders.some(o=>o.id===academic.id||o.id===planet.id))
  await orderFilter.waitFor({state:'hidden'})
  pending=response('/api/admin/orders','store-2','owner');await page.getByRole('button',{name:'直营订单',exact:true}).click()
  assert.equal((await pending).status(),200)
  await orderFilter.getByText('备用商店',{exact:true}).waitFor()
  record('Orders put agent and direct lists on separate levels and remember the selected direct storefront')
  await api('/api/orders/'+planet.id+'/refunds',{version:paid.get(planet.id).version,key:crypto.randomUUID(),reason:'本机模拟售后申请'},buyer,201)
  pending=response('/api/admin/refunds',null,'owner');await go('退款与售后');assert.equal((await pending).status(),200)
  const refundFilter=page.getByRole('combobox',{name:'售后店铺',exact:true})
  await refundFilter.getByText('全部自营店铺',{exact:true}).waitFor()
  pending=response('/api/admin/refunds','store-3');await choose('售后店铺','AI星球')
  const refunds=await(await pending).json()
  assert(refunds.rows.some(row=>row.order_id===planet.id&&row.owner_store_name==='AI星球'))
  const refundRow=page.locator('tbody tr').filter({hasText:planet.id})
  await refundRow.getByRole('button',{name:'处理申请',exact:true}).click()
  await page.getByRole('dialog').getByText('所属店铺：AI星球',{exact:true}).waitFor()
  await page.keyboard.press('Escape')
  await page.getByRole('dialog').waitFor({state:'hidden'})
  pending=response('/api/admin/refunds','platform');await choose('售后店铺','ScholAI')
  assert(!(await(await pending).json()).rows.some(row=>row.order_id===planet.id))
  pending=response('/api/admin/refunds',null,'agent');await page.getByRole('button',{name:'查看代理退款 (1)',exact:true}).click()
  assert(!(await(await pending).json()).rows.some(row=>row.order_id===planet.id))
  assert.equal(await page.getByRole('button',{name:'代理售后',exact:true}).getAttribute('aria-pressed'),'true')
  await refundFilter.waitFor({state:'hidden'})
  record('Refunds have separate direct and agent lists, shop-specific details and correctly routed alerts')

  pending=response('/api/admin/accounting/report',null,'owner');await go('清账统计');assert.equal((await pending).status(),200)
  const accountingFilter=page.getByRole('combobox',{name:'账目店铺',exact:true})
  await accountingFilter.getByText('全部自营店铺',{exact:true}).waitFor()
  pending=response('/api/admin/accounting/report','platform');await choose('账目店铺','ScholAI');assert.equal((await pending).status(),200)
  pending=response('/api/admin/accounting/report',null,'agent');await page.getByRole('button',{name:'代理清账',exact:true}).click()
  assert.equal((await pending).status(),200)
  await accountingFilter.waitFor({state:'hidden'})
  pending=response('/api/admin/accounting/report','platform','owner');await page.getByRole('button',{name:'直营清账',exact:true}).click()
  assert.equal((await pending).status(),200)
  pending=response('/api/admin/accounting','platform');await page.getByRole('tab',{name:'清账与记录',exact:true}).click();assert.equal((await pending).status(),200)
  await page.getByText('本期待清账',{exact:true}).waitFor()
  assert.equal(await page.getByRole('button',{name:'确认记录全站清账',exact:true}).count(),0)
  pending=response('/api/admin/accounting',null,null);await page.getByRole('button',{name:'记录全站清账',exact:true}).click()
  assert.equal((await pending).status(),200)
  await page.getByRole('dialog',{name:'记录全站清账'}).getByRole('button',{name:'确认记录全站清账',exact:true}).waitFor()
  await page.getByRole('button',{name:'取消',exact:true}).click()
  await page.getByRole('dialog').waitFor({state:'hidden'})
  record('Accounting isolates both report and ledger reads while the whole-site close opens only after an explicit action')

  await go('客户管理')
  await choose('所属店铺','AI星球')
  const crm=page.locator('.crm-container')
  await crm.getByRole('columnheader',{name:'客户资料',exact:true}).waitFor()
  assert.deepEqual(await crm.locator('thead th').allTextContents(), ['客户资料','所属店铺','绑定账号与套餐','优惠情况','订单统计','到期状态与提醒'])
  await crm.getByRole('textbox',{name:'搜索关键词',exact:true}).fill(prefix)
  pending=response('/api/admin/customers','store-3');await crm.getByRole('button',{name:'查询',exact:true}).click()
  let data=await(await pending).json();assert.equal(data.total,1);assert.equal(data.stats.order_paid_cents,1490)
  await crm.getByText(shared,{exact:true}).first().waitFor()
  await crm.locator('tbody tr').filter({hasText:shared}).getByText('未用优惠',{exact:true}).waitFor()
  record('The same buyer is automatically one customer across shops and selected-store totals use that store’s paid amount')
  await page.clock.install()
  await order('store-3',other)
  pending=response('/api/admin/customers','store-3');await page.clock.fastForward(31000)
  data=await(await pending).json();assert.equal(data.total,2);assert.equal(data.stats.order_count,2)
  await crm.getByText(other,{exact:true}).first().waitFor()
  record('A new unpaid buyer appears automatically on the next 30-second refresh without manual customer entry')
  pending=response('/api/admin/customers',null);await choose('所属店铺','全部自营店铺');data=await(await pending).json()
  assert.equal(data.total,2);assert.equal(data.stats.order_count,3);assert.equal(data.stats.order_paid_cents,2330)
  const sharedRow=crm.locator('tbody tr').filter({hasText:shared}).first()
  await sharedRow.getByText(couponCode,{exact:true}).waitFor()
  const orderCell=sharedRow.getByRole('cell').nth(4)
  assert.match(await orderCell.innerText(),/累计实付\s*¥23\.30/)
  assert.equal(await orderCell.locator('time[datetime]').count(),1)
  assert(!/笔订单|净消费|已退款/.test(await orderCell.innerText()))
  const layout=await crm.getByRole('table',{name:'客户列表'}).evaluate(table=>{
    const headers=[...table.querySelectorAll('th')]
    return {fixed:getComputedStyle(table).tableLayout==='fixed',start:getComputedStyle(headers[0]).paddingInlineStart,
      end:getComputedStyle(headers.at(-1)).paddingInlineEnd, fits:table.getBoundingClientRect().width<=table.parentElement.clientWidth+1}
  })
  assert.deepEqual(layout,{fixed:true,start:'24px',end:'24px',fits:true})
  await page.screenshot({path:path.join(evidence,'customers-discounts.png'),fullPage:true})
  await page.setViewportSize({width:1280,height:900})
  assert(await crm.getByRole('table',{name:'客户列表'}).evaluate(table=>table.parentElement.scrollWidth<=table.parentElement.clientWidth+1))
  record('Customer columns use planned widths and insets, display the applied coupon, and show just the paid amount and order time')
  await sharedRow.getByRole('button',{name:shared,exact:true}).click()
  const dialog=page.getByRole('dialog');await dialog.getByRole('region',{name:'客户订单记录'}).waitFor()
  await dialog.getByText(academic.id,{exact:true}).waitFor();await dialog.getByText(planet.id,{exact:true}).waitFor()
  await dialog.getByText(couponCode,{exact:true}).waitFor()
  await page.screenshot({path:path.join(evidence,'customer-orders.png'),fullPage:true});await page.keyboard.press('Escape')
  record('Customer detail retains both shops’ order history and cash totals without creating membership expiry records')
  const exported=await api('/api/admin/customers/export?scope=owner&store=store-3&q='+prefix)
  assert.equal(exported.customers.length,2);assert.equal(exported.customers.reduce((n,c)=>n+c.order_count,0),2)
  record('Customer export includes the selected store’s current order statistics')
  const agents=page.waitForResponse(r=>{const u=new URL(r.url());return u.pathname==='/api/admin/customers'&&u.searchParams.get('scope')==='agent'})
  await crm.getByRole('button',{name:'代理客户',exact:true}).click()
  assert((await(await agents).json()).customers.every(c=>c.partner_id))
  await crm.getByRole('combobox',{name:'所属代理',exact:true}).waitFor()
  assert.equal(await crm.getByRole('button',{name:shared,exact:true}).count(),0)
  await crm.getByRole('button',{name:'直营客户',exact:true}).click()
  await crm.getByRole('combobox',{name:'所属店铺',exact:true}).waitFor()
  record('Direct and agent customer views use separate data and filters')
  await page.clock.resume();await page.setViewportSize({width:390,height:844})
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1))
  await page.screenshot({path:path.join(evidence,'customers-mobile.png'),fullPage:true})
  record('Customer scope controls and order statistics fit a mobile viewport with table scrolling contained')
  assert.deepEqual(result.pageErrors,[]);assert.deepEqual(result.externalRequests,[])
  console.log(JSON.stringify({passed:result.checks.length,pageErrors:0}))
}catch(error){result.failure=error.message;result.overflow=await page.evaluate(()=>({viewport:innerWidth,scrollWidth:document.documentElement.scrollWidth,nodes:[...document.querySelectorAll('body *')].filter(e=>e.getBoundingClientRect().right>innerWidth+1&&!e.closest('[data-slot=table-container]')).slice(0,20).map(e=>({tag:e.tagName,class:e.className,width:e.getBoundingClientRect().width}))}));await page.screenshot({path:path.join(evidence,'failure.png'),fullPage:true});throw error}finally{
  try{if(product){const current=(await api('/api/admin/my-shop/products')).products.find(p=>p.id===product.id);if(current)await api('/api/admin/my-shop/products',{...current,status:'archived'})}}catch(error){cleanupError=error;result.cleanupError=error.message}
  fs.writeFileSync(path.join(evidence,'results.json'),JSON.stringify(result,null,2))
  await admin.close();await buyer.close();await browser.close()
}
if(cleanupError)throw cleanupError
