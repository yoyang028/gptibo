import { hasControlCharacters, type ShopProduct, type ShopProductInput } from '../shared/shop-products.ts'
import { redemptionGuideFromProduct } from '../shared/redemption-copy.ts'
import { ApiError, type Env } from './platform.ts'
import { seal, unseal } from './product-secrets.ts'
import type { Order } from './order-state.ts'

export function validateGuide(value: unknown) {
  if (typeof value !== 'string' || value.length > 12000 || hasControlCharacters(value))
    throw new ApiError('付款后兑换指引最多 12000 字，不能包含无效控制字符。')
  return value.trim()
}

export async function privateProductGuide(env: Env, id: string) {
  const row = await env.INTEREST_DB.prepare('SELECT encrypted_content FROM shop_redemption_guides WHERE product_id=?').bind(id).first<{ encrypted_content: string }>()
  return row ? unseal(env, row.encrypted_content) : ''
}

export async function editableProducts(env: Env, products: ShopProduct[]): Promise<ShopProductInput[]> {
  const rows = (await env.INTEREST_DB.prepare('SELECT product_id,encrypted_content FROM shop_redemption_guides').all<{ product_id: string; encrypted_content: string }>()).results
  const guides = new Map(await Promise.all(rows.map(async r => [r.product_id, await unseal(env, r.encrypted_content)] as const)))
  return products.map(p => ({ ...p, redemptionGuide: guides.get(p.id) ?? '' }))
}

export async function guideSaveStatement(env: Env, product: ShopProduct, changeId: string, explicit?: unknown) {
  const inferred = explicit === undefined ? redemptionGuideFromProduct(product) : validateGuide(explicit)
  if (explicit === undefined && !inferred) return null
  if (!inferred) return env.INTEREST_DB.prepare('DELETE FROM shop_redemption_guides WHERE product_id=? AND EXISTS(SELECT 1 FROM shop_products WHERE id=? AND change_id=?)').bind(product.id, product.id, changeId)
  const encrypted = await seal(env, inferred)
  return env.INTEREST_DB.prepare('INSERT INTO shop_redemption_guides(product_id,encrypted_content,product_version,updated_at) SELECT ?,?,?,? WHERE EXISTS(SELECT 1 FROM shop_products WHERE id=? AND change_id=?) ON CONFLICT(product_id) DO UPDATE SET encrypted_content=excluded.encrypted_content,product_version=excluded.product_version,updated_at=excluded.updated_at').bind(product.id, encrypted, product.version + 1, Date.now(), product.id, changeId)
}

export async function deliveredRedemptionGuide(env: Env, order: Order, delivered: boolean, snapshot = '') {
  if (!delivered || order.status !== 'success' || order.mode !== 'live' || order.is_test || order.payment_status !== 'paid' || order.refund_hold || order.refunded_cents || order.redemption_blocked) return undefined
  // Legacy orders have no guide snapshot; they may use the separately secured
  // product guide. New orders always retain their encrypted delivery guide.
  return (snapshot ? await unseal(env, snapshot) : await privateProductGuide(env, order.plan)) || undefined
}
