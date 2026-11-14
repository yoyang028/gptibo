import { ApiError, hash, type Env } from './platform.ts'
import { getOrder, type Order } from './order-state.ts'
import { promotionFor } from './member-promotions.ts'
import { findRechargeOrder, queryPlatformOrder } from './recharge/service.ts'
import { config, request, moneyCents, type RemoteOrder, type Redemption } from './recharge/client.ts'
import { INVITATION_PLANS } from '../shared/member-promotions.ts'

type Snapshot = Record<string, string | number | null>
type Check = { state: 'matched' | 'difference' | 'expected' | 'error'; differences: string[]; local: Snapshot; upstream: Snapshot }
export async function operationEvent(env: Env, category: string, target: string, action: string, note: string, details: unknown = {}, actor = 'system') {
  await env.INTEREST_DB.prepare('INSERT INTO member_operation_events(id,category,target_id,action,actor,note,details,created_at) VALUES (?,?,?,?,?,?,?,?)')
    .bind(crypto.randomUUID(), category, target, action, actor, note, JSON.stringify(details), Date.now()).run()
}
export function assertPilotOrder(o: Order) {
  if (o.owner_store_id !== 'store-3' || o.partner_id || o.mode !== 'live' || o.is_test || !(INVITATION_PLANS as readonly string[]).includes(o.plan)) throw new ApiError('请选择通用店的真实活动规格订单。', 409)
}
async function compare(env: Env, o: Order): Promise<Check> {
  const p = await promotionFor(env, o.id), row = await findRechargeOrder(env, o.id)
  const local: Snapshot = { orderId: o.id, status: o.status, payment: o.payment_status, cashCents: p?.cash_cents ?? o.price_cents,
    supplyCents: p?.supply_cents ?? row?.supply_cents ?? null, refundCents: o.refunded_cents,
    review: p?.review_status ?? 'none', procurement: p?.procurement_status ?? 'ready', remoteId: row?.remote_id ?? null,
    idempotencyKey: 'order:' + o.id, version: o.version }
  const result: Check = { state: 'matched', differences: [], local, upstream: {} }
  if (!row?.remote_id) {
    result.state = row?.attempted_at || o.payment_status === 'paid' || o.status === 'success' ? 'difference' : 'expected'
    result.differences = [row?.attempted_at ? 'upstream_identity_unknown' : o.payment_status === 'paid' || o.status === 'success' ? 'local_paid_without_upstream' : p?.procurement_status === 'awaiting_supplier' ? 'awaiting_supplier' : p?.review_status === 'required' ? 'awaiting_review' : 'not_submitted']
    return result
  }
  if (row.account !== config(env).account) return { ...result, state: 'error', differences: ['supplier_account_changed'] }
  if (!/^[A-Za-z0-9_-]{1,100}$/.test(row.remote_id)) return { ...result, state: 'error', differences: ['upstream_identity_invalid'] }
  const remote = await request<RemoteOrder>(env, '/orders/' + row.remote_id)
  if (!remote || remote.order_id !== row.remote_id || remote.merchant_order_no !== o.id || remote.product_code !== row.product_code || remote.currency !== 'CNY' || remote.quantity !== 1 || remote.collection_mode !== 'platform_collect' || remote.payment_scope !== 'retail' || remote.delivery_mode !== 'auto_recharge') return { ...result, state: 'difference', differences: ['upstream_identity_mismatch'] }
  if (!['pending','paid','closed','expired','partially_refunded','refunded'].includes(remote.payment_status)) throw new Error('Invalid upstream payment state')
  let delivery: string | null = remote.fulfillment_status ?? null
  if (delivery !== null && !['queued','running','succeeded','failed','cancelled'].includes(delivery)) throw new Error('Invalid delivery status')
  // If delivery is absent, read the latest original-order task. No POST recovery.
  if (!delivery) {
    const refs = await request<{ fulfillment_id: string; order_id: string; attempt_no: number }[]>(env, '/orders/' + row.remote_id + '/fulfillments')
    if (!Array.isArray(refs) || refs.some(r => r.order_id !== row.remote_id || !/^[A-Za-z0-9_-]{1,128}$/.test(r.fulfillment_id) || !Number.isSafeInteger(r.attempt_no) || r.attempt_no < 1) || new Set(refs.map(r => r.attempt_no)).size !== refs.length) throw new Error('Invalid task list')
    const latest = refs.reduce<(typeof refs)[number] | null>((a, b) => !a || b.attempt_no > a.attempt_no ? b : a, null)
    if (latest) {
      const task = await request<Redemption>(env, '/redemptions/' + latest.fulfillment_id)
      if (task.order_id !== row.remote_id || task.redemption_id !== latest.fulfillment_id || task.attempt_no !== latest.attempt_no || !['queued','running','succeeded','failed','cancelled'].includes(task.status)) throw new Error('Invalid task identity')
      delivery = task.status
    }
  }
  const cash = moneyCents(remote.sale_amount), supply = moneyCents(remote.supply_amount), refund = moneyCents(remote.refunded_amount ?? '0.00')
  result.upstream = { remoteId: remote.order_id, orderId: remote.merchant_order_no, payment: remote.payment_status, delivery, cashCents: cash, supplyCents: supply, refundCents: refund }
  const d = result.differences
  if (cash !== local.cashCents) d.push('cash_amount')
  if (local.supplyCents !== null && supply !== local.supplyCents) d.push('supply_amount')
  if (refund !== o.refunded_cents) d.push('refund_amount')
  if ((['paid','partially_refunded','refunded'].includes(remote.payment_status)) !== (o.payment_status === 'paid')) d.push('payment_status')
  if (['closed','expired'].includes(remote.payment_status) && o.status === 'pending') d.push('close_status')
  if ((delivery === 'succeeded') !== (o.status === 'success') || (delivery && ['failed','cancelled'].includes(delivery) && !['failed','cancelled'].includes(o.status)) || (o.status === 'processing' && !['queued','running'].includes(delivery ?? ''))) d.push('delivery_status')
  if (p && (p.cash_cents === 0 || p.procurement_status === 'awaiting_supplier')) d.push('held_order_submitted')
  result.state = d.length ? 'difference' : 'matched'
  return result
}
export async function reconcilePilotOrder(env: Env, id: string, actor = 'system') {
  const order = await getOrder(env, id); assertPilotOrder(order)
  const db = env.INTEREST_DB, token = crypto.randomUUID(), now = Date.now()
  await db.prepare('INSERT INTO member_order_reconciliations(order_id) VALUES (?) ON CONFLICT(order_id) DO NOTHING').bind(id).run()
  await db.prepare('UPDATE member_order_reconciliations SET lease_token=?,lease_until=? WHERE order_id=? AND lease_until<=?').bind(token, now + 60000, id, now).run()
  const claim = await db.prepare('SELECT fingerprint FROM member_order_reconciliations WHERE order_id=? AND lease_token=?').bind(id, token).first<{ fingerprint: string }>()
  if (!claim) throw new ApiError('订单正在对账，请稍后刷新。', 409)
  try {
    let result: Check
    try { result = await compare(env, order) }
    catch { result = { state: 'error', differences: ['upstream_query_failed'], local: { orderId: id }, upstream: {} } }
    if ((await getOrder(env, id)).version !== order.version) throw new ApiError('订单在对账期间已变化，请重新核对。', 409)
    const fingerprint = await hash(JSON.stringify(result)), statements = [db.prepare('UPDATE member_order_reconciliations SET state=?,differences=?,local_snapshot=?,upstream_snapshot=?,fingerprint=?,checked_at=?,version=version+1 WHERE order_id=? AND lease_token=?')
      .bind(result.state, JSON.stringify(result.differences), JSON.stringify(result.local), JSON.stringify(result.upstream), fingerprint, now, id, token)]
    if (claim.fingerprint !== fingerprint || actor !== 'system') statements.push(db.prepare("INSERT INTO member_operation_events(id,category,target_id,action,actor,note,details,created_at) SELECT ?,'reconciliation',order_id,'check',?,'核对原订单状态、金额和交付结果',?,? FROM member_order_reconciliations WHERE order_id=? AND lease_token=?")
      .bind(crypto.randomUUID(), actor, JSON.stringify(result), now, id, token))
    await db.batch(statements)
    return result
  } finally { await db.prepare('UPDATE member_order_reconciliations SET lease_token=NULL,lease_until=0 WHERE order_id=? AND lease_token=?').bind(id, token).run() }
}
export async function scanPilotOrders(env: Env, limit = 3) {
  if (env.MEMBERSHIP_ENABLED === undefined) return { checked: 0, failed: 0 }
  const rows = (await env.INTEREST_DB.prepare(`SELECT o.id FROM orders o LEFT JOIN member_order_reconciliations c ON c.order_id=o.id
    WHERE o.owner_store_id='store-3' AND o.partner_id IS NULL AND o.mode='live' AND o.is_test=0
      AND o.plan IN ('plus','pro-5x','pro-20x','pro-25x') AND COALESCE(c.lease_until,0)<=?
      AND COALESCE(c.checked_at,0)<? ORDER BY COALESCE(c.checked_at,0),o.created_at,o.id LIMIT ?`).bind(Date.now(), Date.now() - 300000, Math.max(1, Math.min(3, limit))).all<{ id: string }>()).results
  let failed = 0
  for (let i = 0; i < rows.length; i += 2) {
    const results = await Promise.allSettled(rows.slice(i, i + 2).map(o => reconcilePilotOrder(env, o.id)))
    failed += results.filter(r => r.status === 'rejected' || r.value.state === 'error').length
  }
  return { checked: rows.length, failed }
}
export async function syncPilotOrder(env: Env, id: string, note: string) {
  const o = await getOrder(env, id); assertPilotOrder(o)
  const p = await promotionFor(env, id)
  if (p && (p.cash_cents === 0 || p.procurement_status === 'awaiting_supplier' || !['none','approved'].includes(p.review_status))) throw new ApiError('该订单需先完成审核与上游采购方案核对，保持锁券待处理。', 409)
  // The existing validated GET-only state machine owns transitions. No direct
  // edits to payments, fulfillment, idempotency keys or reward records here.
  await operationEvent(env, 'reconciliation', id, 'sync_requested', note, {}, env.ADMIN_USERNAME ?? 'admin')
  try { await queryPlatformOrder(env, o) }
  catch { await operationEvent(env, 'reconciliation', id, 'sync_failed', '原订单同步未完成，请查看差异并复核上游'); throw new ApiError('原订单同步未完成；没有发起新采购，请复核上游。', 409) }
  return reconcilePilotOrder(env, id, env.ADMIN_USERNAME ?? 'admin')
}
