import type { ShopProduct } from './shop-products.ts'

export function inventoryLabel(product: Pick<ShopProduct, 'stock' | 'inventory'>): string {
  if (product.inventory?.status === 'checking') return '库存待确认'
  if (product.stock === 0 || product.inventory?.status === 'replenishing') return '补货中'
  return ''
}
