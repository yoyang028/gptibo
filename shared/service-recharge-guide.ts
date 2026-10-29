export const SERVICE_RECHARGE_FAMILIES = ['claude', 'grok', 'codex-credits'] as const
export type ServiceRechargeFamily = typeof SERVICE_RECHARGE_FAMILIES[number]
export type ServiceGuideScene = 'selection' | 'payment' | 'delivery' | 'account' | 'submission' | 'result'
export type ServiceGuideStep = { title: string; short: string; description: string; address: string; scene: ServiceGuideScene; duration: number }

export function serviceRechargeFamily(value: string): ServiceRechargeFamily | undefined {
  return (SERVICE_RECHARGE_FAMILIES as readonly string[]).includes(value) ? value as ServiceRechargeFamily : undefined
}

export const SERVICE_RECHARGE_NAMES: Record<ServiceRechargeFamily, string> = {
  claude: 'Claude', grok: 'Grok', 'codex-credits': 'Codex 额度',
}

/** These products deliver a code and a private, order-specific redemption guide. */
export function serviceRechargeSteps(family: ServiceRechargeFamily): readonly ServiceGuideStep[] {
  const name = SERVICE_RECHARGE_NAMES[family]
  const eligibility = family === 'grok'
    ? '先确认美区账号、半价优惠资格和已有订阅状态，再选择适合自己的档位。'
    : family === 'codex-credits'
      ? '按编程需求选择额度，先核对目标账号及商品说明中的充值条件。'
      : '选择 Pro、Max 5× 或 Max 20×，先核对自己的账号条件与当前订阅。'
  return [
    { title: '选择规格并核对条件', short: '选规格', description: eligibility, address: '本站 / 选择规格', scene: 'selection', duration: 6500 },
    { title: '填写订单并完成付款', short: '付款', description: '商品开放购买后，填写订单通知邮箱，核对规格、金额与收款说明，再按订单页面完成付款。', address: '本站 / 确认订单与付款', scene: 'payment', duration: 6500 },
    { title: '领取兑换码与指引', short: '领取', description: '付款确认并完成交付后，回到本站原订单领取兑换码、对应兑换入口和完整操作指引。', address: '我的订单 / 交付内容', scene: 'delivery', duration: 6500 },
    { title: '打开随单入口核对账号', short: '核对账号', description: `从原订单打开对应兑换入口，核对准备充值的 ${name} 账号。需要填写的资料与操作位置以本单指引为准。`, address: '随单兑换入口 / 核对账号', scene: 'account', duration: 6500 },
    { title: '提交兑换并等待结果', short: '兑换', description: '核对目标账号与所选规格，按随单指引提交兑换。处理中或结果不明时，先查询原单进度，再联系售后核查。', address: '随单兑换入口 / 兑换进度', scene: 'submission', duration: 6500 },
    { title: family === 'codex-credits' ? '核对新增额度' : '核对订阅与权益', short: '核对到账', description: family === 'codex-credits' ? '回到对应 Codex 账号查看余额及变动记录，核对所购额度；如有差异，从原订单联系售后。' : `回到对应 ${name} 账号，核对套餐、到期时间及所选规格包含的权益；如有差异，从原订单联系售后。`, address: `${name} / 核对充值结果`, scene: 'result', duration: 6000 },
  ]
}

export const SERVICE_GUIDE_NOTICE = '流程为操作示意；兑换入口、账号条件及需要填写的资料，以原订单随单指引为准。'
