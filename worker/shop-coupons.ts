import { ApiError, type Env } from './platform.ts'
import { ownerSupplyPrices } from './owner-shop.ts'
export type CouponQuote = {
  id: string
  version: number
  code: string
  priceCents: number
  discountCents: number
  listPriceCents: number
}
export async function couponQuote(
  env: Env,
  plan: string,
  email: string,
  code: unknown,
): Promise<CouponQuote> {
  if (typeof code !== 'string' || !/^[A-Za-z0-9_-]{3,32}$/.test(code.trim()))
    throw new ApiError('优惠码格式无效。')
  const row = await env.INTEREST_DB.prepare(
    'SELECT id,code,settings,version FROM shop_coupons WHERE code=? COLLATE NOCASE',
  )
    .bind(code.trim())
    .first<{ id: string; code: string; settings: string; version: number }>()
  if (!row) throw new ApiError('优惠码不存在。', 409)
  const settings = JSON.parse(row.settings),
    now = Date.now()
  const product = await env.INTEREST_DB.prepare(
    'SELECT price_cents FROM catalog_plans WHERE id=? AND enabled=1',
  )
    .bind(plan)
    .first<{ price_cents: number }>()
  const count = await env.INTEREST_DB.prepare(
    "SELECT COUNT(*) total,COALESCE(SUM(CASE WHEN u.email=? THEN 1 ELSE 0 END),0) used_email FROM shop_coupon_uses u JOIN orders o ON o.id=u.order_id WHERE u.coupon_id=? AND o.status<>'cancelled'",
  )
    .bind(email, row.id)
    .first<{ total: number; used_email: number }>()
  if (
    !product ||
    !settings.active ||
    now < Date.parse(settings.starts_at) ||
    now >= Date.parse(settings.ends_at) ||
    count!.total >= settings.max_uses ||
    (settings.once_per_email && count!.used_email) ||
    !settings.targets.some(
      (t: { storeId: string; plan: string }) =>
        t.storeId === 'platform' && t.plan === plan,
    )
  )
    throw new ApiError('该优惠码已失效、已使用或不适用于此商品。', 409)
  const priceCents = product.price_cents - settings.discount_cents,
    costs = await ownerSupplyPrices(env)
  if (
    priceCents <
    Math.max(
      1,
      costs[plan] ?? 1,
      await (await import('./shop-products.ts')).customRetailFloor(env, plan),
    )
  )
    throw new ApiError('商品价格已调整，当前优惠码不可用。', 409)
  return {
    id: row.id,
    version: row.version,
    code: row.code,
    priceCents,
    discountCents: settings.discount_cents,
    listPriceCents: product.price_cents,
  }
}
export function couponReservation(
  env: Env,
  quote: CouponQuote,
  orderId: string,
  email: string,
) {
  return env.INTEREST_DB.prepare(
    'INSERT INTO shop_coupon_uses(order_id,coupon_id,email,coupon_version,discount_cents) SELECT id,?,?,?,? FROM orders WHERE id=?',
  ).bind(quote.id, email, quote.version, quote.discountCents, orderId)
}
