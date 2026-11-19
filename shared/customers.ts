export const MEMBERSHIP_PLANS = ['plus','pro-5x','pro-20x','pro-25x'] as const
export function monthAfter(openedAt: number) {
  const date = new Date(openedAt+8*3600000)
  const year = date.getUTCFullYear(); const month = date.getUTCMonth()+1
  const last = new Date(Date.UTC(year,month+1,0)).getUTCDate()
  return Date.UTC(year,month,Math.min(date.getUTCDate(),last),date.getUTCHours(),date.getUTCMinutes(),date.getUTCSeconds(),date.getUTCMilliseconds())-8*3600000
}
export type CustomerOrderStats = { order_count:number; paid_order_count:number; order_paid_cents:number; order_refunded_cents:number; order_net_cents:number; first_order_at:number|null; last_order_at:number|null; order_stores:string|null; order_products:string|null }
export type CustomerOrderRecord = { id:string; store_id:string; store_name:string; plan_name:string; created_at:number; status:string; payment_status:string; total_cents:number; paid_cents:number; refunded_cents:number }
export type Customer = { id:string; partner_id:string|null; partner_name:string|null; name:string; wechat:string; qq:string; email:string; source:string; note:string; version:number; created_at:number; updated_at:number; account_count:number; paid_cents:number; soon_count:number; expired_count:number; plan_names:string|null; next_expiry:number|null } & Partial<CustomerOrderStats>
export type CustomerAccount = { id:string; customer_id:string; account:string; note:string; version:number; current_subscription_id:string|null; plan:string|null; plan_name:string|null; opened_at:number|null; expires_at:number|null; paid_cents:number|null }
export type CustomerSubscription = { id:string; account_id:string; previous_id:string|null; plan:string; plan_name:string; kind:'open'|'renew'|'upgrade'; opened_at:number; expires_at:number; paid_cents:number; note:string; created_at:number }
export type CustomerList = { customers:Customer[]; total:number; page:number; stats:{customers:number;accounts:number;soon:number;expired:number;paid_cents:number} & Partial<CustomerOrderStats>; plans:{id:string;name:string}[]; partners:{id:string;name:string}[]; asOf:number }
export type CustomerDetail = { customer:Customer; accounts:CustomerAccount[]; subscriptions:CustomerSubscription[]; orderStats?:CustomerOrderStats|null; orders?:CustomerOrderRecord[]; asOf:number }
export type CustomerExport = { customers:Customer[]; accounts:CustomerAccount[]; subscriptions:(CustomerSubscription & {customer_id:string;account:string})[]; asOf:number }
