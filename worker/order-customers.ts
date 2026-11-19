import type { Env, Value } from './platform.ts'
import type { CustomerOrderStats, CustomerOrderRecord } from '../shared/customers.ts'

export function customerOrderStatsQuery(storeId: string | null = null) {
  return {
    sql: `SELECT customer_id,COUNT(*) order_count,SUM(payment_status='paid') paid_order_count,
      SUM(paid_cents) order_paid_cents,SUM(refunded_cents) order_refunded_cents,
      SUM(paid_cents-refunded_cents) order_net_cents,MIN(created_at) first_order_at,MAX(created_at) last_order_at,
      GROUP_CONCAT(DISTINCT store_name) order_stores,GROUP_CONCAT(DISTINCT plan_name) order_products
      FROM owner_customer_orders ${storeId ? 'WHERE store_id=?' : ''} GROUP BY customer_id`,
    values: (storeId ? [storeId] : []) as Value[],
  }
}

export const customerOrderColumns = `COALESCE(oc.order_count,0) order_count,COALESCE(oc.paid_order_count,0) paid_order_count,
  COALESCE(oc.order_paid_cents,0) order_paid_cents,COALESCE(oc.order_refunded_cents,0) order_refunded_cents,
  COALESCE(oc.order_net_cents,0) order_net_cents,oc.first_order_at,oc.last_order_at,oc.order_stores,oc.order_products`

export async function customerOrderHistory(env: Env, customerId: string) {
  const query = customerOrderStatsQuery()
  const [stats, orders] = await Promise.all([
    env.INTEREST_DB.prepare(`SELECT * FROM (${query.sql}) WHERE customer_id=?`).bind(customerId).first<CustomerOrderStats>(),
    env.INTEREST_DB.prepare('SELECT * FROM owner_customer_orders WHERE customer_id=? ORDER BY created_at DESC,id DESC LIMIT 50').bind(customerId).all<CustomerOrderRecord>(),
  ])
  return { orderStats: stats, orders: orders.results }
}
