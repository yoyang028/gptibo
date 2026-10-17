import test from 'node:test'
import assert from 'node:assert/strict'
import { customerFixture } from './customer-fixture.ts'
import {
  hanfolkBuyerCopy,
  SourceCopyChanged,
} from '../shared/hanfolk-buyer-copy.ts'
import {
  hanfolkDraft,
  importHanfolkDrafts,
} from '../worker/hanfolk/importer.ts'
import type { HanfolkDetail } from '../shared/hanfolk-catalog.ts'
import { productProblems } from '../shared/shop-products.ts'
// @ts-ignore -- shared loopback fixture, no live credentials.
import { hanfolkFixtureProducts } from '../scripts/cloudflare/hanfolk-fixture.mjs'

function source(
  id: number,
  title: string,
  description: string,
  labels: string[] = ['标准'],
): HanfolkDetail {
  return {
    ...hanfolkFixtureProducts[0],
    id,
    title,
    description,
    is_sku: labels.length > 1,
    specs:
      labels.length > 1
        ? [
            {
              title: '规格',
              values: labels.map((name, i) => ({ id: String(i + 1), name })),
            },
          ]
        : [],
    sku_variants: labels.map((_, i) => ({
      sku: labels.length > 1 ? String(i + 1) : '0',
      price: 3.21 + i,
      stock: 10,
    })),
  }
}
test('Short-term Grok account and subscription CDKs have separate periods, fulfillment and warranty', () => {
  const account = source(
    27,
    'SuperGrok 成品账户',
    'SuperGrok 成品账号，可用 9–10 天；3 天质保，封号不保。',
  )
  const cdk = source(
    21,
    'SuperGrok CDK（iOS全区充值）',
    '全区通用的 SuperGrok 订阅兑换码，自助充值后可在多端使用。',
    ['1个月', '3个月'],
  )
  const a = hanfolkBuyerCopy(account, '0'),
    b = hanfolkBuyerCopy(cdk, '2')
  assert.equal(a.duration, '9–10 天')
  assert.match(a.purchaseNote, /3 天/)
  assert.match(a.purchaseNote, /封号/)
  assert.equal(b.duration, '3个月')
  assert(!b.purchaseNote.includes('质保 3 天'))
  assert.match(b.buyerHighlights!.join(' '), /站外自行兑换/)
  assert.match(b.deliveryInstructions, /尚未提供可核实/)
  assert(!b.deliveryInstructions.includes('https://grok.com/'))
  assert.throws(
    () => hanfolkBuyerCopy({ ...account, description: '改为7天期限' }, '0'),
    SourceCopyChanged,
  )
})
test('Muse selected allowance, Gmail SKU years and CapCut team periods are not replaced by unrelated promises', () => {
  const muse = hanfolkBuyerCopy(
    source(
      57,
      'Muse成品账户',
      'Muse 成品账号，10亿、50亿、310亿词元可选，附收件入口，可改邮箱。',
      ['10亿词元', '50亿词元'],
    ),
    '2',
  )
  assert.match(muse.name, /50亿/)
  assert(!muse.name.includes('10亿'))
  assert.match(muse.duration, /有效期未注明/)
  assert.match(muse.deliveryInstructions, /https:\/\/muse.ai\//)
  assert.match(muse.steps[1].description, /Log in/)
  assert.match(muse.buyerHighlights!.join(' '), /凭码自行/)
  const gmail = hanfolkBuyerCopy(
    source(
      10,
      'Google Gmail 账户（07-24年）',
      'Gmail 成品账号，附密码与验证资料，不含 Google 付费订阅。',
      ['2025-2026 · 美国', '2006-2019 · 随机'],
    ),
    '1',
  )
  assert.match(gmail.name, /2025-2026/)
  assert(!gmail.name.includes('07-24'))
  assert.match(gmail.buyerWarnings!.join(' '), /不自动沿用.*2FA/)
  const capcut = hanfolkBuyerCopy(
    source(
      23,
      'Capcut Pro成品',
      '成品账号交付，可选个人版或团队版，用于短视频剪辑、字幕与特效制作。',
      ['个人版 · 月卡', '团队版 · 周卡'],
    ),
    '2',
  )
  assert.equal(capcut.duration, '周卡')
  assert.match(capcut.purchaseNote, /团队版/)
  assert.match(capcut.buyerWarnings!.join(' '), /未承诺独享/)
  assert(!capcut.description.includes('七天'))
})
test('Verified redemption guides use product-specific URLs, eligibility and after-sales terms', () => {
  const cases = [
    [55, 'Super Duoingo 12个月', 'Super 12个月，不可叠加，无需绑卡。', 'https://owlduo.com/', /13 岁/, /不另提供质保/],
    [54, 'Adobe Express 12个月', '12个月，新老账号，无需绑卡。', 'https://vip.dajuai.us/exchange', /新老账号/, /激活后不另提供质保/],
    [53, 'Apple Music 5个月', '5个月，印度区新号，需 UPI 或银行卡。', 'https://vip.dajuai.us/exchange', /印度区新号/, /1 个月质保/],
  ] as const
  for (const [id,title,description,url,condition,warranty] of cases) {
    const p = hanfolkBuyerCopy(source(id,title,description), '0')
    assert(p.deliveryInstructions.includes(url))
    assert(p.steps.some(s=>s.description.includes(url)))
    assert.match(p.purchaseNote, condition)
    assert.match(p.purchaseNote, warranty)
    assert(!p.description.includes('具体兑换入口待补齐'))
    assert(!p.deliveryInstructions.includes('尚未提供可核实'))
  }
})
test('Public unpriced content requires explicit display opt-in and cannot become a sale or enter plan prices', async () => {
  const f = await customerFixture(),
    d = source(
      53,
      'Apple Music 5个月兑换',
      'CDK 兑换 5 个月音乐会员，仅限印度区新号，需自备 UPI 或银行卡。',
    )
  f.db.prepare('INSERT INTO hanfolk_catalog(product_id,summary,detail,key_hash,checked_at) VALUES(?,?,?,?,?)').run(d.id,JSON.stringify(d),JSON.stringify(d),'',Date.now())
  const r = await importHanfolkDrafts(
      f.env,
      [d],
      [{ productId: d.id, sku: '0' }],
    ),
    p = await hanfolkDraft(d, '0')
  assert.deepEqual(
    productProblems({ ...p, status: 'listed', catalogPreview: true }),
    [],
  )
  assert(productProblems({ ...p, status: 'listed' }).length)
  assert(
    productProblems({ ...p, status: 'published', catalogPreview: true }).length,
  )
  const saved = await f.request(
    '/api/admin/my-shop/products',
    { ...p, status: 'listed', catalogPreview: true },
    f.admin,
  )
  assert.equal(saved.status, 200)
  const catalog = (await (await f.request('/api/catalog')).json()) as {
    products: (typeof p)[]
    plans: { id: string }[]
  }
  assert.equal(
    catalog.products.find((x) => x.id === r.imported[0])?.pricePending,
    true,
  )
  assert(!catalog.plans.some((x) => x.id === p.id))
  const client = await f.request('/api/orders/client', {})
  const cookie = client.headers.get('Set-Cookie')!.split(';')[0]
  const create = await f.request('/api/orders', {
    plan: p.id,
    key: crypto.randomUUID(),
    email: 'buyer@example.test',
    fields: {},
  }, cookie)
  assert.equal(create.status, 409)
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM orders').get()?.n, 0)
})
test('Source specifications replace native offers without rewriting historical retail records', async () => {
  const f = await customerFixture(),
    before = f.db
      .prepare(
        "SELECT * FROM catalog_plans WHERE id IN ('gemini-pro-18m','duolingo-12m','gmail-account') ORDER BY id",
      )
      .all()
  for (const [id, title] of [
    [130, 'Google AI Pro 成品账号'],
    [131, 'Super Duoingo 12个月会员兑换'],
    [132, 'Google Gmail 账户'],
  ] as const) {
    const d = source(id, title, '合成商品资料')
    f.db.prepare('INSERT INTO hanfolk_catalog(product_id,summary,detail,key_hash,checked_at) VALUES(?,?,?,?,?)').run(id,JSON.stringify(d),JSON.stringify(d),'',Date.now())
    await importHanfolkDrafts(f.env, [d], [{ productId: id, sku: '0' }])
    const p = await hanfolkDraft(d, '0')
    assert.equal(
      (
        await f.request(
          '/api/admin/my-shop/products',
          { ...p, status: 'listed', catalogPreview: true },
          f.admin,
        )
      ).status,
      200,
    )
  }
  const c = (await (await f.request('/api/catalog')).json()) as {
    products: { id: string; priceCents: number; pricePending?: boolean }[]
  }
  for (const plan of before) {
    const p = c.products.find((p) => p.id === plan.id)
    assert.equal(p,undefined)
  }
  assert.deepEqual(
    f.db
      .prepare(
        "SELECT * FROM catalog_plans WHERE id IN ('gemini-pro-18m','duolingo-12m','gmail-account') ORDER BY id",
      )
      .all(),
    before,
  )
  assert.equal(c.products.filter((p) => p.pricePending).length, 3)
})

test('Custom order brand comes from its historical snapshot and remains private to the buyer', async () => {
  const f=await customerFixture()
  const draft=await hanfolkDraft(source(57,'Muse成品账户','Muse 成品账号，10亿、50亿、310亿词元可选，附收件入口，可改邮箱。',['10亿词元','50亿词元']),'1')
  const product={...draft,pricePending:false,priceCents:3800,status:'published',payment:{label:'Local fixture',instructions:'Local unpaid order only',url:'https://example.com/checkout',qr:''}}
  const saved=await f.request('/api/admin/my-shop/products',product,f.admin)
  assert.equal(saved.status,201,saved.status===201?'':await saved.text())
  const {product:stored}=await saved.json() as {product:typeof product}
  const client=await f.request('/api/orders/client',{}),cookie=client.headers.get('Set-Cookie')!.split(';')[0]
  const created=await f.request('/api/orders',{plan:stored.id,email:'owner@example.test',fields:{},expectedPrice:3800,key:crypto.randomUUID()},cookie)
  assert.equal(created.status,201)
  const {order}=await created.json() as {order:{id:string;custom:{groupId:string}}}
  assert.equal(order.custom.groupId,'muse')
  const current=(((await (await f.request('/api/admin/my-shop/products',undefined,f.admin)).json()) as {products:typeof product[]}).products).find(p=>p.id===stored.id)!
  assert.equal((await f.request('/api/admin/my-shop/products',{...current,groupId:'grok',status:'listed'},f.admin)).status,200)
  const read=await f.request('/api/orders/'+order.id,undefined,cookie)
  assert.equal(read.status,200)
  assert.equal(((await read.json()) as {order:{custom:{groupId:string}}}).order.custom.groupId,'muse')
  const other=await f.request('/api/orders/client',{}),stranger=other.headers.get('Set-Cookie')!.split(';')[0]
  assert.equal((await f.request('/api/orders/'+order.id,undefined,stranger)).status,404)
})
