import test from 'node:test'
import assert from 'node:assert/strict'
import { grokProductCopy, GROK_PLAN_RIGHTS } from '../shared/grok-product-copy.ts'
import { grokRedemptionGuide } from '../worker/xiaojiu/grok.ts'

test('X Subscription copy distinguishes Bot eligibility, shared pools and X benefits for every tier', () => {
  assert.deepEqual(Object.values(GROK_PLAN_RIGHTS).map(p=>p.bot),[false,true,true,true])
  for (const [tier,multiple] of [['plus','基础'],['premium','4×'],['super','15×'],['ultra','50×']] as const) {
    const p=grokProductCopy(tier)
    assert(p.features.some(feature=>feature.includes(multiple)))
    assert(p.features.some(feature=>tier==='plus' ? feature.includes('不含 Bot') : feature.includes('Grok · X · Cursor · Bot')))
    assert(p.features.some(feature=>tier==='plus' ? feature.includes('更少广告') : feature.includes('Premium+')))
    assert.match(p.description,/每周共享池/)
    assert.match(p.description,/第三方模型不包含/)
    assert.match(p.description,/连接个人 X 账号/)
    assert.match(p.description,/不交付独立的四个账号/)
    assert.doesNotMatch(p.description,/连接三种体验|三合一权益|四项服务均无限/)
    assert.match(p.faq.find(f=>f.question==='一个订阅能用四项服务吗？')!.answer,/Plus 不包含 Bot/)
  }
  assert.match(grokRedemptionGuide(),/Plus 不包含 Bot/)
  assert.match(grokRedemptionGuide(),/Premium、Super、Ultra 包含 Grok Bot/)
  assert.match(grokRedemptionGuide(),/自动充值与消费上限/)
})
