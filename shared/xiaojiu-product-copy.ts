import type { ShopProduct } from './shop-products.ts'
import { DELIVERY_COPY_HEADING, PENDING_COPY_HEADING } from './product-copy.ts'

// Public supplier facts checked against product IDs 10/14/15/16 and their actual
// SKUs on this date. Official plan information only explains tier differences;
// it never supplies missing supplier redemption periods or warranty promises.
export const XIAOJIU_COPY_CHECKED_AT = '2026-10-17'
export const XIAOJIU_REDEMPTION_URL = 'https://982xj.xyz/'
export const XIAOJIU_CLAUDE_PLAN_SOURCE = 'https://support.claude.com/en/articles/11049741-what-is-the-max-plan'

export type XiaojiuCopy = Pick<ShopProduct, 'tagline' | 'description' | 'duration' | 'features' | 'purchaseNote' | 'deliveryInstructions' | 'steps' | 'faq'>
type ClaudeTier = 'pro' | 'max5x' | 'max20x'

const redeemLink = `[小久自助兑换站](${XIAOJIU_REDEMPTION_URL})`
const section = (heading: string, text: string) => `### ${heading}\n${text}`
const commonDelivery = `恢复售卖后，在本站原订单领取所选规格的充值卡密（CDK），再由你前往 ${redeemLink} 自行充值。本站交付卡密，不在本站直接为账号开通；也不交付成品账号。当前暂停售卖，不接收本商品付款。`
const noCredentials = 'Session / sessionKey 属于登录凭据，仅在确认信任上游后，按其对应商品教程自行提交；不要填进本站订单备注、客服截图或公开聊天。'
const claudeSources: Record<ClaudeTier, string> = {
  pro: 'https://98-xj.com/products/claude%20pro',
  max5x: 'https://98-xj.com/products/claude%20max5x',
  max20x: 'https://98-xj.com/products/claude%20max20x',
}
const claudeNames: Record<ClaudeTier, string> = { pro: 'Claude Pro', max5x: 'Claude Max 5×', max20x: 'Claude Max 20×' }
const claudeCapacity: Record<ClaudeTier, string> = {
  pro: 'Pro 标准付费用量 · 含 Claude Code',
  max5x: '单次会话用量为 Pro 的 5 倍',
  max20x: '单次会话用量为 Pro 的 20 倍',
}

export function claudeProductCopy(tier: ClaudeTier): XiaojiuCopy {
  const name = claudeNames[tier]
  const warrantyPending = tier === 'max5x'
    ? '上游写明 30 天订阅质保；起算时点与本站受理规则仍需开售前确认。'
    : '上游同页同时出现“30 天订阅周期质保”和“29 天全程质保”，存在冲突；质保天数及起算点待核实。'
  return {
    tagline: `${name} 自用账号订阅充值卡密；需完成 KYC 并前往上游兑换。`,
    duration: '订阅充值 · 实际周期待核实',
    description: [
      section('商品介绍', 'Claude 是 Anthropic 的 AI 助手，可用于写作、资料分析、项目整理和编程。本商品为你已有 Claude 账号的订阅充值卡密，由上游处理官方订阅充值，提供对应 Pro 或 Max 档位；不是共享账号或镜像站会员。'),
      section(DELIVERY_COPY_HEADING, commonDelivery),
      section('本规格权益与用量', `${name}：${claudeCapacity[tier]}。${tier === 'pro' ? '适合日常写作、分析与编程。' : '包含 Pro 功能及更高用量，适合频繁使用 Claude 的个人用户。'}\n官方目前将 Claude Code 列为 Pro / Max 权益。5× / 20× 指相对 Pro 的单次会话用量，不代表固定消息数、固定 tokens、速度倍数或无限使用；仍受会话、周用量及模型限制。附加活动、API 赠额和新功能是否适用本次充值，待上游确认。`),
      section('订阅周期与有效期', '上游以“30 天订阅周期”描述本商品，但未为该 SKU 单独列明实际到账天数和起算时刻。请在开售前核对，并以充值后官方账号显示的到期时间验收。卡密最晚兑换时间、是否可长期保存，均待核实；不要把订阅周期当作卡密有效期。'),
      section('适用账号与限制', '使用本人可正常登录、已完成 KYC 的 Claude 账号。上游写明“无法覆盖”“不是 iOS”，已有订阅能否续充、升级或叠加，以及 iOS / App Store 订阅账号如何处理，均需先确认，不能直接按通用卡使用。\n兑换站额外提示：新注册且刚完成 KYC 的账号应暂缓充值并联系客服；通过 KYC 不代表账号已稳定。部分账号还会要求手机号验证，接码服务不包含在本商品内。\n上游限制多人共享、频繁切换 IP / 设备、反代及高风险环境；封号（包括刚充值即封禁）不在其质保范围。'),
      section(PENDING_COPY_HEADING, `${warrantyPending}\n• 卡密有效期、实际到账天数及订阅起算时点。\n• 已有订阅的续充 / 升级资格、地区限制、手机号验证或自备代理的适用条件及费用。\n• 本站售后受理时限、退款计日方式、25% 扣费的计算基数及支付手续费处理。\n• 官方附加活动或 API 赠额是否适用于这些上游规格。`),
      section('信息来源', `[本规格上游说明](${claudeSources[tier]}) · [Claude 官方套餐权益](${XIAOJIU_CLAUDE_PLAN_SOURCE})\n核对日期：${XIAOJIU_COPY_CHECKED_AT}。已查看公开兑换入口与操作说明，尚未进行实际充值验证。`),
    ].join('\n\n'),
    features: [claudeCapacity[tier], '本人账号充值，须先完成 KYC', '原订单领卡密，再到上游自行兑换', '仅订阅异常按上游规则处理，封号不保'],
    purchaseNote: `购买前先确认账号满足 KYC、订阅状态及渠道条件；新注册且刚完成 KYC 的账号暂勿充值。\n上游售后主要处理账号未封禁时的掉会员 / 掉订阅：先补订阅，无法补时再按剩余未使用天数处理。${warrantyPending}\n上游写有退款扣除 25% 手续费、支付手续费不退；计算基数、本站最终可退金额、计日方式和处理时限尚未明确，均待开售前核实，不承诺全额退款或固定到账日期。\n账号封禁（含充值后立即封禁）、共享或违规使用、频繁切换环境、账号历史风险，以及自行修改账号资料导致的异常，不在上游质保范围。\n遇到卡密或充值异常，请保留原订单号、错误提示及隐藏敏感信息的截图，联系本站客服核查。${noCredentials}`,
    deliveryInstructions: `交付所选 ${name} 充值卡密。恢复售卖后，供货完成时在本站原订单领取；需自行前往 ${redeemLink} 输入卡密并完成账号验证、充值及进度查询。兑换站会根据卡密自动识别规格。`,
    steps: [
      { title: '先确认账号，再领取卡密', description: '先核对 KYC、是否已有订阅及账号渠道。恢复售卖后完成本站订单，在原订单领取所选档位卡密；新注册且刚完成 KYC 的账号先联系客服。' },
      { title: '到上游输入卡密', description: `打开 ${redeemLink}，粘贴完整卡密并点击“兑换卡密”。系统按卡密识别商品，先核对是否为你购买的 Claude 档位。` },
      { title: '按 Claude 教程确认账号', description: '仅在上游页面按 Claude 对应教程准备账号验证信息（sessionKey，非 API Key），核对目标账号、订阅条件及所有费用提示后再确认。卡密验证后的完整流程未用真实账号实测。' },
      { title: '跟进原单并验收订阅', description: '在兑换页使用“查充值状态”跟进原单；完成后回自己的 Claude 账号检查套餐与到期时间。处理中不要重复兑换；失败或掉订阅时带订单号和脱敏截图联系本站。' },
    ],
    faq: [
      { question: '购买的是账号、API 额度还是订阅？', answer: '这是自己 Claude 账号的订阅充值卡密，不交付账号密码。Pro / Max 属于个人订阅；官方另有 API 产品和附加活动，具体是否适用本次上游充值尚待确认，未计入本站交付承诺。' },
      { question: 'Pro、Max 5×、Max 20× 有什么区别？', answer: 'Pro 为标准付费用量；Max 5×、20× 的单次会话用量分别为 Pro 的 5 倍、20 倍。三档官方均包含 Claude Code。实际可用量随任务长度、模型及官方限制变化，不能按倍率换算成固定消息条数或无限使用。' },
      { question: '需要到其他网站兑换吗？地址是什么？', answer: `需要。本站原订单交付卡密，你需要到 ${redeemLink} 自行充值。先输入卡密，点击“兑换卡密”，再按自动识别出的 Claude 流程核对账号并操作；本站不会自动读取你的 Claude 账号。` },
      { question: '已经有订阅、iOS 订阅或刚注册账号可以用吗？', answer: '上游写明无法覆盖、不是 iOS，未明确覆盖全部续充与升级场景。已有会员或移动端订阅请先确认；新注册且刚完成 KYC 的账号，兑换站要求暂缓充值并联系客服，不能仅凭完成 KYC 就认定适用。' },
      { question: 'KYC 要去哪里做？包含认证或接码费吗？', answer: '按 Claude 官方对该账号的认证提示操作，本商品不包含额外认证、手机号接码或代理费用。上游另有 [KYC 工具说明](https://982xj.xyz/kyc)，该页面提示可能尝试月付订阅并产生扣款，不能当作保证免费的认证服务；是否需要使用、费用及适用性须先核实。' },
      { question: '卡密多久过期？订阅和质保都是 30 天吗？', answer: `卡密最晚兑换时间和实际到账天数未被上游单独明确，需确认后再购买；充值后查看官方账号到期时间。${warrantyPending}订阅周期、卡密有效期和售后期是三项不同信息。` },
      { question: '封号、掉订阅和充值失败怎么处理？', answer: '账号未封禁且在适用质保期内掉订阅，上游规则为优先补订阅，不能补时再按剩余天数核算；扣费基数与本站最终退款规则待核实。账号封禁（含秒封）上游不保。充值失败先查询原单并联系本站，不承诺失败即全额退款。' },
      { question: '需要把 Session、sessionKey 或密码交给本站吗？', answer: `不需要在本站填写账号密码、Session 或 sessionKey。${noCredentials}实际需要哪些验证信息以卡密识别后的 Claude 专属教程为准。` },
    ],
  }
}

export function codexCreditsProductCopy(amount: 250 | 500 | 1000 | 2500): XiaojiuCopy {
  return {
    tagline: `Codex ${amount} 额度充值卡密；适用非 Free 账号，需到上游自行兑换。`,
    duration: '额度充值 · 有效期待核实',
    description: [
      section('商品介绍', `为已有、符合条件的 ChatGPT 账号补充 Codex 使用额度。本规格为上游标称的 ${amount} Codex 额度，通过充值卡密交付；不是 ChatGPT API 余额，也不包含新账号或会员订阅。`),
      section(DELIVERY_COPY_HEADING, commonDelivery),
      section('各档额度与区别', '250 / 500 / 1000 / 2500 是上游提供的四档额度，核心区别为标称数量。上游没有给出与美元、tokens、请求次数或可完成任务数的固定换算，不能将这些数字当作 API 金额或固定使用次数。'),
      section('额度与有效期', `当前所选档位：${amount} 额度。到账后额度的有效期、使用或扣减规则，以及卡密最晚兑换时间，上游商品与 SKU 未单独说明，均待核实。它不是按月订阅，不能据此推算会延长 ChatGPT 会员期限。`),
      section('适用账号与限制', '上游明确说明 ChatGPT Free 账号不能购买额度；其他账号也需要由兑换页识别为支持的充值对象。充值使用账号现有账单国家，不能通过此卡改变地区。\n上游的 Codex 页面会核验登录状态和额度去向；若显示个人 / Team 选择，必须核对归属与拥有者资格，不保证所有团队或成员账号均可用。提交前仔细确认目标账号和档位。'),
      section(PENDING_COPY_HEADING, '• 卡密最晚兑换时间、到账后额度有效期及是否支持跨期保留。\n• 各订阅档位与 Team / Business 的具体准入范围、账单币种是否影响到账量。\n• 到账额度的明确定义、扣减规则及可核对的额度记录。\n• 非封号异常的售后期、补发或退款条件、手续费及处理时限。'),
      section('信息来源', `[Codex 上游商品说明](https://98-xj.com/products/codex)\n核对日期：${XIAOJIU_COPY_CHECKED_AT}。四档与实际供货规格一致；已查看公开兑换入口与说明，尚未用真实账号充值验证。`),
    ].join('\n\n'),
    features: [`${amount} Codex 额度（上游标称）`, '非 ChatGPT API 余额或会员订阅', 'Free 账号不适用，按现有账单国家充值', '原订单领卡密，再到上游自行兑换'],
    purchaseNote: `请先确认账号具备购买 Codex 额度的资格；Free 不适用，其他账号的具体范围及额度有效期待核实。按账号现有账单国家处理，不能改区；不要将标称额度换算成美元、tokens 或固定使用次数。\n上游明确账号封禁不提供质保。卡密无效、未到账或数量异常的售后期、补发 / 退款规则、费用和时限尚未写明，开售前需确认；不承诺永久有效、无限使用或无条件退款。\n遇到异常，先在上游查询原单，再向本站提供订单号、错误提示与脱敏截图。${noCredentials}`,
    deliveryInstructions: `交付 Codex ${amount} 额度充值卡密。恢复售卖后，供货完成时在本站原订单领取；需到 ${redeemLink} 输入卡密，由页面识别档位后，自行核对账号并完成充值。`,
    steps: [
      { title: '核对资格并领取卡密', description: '先确认不是 Free 账号，核对账单国家及所需额度。恢复售卖后，在本站原订单领取对应档位的充值卡密。' },
      { title: '在上游验证卡密', description: `打开 ${redeemLink}，输入完整卡密并点击“兑换卡密”，核对自动识别出的 Codex 档位与订单一致。` },
      { title: '核对 Session 与额度去向', description: '在同一浏览器登录目标 ChatGPT 账号，按上游教程获取完整 Session JSON，仅在其对应表单自行提交。核对登录状态与个人 / Team 充值对象，确认无误后再操作；完整流程尚未用真实账号实测。' },
      { title: '查询原单并核对到账', description: '使用兑换页“查充值状态”跟进原单，成功后回对应账号检查 Codex 额度及记录。处理中或结果不明时不要重复充值；未到账时保留订单号联系本站核查。' },
    ],
    faq: [
      { question: '这是 API 余额、ChatGPT 会员还是 Codex 额度？', answer: '是 Codex 额度充值卡密。上游明确不是 ChatGPT API 商品，也不交付会员订阅、账号或密码；不能将档位数字当作美元、tokens 或固定调用次数。' },
      { question: '250、500、1000、2500 四档有什么区别？', answer: '这些是上游实际提供的四个标称额度规格。区别在于标称数量与本站售价；上游没有公开固定的任务数量、模型耗用或货币换算，额度定义与到账后使用规则仍需确认。' },
      { question: '需要去哪里兑换？本站能直接充值吗？', answer: `需要到 ${redeemLink} 自行兑换。本站交付卡密，兑换站先按卡密识别档位，再由你按对应教程核对账号并提交；本页没有直接为你账号充值的功能。` },
      { question: '免费账号、团队账号或不同地区可以用吗？', answer: '上游明确 Free 账号不能购买；非 Free 也要经兑换页确认适用。按现有账单国家充值，不能改区。Team 去向仅在页面识别相应资格和拥有者权限后选择，具体订阅档位及地区范围仍待核实。' },
      { question: '卡密和到账额度各能保存多久？', answer: '上游没有单独写明卡密最晚兑换时间、额度到账后的有效期及跨期保留规则，目前均标为待核实；不要据此认定永久有效或与会员同期。' },
      { question: '封号、卡密异常或未到账有什么售后？', answer: '上游明确封号不保。其他卡密或充值异常需凭订单号联系本站核查，受理期、补发或退款条件、手续费与到账时限尚未确认，不承诺无条件或固定时效退款。' },
      { question: 'Session 失效、处理中或失败了怎么办？', answer: '先用原卡密查询充值状态。结果不明或仍在处理中时，不要重复兑换或付款；若页面明确要求更新登录信息，按上游教程获取同一账号的新 Session 并继续原单。' },
      { question: '需要在本站提交 Session 或密码吗？', answer: noCredentials },
    ],
  }
}
