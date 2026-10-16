import type { ShopProduct } from '../../shared/shop-products'

const families: Record<string, { tagline: string; intro: string; category: string }> = {
  claude: { tagline: '从日常对话，到更深入的工作。', intro: 'Pro、Max 5× 与 Max 20×，按你的使用强度选择。', category: 'AI 订阅' },
  'codex-credits': { tagline: '给下一段代码，留足空间。', intro: '250、500、1000、2500 四档额度，按需选择。', category: '编程额度' },
  grok: { tagline: '让好奇，走得更远。', intro: 'Plus、Premium、Super、Ultra，了解每一档的不同。', category: 'AI 订阅' },
  'student-verification': { tagline: '为学习，打开更多可能。', intro: '面向符合资格的学生，提供 Plus 四个月活动的认证服务。', category: '学生认证' },
  muse: { tagline: '一个账号，开始你的创作。', intro: 'Muse AI 成品账号，按交付说明完成首次登录。', category: 'AI 工具' },
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
