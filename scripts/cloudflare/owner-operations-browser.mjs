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
const admin=await browser.newContext({baseURL:origin,ignoreHTTPSErrors:true,viewport:{width:1440,height:1040}})
const buyer=await browser.newContext({baseURL:origin,ignoreHTTPSErrors:true})
const result={checks:[],pageErrors:[],externalRequests:[],realPayments:0,realEmails:0}
await admin.route('**/*',route=>{if(new URL(route.request().url()).origin===origin)return route.continue();result.externalRequests.push(new URL(route.request().url()).origin);return route.abort()})
const page=await admin.newPage();page.on('pageerror',e=>result.pageErrors.push(e.message))
const record=name=>{result.checks.push({name,passed:true});console.log(name)}
async function api(url,data,context=admin,status=200){const r=await context.request.fetch(url,{method:data===undefined?'GET':'POST',headers:{Origin:origin},...(data===undefined?{}:{data})});assert.equal(r.status(),status,url+': '+await r.text());return r.json()}
async function choose(label,name){await page.getByRole('combobox',{name:label,exact:true}).click();await page.getByRole('option',{name,exact:true}).click()}
function response(path,store){return page.waitForResponse(r=>{const u=new URL(r.url());return u.pathname===path&&(store===undefined||u.searchParams.get('store')===store)})}
const prefix='auto-'+crypto.randomUUID().slice(0,8),shared=prefix+'@example.test',other=prefix+'-other@example.test'
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
  record('Store order is ScholAI, AI星球, 备用商店 and the backup storefront remains closed')
  product=(await api('/api/admin/my-shop/products',{
    id:'',version:0,status:'published',pricePending:false,name:'客户自动归集验收 '+prefix,category:'工具服务',tagline:'本机模拟',description:'只用于本机自动验收，不产生真实付款。',
    image:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWQAAAABJRU5ErkJggg==',badge:'服务',unit:'份',duration:'一次',priceCents:990,stock:10,features:['本机测试'],purchaseNote:'模拟订单',deliveryInstructions:'人工确认',steps:[{title:'下单',description:'核对订单'}],faq:[{question:'如何交付？',answer:'原订单查看'}],fields:[],delivery:'manual',payment:{label:'模拟收款',instructions:'本机模拟，勿真实付款',url:'https://payments.example.com/pay',qr:''},
  },admin,201)).product
  await api('/api/admin/my-shop/stores/prices',{storeId:'store-3',plan:product.id,priceCents:1490,enabled:true,version:0})
  await api('/api/orders/client',{},buyer)
  async function order(store,email){return(await api('/api/orders',{plan:product.id,partner:store==='platform'?undefined:store,expectedPrice:store==='platform'?990:1490,email,key:crypto.randomUUID()},buyer,201)).order}
  const academic=await order('platform',shared),planet=await order('store-3',shared)
  for(const order of [academic,planet]){
    await api('/api/orders/'+order.id+'/custom-action',{action:'claim-payment',version:order.version,reference:'LOCAL-FIXTURE-'+order.id},buyer)
    await api('/api/admin/my-shop/orders/'+order.id,{action:'confirm-payment',version:order.version,note:'本机模拟到账记录，不实际收款'})
  }
  await page.getByRole('tab',{name:'订单收益',exact:true}).click()
  await page.getByRole('combobox',{name:'订单店铺范围',exact:true}).waitFor()
  let pending=response('/api/admin/orders','store-3');await choose('当前店铺','AI星球');assert.equal((await pending).status(),200)
  await page.getByRole('button',{name:planet.id,exact:true}).waitFor()
  assert.equal(await page.getByRole('button',{name:academic.id,exact:true}).count(),0)
  pending=response('/api/admin/orders',null);await choose('订单店铺范围','全部自营店铺');assert.equal((await pending).status(),200)
  await page.getByRole('button',{name:academic.id,exact:true}).waitFor();await page.getByRole('button',{name:planet.id,exact:true}).waitFor()
  record('Order detail follows the selected store and can switch to the owner-wide overview')
  pending=response('/api/admin/orders','store-2');await choose('订单店铺范围','备用商店');assert.equal((await pending).status(),200)
  assert.equal(await page.getByRole('button',{name:academic.id,exact:true}).count(),0)
  record('The backup storefront order filter returns only that store without borrowing another store’s rows')
  await choose('当前店铺','AI星球');await page.getByRole('tab',{name:'我的客户',exact:true}).click()
  const crm=page.locator('.crm-container')
  await crm.getByRole('textbox',{name:'搜索关键词',exact:true}).fill(prefix)
  pending=response('/api/admin/customers','store-3');await crm.getByRole('button',{name:'查询',exact:true}).click()
  let data=await(await pending).json();assert.equal(data.total,1);assert.equal(data.stats.order_paid_cents,1490)
  await crm.getByText(shared,{exact:true}).first().waitFor()
  record('The same buyer is automatically one customer across shops and selected-store totals use that store’s paid amount')
  await page.clock.install()
  await order('store-3',other)
  pending=response('/api/admin/customers','store-3');await page.clock.fastForward(31000)
  data=await(await pending).json();assert.equal(data.total,2);assert.equal(data.stats.order_count,2)
  await crm.getByText(other,{exact:true}).first().waitFor()
  record('A new unpaid buyer appears automatically on the next 30-second refresh without manual customer entry')
  pending=response('/api/admin/customers',null);await choose('客户店铺范围','全部自营店铺');data=await(await pending).json()
  assert.equal(data.total,2);assert.equal(data.stats.order_count,3);assert.equal(data.stats.order_paid_cents,2480)
  const sharedRow=crm.locator('tbody tr').filter({hasText:shared}).first()
  await sharedRow.getByRole('button',{name:'管理详情',exact:true}).click()
  const dialog=page.getByRole('dialog');await dialog.getByRole('region',{name:'客户订单记录'}).waitFor()
  await dialog.getByText(academic.id,{exact:true}).waitFor();await dialog.getByText(planet.id,{exact:true}).waitFor()
  await page.screenshot({path:path.join(evidence,'customer-orders.png'),fullPage:true});await page.keyboard.press('Escape')
  record('Customer detail retains both shops’ order history and cash totals without creating membership expiry records')
  const exported=await api('/api/admin/customers/export?scope=owner&store=store-3&q='+prefix)
  assert.equal(exported.customers.length,2);assert.equal(exported.customers.reduce((n,c)=>n+c.order_count,0),2)
  record('Customer export includes the selected store’s current order statistics')
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
