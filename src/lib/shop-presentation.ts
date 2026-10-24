import type { ShopProduct } from '../../shared/shop-products'

const families: Record<string, { tagline: string; intro: string; category: string }> = {
  claude: { tagline: '写作、分析与编程，按用量选择。', intro: 'Pro、Max 5× 与 Max 20×，为你的 Claude 账号选择适合的订阅。', category: 'AI 订阅' },
  'codex-credits': { tagline: '给下一段代码，留足空间。', intro: '250、500、1000、2500 四档额度，为你的 Codex 编程任务按需补充。', category: '编程额度' },
  grok: { tagline: '灵感、社交与代码，一起连接。', intro: 'Grok、X、Cursor 与 Bot，一份组合订阅。Plus 不含 Bot，Premium 及以上包含，按需选择。', category: 'AI 订阅' },
  'student-verification': { tagline: '为学习，打开更多可能。', intro: '面向符合资格的学生，提供 Plus 四个月活动的认证服务。', category: '学生认证' },
  muse: { tagline: '把想法，交给你的智能体。', intro: '成品账号与词元服务，一个入口，按需选择。', category: 'AI 工具' },
  gemini: {tagline:'思考、创作，找到新的可能。',intro:'成品账号与 AI Pro 兑换链接，先核对开通方式和账号条件。',category:'AI 订阅'},
  duolingo: {tagline:'让每天的练习，多一点动力。',intro:'查看会员周期、兑换步骤与账号适用条件。',category:'语言学习'},
  'adobe-express': {tagline:'把想法，变成作品。',intro:'Adobe Express 会员兑换，查看周期与开通条件。',category:'创作工具'},
  'apple-music': {tagline:'让音乐，陪伴每一天。',intro:'音乐会员兑换，先核对账号地区、新用户资格与支付要求。',category:'音乐会员'},
  'apple-id': {tagline:'选择地区，再选账号类型。',intro:'美国、香港、日本与其他地区；新号、老号和 Shadowrocket 已购账号分别选择。',category:'账号服务'},
  gmail: {tagline:'为你的邮件，准备一个入口。',intro:'按注册年份、地区与渠道选择 Gmail 成品账号；不含 Google 付费订阅。',category:'邮箱账号'},
  'capcut-pro': {tagline:'让每一个镜头，更有表达。',intro:'个人版与团队版，按周卡或月卡选择。',category:'创作工具'},
}

export function shopPresentation(id: string, product: ShopProduct) {
  return families[id] ?? { tagline: product.tagline, intro: product.tagline, category: product.category }
}

export function customerProductName(value: string) {
  return value.replace(/\bGoogle\s+(Gemini|Gmail)\b/gi, (_, brand: string) => brand.toLowerCase() === 'gemini' ? 'Gemini' : 'Gmail')
}

export function variantLabel(product: ShopProduct, brand: string, siblings: readonly ShopProduct[] = []) {
  const name = customerProductName(product.name)
  if (product.groupId === 'muse' && product.museKind === 'invitation') {
    return name.match(/\d+\s*B\b/i)?.[0] ?? name
  }
  if (product.groupId === 'apple-id') {
    return name.replace(/Apple\s*ID/gi, '').replace(/[（(][^）)]*[）)]/g, '').replace(/已购\s*/g, '').replace(/\s*·\s*/g, ' · ').trim()
  }
  if (product.groupId === 'gemini') {
    if (/成品账号/.test(name)) {
      const cohort = name.match(/(?:19|20)\d{2}\s*[-–—]\s*(?:19|20)\d{2}/)?.[0].replace(/\s*[-–—]\s*/, '–')
      const multipleAccounts = !siblings.length || siblings.filter(p => /成品账号/.test(p.name)).length > 1
      return multipleAccounts && cohort ? `成品账号 · ${cohort}` : '成品账号'
    }
    if (/激活链接|兑换链接/.test(name)) {
      const months = (product.duration + ' ' + name).match(/(\d+)\s*个月/)?.[1]
      return months ? `${months} 个月 · 激活链接` : '激活链接'
    }
  }
  const displayBrand = customerProductName(brand)
  const label = name.startsWith(displayBrand) ? name.slice(displayBrand.length).trim() : name
  return label.replace(/^Claude\s*/i, '').replace(/^Codex\s*/i, '').replace(/\s*额度$/, ' 点').replace(/Max\s*(\d+)x/i, 'Max $1×').replace(/^[·\s-]+/, '') || product.duration
}

// Older imported descriptions include procurement labels that are only useful
// to the operator. Preserve their service conditions while removing that copy.
export function customerProductCopy(value: string) {
  return customerProductName(value)
    .replace(/，对应供货目录「[^」]+」的「[^」]+」规格。/g, '。')
    .replace('店主确认实际到账后采购对应规格；交付内容保存在原订单。', '付款确认后，卡密或领取信息会交付到原订单。')
}
