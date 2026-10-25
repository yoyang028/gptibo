import type { ShopProduct } from './shop-products.ts'

export type GeminiKind = 'student' | 'activation' | 'account'
export const GEMINI_KINDS = [
  { id: 'student', name: '学生认证', note: '本人资格验证，不直接开通会员' },
  { id: 'activation', name: '18 个月激活链接', note: '自己的账号开通 · Jio 渠道' },
  { id: 'account', name: '成品账号', note: '交付另一个已开通的账号' },
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
