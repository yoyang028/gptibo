import type { ShopProduct } from './shop-products.ts'

// Fact checking and supplier references belong in docs/XIAOJIU_BUYER_DETAILS.md.
// This module contains public storefront copy only, without redemption URLs.
export const XIAOJIU_COPY_CHECKED_AT = '2026-10-17'
export type XiaojiuCopy = Pick<ShopProduct, 'tagline' | 'description' | 'duration' | 'features' | 'purchaseNote' | 'deliveryInstructions' | 'steps' | 'faq'>
type ClaudeTier = 'pro' | 'max5x' | 'max20x'

const section = (heading: string, text: string) => `### ${heading}\n${text}`
const deliveryInstructions = '付款确认并完成交付后，在原订单领取兑换码、兑换入口和操作指引，按指引自行完成充值。'
const steps = [
  { title: '选择规格', description: '根据使用需求选择档位，先阅读账号条件与购买须知，再核对订单信息。' },
  { title: '付款后领取', description: '付款确认后处理交付，兑换码、兑换入口和完整操作指引统一保存在原订单中。' },
  { title: '兑换并使用', description: '按随单指引核对目标账号，完成兑换后检查权益到账情况；遇到异常可凭原订单联系售后。' },
]
const claudeNames: Record<ClaudeTier, string> = { pro: 'Claude Pro', max5x: 'Claude Max 5×', max20x: 'Claude Max 20×' }
const claudeCapacity: Record<ClaudeTier, string> = {
  pro: 'Pro 付费用量，支持 Claude Code',
  max5x: '约为 Pro 的 5 倍会话用量',
  max20x: '约为 Pro 的 20 倍会话用量',
}
const claudeUse: Record<ClaudeTier, string> = {
  pro: '适合日常写作、文档分析、学习与轻量编程。',
  max5x: '适合经常处理长文档、连续编程和多轮任务的用户。',
  max20x: '适合高频使用 Claude 与 Claude Code、需要更充足用量的用户。',
}

export function claudeProductCopy(tier: ClaudeTier): XiaojiuCopy {
  const name = claudeNames[tier]
  return {
    tagline: `${name}，让写作、分析与编程更从容。`,
    duration: '个人订阅充值',
    description: [
      section('为你的 Claude 账号开通订阅', 'Claude 是 Anthropic 的 AI 助手，适合写作润色、长文档理解、资料分析与编程协作。本商品为本人 Claude 账号的订阅充值，交付对应档位的兑换码。使用你自己的账号，保留原有对话与工作习惯。'),
      section(name + ' · 所选权益', `${claudeCapacity[tier]}。${claudeUse[tier]}\nPro、Max 5× 与 Max 20× 均支持 Claude Code。Max 提供更高用量，5× / 20× 表示相对 Pro 的会话用量级别，不代表速度倍数或固定消息条数；实际使用仍受模型、任务长度及会话和周用量限制。`),
      section('适用账号', '请使用本人可正常登录、已完成 KYC 的 Claude 账号。新注册且刚完成认证的账号，请先联系客服确认适用性。\n已有订阅、需要升级或续充、通过 iOS / App Store 订阅的账号，请购买前联系客服核对，避免重复开通。本商品不包含账号、API 余额、认证服务或手机号接码。'),
      section('开通与使用', '订单交付后，按随单指引自行兑换并核对目标账号。充值完成后，可在 Claude 账号中查看套餐与到期时间。兑换码请妥善保管，领取后及时使用；账号验证所需信息仅按兑换页面的对应教程操作，无需在本站提交密码或登录凭据。'),
    ].join('\n\n'),
    features: [claudeCapacity[tier], '本人账号使用，保留对话与工作记录', '支持写作、文档分析与编程协作', '原订单领取兑换码与使用指引'],
    purchaseNote: '购买前请确认账号可正常使用，已完成 KYC，并符合所选规格的订阅条件；已有订阅或特殊渠道账号请先联系客服。\n订阅未到账、兑换码异常或使用中掉订阅，请保留原订单号、错误提示及脱敏截图联系售后核查，按订单情况处理。账号封禁、多人共享、违规使用、频繁切换 IP / 设备或自行修改账号资料造成的异常，不在售后保障范围。\n认证、接码等额外服务不包含在售价内。不要在订单备注或客服聊天中发送账号密码、Session 或 sessionKey。',
    deliveryInstructions,
    steps,
    faq: [
      { question: 'Pro、Max 5×、Max 20× 怎么选？', answer: '日常写作、分析和轻量编程可选择 Pro。高频处理文档或连续使用 Claude Code，可根据需求选择 Max 5× 或 Max 20×，会话用量分别约为 Pro 的 5 倍和 20 倍。各档均有使用限制，用量会随模型和任务变化。' },
      { question: '购买后交付什么？需要自行兑换吗？', answer: '交付所选档位的订阅兑换码。付款确认并完成交付后，原订单会同时提供兑换码、兑换入口和完整指引；你需要按指引自行完成兑换，不需要在本站填写账号密码。' },
      { question: '包含 Claude Code 或 API 余额吗？', answer: 'Pro 与 Max 订阅支持 Claude Code，使用量与对应订阅规则有关。本商品交付个人订阅，不包含 API 余额，也不承诺额外活动赠送权益。' },
      { question: '已有会员或刚注册的账号能用吗？', answer: '账号需可正常登录并已完成 KYC。已有订阅、刚注册且刚完成认证、iOS / App Store 订阅，以及升级或续充场景，请先联系客服核对，确认适用后再购买。' },
      { question: '什么时候开始使用，在哪里查看有效期？', answer: '完成兑换并充值成功后，回到 Claude 账号检查套餐状态与到期时间。兑换码与登录信息请妥善保管，领取后及时兑换，不要向他人分享。' },
      { question: '兑换失败或订阅异常怎么办？', answer: '先在原订单及兑换页面查询处理进度。仍在处理中时不要重复提交；出现兑换码无效、未到账或掉订阅，请凭原订单和脱敏截图联系售后。账号封禁或共享、违规使用造成的异常不在保障范围。' },
    ],
  }
}

export function codexCreditsProductCopy(amount: 250 | 500 | 1000 | 2500): XiaojiuCopy {
  return {
    tagline: `${amount} Codex 额度，为下一段代码留足空间。`,
    duration: '额度包 · 一次充值',
    description: [
      section('为编程任务补充额度', '为符合条件的 ChatGPT 账号补充 Codex 使用额度，适合代码编写、项目理解、调试与持续开发。使用自己的账号，按需选择额度档位。'),
      section(`${amount} 额度 · 所选规格`, `本规格包含 ${amount} Codex 额度。250 / 500 / 1000 / 2500 四档的区别在于额度数量，可根据使用需求选择。额度用于 Codex，不是 ChatGPT API 余额，也不包含 ChatGPT 会员订阅或新账号。\n实际消耗随模型与任务复杂度变化，不按固定消息条数、tokens 或任务次数承诺。`),
      section('适用账号', 'ChatGPT Free 账号不适用。请先确认账号具备额度充值资格，并可正常登录；充值按账号现有账单国家处理，不支持通过本商品更改地区。\n团队场景请先确认目标工作区和相应权限，兑换时仔细核对额度去向，避免充入错误账号或工作区。'),
      section('到账与使用', '付款确认并完成交付后，在原订单领取兑换码及使用指引，自行完成兑换。充值成功后，请到对应账号检查额度与使用记录；额度消耗及有效期以账号显示为准。兑换码领取后请及时使用并妥善保管。'),
    ].join('\n\n'),
    features: [`${amount} Codex 额度`, '四档可选，按编程需求补充', '充值本人符合条件的账号', '原订单领取兑换码与使用指引'],
    purchaseNote: '购买前请确认账号具备 Codex 额度充值资格，Free 账号不适用；团队账号请先确认工作区与权限。充值按当前账单国家处理，不支持改区，也不会延长 ChatGPT 会员期限。\n兑换时核对目标账号与档位，处理中不要重复提交。兑换码无效、额度未到账或数量异常，请凭原订单号、错误提示及脱敏截图联系售后核查。账号封禁、共享或违规使用造成的异常不在保障范围。\n无需在本站提交密码或 Session，相关账号验证请仅按随单教程操作。',
    deliveryInstructions,
    steps,
    faq: [
      { question: '四种额度规格有什么区别？', answer: '提供 250、500、1000、2500 四档额度，区别在于充值额度数量。可按个人编程频率与任务规模选择；实际消耗取决于模型与任务，不能换算为固定完成次数。' },
      { question: '这是 ChatGPT 会员或 API 余额吗？', answer: '这是 Codex 使用额度充值，不包含会员订阅、API 余额、账号或密码，也不会延长现有会员的订阅期限。' },
      { question: '付款后怎么领取和兑换？', answer: '付款确认并完成交付后，在原订单领取兑换码。兑换入口与完整操作步骤会随兑换码一起提供；按指引核对目标账号后自行完成充值。' },
      { question: '免费账号和团队账号可以充值吗？', answer: 'Free 账号不适用。其他账号需具备额度充值资格；团队场景还需核对工作区与权限，确认兑换页面识别的额度去向无误后再操作。' },
      { question: '额度什么时候到账，有效期在哪里看？', answer: '按随单指引完成兑换后，在对应账号中检查充值状态、额度记录和有效期。结果不明确或仍在处理时，请先查询原单，不要重复提交。' },
      { question: '未到账、兑换码异常如何处理？', answer: '保留原订单号、错误提示及脱敏截图，联系售后核查。账号封禁、共享、违规使用或选错充值对象造成的异常不在保障范围。不要在聊天中发送密码或完整 Session。' },
    ],
  }
}
