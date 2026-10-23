import test from 'node:test'
import assert from 'node:assert/strict'
import { grokProductCopy, type GrokTier } from '../shared/grok-product-copy.ts'
import { productProblems } from '../shared/shop-products.ts'
import { publicBuyerProduct } from '../shared/redemption-copy.ts'
import { xiaojiuGrokDraft, XIAOJIU_GROK_SPECS, grokRedemptionGuide } from '../worker/xiaojiu/grok.ts'

const image = 'https://example.com/brands/grok-color.svg'
const entries: {tier:GrokTier; product:number;sku:number;cost:number;retail:number}[] = [
  {tier:'plus',product:19,sku:28,cost:6500,retail:8800},
  {tier:'premium',product:18,sku:27,cost:11500,retail:15800},
  {tier:'super',product:20,sku:29,cost:36000,retail:43800},
  {tier:'ultra',product:21,sku:30,cost:70000,retail:88000},
]
const source = (e: typeof entries[number]) => ({id:e.product,title:{'zh-CN':'美区 Grok '+e.tier+' CDK'},is_active:true,fulfillment_type:'auto',skus:[{id:e.sku,is_active:true,price_amount:(e.cost/100).toFixed(2),stock_quantity:3}]})

test('four Grok tiers use exact Xiaojiu SKU identities and owner retail prices while remaining closed', async () => {
  const ids = new Set<string>()
  for (const e of entries) {
    assert.deepEqual(XIAOJIU_GROK_SPECS[e.tier],{productId:e.product,skuId:e.sku})
    const p = await xiaojiuGrokDraft(e.tier,source(e),e.retail,image)
    assert.deepEqual(productProblems(p),[])
    assert.equal(p.groupId,'grok');assert.equal(p.status,'listed');assert.equal(p.delivery,'api')
    assert.equal(p.priceCents,e.retail);assert.equal(p.api?.provider,'xiaojiu')
    assert.equal(p.api?.productCode,String(e.sku));assert.equal(p.api?.supplierProductId,e.product)
    assert.equal(p.api?.maxCostCents,e.cost);assert.equal(p.api?.configured,false);assert.equal(p.api?.verified,false)
    assert.equal((await xiaojiuGrokDraft(e.tier,source(e),e.retail,image)).id,p.id)
    assert.equal(p.payment.url,'');assert.equal(p.payment.provider,undefined);assert(p.requiresRedemption)
    ids.add(p.id)
  }
  assert.equal(ids.size,4)
})

test('Grok preparation rejects a Daju ID collision, wrong SKU, title, changed delivery and unaffordable cost', async () => {
  const e=entries[0], valid=source(e)
  for (const invalid of [
    {...valid,id:21}, {...valid,title:'SuperGrok 3个月 CDK'},
    {...valid,fulfillment_type:'manual'}, {...valid,is_active:false},
    {...valid,skus:[{...valid.skus[0],id:56}]},
    {...valid,skus:[{...valid.skus[0],is_active:false}]},
    {...valid,skus:[{...valid.skus[0],price_amount:'99.00'}]},
  ]) await assert.rejects(xiaojiuGrokDraft(e.tier,invalid,e.retail,image))
  const depleted=await xiaojiuGrokDraft(e.tier,{...valid,skus:[{...valid.skus[0],stock_quantity:0}]},e.retail,image)
  assert.equal(depleted.stock,0);assert.equal(depleted.status,'listed')
})

test('public Grok pages keep qualification and warranty limits without disclosing a redemption destination', async () => {
  for (const e of entries) {
    const copy=grokProductCopy(e.tier)
    assert.doesNotMatch(JSON.stringify(copy),/https?:\/\/|982xj|98-xj|Daju|上游|待核实|待确认|信息来源|3\s*个月/)
    assert.match(copy.purchaseNote,/美区.*半价|半价.*美区/)
    assert.match(copy.purchaseNote,/30 天/);assert.match(copy.purchaseNote,/账号封禁/)
    const product=await xiaojiuGrokDraft(e.tier,source(e),e.retail,image)
    const buyer=publicBuyerProduct({...product,redemptionGuide:grokRedemptionGuide()})
    assert.equal(buyer.redemptionGuide,undefined)
    assert.doesNotMatch(JSON.stringify({...buyer,api:undefined,image:''}),/https?:\/\/|982xj/)
  }
  assert.match(grokRedemptionGuide(),/https:\/\/982xj\.xyz\//)
  assert.match(grokRedemptionGuide(),/核对账号条件/)
  assert.doesNotMatch(grokRedemptionGuide(),/sessionKey|Session JSON|chatgpt\.com/)
})
