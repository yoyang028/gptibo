// Fixed loopback target: actual workerd/D1 with synthetic identities and mail only.
import fs from 'node:fs'
import path from 'node:path'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import {fileURLToPath} from 'node:url'
import {totp} from '../local/auth.mjs'

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..')
const origin='https://127.0.0.1:8791',control='http://127.0.0.1:8794'
const evidence=path.join(root,'artifacts/local/evidence/store-management')
const privateRoot=path.join(root,'artifacts/local/.secrets/grizzly-cloudflare-mock')
fs.mkdirSync(evidence,{recursive:true})
const state=await(await fetch(control+'/state')).json()
assert.equal(state.localMock,true);assert.equal(state.origin,origin)
assert.equal((await fetch(control+'/reset-auth-limits',{method:'POST',headers:{Origin:control,'X-Local-Control':fs.readFileSync(path.join(privateRoot,'control-token'),'utf8').trim()}})).status,204)
const {chromium}=createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE_PATH||'D:/ChatGPT/CodexCache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright')
const browser=await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE||'C:/Program Files/Google/Chrome/Application/chrome.exe',env:{...process.env,TEMP:path.join(root,'artifacts/local/tmp'),TMP:path.join(root,'artifacts/local/tmp')}})
const context=await browser.newContext({baseURL:origin,ignoreHTTPSErrors:true,viewport:{width:1440,height:1040},permissions:['clipboard-read','clipboard-write']})
const proof={checks:[],visitorRequests:[],pageErrors:[],externalRequests:[]}
await context.route('**/*',route=>{
  if(new URL(route.request().url()).origin===origin)return route.continue()
  proof.externalRequests.push(new URL(route.request().url()).origin);return route.abort()
})
const page=await context.newPage();page.on('pageerror',e=>proof.pageErrors.push(e.message))
const go=label=>page.getByRole('navigation',{name:'后台导航'}).getByRole('button',{name:label,exact:true}).click()
page.on('response',response=>{
  const url=new URL(response.url())
  if(url.pathname==='/api/admin/visitors'&&url.searchParams.has('store'))proof.visitorRequests.push({store:url.searchParams.get('store'),days:url.searchParams.get('days'),status:response.status()})
})
const record=name=>{proof.checks.push({name,passed:true});console.log(name)}
async function api(url,data){
  const response=await context.request.fetch(url,{method:data===undefined?'GET':'POST',headers:{Origin:origin},...(data===undefined?{}:{data})})
  assert.equal(response.status(),200,url);return response.json()
}
async function choose(store,label='当前店铺'){
  await page.getByRole('combobox',{name:label,exact:true}).click()
  await page.getByRole('option',{name:store.name,exact:true}).click()
}
async function period(store,days){
  const pending=page.waitForResponse(r=>{
    const url=new URL(r.url());return url.pathname==='/api/admin/visitors'&&url.searchParams.get('store')===store&&url.searchParams.get('days')===String(days)
  })
  await page.locator('.visitor-stats').getByRole('button',{name:days+' 天',exact:true}).click()
  const response=await pending;assert.equal(response.status(),200)
  const summary=await response.json();assert.equal(summary.days,days);assert.equal(summary.trend.length,days)
  await page.waitForFunction(({uv,pv})=>{
    const values=[...document.querySelectorAll('.visitor-stats .visitor-kpi-value')].map(e=>e.textContent)
    return values[0]===uv&&values[1]===pv
  },{uv:summary.visitors.toLocaleString('zh-CN'),pv:summary.pageViews.toLocaleString('zh-CN')})
  return summary
}
try{
  await page.goto('/admin?view=my-shop')
  await page.locator('#admin-username').fill('dev-admin')
  const sent=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/admin/login/email-code')
  await page.getByRole('button',{name:'获取验证码',exact:true}).click();assert.equal((await sent).status(),200)
  const mailbox=path.join(root,'artifacts/local/cloudflare-grizzly/mailbox')
  const mail=fs.readdirSync(mailbox).filter(f=>f.endsWith('.json')).sort((a,b)=>fs.statSync(path.join(mailbox,b)).mtimeMs-fs.statSync(path.join(mailbox,a)).mtimeMs).map(f=>JSON.parse(fs.readFileSync(path.join(mailbox,f),'utf8'))).find(m=>m.to.includes('admin@example.invalid')&&m.text?.match(/\b\d{6}\b/))
  await page.locator('#admin-email-code').fill(mail.text.match(/\b\d{6}\b/)[0])
  await page.locator('#admin-code').fill(totp(fs.readFileSync(path.join(privateRoot,'admin-totp'),'utf8').trim()))
  await page.getByRole('button',{name:'登录后台',exact:true}).click()
  await page.getByRole('combobox',{name:'当前店铺',exact:true}).waitFor()
  const data=await api('/api/admin/my-shop/stores'),general=data.stores.find(s=>s.id==='store-3'),reserved=data.stores.find(s=>s.id==='store-2')
  assert.equal(general.storefront_url,'https://general.example.test/')
  const baseline={}
  for(const store of data.stores){
    baseline[store.id]=await api('/api/admin/my-shop/visitors?store='+store.id+'&days=1')
    await api('/api/visitors',{visitorId:crypto.randomUUID(),path:store.slug?'/s/'+store.slug:'/'})
  }
  assert.equal(await page.getByRole('tab',{name:'访客统计',exact:true}).count(),0)
  await go('访客统计')
  await page.getByRole('combobox',{name:'访问店铺',exact:true}).getByText('全部自营店铺',{exact:true}).waitFor()
  for(const store of data.stores){
    await choose(store,'访问店铺')
    const today=await period(store.id,1)
    assert.equal(today.pageViews,baseline[store.id].pageViews+1)
    assert.equal(today.visitors,baseline[store.id].visitors+1)
    for(const days of [7,30,90])await period(store.id,days)
    record(store.id+' visitor statistics retain separate store and period parameters for 1/7/30/90 days')
  }
  await choose(general,'访问店铺')
  await period(general.id,1)
  await page.screenshot({path:path.join(evidence,'general-visitors.png'),fullPage:true})
  await go('我的店铺')
  await choose(general)
  assert.equal(await page.getByRole('link',{name:'预览当前店铺',exact:true}).getAttribute('href'),general.storefront_url)
  const storeTabs = page.getByRole('tablist',{name:'商店管理',exact:true})
  assert.deepEqual(await storeTabs.getByRole('tab').allTextContents(), ['商店概览','商品售价','优惠码','商品上下架与排序','账号设置'])
  assert.equal(await page.getByRole('combobox',{name:'当前店铺',exact:true}).count(),1)
  await storeTabs.getByRole('tab',{name:'账号设置',exact:true}).click()
  await page.getByRole('heading',{name:'域名与账单',exact:true}).waitFor()
  assert.equal(await page.locator('.store-current a:visible').getAttribute('href'),general.storefront_url)
  const cards=page.locator('.store-domain')
  assert.equal(await cards.count(),2)
  for(let index=0;index<2;index++){
    const card=cards.nth(index),host=await card.locator('strong').first().textContent()
    await card.getByRole('button',{name:'复制域名推广链接',exact:true}).click()
    assert.equal(await page.evaluate(()=>navigator.clipboard.readText()),'https://'+host+'/')
  }
  record('General store preview, current link, domain cards and copied apex/www URLs share the actual hostname mapping')
  await page.screenshot({path:path.join(evidence,'general-domains.png'),fullPage:true})
  await choose(reserved)
  assert.equal(await page.locator('.store-domain').count(),0)
  await page.getByText('当前店铺尚未绑定独立域名，可使用上方的店铺访问入口。',{exact:true}).waitFor()
  assert.equal(await page.getByRole('link',{name:'预览当前店铺',exact:true}).getAttribute('href'),origin+'/s/store-2')
  record('The reserved store keeps its legacy path and is not presented as having a domain binding')
  await go('访客统计');await choose(general,'访问店铺');await period(general.id,1)
  await page.setViewportSize({width:390,height:844})
  await page.locator('.admin-topbar').getByText('ScholAI / 访客统计',{exact:true}).waitFor()
  await page.locator('.visitor-chart .recharts-area-dot').first().waitFor()
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1))
  assert.equal(await page.locator('.visitor-stats [aria-pressed="true"]').textContent(),'1 天')
  await page.screenshot({path:path.join(evidence,'general-mobile.png'),fullPage:true})
  record('Store selection and selected-day statistics remain usable on mobile without horizontal overflow')
  await page.setViewportSize({width:1440,height:1040})
  await page.goto('/admin?view=visitors')
  const global=page.waitForResponse(r=>{const url=new URL(r.url());return url.pathname==='/api/admin/visitors'&&url.searchParams.get('days')==='1'&&url.searchParams.get('scope')==='owner'})
  await page.locator('.visitor-stats').first().getByRole('button',{name:'1 天',exact:true}).click()
  const summary=await(await global).json()
  assert.equal(summary.ownerStores.length,3)
  assert.deepEqual(summary.partners,[])
  const generalRow=page.locator('.visitor-shops-panel tbody tr').filter({hasText:general.name})
  await generalRow.waitFor()
  const drill=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/admin/visitors'&&new URL(r.url()).searchParams.get('store')==='store-3'&&new URL(r.url()).searchParams.get('days')==='1')
  await generalRow.getByRole('button',{name:'查看趋势',exact:true}).click()
  assert.equal((await drill).status(),200)
  await page.locator('.visitor-kpi-value').first().waitFor()
  assert.equal(await page.getByRole('button',{name:'1 天',exact:true}).getAttribute('aria-pressed'),'true')
  await page.screenshot({path:path.join(evidence,'general-global-drilldown.png'),fullPage:true})
  record('Direct overview includes every owner shop and opens the general store with the selected period')
  const agency=page.waitForResponse(r=>{const url=new URL(r.url());return url.pathname==='/api/admin/visitors'&&url.searchParams.get('scope')==='agent'&&!url.searchParams.has('store')&&url.searchParams.get('days')==='1'})
  await page.getByRole('button',{name:'代理访客',exact:true}).click()
  assert.deepEqual((await(await agency).json()).ownerStores,[])
  await page.getByText('代理店访问趋势',{exact:true}).waitFor()
  await page.getByRole('combobox',{name:'访问店铺',exact:true}).waitFor({state:'hidden'})
  const direct=page.waitForResponse(r=>{const url=new URL(r.url());return url.pathname==='/api/admin/visitors'&&url.searchParams.get('scope')==='owner'&&url.searchParams.get('store')===general.id})
  await page.getByRole('button',{name:'直营访客',exact:true}).click()
  assert.equal((await direct).status(),200)
  await page.getByRole('combobox',{name:'访问店铺',exact:true}).getByText(general.name,{exact:true}).waitFor()
  record('Visitor channels use separate trends and keep the independent direct store and time selections')
  assert(proof.visitorRequests.length>=12)
  assert(proof.visitorRequests.every(r=>['platform','store-2','store-3'].includes(r.store)&&['1','7','30','90'].includes(r.days)&&r.status===200))
  assert.deepEqual(proof.pageErrors,[]);assert.deepEqual(proof.externalRequests,[])
  console.log(JSON.stringify({passed:proof.checks.length,pageErrors:0}))
}finally{
  fs.writeFileSync(path.join(evidence,'results.json'),JSON.stringify(proof,null,2))
  await context.close();await browser.close()
}
