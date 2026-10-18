import type { ShopProduct } from './shop-products.ts'

export const ADMIN_SUPPLIERS = [
  { id: 'bugan', name: 'bugan', description: 'ChatGPT 订阅与自动充值', mark: 'B' },
  { id: 'xiaojiu', name: '小久 · xiaojiu', description: '钱包采购、卡密与兑换商品', mark: 'X' },
  { id: 'grizzly', name: '灰熊', description: '短信接码、号码池与接码订单', mark: 'G' },
  { id: 'hanfolk', name: '大橘', description: 'AI 订阅、会员与上游规格选品', mark: 'D' },
] as const
export type AdminSupplier = (typeof ADMIN_SUPPLIERS)[number]['id']
export type ProductSection = AdminSupplier | 'all' | 'other'

export function productSupplier(product: ShopProduct, linkedSuppliers: Record<string, AdminSupplier>): AdminSupplier | 'other' {
  // Explicit import links take precedence: imported items can use manual delivery.
  if (linkedSuppliers[product.id]) return linkedSuppliers[product.id]
  if (product.api?.provider === 'xiaojiu') return 'xiaojiu'
  if (product.api?.provider === 'grizzly') return 'grizzly'
  return 'other'
}

export function adminProductRoute(search: string) {
  const params = new URLSearchParams(search)
  const view = params.get('view') ?? 'overview'
  const legacy: Record<string, ProductSection> = { sms: 'grizzly', hanfolk: 'hanfolk', plans: 'other' }
  if (Object.hasOwn(legacy, view)) return { view: 'products', supplier: legacy[view] }
  const requested = params.get('supplier')
  const supplier: ProductSection = requested === 'other' || ADMIN_SUPPLIERS.some(s => s.id === requested)
    ? requested as ProductSection : 'all'
  return { view, supplier: view === 'products' ? supplier : 'all' as ProductSection }
}

export function adminProductUrl(supplier: ProductSection = 'all') {
  return '/admin?view=products' + (supplier === 'all' ? '' : '&supplier=' + supplier)
}
