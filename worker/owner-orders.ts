import type { Order } from './order-state.ts'
import type { Env } from './platform.ts'

const ownerOrders = 'o.partner_id IS NULL AND o.is_test=0'
const financeJoins = `LEFT JOIN recharge_orders r ON r.order_id=o.id
  LEFT JOIN member_all_order_promotions p ON p.order_id=o.id AND p.store_id=o.owner_store_id`
const sale = 'COALESCE(p.cash_cents,o.price_cents)'
const cost = 'COALESCE(r.supply_cents,p.supply_cents,o.cost_cents)'
const refunded = 'MAX(o.refunded_cents,COALESCE(r.refunded_cents,0))'
const profit = `CASE WHEN o.mode='live' AND o.payment_status='paid' AND o.status='success'
  AND o.refund_hold=0 AND COALESCE(r.financial_hold,0)=0 AND ${cost} IS NOT NULL
  THEN MAX(0,${sale}-${refunded}-${cost}) END`

type StoreOrderRow = Order & {
  sale_cents: number
  known_cost_cents: number | null
  refund_cents: number
  profit_cents: number | null
  coupon_code: string | null
  coupon_cents: number
  newcomer_cents: number
  reward_cents: number
  discount_cents: number
}

export async function ownerStoreOrderStats(env: Env, storeId: string) {
  return env.INTEREST_DB.prepare(`SELECT COUNT(*) order_count,COALESCE(SUM(${profit}),0) earned_cents
    FROM orders o ${financeJoins} WHERE ${ownerOrders} AND o.owner_store_id=?`)
    .bind(storeId).first<{ order_count: number; earned_cents: number }>()
}

export async function ownerStoreOrderPage(env: Env, storeId: string | null, offset: number) {
  const filter = ownerOrders + (storeId === null ? '' : ' AND o.owner_store_id=?')
  const args = storeId === null ? [] : [storeId]
  const [orders, count] = await env.INTEREST_DB.batch([
    env.INTEREST_DB.prepare(`SELECT o.*,${sale} sale_cents,${cost} known_cost_cents,${refunded} refund_cents,${profit} profit_cents,
      cu.code_snapshot coupon_code,COALESCE(cu.discount_cents,0) coupon_cents,
      COALESCE(p.newcomer_cents,0) newcomer_cents,COALESCE(p.reward_cents,0) reward_cents,
      COALESCE(p.original_cents-p.cash_cents,cu.discount_cents,0) discount_cents
      FROM orders o ${financeJoins} LEFT JOIN shop_coupon_uses cu ON cu.order_id=o.id
      WHERE ${filter} ORDER BY o.created_at DESC,o.id DESC LIMIT 20 OFFSET ?`).bind(...args, offset),
    env.INTEREST_DB.prepare(`SELECT COUNT(*) total FROM orders o WHERE ${filter}`).bind(...args),
  ]) as [{ results: StoreOrderRow[] }, { results: { total: number }[] }]
  return { rows: orders.results, total: count.results[0]?.total ?? 0 }
}
