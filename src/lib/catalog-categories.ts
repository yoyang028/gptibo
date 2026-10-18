export const CATALOG_CATEGORIES = [
  { id: 'ai', name: 'AI订阅' },
  { id: 'learning', name: '学习订阅' },
  { id: 'lifestyle', name: '生活订阅' },
  { id: 'mail', name: '邮箱账号' },
  { id: 'sms', name: '接码服务' },
  { id: 'tool', name: '工具服务' },
] as const

export type CatalogCategory = (typeof CATALOG_CATEGORIES)[number]['id']

// Family identity takes precedence over broad supplier labels such as 创作与生活.
const productCategories: Readonly<Record<string, CatalogCategory>> = {
  chatgpt: 'ai',
  claude: 'ai',
  'codex-credits': 'ai',
  grok: 'ai',
  gemini: 'ai',
  muse: 'ai',
  duolingo: 'learning',
  'student-verification': 'learning',
  'apple-music': 'lifestyle',
  'x-premium': 'lifestyle',
  gmail: 'mail',
  'codex-sms': 'sms',
  'adobe-express': 'tool',
  'apple-id': 'tool',
  'capcut-pro': 'tool',
}

function categoryFromText(value: string): CatalogCategory | undefined {
  if (/接码|短信|验证码|\bsms\b/i.test(value)) return 'sms'
  if (/邮箱|邮件账号|e-?mail|gmail|outlook/i.test(value)) return 'mail'
  if (/学习|语言|教育|学生|learning|education|duolingo/i.test(value)) return 'learning'
  if (/技术服务|部署|安装服务|deployment/i.test(value)) return 'tool'
  if (/人工智能|大模型|\bai\b|编程额度/i.test(value)) return 'ai'
  if (/生活|音乐|影音|娱乐|社交|流媒体|lifestyle|music|netflix|spotify|youtube premium|x premium/i.test(value)) return 'lifestyle'
  if (/工具|技术|剪辑|设计|创作|账号服务|应用商店|\btools?\b|software|apple\s*id/i.test(value)) return 'tool'
  if (/\bchatgpt\b|\bclaude\b|\bgemini\b|\bgrok\b|\bmuse\b|\bcodex\b/i.test(value)) return 'ai'
}

export function catalogCategory(product: { id: string; groupId?: string; category?: string; name?: string }): CatalogCategory {
  const family = product.groupId ?? product.id
  if (Object.hasOwn(productCategories, family)) return productCategories[family]
  return categoryFromText(product.category ?? '') ?? categoryFromText(product.name ?? '') ?? 'tool'
}
