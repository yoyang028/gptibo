import type { Env, Value } from './platform.ts'
import type { CustomerOrderStats, CustomerOrderRecord, CustomerOrderMembership, CustomerOrderDiscounts } from '../shared/customers.ts'

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

const appliedDiscount = `co.payment_status='paid' AND co.status<>'cancelled'
  AND (co.refunded_cents=0 OR co.refunded_cents<co.paid_cents)`
const discountJoins = `LEFT JOIN shop_coupon_uses cu ON cu.order_id=co.id AND ${appliedDiscount}
  LEFT JOIN member_all_order_promotions p ON p.order_id=co.id AND p.store_id=co.store_id
    AND p.allocation_status NOT IN ('released','restored') AND ${appliedDiscount}`
const rewardApplied = "CASE WHEN p.allocation_status='captured' THEN p.reward_cents ELSE 0 END"

export async function customerOrderDiscounts(env: Env, customerIds: string[], store: string | null) {
  const discounts = new Map<string, CustomerOrderDiscounts>()
  if (!customerIds.length) return discounts
  const where = `co.customer_id IN (${customerIds.map(() => '?').join(',')})` + (store ? ' AND co.store_id=?' : '')
  const { results } = await env.INTEREST_DB.prepare(`SELECT co.customer_id,
    COALESCE(SUM(cu.discount_cents),0) coupon_cents,
    CASE WHEN COUNT(DISTINCT cu.code_snapshot)=1 AND COUNT(cu.code_snapshot)=COUNT(cu.order_id)
      THEN MIN(cu.code_snapshot) END coupon_code,
    SUM(${rewardApplied}) reward_cents, COALESCE(SUM(p.newcomer_cents),0) newcomer_cents
    FROM owner_customer_orders co ${discountJoins} WHERE ${where} GROUP BY co.customer_id`)
    .bind(...customerIds, ...(store ? [store] : [])).all<CustomerOrderDiscounts & {customer_id:string}>()
  for (const { customer_id, ...summary } of results) discounts.set(customer_id, summary)
  return discounts
}

export function orderMembershipStats(store: string | null, now: number, soon: number) {
  return {
    sql: `SELECT customer_id, GROUP_CONCAT(DISTINCT plan_name) ordered_plans,
      GROUP_CONCAT(DISTINCT account_hint) bound_account_hints, COUNT(*) membership_orders,
      SUM(CASE WHEN expected_expiry>? AND expected_expiry<=? THEN 1 ELSE 0 END) membership_soon,
      SUM(CASE WHEN expected_expiry<=? THEN 1 ELSE 0 END) membership_expired,
      COALESCE(MIN(CASE WHEN expected_expiry>? THEN expected_expiry END),MAX(expected_expiry)) expected_expiry,
      CASE WHEN SUM(state='confirmed')>0 THEN 'confirmed'
        WHEN SUM(state='pending')>0 THEN 'pending'
        WHEN SUM(state='unverified')>0 THEN 'unverified'
        WHEN SUM(state='review')>0 THEN 'review'
        WHEN SUM(state='refunded')=COUNT(*) THEN 'refunded' ELSE 'inactive' END membership_state
      FROM crm_owner_order_memberships ${store ? 'WHERE store_id=?' : ''} GROUP BY customer_id`,
    values: [now, soon, now, now, ...(store ? [store] : [])] as Value[],
  }
}

export const orderMembershipColumns = `om.ordered_plans,om.bound_account_hints,COALESCE(om.membership_orders,0) membership_orders,
  COALESCE(om.membership_soon,0) membership_soon,COALESCE(om.membership_expired,0) membership_expired,
  om.expected_expiry,om.membership_state`

export async function customerOrderHistory(env: Env, customerId: string, store: string | null) {
  const query = customerOrderStatsQuery(store)
  const scope = ' WHERE customer_id=?' + (store ? ' AND store_id=?' : '')
  const orderScope = 'WHERE co.customer_id=?' + (store ? ' AND co.store_id=?' : '')
  const values = store ? [customerId, store] : [customerId]
  const [stats, orders, memberships] = await Promise.all([
    env.INTEREST_DB.prepare(`SELECT * FROM (${query.sql}) WHERE customer_id=?`).bind(...query.values, customerId).first<CustomerOrderStats>(),
    env.INTEREST_DB.prepare(`SELECT co.*, COALESCE(cu.discount_cents,0) coupon_cents,cu.code_snapshot coupon_code,
      ${rewardApplied} reward_cents,COALESCE(p.newcomer_cents,0) newcomer_cents
      FROM owner_customer_orders co ${discountJoins} ${orderScope} ORDER BY co.created_at DESC,co.id DESC LIMIT 50`).bind(...values).all<CustomerOrderRecord>(),
    env.INTEREST_DB.prepare('SELECT * FROM crm_owner_order_memberships' + scope + ' ORDER BY created_at DESC,order_id DESC LIMIT 50').bind(...values).all<CustomerOrderMembership>(),
  ])
  return { orderStats: stats, orders: orders.results, orderMemberships: memberships.results }
}
