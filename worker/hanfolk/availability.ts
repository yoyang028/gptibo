import type { ShopProduct } from '../../shared/shop-products.ts'
import type { HanfolkDetail } from '../../shared/hanfolk-catalog.ts'
import type { Env } from '../platform.ts'

/** Use the source SKU, never the placeholder retail or an unrelated old offer. */
export async function hanfolkAvailability(env: Env) {
  const rows = (await env.INTEREST_DB.prepare('SELECT l.local_id,l.product_id,l.sku,p.public_json,c.detail FROM hanfolk_product_links l JOIN shop_products p ON p.id=l.local_id LEFT JOIN hanfolk_catalog c ON c.product_id=l.product_id AND c.key_hash=(SELECT key_hash FROM hanfolk_settings WHERE id=\'main\')').all<{ local_id:string;product_id:number;sku:string;public_json:string;detail:string|null }>()).results
  const stock = new Map<string, number>(), groups = new Set<string>()
  for (const row of rows) {
    const product = JSON.parse(row.public_json) as ShopProduct
    if (product.groupId) groups.add(product.groupId)
    const detail = row.detail ? JSON.parse(row.detail) as HanfolkDetail : null
    const variant = detail?.sku_variants.find(v=>v.sku===row.sku)
    stock.set(row.local_id, variant?.stock ?? 0)
  }
  return { stock, groups }
}

export async function availableHanfolkProducts(env: Env, products: ShopProduct[]) {
  const { stock, groups } = await hanfolkAvailability(env)
  return products.filter(p=>!groups.has(p.groupId??p.id) || (stock.get(p.id)??0)>0)
    .map(p=>stock.has(p.id)?{...p,stock:stock.get(p.id)!}:p)
}
