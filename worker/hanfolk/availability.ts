import type { ShopProduct } from '../../shared/shop-products.ts'
import type { HanfolkDetail } from '../../shared/hanfolk-catalog.ts'
import { ApiError, type Env } from '../platform.ts'
import { unseal } from '../product-secrets.ts'
import { HanfolkClient } from './client.ts'
import { hanfolkSettings } from './settings.ts'

/** Keep owner-approved products and all SKUs, including zero-stock and removed SKUs. */
export async function hanfolkAvailability(env: Env) {
  const rows = (await env.INTEREST_DB.prepare("SELECT l.local_id,l.product_id,l.sku,p.public_json,c.detail,c.checked_at,s.key_hash,s.checked_key_hash,i.stock,i.source_state,i.checked_at inventory_at,i.key_hash inventory_key FROM hanfolk_product_links l JOIN shop_products p ON p.id=l.local_id CROSS JOIN hanfolk_settings s LEFT JOIN hanfolk_catalog c ON c.product_id=l.product_id AND c.key_hash=s.key_hash LEFT JOIN hanfolk_inventory i ON i.local_id=l.local_id WHERE s.id='main'")
    .all<{ local_id: string; product_id: number; sku: string; public_json: string; detail: string | null; checked_at: number | null; key_hash: string; checked_key_hash: string; stock: number | null; source_state: string | null; inventory_at: number | null; inventory_key: string | null }>()).results
  const stock = new Map<string, number>(), groups = new Set<string>(), states = new Map<string, NonNullable<ShopProduct['inventory']>>()
  for (const row of rows) {
    const product = JSON.parse(row.public_json) as ShopProduct
    if (product.groupId) groups.add(product.groupId)
    const detail = row.detail ? JSON.parse(row.detail) as HanfolkDetail : null
    const variant = detail?.sku_variants.find(v => v.sku === row.sku)
    const currentInventory = row.inventory_key === row.key_hash && row.stock !== null
    const checkedAt = currentInventory ? row.inventory_at ?? 0 : row.checked_at ?? 0
    const quantity = currentInventory ? row.stock! : variant?.stock ?? row.stock ?? product.stock
    const unknown = !checkedAt || checkedAt < Date.now() - 15 * 60_000 || (!currentInventory && !variant) || row.key_hash !== row.checked_key_hash
    stock.set(row.local_id, quantity)
    states.set(row.local_id, { status: unknown ? 'checking' : quantity === 0 ? 'replenishing' : 'available', checkedAt })
  }
  return { stock, groups, states }
}

export async function availableHanfolkProducts(env: Env, products: ShopProduct[]) {
  const { stock, states } = await hanfolkAvailability(env)
  return products.map(p => stock.has(p.id) ? { ...p, stock: stock.get(p.id)!, inventory: states.get(p.id) } : p)
}

/** Read the exact source SKU again at checkout; this operation cannot procure. */
export async function assertHanfolkStock(env: Env, id: string) {
  const link = await env.INTEREST_DB.prepare('SELECT product_id,sku FROM hanfolk_product_links WHERE local_id=?').bind(id).first<{product_id: number; sku: string}>()
  if (!link) return
  const settings = await hanfolkSettings(env)
  if (!settings.api_secret || !settings.checked_at || settings.checked_key_hash !== settings.key_hash || settings.checked_at < Date.now() - 15 * 60_000)
    throw new ApiError('库存待确认，请稍后重试。', 409)
  let detail: HanfolkDetail
  try { detail = await new HanfolkClient(env, await unseal(env, settings.api_secret)).detail(link.product_id) }
  catch { throw new ApiError('库存暂时无法确认，请稍后重试。', 503) }
  const variant = detail.sku_variants.find(v => v.sku === link.sku)
  if (!variant || variant.stock <= 0) throw new ApiError('当前规格补货中，请稍后再来。', 409)
}
