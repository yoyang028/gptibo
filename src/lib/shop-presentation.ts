import type { ShopProduct } from '../../shared/shop-products'

const families: Record<string, { tagline: string; intro: string; category: string }> = {
  claude: { tagline: '从日常对话，到更深入的工作。', intro: 'Pro、Max 5× 与 Max 20×，按你的使用强度选择。', category: 'AI 订阅' },
  'codex-credits': { tagline: '给下一段代码，留足空间。', intro: '250、500、1000、2500 四档额度，按需选择。', category: '编程额度' },
  grok: { tagline: '让好奇，走得更远。', intro: '成品账号与订阅兑换码，按使用方式和服务周期选择。', category: 'AI 订阅' },
  'student-verification': { tagline: '为学习，打开更多可能。', intro: '面向符合资格的学生，提供 Plus 四个月活动的认证服务。', category: '学生认证' },
  muse: { tagline: '一个账号，开始你的创作。', intro: '成品账号与多档词元规格，按交付说明完成首次登录。', category: 'AI 工具' },
  gemini: {tagline:'思考、创作，找到新的可能。',intro:'成品账号与 AI Pro 兑换链接，先核对开通方式和账号条件。',category:'AI 订阅'},
  duolingo: {tagline:'让每天的练习，多一点动力。',intro:'查看会员周期、兑换步骤与账号适用条件。',category:'语言学习'},
  'adobe-express': {tagline:'把想法，变成作品。',intro:'Adobe Express 会员兑换，查看周期与开通条件。',category:'创作工具'},
  'apple-music': {tagline:'让音乐，陪伴每一天。',intro:'音乐会员兑换，先核对账号地区、新用户资格与支付要求。',category:'音乐会员'},
  'apple-id': {tagline:'选择适合你的应用商店。',intro:'按地区、注册时间和已购项目选择账号，核对登录与安全说明。',category:'账号服务'},
  gmail: {tagline:'为你的邮件，准备一个入口。',intro:'按注册年份、地区与渠道选择 Gmail 成品账号；不含 Google 付费订阅。',category:'邮箱账号'},
  'capcut-pro': {tagline:'让每一个镜头，更有表达。',intro:'个人版与团队版，按周卡或月卡选择。',category:'创作工具'},
}

export function shopPresentation(id: string, product: ShopProduct) {
  return families[id] ?? { tagline: product.tagline, intro: product.tagline, category: product.category }
}

export function variantLabel(product: ShopProduct, brand: string) {
  const label = product.name.startsWith(brand) ? product.name.slice(brand.length).trim() : product.name
  return label.replace(/^Claude\s*/i, '').replace(/^Codex\s*/i, '').replace(/\s*额度$/, ' 点').replace(/Max\s*(\d+)x/i, 'Max $1×') || product.duration
}

// Older imported descriptions include procurement labels that are only useful
// to the operator. Preserve their service conditions while removing that copy.
export function customerProductCopy(value: string) {
  return value
    .replace(/，对应供货目录「[^」]+」的「[^」]+」规格。/g, '。')
    .replace('店主确认实际到账后采购对应规格；交付内容保存在原订单。', '付款确认后，卡密或领取信息会交付到原订单。')
}
