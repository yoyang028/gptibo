import { ApiError, type Env, type Value } from './platform.ts'
import type { Order } from './order-state.ts'
import type { AdminStoreOption } from '../shared/admin-store-scope.ts'

export type AdminStoreScope = { channel: 'all' | 'owner' | 'agent'; storeId: string | null }

export async function adminOwnerStores(env: Env) {
  return (await env.INTEREST_DB.prepare(`SELECT id,COALESCE(NULLIF(json_extract(settings,'$.name'),''),id) name,
    COALESCE(json_extract(settings,'$.active'),1) active FROM owner_shop_settings
    ORDER BY COALESCE(json_extract(settings,'$.displayOrder'),slot)`).all<AdminStoreOption>()).results
}

export async function readAdminStoreScope(env: Env, url: URL): Promise<AdminStoreScope> {
  const channel = url.searchParams.get('scope') || 'all'
  const storeId = url.searchParams.get('store') || null
  if ((channel !== 'all' && channel !== 'owner' && channel !== 'agent') || (storeId && channel === 'agent')) {
    throw new ApiError('店铺范围无效。')
  }
  if (storeId && !await env.INTEREST_DB.prepare('SELECT 1 FROM owner_shop_settings WHERE id=?').bind(storeId).first()) {
    throw new ApiError('店铺不存在。', 404)
  }
  return { channel: storeId ? 'owner' : channel, storeId }
}

export function scopedOrders(scope: AdminStoreScope, alias: 'o' | 'orders' = 'o') {
  const clauses: string[] = []
  const values: Value[] = []
  if (scope.channel !== 'all') {
    clauses.push(alias + '.is_test=0', alias + (scope.channel === 'owner' ? '.partner_id IS NULL' : '.partner_id IS NOT NULL'))
  }
  if (scope.storeId) {
    clauses.push(alias + '.owner_store_id=?')
    values.push(scope.storeId)
  }
  return { clauses, values }
}

export function orderInAdminScope(scope: AdminStoreScope, order: Order) {
  if (scope.channel === 'all') return true
  if (order.is_test) return false
  if (scope.channel === 'agent') return order.partner_id != null
  return order.partner_id == null && (!scope.storeId || scope.storeId === (order.owner_store_id ?? 'platform'))
}

export async function adminOrderStoreName(env: Env, order: Order) {
  if (order.partner_id) return null
  const store = await env.INTEREST_DB.prepare("SELECT json_extract(settings,'$.name') name FROM owner_shop_settings WHERE id=?")
    .bind(order.owner_store_id ?? 'platform').first<{ name: string | null }>()
  return store?.name ?? null
}
