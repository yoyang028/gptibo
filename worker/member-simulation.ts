import { ApiError, json, type Env } from './platform.ts'
import { INVITATION_PLANS, NEWCOMER_DISCOUNT_CENTS } from '../shared/member-promotions.ts'
import { promotionAmounts, promotionPath } from '../shared/member-policy.ts'
import { availableRewards, identityKey } from './member-promotions.ts'
import { emailValue } from './partner-auth.ts'
import { ownerStoreOffer } from './owner-store-prices.ts'
import { ownerShop } from './owner-shop.ts'
import { supplierSnapshot } from './recharge/service.ts'
import { couponQuote } from './shop-coupons.ts'
import { riskFlags, riskMetrics } from './member-risk.ts'

export async function simulatePromotion(env: Env, data: Record<string, unknown>) {
  if (!(INVITATION_PLANS as readonly unknown[]).includes(data.plan) || !['scenario','member'].includes(String(data.mode))) throw new ApiError('预演商品或模式无效。')
  const plan = String(data.plan), offer = await ownerStoreOffer(env, 'store-3', plan), shop = await ownerShop(env, 'store-3')
  if (!offer.enabled || !shop.active || shop.hiddenProductIds.some(id => id === plan || id === offer.product_id)) throw new ApiError('该规格当前不可售。', 409)
  const requested = data.rewardCents ?? 0
  if (typeof requested !== 'number' || !Number.isSafeInteger(requested) || requested < 0) throw new ApiError('抵扣金额无效。')
  if (data.newcomer !== undefined && typeof data.newcomer !== 'boolean') throw new ApiError('新人优惠选择无效。')
  let available = Number(data.availableCents ?? 0), member: { id: string; frozen: number; emailVerified: number } | null = null, recent = 0
  if (!Number.isSafeInteger(available) || available < 0) throw new ApiError('假设余额无效。')
  if (data.mode === 'member') {
    const email = emailValue(data.memberEmail)
    member = await env.INTEREST_DB.prepare('SELECT p.id,p.frozen,u.emailVerified FROM member_profiles p JOIN member_s3_user u ON u.id=p.id WHERE lower(u.email)=? AND p.store_id=\'store-3\'').bind(email).first()
    if (!member?.emailVerified || member.frozen) throw new ApiError('该会员尚未验证邮箱、未建立权益或权益已冻结。', 409)
    available = (await availableRewards(env, member.id)).reduce((s, g) => s + g.available, 0)
    recent = (await env.INTEREST_DB.prepare('SELECT COUNT(*) n FROM member_order_promotions WHERE member_id=? AND created_at>?').bind(member.id, Date.now() - 86400000).first<{ n: number }>())?.n ?? 0
  } else {
    recent = Number(data.recentOrders ?? 0)
    if (!Number.isSafeInteger(recent) || recent < 0 || recent > 1000000) throw new ApiError('假设近期订单数无效。')
  }
  const customerEmail = data.customerEmail ? emailValue(data.customerEmail) : data.mode === 'member' ? emailValue(data.memberEmail) : 'preview@example.invalid'
  const code = typeof data.inviteCode === 'string' ? data.inviteCode.trim().toUpperCase() : ''
  let inviteValid = data.mode === 'scenario' && data.assumeInvite === true, newCustomer = data.mode === 'scenario' ? data.assumeNewCustomer === true : false
  let referrer: { id: string; email: string } | null = null
  if (code) {
    if (!/^[A-Z0-9]{32}$/.test(code)) throw new ApiError('邀请码格式无效。')
    referrer = await env.INTEREST_DB.prepare("SELECT p.id,u.email FROM member_profiles p JOIN member_s3_user u ON u.id=p.id WHERE p.invite_code=? AND p.frozen=0 AND u.emailVerified=1").bind(code).first()
    inviteValid = !!referrer
  }
  if (data.customerEmail || data.mode === 'member') {
    const key = await identityKey(env, 'email', customerEmail)
    const old = await env.INTEREST_DB.prepare("SELECT 1 FROM orders WHERE owner_store_id='store-3' AND partner_id IS NULL AND mode='live' AND is_test=0 AND lower(customer_email)=? AND payment_status='paid' AND refunded_cents<price_cents LIMIT 1").bind(customerEmail).first()
    const claim = await env.INTEREST_DB.prepare("SELECT 1 FROM member_first_purchases WHERE store_id='store-3' AND customer_key=?").bind(key).first()
    newCustomer = !old && !claim
  }
  if (data.newcomer === true && (!newCustomer || !inviteValid)) throw new ApiError('新人减5元需要有效邀请及首次购买资格。', 409)
  const newcomerCents = data.newcomer === true ? NEWCOMER_DISCOUNT_CENTS : 0
  const ordinary = data.couponCode ? await couponQuote(env, plan, customerEmail, data.couponCode, 'store-3') : null
  let amounts: ReturnType<typeof promotionAmounts>
  try { amounts = promotionAmounts(offer.price_cents, available, requested, newcomerCents, ordinary?.discountCents ?? 0, !!data.couponCode) }
  catch (e) { throw new ApiError((e as Error).message, 409) }
  const snapshot = await supplierSnapshot(env, plan, offer.price_cents), flags: string[] = []
  if (referrer && (referrer.id === member?.id || referrer.email.toLowerCase() === customerEmail)) flags.push('self_invitation')
  if (data.abnormal === true) flags.push('simulated_anomaly')
  if (amounts.rewardCents > 3000 && amounts.rewardCents < 10000 && recent >= 5) flags.push('frequent_redemption')
  if (data.mode === 'member' || data.customerEmail) flags.push(...riskFlags(await riskMetrics(env, { memberId: member?.id, customerKey: await identityKey(env, 'email', customerEmail) })))
  const path = promotionPath(offer.price_cents, amounts.cashCents, snapshot.supplyCents, flags)
  return json({ ...amounts, ...path, originalCents: offer.price_cents, supplyCents: snapshot.supplyCents, availableCents: available,
    newcomerCents, otherCents: ordinary?.discountCents ?? 0, flags, basis: data.mode, invitationEligible: inviteValid && newCustomer,
    procurementPath: path.procurementStatus === 'awaiting_supplier' ? 'hold_for_supplier' : path.reviewStatus === 'required' ? 'review_then_platform_collect' : 'platform_collect',
    sideEffects: false, message: '仅预演。没有创建订单、占用奖励、核销优惠码或发起采购；实际下单将重新校验资格与余额。' })
}
