import {
  hanfolkFamily,
  skuName,
  type HanfolkDetail,
} from './hanfolk-catalog.ts'
import type { ShopProduct } from './shop-products.ts'
import { museBuyerCopy } from './muse-buyer-copy.ts'
import { appleIdBuyerCopy, APPLE_ID_SOURCES } from './apple-id-buyer-copy.ts'

export type HanfolkBuyerCopy = Pick<
  ShopProduct,
  | 'name'
  | 'tagline'
  | 'description'
  | 'duration'
  | 'features'
  | 'buyerHighlights'
  | 'buyerWarnings'
  | 'purchaseNote'
  | 'deliveryInstructions'
  | 'steps'
  | 'faq'
>
const section = (title: string, text: string) => '### ' + title + '\n' + text
const pendingRedeem =
  '需要前往站外自行兑换。供货方尚未提供可核实的专用兑换地址，当前只展示资料；地址、具体操作和兑换时限补齐后才可开售。请勿把卡密提交到搜索得到的陌生网站。'
const unspecifiedWarranty =
  '供货资料未写明本规格的质保期限、退款条件或更换规则，购买前需确认；不将其他规格的售后承诺套用到本商品。'
export class SourceCopyChanged extends Error {}
const profileTerms: Record<number, RegExp[]> = {
  27: [/9[–-]10\s*天/, /3\s*天/, /封号不保/],
  36: [/18\s*个月/, /5\s*TB/i, /无需绑卡/, /自己账号/],
  57: [/10亿/, /50亿/, /310亿/, /收件入口/, /可改邮箱/],
  55: [/12\s*个月/, /Super/i, /不可叠加/, /无需绑卡/],
  54: [/12\s*个月/, /新老账号/, /无需绑卡/],
  53: [/5\s*个月/, /印度区新号/, /UPI|银行卡/i],
  21: [/全区通用/, /多端/],
  3: [/Google AI Pro/, /成品账号/],
  10: [/Gmail/, /密码/, /验证资料/, /不含/],
  23: [/个人版/, /团队版/, /成品账号/],
  15: [/美国/, /独享/, /密保/],
  50: [/香港/, /独享/, /密保/],
  14: [/日本/, /独享/, /密保/],
  4: [/土耳其/, /独享/, /密保/],
  5: [/尼日利亚/, /独享/, /密保/],
  16: [/美国/, /独享/, /Shadowrocket/],
}

/** Buyer-facing editorial copy. Source identifiers select a verified product
 * profile; unknown products receive no invented term, URL or entitlement. */
export function hanfolkBuyerCopy(
  product: HanfolkDetail,
  sku: string,
): HanfolkBuyerCopy {
  if (
    profileTerms[product.id]?.some(
      (pattern) => !pattern.test(product.description),
    )
  )
    throw new SourceCopyChanged(
      '上游商品 #' + product.id + ' 的关键资料已变化，需要重新核实后整理。',
    )
  const family = hanfolkFamily(product.title),
    label = skuName(product, sku).trim()
  if (family === 'muse' && (product.id === 57 || product.id === 69)) return museBuyerCopy(product.id, label)
  if (family === 'apple-id' && Object.hasOwn(APPLE_ID_SOURCES, product.id)) return appleIdBuyerCopy(product.id as keyof typeof APPLE_ID_SOURCES, label)
  const account = /成品|账户|账号|Apple\s*ID/i.test(product.title)
  let name =
    label === product.title ? product.title : product.title + ' · ' + label
  let introduction = product.description,
    rights = label,
    duration = label === product.title ? '以所选商品说明为准' : label
  let conditions =
    '购买前核对本规格的服务内容和适用账号；未说明的使用限制应先向店主确认。'
  let delivered = account
    ? '交付所选成品账号的登录资料；资料格式以原订单为准。'
    : '交付所选规格的兑换资料，由买家在站外自行完成兑换。'
  let use = account
    ? '按原订单指引前往对应服务登录，核对收到的账号与权益。'
    : pendingRedeem
  let warranty = unspecifiedWarranty
  let redemption = account
    ? '不需要 CDK 兑换；需按交付指引到对应服务登录账号。'
    : pendingRedeem
  const highlights: string[] = [
    account
      ? '交付成品账号，不是为现有账号充值'
      : '交付兑换资料，需站外自行兑换',
  ]
  const warnings: string[] = [],
    faq: { question: string; answer: string }[] = []
  let steps: ShopProduct['steps'] = account
    ? [
        {
          title: '查看交付资料',
          description: '在原订单核对账号、资料格式与登录指引。',
        },
        {
          title: '登录并核对',
          description: '按对应服务指引登录，核对账号和本规格写明的权益。',
        },
        {
          title: '处理首次使用问题',
          description:
            '资料缺漏或登录异常，保留错误提示并从原订单联系售后。请勿公开完整账号、密码和验证码。',
        },
      ]
    : [
        {
          title: '先核对资格',
          description: '确认账号地区、已有订阅和本规格的适用条件。',
        },
        {
          title: '领取兑换资料',
          description:
            '开售后在原订单查看卡密或激活链接，以及已经核实的专用操作指引。',
        },
        {
          title: '按已核实地址兑换',
          description:
            '专用兑换地址仍待供货方补齐，目前不可购买；不要使用其他商品的兑换站或提交到陌生链接。',
        },
        {
          title: '确认权益',
          description:
            '完成兑换后，在服务官方页面核对方案和有效期；异常从原订单联系售后。',
        },
      ]
  if (product.id === 27 && family === 'grok') {
    name = 'SuperGrok · 短期成品账号'
    introduction =
      '适合短期使用 Grok 的成品账号。收到的是一个账号，不是充值到你原有账号的月度兑换码。'
    rights = 'SuperGrok 账号使用权；可用 9–10 天。'
    duration = '9–10 天'
    conditions = '按交付账号使用，不能将本规格视为 1 个月或 3 个月订阅充值。'
    warranty = '质保 3 天；封号不在质保范围。质保期与账号可用期不同。'
    use =
      '使用交付账号在 [Grok 服务入口](https://grok.com/) 登录并核对权益。该网址为服务登录入口，不是 CDK 兑换站。'
    highlights.push('可用 9–10 天；质保 3 天，二者不同')
    warnings.push('封号不保；这不是一个月订阅')
    faq.push({
      question: '和 1/3 个月兑换码有什么区别？',
      answer:
        '本规格直接交付短期成品账号；兑换码规格需要你用自己的账号在站外完成充值，交付物与售后分别适用。',
    })
  }
  if (product.id === 21 && family === 'grok') {
    name = 'SuperGrok · ' + label + ' CDK'
    introduction =
      '为自己的账号开通 SuperGrok 的订阅兑换码。适合需要保留自己账号，并按所选周期充值的买家。'
    rights =
      '本次选择 ' + label + '；iOS 全区充值规格，完成自助充值后可多端使用。'
    duration = label
    conditions =
      '需自备可用账号，按 iOS 充值规格操作；不要将此 CDK 视为成品账号或 X Premium 会员。'
    highlights.push(label + '订阅；iOS 全区充值')
    warnings.push('需自备账号；专用 CDK 兑换地址尚待核实')
    faq.push({
      question: '可以直接在本站完成账号充值吗？',
      answer:
        '本站交付兑换码，买家需要前往供货方指定站点自行兑换。该站点目前未提供，因此暂不可购买。Grok 登录首页不能代替 CDK 兑换站。',
    })
  }
  if (product.id === 36 && family === 'gemini') {
    name = 'Google AI Pro · 18 个月激活链接'
    introduction =
      '通过 CDK 领取 Google AI Pro 激活链接，为自己符合条件的 Google 账号开通。不是出售 Google 成品账号。'
    rights = '18 个月 Google AI Pro，含 5TB；Jio 渠道。'
    duration = '18 个月'
    conditions =
      '需使用自己的 Google 账号；供货说明为无需绑卡。现有账号资格、已有订阅和家庭状态仍需在领取前核对。'
    delivered = 'CDK 及用于领取激活链接的指引；最终为买家自己的账号开通。'
    highlights.push('18 个月 AI Pro · 5TB · 无需绑卡')
    warnings.push('不是成品账号；CDK 中转兑换地址待供货方确认')
    warnings.push('Jio 活动有资格及持续套餐条件，本批次适用与维持方式仍需确认')
    faq.push({
      question: '可以把 CDK 直接输入 Gemini 登录页吗？',
      answer:
        '不能将 Gemini 登录入口当作 CDK 兑换站。需先按供货方明确指引领取激活链接，再使用符合条件的账号激活。',
    })
    faq.push({ question: 'Jio 渠道代表任何账号都能用满 18 个月吗？', answer: '不能这样推定。[Jio 官方活动说明](https://www.jio.com/google-gemini-offer/) 对年龄、有效 Jio 套餐及持续保持资格有要求。本次供货 CDK 的目标账号条件、资格由谁维持和中途失去权益如何处理，尚未获明确确认；开售前需先核对，不能把无需绑卡理解为完全没有资格或后续条件。' })
  }
  if (product.id === 3 && family === 'gemini') {
    name = 'Google AI Pro 成品账号 · ' + label
    introduction =
      '交付已经开通 Google AI Pro 的成品账号，用于 Gemini 对话、学习和内容创作。账号注册年份与会员剩余时间分别计算。'
    rights = label + ' 注册年份/地区规格；Pixel / Jio 开通的 AI Pro 成品账号。'
    duration = '会员剩余期未注明'
    conditions = '使用交付的 Google 账号；随机规格不保证特定地区。'
    use =
      '使用交付账号在 [Gemini 服务入口](https://gemini.google.com/) 登录，核对 AI Pro 状态及到期时间。该链接为服务入口，不是 CDK 兑换。'
    highlights.push('账号年份：' + label, '成品账号，开通渠道为 Pixel / Jio')
    warnings.push('注册年份不是会员时长；不能按 18 个月激活链接理解')
    faq.push({
      question: '老账号就包含更长会员吗？',
      answer:
        '不是。注册年份只描述账号年龄；供货方没有给出本规格的会员剩余周期，须核对实际权益。',
    })
  }
  if (product.id === 55 && family === 'duolingo') {
    name = '多邻国 Super · 12 个月 CDK'
    introduction =
      '给自己的多邻国账号开通 12 个月 Super 会员，适合准备持续学习、且账号符合兑换条件的买家。'
    rights = '12 个月 Super 会员，不是 Max 方案或成品账号。'
    duration = '12 个月'
    conditions = '使用自己的账号，无需绑卡。已有 Super / Max 必须到期后再领取，不能叠加；未满 13 岁不适用，在 classroom 课堂内须先退出。新老账号仍须通过活动资格核验。'
    delivered = '交付 12 个月 Super 的卡密或领取链接，不含账号密码、Max 或家庭席位。'
    redemption = '需要到 [OwlDuo 领取站](https://owlduo.com/) 自行领取。OwlDuo 是独立第三方服务，不是多邻国官网。'
    use = '打开 [OwlDuo](https://owlduo.com/)，验证原订单卡密；通过 +86 已绑定手机号的验证码，或邮箱 / 用户名加多邻国密码登录本人账号。核对目标账号、Super 类型与 12 个月后确认兑换，等到明确领取成功，再回多邻国 App 检查会员。完整操作见 [图文教程](https://owlduo.com/redeem/guide)。Google / Apple / 微信登录用户应先在官方 App 绑定邮箱或手机号、设置多邻国密码，不要填写邮箱或 Apple 账号密码。'
    warranty = '本渠道激活后不另提供质保；12 个月是会员权益周期，不是售后保障期。激活前或领取中异常，从原订单联系售后核对领取记录；结果未明确时保留原卡密，不换卡重领，不承诺所有失败自动补发或退款。'
    highlights.push('12 个月 Super · 无需绑卡')
    warnings.push('现有 Super / Max 到期后再领；未满 13 岁不适用', '课堂账号先退出；活动资格及领取期限按本批次核验')
    steps = [
      { title: '先核对账号资格', description: conditions },
      { title: '打开领取站验证卡密', description: '到 [OwlDuo](https://owlduo.com/) 输入本单卡密或打开交付链接。先确认显示的套餐、周期和领取期限；验证通过不代表会员已经到账。' },
      { title: '本人登录并确认账号', description: '+86 手机号必须已绑定目标账号；或用邮箱 / 用户名和多邻国密码登录。核对页面脱敏账号、Super 与周期后再确认。商家不需要你的密码或短信验证码。' },
      { title: '等到领取成功再核对', description: '排队、已提交均不等于成功。完成后回 App 查看同一账号；页面关闭或超时，用原卡密回查记录，结果不明先联系售后。' },
    ]
    faq.push({
      question: '已有会员可以延长一年吗？',
      answer:
        '该商品明确不可叠加已有订阅。请先核对账号状态，不按续费或叠加方案购买。',
    })
    faq.push({ question: '卡密有效期和 12 个月会员是一回事吗？', answer: '不是。卡密、官方活动领取期限和会员周期分别核对。领取站会显示本批次的领取条件与期限；收到后及时领取，不把未核销卡密理解为活动权益永久有效。活动来源为 Airtel 合作推广，最终资格与权益由多邻国核验。' })
  }
  if (product.id === 54 && family === 'adobe-express') {
    name = 'Adobe Express · 12 个月 CDK'
    introduction =
      '通过兑换资料为自己的 Adobe 账号开通 Express，适合需要该产品会员方案的创作用户。'
    rights =
      '12 个月 Adobe Express；不等同于 Creative Cloud 全家桶或 Photoshop 单独订阅。'
    duration = '12 个月'
    conditions = '新老账号均可，无需绑卡。'
    delivered = '交付 Adobe Express 12 个月 CDK；买家用自己的 Adobe 账号在站外激活，不交付 Adobe 账号。'
    redemption = '需要到 [大桔兑换站](https://vip.dajuai.us/exchange) 自行兑换，再打开返回的激活链接。'
    use = '先准备并登录目标 Adobe 账号；在 [大桔兑换站](https://vip.dajuai.us/exchange) 粘贴本单 Adobe Express 卡密，核对识别商品后兑换。立即打开返回链接，按页面完成激活；如提示地区不匹配，按该渠道指南在印度网络环境重新打开原链接。回 [Adobe Express](https://express.adobe.com/) 检查同一账号的会员状态。卡密与返回链接是两步，返回链接可能过期。'
    warranty = '本渠道成功激活后即完成交付，激活后不另提供质保。未能兑换或激活时，保留原卡密、原链接及错误提示，从原订单联系售后核对；不直接反复换码操作。'
    highlights.push('12 个月 Express · 新老账号可用 · 无需绑卡')
    warnings.push('只包含 Express，不含 Creative Cloud 全家桶', '兑换后的激活链接须及时使用；地区不匹配时按指南处理')
    steps = [
      { title: '准备目标 Adobe 账号', description: '新老账号均可，无需绑卡。先确认登录的是要领取会员的账号。' },
      { title: '在兑换站换出链接', description: '到 [大桔兑换站](https://vip.dajuai.us/exchange) 输入本单卡密，确认识别为 Adobe Express 后提交。不要把卡密当作 Adobe 官方优惠码直接填写。' },
      { title: '立即打开链接激活', description: '打开返回的原激活链接，按页面完成；链接可能过期。地区不匹配时，按渠道指南在印度网络环境重开原链接。' },
      { title: '检查会员并保留记录', description: '回 [Adobe Express](https://express.adobe.com/) 核对账号和会员。已是 Premium 的账号能否延长及延长多久，以 Adobe 实际规则为准；结果不明用原卡密查看原结果。' },
    ]
    faq.push({
      question: '是否包含 Photoshop 和全部 Adobe 软件？',
      answer:
        '不包含此类承诺。此商品仅对应 Adobe Express 12 个月兑换，不是 Creative Cloud 全家桶。',
    })
    faq.push({ question: '卡密不失效，兑换出的链接也永久有效吗？', answer: '不是。该兑换站说明卡密本身不设到期，但换出的激活链接可能过期，请准备好账号再兑换并立即使用。不要将此说明理解为永久会员或无限期保留的激活链接。' })
  }
  if (product.id === 53 && family === 'apple-music') {
    name = 'Apple Music · 印度区新号 5 个月'
    introduction =
      '面向符合条件的印度区新账号的音乐会员兑换。地区和新用户资格是购买前首先要核对的条件。'
    rights = '5 个月 Apple Music 会员兑换。'
    duration = '5 个月'
    conditions =
      '仅限印度区新号；需买家自备 UPI 或银行卡。其他地区、老账号不能直接视为适用。'
    delivered = '交付 Apple Music 5 个月 CDK，不含 Apple 账号或支付方式；需要买家在站外完成兑换与激活。'
    redemption = '需要到 [大桔兑换站](https://vip.dajuai.us/exchange) 自行兑换，立即打开返回链接激活。'
    use = '按本渠道指南先准备印度网络环境、符合条件的印度区新 Apple 账号和有效 UPI 或银行卡。到 [大桔兑换站](https://vip.dajuai.us/exchange) 输入本单 Apple Music 卡密，核对识别商品后兑换；立即打开返回链接，按页面提示用自己的支付方式完成激活，核对会员及后续续订提示。不要为尝试资格而提前消耗卡密。'
    warranty = '本兑换渠道当前说明为成功激活后 1 个月质保；5 个月是会员权益周期，不等于 5 个月保障。具体异常凭原订单和激活记录核对，未说明的故障范围及退款规则不作额外承诺。'
    highlights.push('5 个月会员 · 印度区新号')
    warnings.push(
      '必须自备 UPI 或银行卡',
      '仅印度区新号；激活须按渠道要求准备印度网络环境',
    )
    steps = [
      { title: '先备齐账号与支付条件', description: conditions + ' 按渠道指南准备印度网络环境；核对官方页面显示的新用户资格。' },
      { title: '兑换本单卡密', description: '在 [大桔兑换站](https://vip.dajuai.us/exchange) 粘贴 Apple Music 卡密并核对商品；先准备好账号再换出激活链接。' },
      { title: '及时打开链接激活', description: '返回链接可能过期，请立即使用。按页面用自备有效 UPI / 银行卡完成激活；本站不提供支付工具。' },
      { title: '核对会员与续订', description: '确认是本人的目标账号，保存激活结果，查看是否有后续自动续订和收费提示；不需要续订时按 Apple 设置管理。结果不明用原卡密回查，勿换码重试。' },
    ]
    faq.push({
      question: '是不是无需任何支付方式？',
      answer:
        '不是。供货说明明确要求自备 UPI 或银行卡，请先确认地区、新用户资格和支付条件。',
    })
  }
  if (product.id === 10 && family === 'gmail') {
    name = 'Google Gmail · ' + label
    introduction =
      '交付 Gmail 成品账号，按注册年份、地区和渠道选择。适合需要独立邮箱资料的买家，不含 Google 付费订阅。'
    rights =
      '当前选择 ' + label + '；附密码与验证资料。年份按所选 SKU 说明核对。'
    duration = '账号资料 · ' + label
    conditions =
      (label.includes('美国')
        ? '本规格标注美国。'
        : '本规格为随机地区，不保证美国。') +
      '注册年份不是订阅时长；渠道二是来源规格标签，不代表更多会员权益。'
    use =
      '在 [Google 登录入口](https://accounts.google.com/) 使用交付账号及相应验证资料登录，无需 CDK 兑换。不要把账号密码或验证资料提交到陌生第三方站点。'
    highlights.push('年份 / 地区 / 渠道：' + label, '交付账号、密码与验证资料')
    warnings.push(
      '不含 Gemini / Google AI Pro 等付费订阅',
      '不自动沿用本站旧美国白号的 2FA 配置和当日首登质保',
    )
    faq.push({
      question: '为什么规格年份与源商品总标题不同？',
      answer:
        '按你选择的具体 SKU 年份、地区和渠道核对。本页使用实际规格信息，不能用总标题中的年份范围替代所选规格。',
    })
  }
  if (product.id === 23 && family === 'capcut-pro') {
    const team = label.includes('团队'),
      period = label.includes('周') ? '周卡' : '月卡'
    name = 'CapCut Pro · ' + label
    introduction =
      '交付用于 CapCut Pro 的成品账号资料。先按个人版或团队版、周卡或月卡选择，再核对该版本的登录与使用条件。'
    rights = '当前选择 ' + label + '，不与其他版本或周期互换。'
    duration = period
    conditions = team
      ? '本规格为团队版，席位数、是否独享及设备限制尚未说明，不应视作个人独享订阅。'
      : '本规格为个人版；设备数、地区限制和续费规则未明确，购买前需核对。'
    use =
      '按原订单提供的资料与版本指引使用 [CapCut 服务入口](https://www.capcut.com/)，核对 Pro 状态与到期时间。成品账号无需 CDK 兑换；团队版的具体加入方式须按随单指引核实。'
    highlights.push(label + '成品规格')
    warnings.push(
      team ? '团队版未承诺独享或特定席位数' : '个人版未承诺任意设备或地区通用',
      '周卡/月卡的起算方式、到期时间须核对',
    )
    faq.push({
      question: '周卡一定是从付款时起算七天吗？',
      answer:
        '资料只标注周卡或月卡，未明确起算规则。请以已确认的交付说明和实际到期时间为准，不能自行推定。',
    })
  }
  const description = [
    section('商品介绍', introduction),
    section('本规格权益与区别', rights),
    section(
      '额度与有效期',
      duration +
        '。' +
        (account && /账号资料|未注明/.test(duration)
          ? '账号注册时间、使用额度与会员期限分别核对。'
          : ''),
    ),
    section('适用账号与限制', conditions),
    section('交付内容与使用方式', delivered + '\n' + use),
    section('售后范围', warranty),
  ].join('\n\n')
  faq.unshift({
    question: '收到的是什么，需要站外兑换吗？',
    answer: delivered + ' ' + redemption,
  })
  faq.push({ question: '售后保障到什么范围？', answer: warranty })
  if (account && product.id !== 57) steps[1] = { title: '按指定入口登录', description: use }
  return {
    name: name.slice(0, 80),
    tagline: rights.slice(0, 160),
    description,
    duration: duration.slice(0, 80),
    features: [
      rights.slice(0, 160),
      account ? '成品账号资料交付' : '兑换资料交付 · 需站外操作',
    ],
    buyerHighlights: highlights,
    buyerWarnings: warnings,
    purchaseNote: conditions + '\n\n' + warranty,
    deliveryInstructions: delivered + '\n\n' + use,
    steps,
    faq,
  }
}
