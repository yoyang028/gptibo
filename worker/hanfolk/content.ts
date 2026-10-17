import {
  hanfolkFamily,
  type HanfolkDetail,
} from '../../shared/hanfolk-catalog.ts'

// Editorial guidance is separate from source terms. Do not invent warranties,
// refund promises, unlimited usage, regions or subscription periods.
export function hanfolkCopy(product: HanfolkDetail, specification: string) {
  const family = hanfolkFamily(product.title)!,
    account = /成品|账户|账号|Apple\s*ID/i.test(product.title),
    redeem = !account
  const steps = account
    ? [
        {
          title: '核对所选账号',
          description: '确认所选规格、地区、服务周期或词元额度，阅读购买须知。',
        },
        {
          title: '查看交付资料',
          description:
            '从原订单查看账号与对应登录说明；妥善保存原订单及交付资料。',
        },
        {
          title: '完成首次登录',
          description:
            '在对应服务的官方入口登录并核对权益，遇到资料或登录问题，从原订单联系售后。',
        },
      ]
    : [
        {
          title: '先检查账号条件',
          description:
            '核对所选规格的账号地区、已有订阅和兑换资格，符合条件后再购买。',
        },
        {
          title: '领取兑换资料',
          description: '从原订单查看兑换码或激活链接，以及该规格的使用说明。',
        },
        {
          title: '兑换并核对权益',
          description:
            '按交付指引完成兑换，在服务官方页面确认会员状态和有效期；保留原订单。',
        },
      ]
  let conditions =
    '各规格的周期、地区、账号条件和售后范围分别适用。请先核对所选规格；未写明的质保、退款或续费条件，请购买前联系店主确认。'
  let instructions = account
    ? '账号资料交付到原订单后，按说明完成首次登录并核对所购权益。不要向无关网站或个人提供密码、密保和验证码。'
    : '兑换资料交付到原订单后，按对应指引使用。提交兑换前再次核对登录账号，兑换码与链接请勿公开。'
  const faq: { question: string; answer: string }[] = [
    {
      question: '我选择的是哪个规格？',
      answer: specification + '。请核对本规格介绍、周期和适用条件后购买。',
    },
  ]
  if (family === 'grok') {
    faq.push({
      question: '成品账号和兑换码有什么不同？',
      answer: account
        ? '本规格交付成品账号。它与为自己账号充值的 CDK 不同，使用周期和质保以本规格说明为准。'
        : '本规格交付 SuperGrok 订阅兑换码，为自己的账号充值；请选择所需周期，按交付指引兑换。',
    })
    if (product.id === 27)
      conditions =
        '本成品账号可用 9–10 天，质保 3 天；封号不在质保范围。请确认短期使用需求，不将此规格视为一个月订阅。'
    if (product.id === 21)
      conditions =
        '本商品为 iOS 全区充值 CDK，提供 1 个月或 3 个月规格；自助充值后可多端使用。请先确认自己账号和所选周期，成品账号的短期质保条件不适用于本规格。'
  }
  if (family === 'gemini') {
    faq.push({
      question: '这是激活链接还是成品账号？',
      answer: redeem
        ? '本规格通过 CDK 领取 18 个月 Google AI Pro 激活链接，为自己的账号开通，含 5TB，无需绑卡。'
        : '本规格交付已开通 Google AI Pro 的账号。注册年份见所选规格，不代表付费会员剩余时长；具体权益和有效期请先核对商品说明。',
    })
    conditions = redeem
      ? 'Jio 渠道，18 个月 AI Pro、5TB，为自己的账号开通，无需绑卡。兑换前核对当前登录账号及资格。'
      : 'Pixel / Jio 开通的 Google AI Pro 成品账号；注册年份与账号渠道见所选规格。介绍未明确承诺的剩余会员周期、续费和质保，请先咨询店主。'
  }
  if (family === 'muse') {
    conditions =
      '成品账号，提供 10 亿、50 亿、310 亿词元规格，附收件入口，可改邮箱。词元数量以本规格为准，不等同于无限使用或固定会员时长。'
    instructions =
      '从原订单查看 Muse 账号和收件入口，在对应登录页面完成验证，首次登录后核对词元数量；如需更改邮箱，按账号设置与交付说明操作。'
    faq.push({
      question: '词元额度和服务期限一样吗？',
      answer:
        '词元是本规格的使用额度，不能据此推定会员期限。请分别核对所选词元档位、账号权益和使用规则。',
    })
  }
  if (family === 'duolingo') {
    conditions =
      'CDK 为自己的账号开通 12 个月 Super，无需绑卡，不可叠加已有订阅。已有付费订阅的账号，请先联系店主核对适用性。'
    faq.push({
      question: '已有会员可以叠加吗？',
      answer:
        '该规格不可叠加已有订阅。请先检查账号的订阅状态，不要在未确认资格时购买。',
    })
  }
  if (family === 'adobe-express') {
    conditions =
      'CDK 开通 12 个月 Adobe Express，新老账号均可，无需绑卡。购买内容为 Adobe Express，请勿将其视为 Creative Cloud 全家桶或 Photoshop 单独订阅。'
    faq.push({
      question: '需要新账号或绑定银行卡吗？',
      answer:
        '该规格说明支持新老账号，无需绑卡。请确认正在使用的 Adobe 账号，再按交付指引兑换。',
    })
  }
  if (family === 'apple-music') {
    conditions =
      '5 个月会员兑换，仅限印度区新号；需自备 UPI 或银行卡。其他地区或已有使用记录的账号，请先核对资格，不承诺适用。'
    faq.push({
      question: '中国区账号可以直接使用吗？',
      answer:
        '该规格只适用于印度区新号，且需自备 UPI 或银行卡。请先核对账号地区、资格和支付条件。',
    })
  }
  if (family === 'apple-id') {
    const app = product.id === 16
    conditions = app
      ? '美国区独享 Apple ID，带 Shadowrocket 已购记录。只包含本规格写明的账号与已购项目；请按交付说明使用。'
      : product.title +
        '。新号、老号按所选规格区分；注册时长不代表会员期限。请核对地区、密保资料和可改密条件。'
    instructions =
      '从原订单领取账号及随附资料，仅按用途在 App Store 登录并核对地区或已购项目。不要把购买账号用于设备的 iCloud、查找或个人数据备份；登录异常请从原订单联系售后。'
    faq.push({
      question: '地区和新老号怎么选择？',
      answer:
        '地区决定对应的 App Store；新老号按所选规格的注册时长区分。已购项目只在明确标注的规格中包含，请勿默认其他账号也带有。',
    })
  }
  if (family === 'gmail') {
    conditions =
      'Gmail 成品账号，附密码与验证资料，不含 Google 付费订阅。注册年份、地区及渠道按所选规格区分，不能据此推定 Gemini、AI Pro 或其他订阅权益。'
    faq.push({
      question: 'Gmail 账号包含 Gemini 会员吗？',
      answer:
        '不包含。此商品为邮箱成品账号；需要 Google AI Pro 时，请单独查看 Google Gemini 商品的账号或激活链接规格。',
    })
  }
  if (family === 'capcut-pro') {
    conditions =
      '成品账号交付，个人版与团队版、周卡与月卡分别选择。请核对所选版本及周期，不将团队版视为独享个人订阅；设备、地区及续费条件请先咨询店主。'
    faq.push({
      question: '个人版和团队版可以互换吗？',
      answer:
        '两种版本为不同规格，周期也分别按周卡、月卡选择。请在下单前核对；未明确写明的席位、设备数量和迁移规则，请向店主确认。',
    })
  }
  faq.push({
    question: '领取、使用或售后遇到问题怎么办？',
    answer:
      '请保留原订单，从订单中的售后入口联系店主，并说明遇到的问题。不要公开完整账号、密码、验证码或未兑换的卡密。售后按本规格写明的范围核对。',
  })
  return { conditions, instructions, steps, faq }
}
