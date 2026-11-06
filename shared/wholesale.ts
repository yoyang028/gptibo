export type WholesaleProduct = {
  id: string; name: string; description: string; category: string; price_cents: number
  fulfillment: 'stock' | 'manual'; active: number; version: number; stock: number
}
export type WholesaleOrder = {
  id: string; partner_id: string; request_key: string; product_id: string; product_name: string
  unit_price_cents: number; quantity: number; amount_cents: number; fulfillment: 'stock' | 'manual'
  status: 'pending' | 'fulfilled' | 'refunded'; buyer_note: string; handling_note: string
  created_at: number; updated_at: number; delivery?: string[]; partner_name?: string
}
export type WholesaleTopup = {
  id: string; partner_id: string; amount_cents: number; payment_reference: string
  status: 'pending' | 'approved' | 'rejected'; handling_note: string; created_at: number; partner_name?: string
}
export type WholesaleLedger = { id: number; kind: 'topup' | 'purchase' | 'refund'; reference_id: string; amount_cents: number; balance_cents: number; created_at: number }
export type WholesaleKey = { id: string; name: string; prefix: string; created_at: number; expires_at: number; revoked_at: number | null }
export type WholesaleAccount = { id: string; name: string; balance_cents: number; payment_instructions: string; topup_enabled: boolean }
export type WholesaleAgent = { id: string; name: string; email: string; active: number; version: number; balance_cents: number }
export const WHOLESALE_STATUS = { pending: '待处理', fulfilled: '已交付', refunded: '已退回余额', approved: '已入账', rejected: '已驳回' } as const
export const wholesaleMoney = (cents: number) => new Intl.NumberFormat('zh-CN', { style: 'currency', currency: 'CNY' }).format(cents / 100)
