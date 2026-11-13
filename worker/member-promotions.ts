import { ApiError, hash, json, body, type Env, type Statement } from './platform.ts'
import { memberStore, membershipEnabled, verifiedMember, MEMBER_STORE } from './member-auth.ts'
import { ownerStoreOffer, ownerCheckoutGuard } from './owner-store-prices.ts'
import { supplierSnapshot, snapshotStatement } from './recharge/service.ts'
import { emailValue } from './partner-auth.ts'
import { couponQuote } from './shop-coupons.ts'
import type { Order } from './order-state.ts'
import { INVITATION_PLANS, NEWCOMER_DISCOUNT_CENTS, type PromotionQuote, type PromotionView } from '../shared/member-promotions.ts'

export type Profile = { id: string; invite_code: string; frozen: number }
export type Promotion = {
  order_id: string; store_id: string; member_id: string | null; referrer_id: string | null; invite_code: string
  customer_key: string; original_cents: number; newcomer_cents: number; reward_cents: number; other_cents: number; cash_cents: number
  supply_cents: number; supplier_snapshot: string; request_hash: string; review_status: PromotionView['reviewStatus']
  review_note: string; risk_flags: string; procurement_status: PromotionView['procurementStatus']; allocation_status: string
  created_at: number; updated_at: number
}
export async function promotionFor(env: Env, id: string) {
  // The rollout switch blocks new activity, never protections on existing
  // orders. SELECT * remains compatible with pre-migration deployments.
  if (!membershipEnabled(env)) {
    const o = await env.INTEREST_DB.prepare('SELECT * FROM orders WHERE id = ?').bind(id).first<{ member_promotion?: number }>()
    if (!o?.member_promotion) return null
  }
  return env.INTEREST_DB.prepare('SELECT * FROM member_order_promotions WHERE order_id=?').bind(id).first<Promotion>()
}

export async function identityKey(env: Env, kind: string, value: string) {
  if (!env.MEMBER_AUTH_SECRET) throw new ApiError('会员活动尚未配置。', 503)
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(env.MEMBER_AUTH_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  return Array.from(new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`store-3:${kind}:${value.toLowerCase().trim()}`))), b => b.toString(16).padStart(2, '0')).join('')
}
export async function memberProfile(env: Env, id: string) {
  await env.INTEREST_DB.prepare('INSERT INTO member_profiles(id,invite_code,created_at) SELECT id,?,? FROM member_s3_user WHERE id=? AND emailVerified=1 ON CONFLICT(id) DO NOTHING')
    .bind(crypto.randomUUID().replaceAll('-', '').toUpperCase(), Date.now(), id).run()
  const profile = await env.INTEREST_DB.prepare('SELECT id,invite_code,frozen FROM member_profiles WHERE id=?').bind(id).first<Profile>()
  if (!profile) throw new ApiError('请先验证会员邮箱。', 403)
  return profile
}
export async function availableRewards(env: Env, member: string) {
  return (await env.INTEREST_DB.prepare("SELECT id,remaining_cents-reserved_cents available FROM member_reward_grants WHERE store_id=? AND member_id=? AND status='active' AND expires_at>? AND remaining_cents>reserved_cents ORDER BY expires_at,created_at,id")
    .bind(MEMBER_STORE, member, Date.now()).all<{ id: string; available: number }>()).results
}
export async function promotionRequestHash(data: Record<string, unknown>) {
  const p = data.promotion as Record<string, unknown> | undefined
  return hash(JSON.stringify({ plan: data.plan, invite: typeof p?.inviteCode === 'string' ? p.inviteCode.trim().toUpperCase() : '', newcomer: p?.newcomer === true, reward: p?.rewardCents ?? 0, coupon: data.couponCode ?? '' }))
}
export async function quotePromotion(request: Request, env: Env, data: Record<string, unknown>) {
  if (!memberStore(request, env) || !(INVITATION_PLANS as readonly unknown[]).includes(data.plan)) throw new ApiError('此商店或商品不参与邀新活动。', 409)
  const email = emailValue(data.email), offer = await ownerStoreOffer(env, MEMBER_STORE, String(data.plan))
  if (!offer.enabled) throw new ApiError('该套餐暂不可购买。', 409)
  const input = (data.promotion ?? {}) as Record<string, unknown>
  if (input === null || typeof input !== 'object' || Array.isArray(input)) throw new ApiError('优惠选择无效。')
  const code = typeof input.inviteCode === 'string' ? input.inviteCode.trim().toUpperCase() : ''
  if (code && !/^[A-Z0-9]{32}$/.test(code)) throw new ApiError('邀请链接无效。')
  const member = await verifiedMember(request, env), profile = member ? await memberProfile(env, member.id) : null
  const referrer = code ? await env.INTEREST_DB.prepare('SELECT p.id,p.frozen,u.email FROM member_profiles p JOIN member_s3_user u ON u.id=p.id WHERE p.store_id=? AND p.invite_code=? AND p.frozen=0 AND u.emailVerified=1').bind(MEMBER_STORE, code).first<{ id: string; email: string; frozen: number }>() : null
  const customerKey = await identityKey(env, 'email', email)
  const old = await env.INTEREST_DB.prepare("SELECT 1 FROM orders WHERE owner_store_id=? AND partner_id IS NULL AND mode='live' AND is_test=0 AND lower(customer_email)=? AND payment_status='paid' AND refunded_cents<price_cents LIMIT 1").bind(MEMBER_STORE, email).first()
  const claim = await env.INTEREST_DB.prepare('SELECT order_id FROM member_first_purchases WHERE store_id=? AND customer_key=?').bind(MEMBER_STORE, customerKey).first()
  const newcomerEligible = !!referrer && !old && !claim
  if (input.newcomer !== undefined && typeof input.newcomer !== 'boolean') throw new ApiError('新人优惠选择无效。')
  const newcomer = input.newcomer === true ? NEWCOMER_DISCOUNT_CENTS : 0
  if (newcomer && !newcomerEligible) throw new ApiError('此邮箱已有购买记录、待处理首单，或邀请资格已变化，不能重复领取新人优惠。', 409)
  const requested = input.rewardCents ?? 0
  if (typeof requested !== 'number' || !Number.isSafeInteger(requested) || requested < 0) throw new ApiError('奖励抵扣金额无效。')
  if ((newcomer && (requested || data.couponCode)) || (requested && data.couponCode)) throw new ApiError('请在新人优惠、奖励抵扣和普通优惠码中选择一种；多张邀请奖励可以完全叠加。', 409)
  if (requested && (!member || profile?.frozen)) throw new ApiError(profile?.frozen ? '账号权益正在审核，请联系支持。' : '请登录并验证邮箱后使用奖励。', 403)
  const rewards = member ? await availableRewards(env, member.id) : []
  const availableCents = profile?.frozen ? 0 : rewards.reduce((s, g) => s + g.available, 0)
  const rewardCents = Math.min(requested, offer.price_cents)
  if (rewardCents > availableCents) throw new ApiError('可用奖励余额已变化，请刷新后重试。', 409)
  const ordinary = data.couponCode ? await couponQuote(env, String(data.plan), email, data.couponCode, MEMBER_STORE) : null
  const cashCents = offer.price_cents - newcomer - rewardCents - (ordinary?.discountCents ?? 0)
  const snapshot = await supplierSnapshot(env, String(data.plan), offer.price_cents)
  const flags: string[] = []
  if (referrer && (referrer.id === member?.id || referrer.email.toLowerCase() === email)) flags.push('self_invitation')
  if (rewardCents > 3000 && rewardCents < 10000) {
    const recent = await env.INTEREST_DB.prepare('SELECT COUNT(*) n FROM member_order_promotions WHERE member_id=? AND created_at>?').bind(member?.id ?? '', Date.now() - 86400000).first<{ n: number }>()
    if ((recent?.n ?? 0) >= 5) flags.push('frequent_redemption')
  }
  const reviewStatus = offer.price_cents - cashCents >= 10000 || cashCents === 0 || flags.length ? 'required' : 'none'
  const procurementStatus = cashCents < snapshot.supplyCents ? 'awaiting_supplier' : 'ready'
  const allocations: { id: string; amount: number }[] = []
  let remaining = rewardCents
  for (const grant of rewards) { const amount = Math.min(remaining, grant.available); if (amount) allocations.push({ id: grant.id, amount }); remaining -= amount; if (!remaining) break }
  const quote: PromotionQuote = { originalCents: offer.price_cents, newcomerCents: newcomer, rewardCents, cashCents, otherCents: ordinary?.discountCents ?? 0,
    availableCents, newcomerEligible, inviteValid: !!referrer, reviewStatus, procurementStatus, allocationStatus: 'reserved',
    message: procurementStatus === 'awaiting_supplier' ? '优惠额度将完整保留。此订单需等待上游采购方式确认，暂不发起付款或充值。' : reviewStatus === 'required' ? '此订单需审核通过后继续付款与充值。' : '确认优惠后按实际应付金额付款。',
    selection: { inviteCode: referrer ? code : '', newcomer: !!newcomer, rewardCents: requested } }
  return { quote, offer, snapshot, allocations, member, referrer, customerKey, isNew: !old && !claim, flags }
}

export async function promotionStatements(env: Env, orderId: string, data: Record<string, unknown>, prepared: Awaited<ReturnType<typeof quotePromotion>>) {
  const { quote: q, snapshot, allocations, member, referrer, customerKey, isNew, flags } = prepared, now = Date.now()
  const statements = [env.INTEREST_DB.prepare(`INSERT INTO member_order_promotions(order_id,store_id,member_id,referrer_id,invite_code,customer_key,original_cents,newcomer_cents,reward_cents,other_cents,cash_cents,supply_cents,supplier_snapshot,request_hash,review_status,risk_flags,procurement_status,created_at,updated_at)
    SELECT id,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,? FROM orders WHERE id=?`)
    .bind(MEMBER_STORE, member?.id ?? null, referrer?.id ?? null, q.selection.inviteCode, customerKey, q.originalCents, q.newcomerCents, q.rewardCents, q.otherCents, q.cashCents, snapshot.supplyCents, JSON.stringify(snapshot), await promotionRequestHash(data), q.reviewStatus, JSON.stringify(flags), q.procurementStatus, now, now, orderId)]
  if (referrer && isNew) statements.push(env.INTEREST_DB.prepare('INSERT INTO member_first_purchases(store_id,customer_key,order_id) SELECT store_id,customer_key,order_id FROM member_order_promotions WHERE order_id=? ' + (q.newcomerCents ? '' : 'ON CONFLICT(store_id,customer_key) DO NOTHING')).bind(orderId))
  for (const allocation of allocations) statements.push(env.INTEREST_DB.prepare('INSERT INTO member_reward_allocations(order_id,grant_id,amount_cents,created_at) SELECT order_id,?,?,? FROM member_order_promotions WHERE order_id=?').bind(allocation.id, allocation.amount, now, orderId))
  statements.push(env.INTEREST_DB.prepare('INSERT INTO member_order_assertions SELECT order_id FROM member_order_promotions WHERE order_id=?').bind(orderId))
  return statements
}

export async function promotionView(env: Env, order: Order): Promise<PromotionView | null> {
  if (order.owner_store_id !== MEMBER_STORE) return null
  const p = await promotionFor(env, order.id)
  if (!p) return null
  return { originalCents: p.original_cents, newcomerCents: p.newcomer_cents, rewardCents: p.reward_cents, otherCents: p.other_cents, cashCents: p.cash_cents,
    reviewStatus: p.review_status, procurementStatus: p.procurement_status, allocationStatus: p.allocation_status,
    message: order.status === 'cancelled' ? p.allocation_status === 'released' ? '订单已取消，优惠占用已释放；原券有效期保持不变。' : '付款入口已到期，正在核对是否到账。确认关闭后释放优惠占用。' : p.review_status === 'rejected' ? '此订单审核未通过，请联系支持或取消订单释放额度。' : p.procurement_status === 'awaiting_supplier' ? '这笔优惠订单需人工确认供货。优惠额度已保留，确认前不会发起付款或充值。' : p.review_status === 'required' ? '等待人工审核，优惠额度已锁定。' : '已确认本次优惠，按实际应付金额处理。' }
}
export async function assertPromotionReady(env: Env, id: string) {
  const p = await promotionFor(env, id)
  if (p && (p.procurement_status !== 'ready' || !['none','approved'].includes(p.review_status) || ['released','restored'].includes(p.allocation_status))) throw new ApiError('订单正在等待审核或上游采购确认，不能发起付款或充值。', 409)
  if (p?.member_id && (await env.INTEREST_DB.prepare('SELECT frozen FROM member_profiles WHERE id=?').bind(p.member_id).first<{ frozen: number }>())?.frozen) throw new ApiError('账号权益正在审核，订单已暂停。', 409)
}

export async function cancelPromotion(request: Request, env: Env, order: Order) {
  const data = await body(request), p = await promotionFor(env, order.id)
  if (!p || data.version !== order.version) throw new ApiError('订单已更新，请刷新后重试。', 409)
  // A local timeout is not proof that an upstream payer cannot still pay.
  const upstream = await env.INTEREST_DB.prepare('SELECT attempted_at,remote_id,payment_status FROM recharge_orders WHERE order_id=?').bind(order.id).first<{ attempted_at: number | null; remote_id: string | null; payment_status: string }>()
  if (order.status !== 'pending' || order.payment_status !== 'unpaid' || order.refund_hold || (upstream && (upstream.attempted_at || upstream.remote_id))) throw new ApiError('付款入口已建立或状态待确认，请先联系支持核对上游关单，不能直接释放额度。', 409)
  await env.INTEREST_DB.batch(releasePromotionStatements(env, order.id, order.version))
  return json({ ok: true })
}
export function releasePromotionStatements(env: Env, orderId: string, version: number): Statement[] {
  const id = crypto.randomUUID(), now = Date.now()
  return [
    env.INTEREST_DB.prepare("UPDATE orders SET status='cancelled',version=version+1,updated_at=?,last_event_id=? WHERE id=? AND version=? AND status='pending' AND payment_status='unpaid' AND refund_hold=0").bind(now, id, orderId, version),
    env.INTEREST_DB.prepare("UPDATE member_reward_allocations SET status='released' WHERE order_id=? AND status='reserved' AND EXISTS(SELECT 1 FROM orders WHERE id=? AND last_event_id=?)").bind(orderId, orderId, id),
    env.INTEREST_DB.prepare("UPDATE member_order_promotions SET allocation_status='released',updated_at=? WHERE order_id=? AND allocation_status='reserved' AND EXISTS(SELECT 1 FROM orders WHERE id=? AND last_event_id=?)").bind(now, orderId, orderId, id),
    env.INTEREST_DB.prepare('DELETE FROM member_first_purchases WHERE order_id=? AND EXISTS(SELECT 1 FROM orders WHERE id=? AND last_event_id=?)').bind(orderId, orderId, id),
    env.INTEREST_DB.prepare("INSERT INTO order_events(id,order_id,actor,action,from_status,to_status,note,order_version,created_at) SELECT ?,id,'customer','promotion-cancel','pending','cancelled','关闭未付款活动订单并释放优惠占用',version,? FROM orders WHERE id=? AND last_event_id=?").bind(id, now, orderId, id),
  ]
}

export async function approvePromotion(env: Env, p: Promotion, note: string) {
  if (p.review_status !== 'required' || !['reserved','captured'].includes(p.allocation_status)) throw new ApiError('订单审核状态已变化。', 409)
  const order = await env.INTEREST_DB.prepare('SELECT * FROM orders WHERE id=?').bind(p.order_id).first<Order>()
  if (!order || !['pending','session','failed'].includes(order.status)) throw new ApiError('订单不能执行此审核操作。', 409)
  const snapshot = p.procurement_status === 'ready' && order.payment_status === 'unpaid' ? await supplierSnapshot(env, order.plan, p.cash_cents) : null
  const statements: Statement[] = [env.INTEREST_DB.prepare("INSERT INTO member_review_actions(id,order_id,expected_updated_at,decision,note,created_at) VALUES (?,?,?,'approved',?,?)").bind(crypto.randomUUID(), p.order_id, p.updated_at, note, Date.now())]
  if (snapshot) statements.push(snapshotStatement(env, p.order_id, snapshot, p.cash_cents))
  statements.push(env.INTEREST_DB.prepare("INSERT INTO admin_audit(id,action,target_id,note,created_at) VALUES (?,'member-order-approve',?,?,?)").bind(crypto.randomUUID(), p.order_id, note, Date.now()))
  await env.INTEREST_DB.batch(statements)
}

// SQL text is exported only for the native checkout's existing guarded INSERT.
export { ownerCheckoutGuard }
