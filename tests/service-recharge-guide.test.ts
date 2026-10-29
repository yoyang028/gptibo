import test from 'node:test'
import assert from 'node:assert/strict'
import { SERVICE_RECHARGE_FAMILIES, SERVICE_RECHARGE_NAMES, SERVICE_GUIDE_NOTICE, serviceRechargeFamily, serviceRechargeSteps } from '../shared/service-recharge-guide.ts'

test('Redemption guides resolve exact product families without treating another product as a fallback', () => {
  for (const id of SERVICE_RECHARGE_FAMILIES) assert.equal(serviceRechargeFamily(id), id)
  for (const id of ['chatgpt', 'muse', 'student-verification', 'x-premium', 'gork', 'custom-example', '']) assert.equal(serviceRechargeFamily(id), undefined)
  assert.equal(SERVICE_RECHARGE_NAMES['codex-credits'], 'Codex 额度')
})

test('Each service receives the six-step code-delivery flow instead of the GPT Session submission flow', () => {
  for (const id of SERVICE_RECHARGE_FAMILIES) {
    const steps = serviceRechargeSteps(id)
    assert.deepEqual(steps.map(step => step.scene), ['selection', 'payment', 'delivery', 'account', 'submission', 'result'])
    assert.match(steps[2].description, /付款确认.*完成交付.*原订单.*兑换码.*兑换入口/)
    assert.match(steps[3].description, new RegExp(SERVICE_RECHARGE_NAMES[id]))
    assert.doesNotMatch(JSON.stringify(steps), /粘贴.*Session|api\/auth\/session|自动到账|立即到账|账号密码/)
    assert(steps.every(step => step.duration >= 5000))
  }
})

test('The account condition and result instructions remain specific to the selected service', () => {
  assert.match(serviceRechargeSteps('grok')[0].description, /美区.*半价.*已有订阅/)
  assert.match(serviceRechargeSteps('claude')[0].description, /Pro.*Max 5×.*Max 20×/)
  const codex = serviceRechargeSteps('codex-credits')
  assert.match(codex[5].title, /新增额度/)
  assert.match(codex[5].description, /余额.*变动记录/)
  assert.doesNotMatch(codex[5].description, /续费|个月|订阅时长/)
})

test('Public walkthrough copy points to private per-order guidance without publishing a redemption destination', () => {
  assert.match(SERVICE_GUIDE_NOTICE, /操作示意.*原订单随单指引/)
  for (const id of SERVICE_RECHARGE_FAMILIES) {
    assert.doesNotMatch(JSON.stringify(serviceRechargeSteps(id)), /https?:\/\/|dajuxai|t\.me|DEMO_ONLY_NOT_A_VALID_SESSION/)
    assert.match(serviceRechargeSteps(id)[4].description, /结果不明.*原单进度.*售后/)
  }
})
