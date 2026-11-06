import { ApiError, type Env } from './platform.ts'

export async function resolveOwnerStore(env: Env, slug: unknown): Promise<string | null> {
  if (slug === undefined || slug === null || slug === '') return 'platform'
  if (typeof slug !== 'string') return null
  return (await env.INTEREST_DB.prepare('SELECT id FROM owner_shop_settings WHERE slug=?').bind(slug).first<{ id: string }>())?.id ?? null
}
export async function ownerStoreOffer(env: Env, storeId: string, plan: string) {
  const row = await env.INTEREST_DB.prepare(`SELECT c.*,COALESCE(p.price_cents,c.price_cents) store_price_cents,COALESCE(p.enabled,c.enabled) store_enabled,COALESCE(p.version,0) store_price_version
    FROM catalog_plans c LEFT JOIN owner_store_prices p ON p.plan=c.id AND p.store_id=? WHERE c.id=?`).bind(storeId, plan).first<{ price_cents: number; enabled: number; store_price_cents: number; store_enabled: number; version: number; store_price_version: number; product_id: string }>()
  if (!row) throw new ApiError('商品不存在。', 404)
  return { ...row, price_cents: row.store_price_cents, enabled: row.store_enabled }
}

// Used in both native and custom checkout INSERTs. Checks stay in the same D1
// transaction as stock reservation, including changes made after the first read.
export const ownerCheckoutGuard = `EXISTS(SELECT 1 FROM owner_shop_settings os WHERE os.id=? AND COALESCE(json_extract(os.settings,'$.active'),1)=1
  AND NOT EXISTS(SELECT 1 FROM json_each(os.settings,'$.hiddenProductIds') h WHERE h.value=c.product_id OR h.value=c.id))
  AND COALESCE((SELECT enabled FROM owner_store_prices WHERE store_id=? AND plan=c.id),c.enabled)=1
  AND COALESCE((SELECT version FROM owner_store_prices WHERE store_id=? AND plan=c.id),0)=?`
