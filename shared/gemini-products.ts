import type { ShopProduct } from './shop-products.ts'

export type GeminiKind = 'student' | 'activation' | 'account'
export const GEMINI_KINDS = [
  { id: 'student', name: '12 个月 学生资格认证（推荐）', note: '自己的账号 · 认证后需绑卡领取', risk: '适合有真实学生资格、可自行绑卡的用户。账号由自己掌握；优惠能否领取、持续多久仍取决于 Google 的资格审核和活动条件。12 个月指学生优惠周期，不是认证服务或售后期限。' },
  { id: 'activation', name: '18 个月 激活链接', note: '自己的账号 · 无需绑卡 · Jio 渠道', risk: '不想绑卡、希望给自己账号开通时可选。合作方活动要求持续符合资格，存在中途掉订阅风险，不承诺绝不掉订阅；已有月度 AI Pro 会覆盖期限，链接兑出后须立即激活。' },
  { id: 'account', name: '成品账号', note: '另一个已开通账号 · 首登核对剩余期', risk: '适合接受另一个账号的用户。按随单资料登录，非本人账号充值；Pixel / Jio 活动变化可能导致掉订阅，也可能遇到账号验证。当前不承诺固定 12 个月，绑卡要求以该账号实际提示为准。' },
] as const
export const GEMINI_STUDENT_GUIDE = '/guides/gemini-student'
export const GEMINI_ACTIVATION_GUIDE = '/guides/gemini-activation'
export const GEMINI_REGION_GUIDE = '/guides/gemini-region'
export const GEMINI_EXTENSION_GUIDE = '/guides/gemini-student-extension'
export function geminiKind(p: Pick<ShopProduct, 'groupId' | 'name'>): GeminiKind | undefined {
  if (p.groupId !== 'gemini') return undefined
  return /学生|SheerID/i.test(p.name) ? 'student' : /成品|账号|账户/.test(p.name) ? 'account' : /激活链接|兑换链接|CDK/i.test(p.name) ? 'activation' : undefined
}
export function geminiVariants(products: readonly ShopProduct[]) {
  const order: Record<GeminiKind, number> = { student: 0, activation: 1, account: 2 }
  return products.filter(p => geminiKind(p)).sort((a,b) => order[geminiKind(a)!]-order[geminiKind(b)!] || a.name.localeCompare(b.name,'zh-CN') || a.id.localeCompare(b.id))
}
export function geminiDefault(products: readonly ShopProduct[]) {
  const sorted = geminiVariants(products)
  return sorted.find(p => !p.pricePending && p.stock > 0)?.id ?? sorted[0]?.id
}
export function geminiGuide(p: Pick<ShopProduct, 'groupId' | 'name'>) {
  return geminiKind(p) === 'activation' ? GEMINI_ACTIVATION_GUIDE : geminiKind(p) === 'student' ? GEMINI_STUDENT_GUIDE : undefined
}
