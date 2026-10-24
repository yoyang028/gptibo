import type { ShopProduct } from './shop-products.ts'

export const APPLE_ID_REGION_GROUPS = [
  { id: 'us', name: '美国' },
  { id: 'hk', name: '香港' },
  { id: 'jp', name: '日本' },
  { id: 'other', name: '其他' },
] as const
export type AppleIdRegionGroup = typeof APPLE_ID_REGION_GROUPS[number]['id']

/** Recognize explicit region labels only; an unknown name remains in Other. */
export function appleIdRegion(product: Pick<ShopProduct, 'name'>) {
  return product.name.match(/美国|香港|日本|土耳其|尼日利亚/)?.[0] ?? '其他地区'
}
export function appleIdRegionGroup(product: Pick<ShopProduct, 'name'>): AppleIdRegionGroup {
  const region = appleIdRegion(product)
  return region === '美国' ? 'us' : region === '香港' ? 'hk' : region === '日本' ? 'jp' : 'other'
}
export function appleIdAccountKind(product: Pick<ShopProduct, 'name'>) {
  return /Shadowrocket|小火箭/i.test(product.name) ? 'purchased' : /老号/.test(product.name) ? 'aged' : /新号/.test(product.name) ? 'new' : 'other'
}
export function appleIdVariants(products: readonly ShopProduct[]) {
  const regions = ['美国', '香港', '日本', '土耳其', '尼日利亚', '其他地区']
  const kinds = ['new', 'aged', 'purchased', 'other']
  return products.filter(p => p.groupId === 'apple-id').sort((a, b) =>
    regions.indexOf(appleIdRegion(a)) - regions.indexOf(appleIdRegion(b)) ||
    kinds.indexOf(appleIdAccountKind(a)) - kinds.indexOf(appleIdAccountKind(b)) || a.name.localeCompare(b.name, 'zh-CN') || a.id.localeCompare(b.id),
  )
}
export function appleIdVariantNote(product: Pick<ShopProduct, 'name' | 'duration'>) {
  const kind = appleIdAccountKind(product)
  if (kind === 'purchased') return '含 Shadowrocket 已购记录'
  const age = product.name.match(/[（(]([^）)]+)[）)]/)?.[1]
  return age ?? product.duration
}
