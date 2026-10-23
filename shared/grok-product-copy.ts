import type { ShopProduct } from './shop-products.ts'

export type GrokTier = 'plus' | 'premium' | 'super' | 'ultra'
export const GROK_TIER_NAMES: Record<GrokTier, string> = {
  plus: 'Plus', premium: 'Premium', super: 'Super', ultra: 'Ultra',
}
type BuyerCopy = Pick<ShopProduct, 'tagline' | 'description' | 'duration' | 'features' | 'purchaseNote' | 'deliveryInstructions' | 'steps' | 'faq'>
const section = (title: string, text: string) => `### ${title}\n${text}`

/** The X Subscription rules verified against official docs on 2026-10-24. */
export const GROK_PLAN_RIGHTS: Record<GrokTier, { bot: boolean; usage: string; x: string }> = {
  plus: { bot: false, usage: '基础共享用量', x: 'X 认证标记、创作者工具与更少广告' },
  premium: { bot: true, usage: '4× Plus 共享用量', x: 'X Premium+ 权益' },
  super: { bot: true, usage: '15× Plus 共享用量', x: 'X Premium+ 权益' },
  ultra: { bot: true, usage: '50× Plus 共享用量', x: 'X Premium+ 权益' },
}

/** Storefront copy only: redemption destinations stay in private order data. */
export function grokProductCopy(tier: GrokTier): BuyerCopy {
  const name = GROK_TIER_NAMES[tier]
  const rights = GROK_PLAN_RIGHTS[tier]
  const included = rights.bot ? 'Grok、X、Cursor 与 Bot' : 'Grok、X 与 Cursor'
  const botNote = rights.bot ? '包含 Grok Bot，可使用 AI 智能体处理任务；Bot 与 Grok、Cursor 共用本档每周用量池。' : 'Plus 不包含 Grok Bot。如需 Bot，请选择 Premium、Super 或 Ultra。'
  return {
    tagline: `Grok ${name} · ${rights.usage}${rights.bot ? '，含 Bot。' : '，不含 Bot。'}`,
    duration: '美区组合订阅充值',
    description: [
      section('一个订阅，连接你的工作与灵感', `The X Subscription 将 Grok、X、Cursor 与 Bot 纳入同一订阅体系，具体权益随档位变化。本规格包含 ${included}。${botNote}\n通过兑换码交付，为符合条件的美区本人账号充值，不交付独立的四个账号。`),
      section(`当前所选 · ${name}`, `本规格对应 Grok ${name} 美区充值兑换码。包含 ${rights.usage}与${rights.x}。${botNote}\nGrok 用于问答、语音与创作；Cursor 用于代码编辑与 AI 编程；X 提供对应档位的认证和创作者权益；Bot 指 Grok Bot，可将任务交给 AI 智能体完成。四个入口的功能有区别，不能将组合订阅理解为四份独立的无限额度。`),
      section('共享用量与额外费用', '订阅内的合资格自有模型用量按每周共享池计算。Grok、Cursor，以及包含 Bot 的档位，均从同一用量池扣除；下次重置时间可在账号用量页查看。不同任务的消耗不同，用量倍率不等于固定消息条数、固定 tokens 或四份可叠加额度。\n第三方模型在 Premium 及以上可选。Cursor 中的 Claude、GPT 等第三方模型不包含在订阅内用量中，需要单独的额外用量余额；超过每周包含用量的使用也可能另计费。请先检查额外用量、自动充值和消费上限设置，再开始使用。'),
      section('开通后，如何使用各项服务', `按随单指引完成兑换后，使用同一订阅身份登录 Grok 与 Cursor，核对账号和所选档位。需要账号关联时，只在官方账号设置中选择本人要关联的账号。X 权益需连接个人 X 账号，组织管理或附属账号不适用；X 认证仍需满足平台资格要求。\n${rights.bot ? 'Bot 使用同一已开通订阅的账号登录，无需另买 Bot 订阅。' : 'Plus 仍可使用对应的 Grok、Cursor 与 X 权益，不能凭 Plus 登录使用付费 Bot 功能。'}账号关联或合并可能不可撤销，确认前请检查目标账号。`),
      section('购买前先核对账号', '仅限具备充值半价优惠资格的美区账号开通。已有会员不支持直接覆盖，购买前请先核对订阅状态与优惠资格；不符合条件时请先联系客服。\n请使用本人可正常登录的账号。本商品交付充值兑换码，不交付账号密码。'),
      section('交付、兑换与验收', '付款确认并完成交付后，在原订单领取兑换码、对应兑换入口和操作指引，再自行完成兑换。充值成功后，检查账号中的套餐、到期时间及账单记录。\n兑换码领取后请妥善保管并及时使用。结果不明确或仍在处理中时，先查询原单进度，不要重复提交或重新购买。'),
    ].join('\n\n'),
    features: [rights.usage, rights.bot ? 'Grok · X · Cursor · Bot' : 'Grok · X · Cursor；不含 Bot', rights.x, '本人账号充值，30 天掉订阅保障'],
    purchaseNote: '仅适用于具备充值半价优惠资格的美区账号；已有会员不可直接覆盖。付款前请确认账号、档位及适用条件。\n提供 30 天订阅异常保障。出现掉订阅、兑换码异常或未到账，请保留原订单号、错误提示和脱敏截图联系售后；账号封禁不在质保及售后范围。订阅周期、兑换码有效期与售后保障期是不同概念，请按随单说明及账号记录验收。\n充值被拒绝或结果不明时，请先查询原单并联系售后核查，不要连续重试、换账号重复充值或重复下单。账号密码、登录凭据及兑换码不要填入订单备注或公开聊天。',
    deliveryInstructions: '付款确认并完成交付后，在原订单领取兑换码、兑换入口和操作指引，按指引自行完成兑换。',
    steps: [
      { title: '核对账号与规格', description: '确认美区账号、半价优惠资格和现有订阅状态，再选择 Plus、Premium、Super 或 Ultra。' },
      { title: '付款后领取', description: '付款确认并完成交付后，兑换码、兑换入口与完整指引统一保存在原订单。' },
      { title: '兑换并核对权益', description: `按随单指引完成充值，检查订阅、有效期和账单，再登录或关联自己的 Grok、Cursor 与个人 X 账号。${rights.bot ? 'Bot 使用同一订阅账号登录。' : 'Plus 不包含 Bot。'}` },
    ],
    faq: [
      { question: '购买后能获得哪些内容？', answer: `交付 Grok ${name} 美区组合订阅的充值兑换码，包含 ${included} 对应档位权益。${botNote}兑换入口和完整教程会在付款确认、兑换码交付后随原订单提供。` },
      { question: '四个档位怎么选择？', answer: 'Plus 为基础共享用量，不包含 Bot；Premium、Super、Ultra 包含 Bot，共享用量分别为 Plus 的 4×、15×、50×。Plus 的 X 权益包括认证标记、创作者工具和更少广告，Premium 及以上为 X Premium+ 权益。按使用需求选择，具体可用量和重置时间可在账号中查看。' },
      { question: '一个订阅能用四项服务吗？', answer: `Premium、Super、Ultra 可以使用 Grok、X、Cursor 与 Bot；Plus 不包含 Bot。${name} ${rights.bot ? '属于包含 Bot 的档位。' : '请按 Grok、X 与 Cursor 三项权益使用。'}这些服务共享订阅身份和合资格 AI 用量，X 权益需关联个人 X 账号，不是收到四个独立账号。` },
      { question: 'Cursor 里的 Claude、GPT 也免费包含吗？', answer: '不包含。第三方模型在 Premium 及以上可选，Plus 不包含此项；受支持的第三方模型属于额外付费用量，从首次使用开始单独计费；超过每周包含用量后的合资格自有模型使用也需要额外余额。是否允许额外消费、自动充值和消费上限，由账号设置决定。' },
      { question: '哪些账号可以充值？已有会员可以用吗？', answer: '仅支持具备充值半价优惠资格的美区账号，已有会员不可直接覆盖。不确定账号条件时请先联系客服，确认适用后再购买。' },
      { question: '需要自己兑换吗？在哪里领取？', answer: '需要按随单指引自行兑换。付款确认并完成交付后，在本站原订单领取兑换码及对应入口，核对账号和所选档位后操作；无需在本站填写账号密码。' },
      { question: '30 天保障等于订阅时长吗？', answer: '30 天指订阅异常保障期，不代表兑换码或订阅本身的有效期。充值完成后，请在账号中检查套餐、到期时间与账单记录，并妥善保存原订单。' },
      { question: '充值被拒绝、掉订阅或账号封禁怎么办？', answer: '充值被拒绝或结果不明时，先查询原单并凭错误提示联系售后，避免重复提交。保障范围内的订阅异常凭原订单核查处理；账号封禁不提供质保或售后。' },
    ],
  }
}
