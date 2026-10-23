import type { ShopProduct } from './shop-products.ts'

export type GrokTier = 'plus' | 'premium' | 'super' | 'ultra'
export const GROK_TIER_NAMES: Record<GrokTier, string> = {
  plus: 'Plus', premium: 'Premium', super: 'Super', ultra: 'Ultra',
}
type BuyerCopy = Pick<ShopProduct, 'tagline' | 'description' | 'duration' | 'features' | 'purchaseNote' | 'deliveryInstructions' | 'steps' | 'faq'>
const section = (title: string, text: string) => `### ${title}\n${text}`

/** Storefront copy only: redemption destinations stay in private order data. */
export function grokProductCopy(tier: GrokTier): BuyerCopy {
  const name = GROK_TIER_NAMES[tier]
  return {
    tagline: `Grok ${name} · 连接灵感、社交与编程。`,
    duration: '美区组合订阅充值',
    description: [
      section('一个订阅，连接三种体验', '为符合条件的美区账号开通组合订阅，包含 Grok、X Premium 与 Cursor 对应档位权益。通过兑换码交付，使用自己的账号，按随单指引完成充值。'),
      section(`当前所选 · ${name}`, `本规格对应 Grok ${name} 美区充值兑换码。四档可选：Plus、Premium、Super、Ultra；请按需要选择，并在兑换时核对识别出的套餐与订单一致。\nGrok 用于问答与创作，X Premium 提供对应订阅体验，Cursor 用于编程协作。具体可用功能、用量和服务周期，以账号开通后的对应套餐显示为准，不将档位名称换算为固定消息数、固定 tokens 或无限使用。`),
      section('购买前先核对账号', '仅限具备充值半价优惠资格的美区账号开通。已有会员不支持直接覆盖，购买前请先核对订阅状态与优惠资格；不符合条件时请先联系客服。\n请使用本人可正常登录的账号。本商品交付充值兑换码，不交付账号密码。'),
      section('交付、兑换与验收', '付款确认并完成交付后，在原订单领取兑换码、对应兑换入口和操作指引，再自行完成兑换。充值成功后，检查账号中的套餐、到期时间及账单记录。\n兑换码领取后请妥善保管并及时使用。结果不明确或仍在处理中时，先查询原单进度，不要重复提交或重新购买。'),
    ].join('\n\n'),
    features: [`${name} 美区组合订阅`, 'Grok · X Premium · Cursor 对应权益', '本人账号充值，订单内领码', '30 天订阅异常保障，封号不保'],
    purchaseNote: '仅适用于具备充值半价优惠资格的美区账号；已有会员不可直接覆盖。付款前请确认账号、档位及适用条件。\n提供 30 天订阅异常保障。出现掉订阅、兑换码异常或未到账，请保留原订单号、错误提示和脱敏截图联系售后；账号封禁不在质保及售后范围。订阅周期、兑换码有效期与售后保障期是不同概念，请按随单说明及账号记录验收。\n充值被拒绝或结果不明时，请先查询原单并联系售后核查，不要连续重试、换账号重复充值或重复下单。账号密码、登录凭据及兑换码不要填入订单备注或公开聊天。',
    deliveryInstructions: '付款确认并完成交付后，在原订单领取兑换码、兑换入口和操作指引，按指引自行完成兑换。',
    steps: [
      { title: '核对账号与规格', description: '确认美区账号、半价优惠资格和现有订阅状态，再选择 Plus、Premium、Super 或 Ultra。' },
      { title: '付款后领取', description: '付款确认并完成交付后，兑换码、兑换入口与完整指引统一保存在原订单。' },
      { title: '兑换并核对权益', description: '按随单指引核对目标账号与套餐后兑换，完成后检查订阅及账单记录。异常时保留原单联系售后。' },
    ],
    faq: [
      { question: '购买后能获得哪些内容？', answer: `交付 Grok ${name} 美区组合订阅的充值兑换码，包含 Grok、X Premium 与 Cursor 对应档位权益。兑换入口和完整教程会在付款确认、兑换码交付后随原订单提供。` },
      { question: '四个档位怎么选择？', answer: '提供 Plus、Premium、Super、Ultra 四种规格。按需求选择对应档位，开通前核对页面识别的套餐；各服务的功能与用量按开通后的账号套餐显示，不承诺固定消息条数、tokens 或无限使用。' },
      { question: '哪些账号可以充值？已有会员可以用吗？', answer: '仅支持具备充值半价优惠资格的美区账号，已有会员不可直接覆盖。不确定账号条件时请先联系客服，确认适用后再购买。' },
      { question: '需要自己兑换吗？在哪里领取？', answer: '需要按随单指引自行兑换。付款确认并完成交付后，在本站原订单领取兑换码及对应入口，核对账号和所选档位后操作；无需在本站填写账号密码。' },
      { question: '30 天保障等于订阅时长吗？', answer: '30 天指订阅异常保障期，不代表兑换码或订阅本身的有效期。充值完成后，请在账号中检查套餐、到期时间与账单记录，并妥善保存原订单。' },
      { question: '充值被拒绝、掉订阅或账号封禁怎么办？', answer: '充值被拒绝或结果不明时，先查询原单并凭错误提示联系售后，避免重复提交。保障范围内的订阅异常凭原订单核查处理；账号封禁不提供质保或售后。' },
    ],
  }
}
