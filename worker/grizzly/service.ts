import {
  decimalUnits,
  grizzlyCostCents,
  validGrizzlyConfig,
  type SmsView,
} from '../../shared/grizzly-sms.ts'
import type { ShopProduct } from '../../shared/shop-products.ts'
import { ApiError, type Env } from '../platform.ts'
import { getOrder, type Order } from '../order-state.ts'
import { unseal } from '../product-secrets.ts'
import { alipayConfigured } from '../payments/providers.ts'
import { GrizzlyClient, GrizzlyError } from './client.ts'
import { allocateFromPools, poolQuotes } from './pools.ts'

type Activation = {
  order_id: string
  activation_id: string | null
  phone: string | null
  code: string | null
  cost_usd: string | null
  country: string | null
  supplier_cancelled_at: number | null
  supplier_refund_usd: string | null
  supplier_refund_confirmed_at: number | null
  verified: number
  state: SmsView['state']
  attempted: number
  cancel_requested: number
  completed_at: number | null
  expires_at: number | null
  next_poll_at: number
  error: string
  lease_token: string
  lease_until: number
}
const find = (env: Env, id: string) =>
  env.INTEREST_DB.prepare('SELECT * FROM grizzly_activations WHERE order_id=?')
    .bind(id)
    .first<Activation>()
const eligible = (o: Order) =>
  o.mode === 'live' &&
  !o.is_test &&
  o.payment_status === 'paid' &&
  !o.refund_hold &&
  !o.redemption_blocked &&
  o.refunded_cents === 0 &&
  o.status !== 'cancelled'
export function grizzlyCheckoutEnabled(env: Env) {
  if (
    env.GRIZZLY_SMS_ENABLED !== 'true' ||
    env.PAYMENT_CHECKOUT_ENABLED !== 'true' ||
    env.ORDER_TESTING_ENABLED === 'true' ||
    !alipayConfigured(env)
  )
    return false
  try {
    const url = new URL(env.PAYMENT_NOTIFY_ORIGIN ?? '')
    return (
      url.protocol === 'https:' &&
      !url.username &&
      !url.password &&
      url.pathname === '/' &&
      !url.search &&
      !url.hash
    )
  } catch {
    return false
  }
}
export async function smsSummary(
  env: Env,
  order: Order,
): Promise<SmsView | undefined> {
  const row = await find(env, order.id)
  if (!row) return undefined
  const visible =
    eligible(order) &&
    Boolean(row.verified) &&
    ['waiting', 'received'].includes(row.state)
  const messages = {
    ready: '付款确认后自动分配美国号码。',
    allocating: '正在分配号码，请稍候。',
    waiting: '请使用本号码发送短信验证码，订单会自动查询。',
    received: '已收到验证码。',
    cancelled: '本次接码已停止；如需退款，请在原订单申请售后。',
    unknown: '发号结果待店主核对，请保留原订单，勿重复付款。',
    failed: '本次未完成发号，可联系店主或申请售后。',
    review: '本次供货需要店主核对，请保留原订单。',
  }
  return {
    state: row.state,
    phone: visible ? row.phone : null,
    code: visible ? row.code : null,
    expiresAt: row.expires_at,
    message: row.error || messages[row.state],
  }
}
export async function smsAdminInfo(env: Env, id: string) {
  const row = await find(env, id)
  return row
    ? {
        activationId: row.activation_id,
        costUsd: row.cost_usd,
        country: row.country,
        supplierCancelledAt: row.supplier_cancelled_at,
        supplierRefundUsd: row.supplier_refund_usd,
        supplierRefundConfirmedAt: row.supplier_refund_confirmed_at,
      }
    : {}
}
// The administrator checks the provider ledger before releasing an uncertain
// order for normal refund review. Known activations must first close upstream.
export async function confirmSmsClosed(
  env: Env,
  order: Order,
  reference: unknown,
  note: string,
) {
  if (
    !eligible(order) ||
    typeof reference !== 'string' ||
    reference.trim().length < 3 ||
    reference.length > 200
  )
    throw new ApiError(
      '请填写上游账单或客服核对记录编号，确认无活动号码后再处理。',
      409,
    )
  const db = env.INTEREST_DB,
    token = crypto.randomUUID(),
    now = Date.now()
  await db
    .prepare(
      "UPDATE grizzly_activations SET lease_token=?,lease_until=? WHERE order_id=? AND lease_until<=? AND code IS NULL AND state IN ('unknown','review')",
    )
    .bind(token, now + 45000, order.id, now)
    .run()
  const row = await find(env, order.id)
  if (!row || row.lease_token !== token)
    throw new ApiError('当前接码状态不支持人工核对关闭。', 409)
  try {
    if (row.activation_id) {
      const detail = await db
        .prepare('SELECT api_secret FROM shop_order_details WHERE order_id=?')
        .bind(order.id)
        .first<{ api_secret: string }>()
      const client = new GrizzlyClient(
        env,
        await unseal(env, detail!.api_secret),
      )
      const status = await client.status(row.activation_id)
      if (status.state === 'received')
        throw new ApiError(
          '上游已收到验证码，请先人工核对本次交付，不能登记为未接码。',
          409,
        )
      if (status.state !== 'cancelled')
        await client.finish(row.activation_id, true)
    }
    const event = crypto.randomUUID(),
      message = '店主已核对本次接码已关闭，可在原订单申请售后。'
    await db.batch([
      db
        .prepare(
          "UPDATE grizzly_activations SET state='cancelled',error=?,supplier_cancelled_at=CASE WHEN activation_id IS NOT NULL THEN COALESCE(supplier_cancelled_at,?) ELSE supplier_cancelled_at END WHERE order_id=? AND lease_token=?",
        )
        .bind(message, now, order.id, token),
      db
        .prepare(
          "INSERT OR IGNORE INTO sms_supplier_events(id,order_id,kind,reference,note,created_at) SELECT ?,order_id,'cancel',activation_id,?,? FROM grizzly_activations WHERE order_id=? AND lease_token=? AND activation_id IS NOT NULL",
        )
        .bind(
          crypto.randomUUID(),
          note + '；核对记录：' + reference.trim(),
          now,
          order.id,
          token,
        ),
      db
        .prepare(
          "UPDATE shop_order_details SET supplier_state='failed',supplier_error=? WHERE order_id=? AND EXISTS(SELECT 1 FROM grizzly_activations WHERE order_id=? AND lease_token=?)",
        )
        .bind(message, order.id, order.id, token),
      db
        .prepare(
          "UPDATE orders SET status='failed',version=version+1,updated_at=?,last_event_id=? WHERE id=? AND EXISTS(SELECT 1 FROM grizzly_activations WHERE order_id=? AND lease_token=?)",
        )
        .bind(now, event, order.id, order.id, token),
      db
        .prepare(
          "INSERT INTO order_events(id,order_id,actor,action,to_status,note,order_version,created_at) SELECT ?,id,'admin','sms-manual-closed',status,?,version,? FROM orders WHERE id=? AND last_event_id=?",
        )
        .bind(
          event,
          note + '；核对记录：' + reference.trim(),
          now,
          order.id,
          event,
        ),
      db
        .prepare(
          "INSERT INTO admin_audit(id,target_id,action,note,created_at) SELECT ?,id,'sms-manual-closed',?,? FROM orders WHERE id=? AND last_event_id=?",
        )
        .bind(
          event,
          note + '；核对记录：' + reference.trim(),
          now,
          order.id,
          event,
        ),
    ])
  } catch (e) {
    if (e instanceof GrizzlyError) throw new ApiError(e.message, 409)
    throw e
  } finally {
    await db
      .prepare(
        "UPDATE grizzly_activations SET lease_token='',lease_until=0 WHERE order_id=? AND lease_token=?",
      )
      .bind(order.id, token)
      .run()
  }
}
export async function smsRefundProblem(env: Env, id: string) {
  const row = await find(env, id)
  return row &&
    (row.lease_until > Date.now() ||
      ['allocating', 'waiting', 'unknown', 'review'].includes(row.state))
    ? '请先停止接码；发号结果待核对时请联系店主，确认原号码状态后再申请退款。'
    : null
}
async function state(
  env: Env,
  id: string,
  token: string,
  next: Activation['state'],
  error = '',
) {
  const event = crypto.randomUUID(),
    now = Date.now(),
    success = next === 'received'
  await env.INTEREST_DB.batch([
    env.INTEREST_DB.prepare(
      'UPDATE grizzly_activations SET state=?,error=?,next_poll_at=? WHERE order_id=? AND lease_token=?',
    ).bind(next, error, now + 5000, id, token),
    env.INTEREST_DB.prepare(
      "UPDATE grizzly_activations SET supplier_cancelled_at=COALESCE(supplier_cancelled_at,?) WHERE order_id=? AND lease_token=? AND state='cancelled' AND activation_id IS NOT NULL",
    ).bind(now, id, token),
    env.INTEREST_DB.prepare(
      "INSERT OR IGNORE INTO sms_supplier_events(id,order_id,kind,reference,note,created_at) SELECT ?,order_id,'cancel',activation_id,'上游确认取消；余额退款另行核对',? FROM grizzly_activations WHERE order_id=? AND lease_token=? AND state='cancelled' AND activation_id IS NOT NULL",
    ).bind(crypto.randomUUID(), now, id, token),
    env.INTEREST_DB.prepare(
      'UPDATE shop_order_details SET supplier_state=?,supplier_error=?,last_checked_at=? WHERE order_id=? AND EXISTS(SELECT 1 FROM grizzly_activations WHERE order_id=? AND lease_token=?)',
    ).bind(
      success
        ? 'success'
        : ['waiting', 'allocating', 'ready'].includes(next)
          ? 'pending'
          : next === 'cancelled'
            ? 'failed'
            : next,
      error,
      now,
      id,
      id,
      token,
    ),
    env.INTEREST_DB.prepare(
      "UPDATE orders SET status=?,started_at=COALESCE(started_at,?),version=version+1,updated_at=?,last_event_id=? WHERE id=? AND payment_status='paid' AND refund_hold=0 AND refunded_cents=0 AND redemption_blocked=0 AND status<>'success' AND EXISTS(SELECT 1 FROM grizzly_activations WHERE order_id=? AND lease_token=?)",
    ).bind(
      success
        ? 'success'
        : ['waiting', 'allocating'].includes(next)
          ? 'processing'
          : 'failed',
      now,
      now,
      event,
      id,
      id,
      token,
    ),
    env.INTEREST_DB.prepare(
      "INSERT INTO order_events(id,order_id,actor,action,to_status,note,order_version,created_at) SELECT ?,id,'system','sms-status',status,?,version,? FROM orders WHERE id=? AND last_event_id=?",
    ).bind(event, '短信接码状态：' + next, now, id, event),
  ])
}
export async function fulfillGrizzly(
  env: Env,
  id: string,
  product: ShopProduct,
  sealed: string,
) {
  const db = env.INTEREST_DB,
    now = Date.now(),
    token = crypto.randomUUID()
  let row = await find(env, id)
  if (
    !row ||
    !validGrizzlyConfig(product.api) ||
    row.next_poll_at > now ||
    ['unknown', 'failed', 'review', 'cancelled'].includes(row.state)
  )
    return
  if (!eligible(await getOrder(env, id))) return
  await db
    .prepare(
      "UPDATE grizzly_activations SET lease_token=?,lease_until=? WHERE order_id=? AND lease_until<=? AND next_poll_at<=? AND EXISTS(SELECT 1 FROM orders WHERE id=? AND mode='live' AND is_test=0 AND payment_status='paid' AND refund_hold=0 AND refunded_cents=0 AND redemption_blocked=0 AND status<>'cancelled')",
    )
    .bind(token, now + 45000, id, now, now, id)
    .run()
  row = await find(env, id)
  if (!row || row.lease_token !== token) return
  try {
    const client = new GrizzlyClient(env, await unseal(env, sealed)),
      api = product.api!
    if (!row.activation_id) {
      const previous = (
        await db
          .prepare(
            'SELECT country,state FROM sms_allocation_attempts WHERE order_id=?',
          )
          .bind(id)
          .all<{ country: string; state: string }>()
      ).results
      if (
        row.attempted &&
        (!previous.length || previous.some((a) => a.state !== 'no_numbers'))
      ) {
        await state(env, id, token, 'unknown')
        return
      }
      if (env.GRIZZLY_SMS_ENABLED !== 'true') return
      const quotes =
        api.sms!.country === 'auto-us'
          ? await poolQuotes(client, api.productCode)
          : [
              {
                country: api.sms!.country,
                priceUsd: api.sms!.maxPriceUsd,
                count: 1,
                error: null,
              },
            ]
      if (api.sms!.country === 'auto-us') {
        const balance = await client.balance()
        const cheapest = quotes
          .filter((q) => q.priceUsd && q.count && q.count > 0)
          .map((q) => decimalUnits(q.priceUsd))
          .sort((a, b) => a - b)[0]
        if (cheapest !== undefined && decimalUnits(balance) < cheapest)
          throw new GrizzlyError('NO_BALANCE', true)
      }
      await db
        .prepare(
          "UPDATE grizzly_activations SET attempted=1,state='allocating' WHERE order_id=? AND lease_token=? AND EXISTS(SELECT 1 FROM orders WHERE id=? AND payment_status='paid' AND refund_hold=0 AND refunded_cents=0 AND redemption_blocked=0 AND status IN ('session','processing'))",
        )
        .bind(id, token, id)
        .run()
      if (!eligible(await getOrder(env, id))) return
      const allocated = await allocateFromPools(
        client,
        api.productCode,
        api.sms!.maxPriceUsd,
        quotes,
        {
          attempt: async (country, quote) => {
            if (
              env.GRIZZLY_SMS_ENABLED !== 'true' ||
              !eligible(await getOrder(env, id))
            )
              throw new GrizzlyError('DISABLED', true)
            const now = Date.now()
            await db
              .prepare(
                "INSERT INTO sms_allocation_attempts(order_id,country,state,quoted_usd,max_price_usd,created_at,updated_at) SELECT ?,?,'requested',?,?,?,? WHERE EXISTS(SELECT 1 FROM grizzly_activations WHERE order_id=? AND lease_token=?)",
              )
              .bind(
                id,
                country,
                quote,
                api.sms!.maxPriceUsd,
                now,
                now,
                id,
                token,
              )
              .run()
            if (
              !(await db
                .prepare(
                  'SELECT 1 FROM grizzly_activations WHERE order_id=? AND lease_token=?',
                )
                .bind(id, token)
                .first())
            )
              throw new GrizzlyError('NETWORK')
            await db
              .prepare(
                'UPDATE grizzly_activations SET country=? WHERE order_id=? AND lease_token=?',
              )
              .bind(country, id, token)
              .run()
          },
          result: async (country, result, remoteId) => {
            await db
              .prepare(
                'UPDATE sms_allocation_attempts SET state=?,activation_id=?,updated_at=? WHERE order_id=? AND country=?',
              )
              .bind(result, remoteId ?? null, Date.now(), id, country)
              .run()
            if (remoteId)
              await db
                .prepare(
                  'UPDATE grizzly_activations SET activation_id=? WHERE order_id=? AND lease_token=?',
                )
                .bind(remoteId, id, token)
                .run()
          },
        },
        previous.map((a) => a.country),
      )
      // Persist the supplier identity even if its cost/country needs review.
      let reportedUsd: string | null = null
      try {
        if (allocated.currency === 840) {
          grizzlyCostCents(allocated.cost, api.sms!.cnyPerUsd)
          reportedUsd = String(allocated.cost)
        }
      } catch {
        /* Unparseable cost is never treated as confirmed money. */
      }
      await db
        .prepare(
          'UPDATE grizzly_activations SET activation_id=?,phone=?,expires_at=?,cost_usd=? WHERE order_id=? AND lease_token=?',
        )
        .bind(
          allocated.id,
          allocated.phone,
          Date.now() + 20 * 60000,
          reportedUsd,
          id,
          token,
        )
        .run()
      await db
        .prepare(
          "INSERT OR IGNORE INTO sms_supplier_events(id,order_id,kind,amount_usd,reference,note,created_at) VALUES (?,?,'purchase',?,?,?,?)",
        )
        .bind(
          crypto.randomUUID(),
          id,
          reportedUsd,
          allocated.id,
          '号码池 ' + allocated.selectedCountry,
          Date.now(),
        )
        .run()
      let cost: number
      try {
        if (
          allocated.currency !== 840 ||
          allocated.country !== allocated.selectedCountry ||
          !/^\+1\d{10}$/.test(allocated.phone) ||
          decimalUnits(allocated.cost) > decimalUnits(api.sms!.maxPriceUsd)
        )
          throw new Error()
        cost = grizzlyCostCents(allocated.cost, api.sms!.cnyPerUsd)
        if (cost > api.maxCostCents!) throw new Error()
      } catch {
        await state(
          env,
          id,
          token,
          'review',
          '供货号码、国家或扣款金额待核对，请联系店主。',
        )
        return
      }
      await db.batch([
        db
          .prepare(
            'UPDATE grizzly_activations SET cost_usd=?,verified=1 WHERE order_id=? AND lease_token=?',
          )
          .bind(String(allocated.cost), id, token),
        db
          .prepare(
            'UPDATE orders SET cost_cents=? WHERE id=? AND EXISTS(SELECT 1 FROM grizzly_activations WHERE order_id=? AND lease_token=?)',
          )
          .bind(cost, id, id, token),
      ])
      await state(env, id, token, 'waiting')
      return
    }
    if (!row.verified) {
      await state(
        env,
        id,
        token,
        'review',
        '本次号码校验尚未完成，请联系店主核对原单。',
      )
      return
    }
    if (row.code) {
      if (row.state !== 'received') await state(env, id, token, 'received')
      if (!row.completed_at) {
        await client.finish(row.activation_id)
        await db
          .prepare(
            'UPDATE grizzly_activations SET completed_at=? WHERE order_id=? AND lease_token=?',
          )
          .bind(Date.now(), id, token)
          .run()
      }
      return
    }
    const status = await client.status(row.activation_id)
    if (status.state === 'received') {
      // Persist the code and successful delivery before finalizing upstream.
      await db
        .prepare(
          'UPDATE grizzly_activations SET code=? WHERE order_id=? AND lease_token=?',
        )
        .bind(status.code!, id, token)
        .run()
      await state(env, id, token, 'received')
      try {
        await client.finish(row.activation_id)
        await db
          .prepare(
            'UPDATE grizzly_activations SET completed_at=? WHERE order_id=? AND lease_token=?',
          )
          .bind(Date.now(), id, token)
          .run()
      } catch {
        /* The delivered code stays available; cron completes the activation. */
      }
    } else if (status.state === 'cancelled')
      await state(env, id, token, 'cancelled')
    else if (
      row.cancel_requested ||
      (row.expires_at && row.expires_at <= Date.now())
    ) {
      // Query first: a code arriving alongside cancellation wins.
      await client.finish(row.activation_id, true)
      await state(env, id, token, 'cancelled')
    } else
      await db
        .prepare(
          'UPDATE grizzly_activations SET next_poll_at=?,error=? WHERE order_id=? AND lease_token=?',
        )
        .bind(Date.now() + 5000, '', id, token)
        .run()
  } catch (e) {
    const current = await find(env, id)
    const error =
      e instanceof GrizzlyError ? e.message : '接码结果暂未确认，请保留原订单。'
    if (!current?.activation_id)
      await state(
        env,
        id,
        token,
        e instanceof GrizzlyError && e.definitive ? 'failed' : 'unknown',
        error,
      )
    else
      await db
        .prepare(
          'UPDATE grizzly_activations SET error=?,next_poll_at=? WHERE order_id=? AND lease_token=?',
        )
        .bind(error, Date.now() + 15000, id, token)
        .run()
  } finally {
    await db
      .prepare(
        "UPDATE grizzly_activations SET lease_token='',lease_until=0 WHERE order_id=? AND lease_token=?",
      )
      .bind(id, token)
      .run()
  }
}
export async function cancelSms(env: Env, order: Order) {
  if (!eligible(order)) throw new ApiError('当前订单暂不能停止接码。', 409)
  const row = await find(env, order.id)
  if (
    !row ||
    row.code ||
    !['ready', 'waiting', 'cancelled'].includes(row.state)
  )
    throw new ApiError('发号状态待核对或已收码，请刷新原订单或联系店主。', 409)
  if (row.state === 'ready') {
    await env.INTEREST_DB.prepare(
      "UPDATE grizzly_activations SET state='cancelled' WHERE order_id=? AND state='ready' AND attempted=0 AND lease_until<=?",
    )
      .bind(order.id, Date.now())
      .run()
    if ((await find(env, order.id))?.state !== 'cancelled')
      throw new ApiError('正在分配号码，请稍后刷新。', 409)
    return
  }
  await env.INTEREST_DB.prepare(
    'UPDATE grizzly_activations SET cancel_requested=1,next_poll_at=0 WHERE order_id=? AND code IS NULL',
  )
    .bind(order.id)
    .run()
}
export async function reconcileSms(env: Env) {
  const rows = (
    await env.INTEREST_DB.prepare(
      "SELECT g.order_id,d.snapshot,d.api_secret FROM grizzly_activations g JOIN orders o ON o.id=g.order_id JOIN shop_order_details d ON d.order_id=g.order_id WHERE o.payment_status='paid' AND o.refund_hold=0 AND o.refunded_cents=0 AND o.redemption_blocked=0 AND g.next_poll_at<=? AND (g.state IN ('ready','allocating','waiting') OR (g.state='received' AND g.completed_at IS NULL)) ORDER BY g.next_poll_at LIMIT 20",
    )
      .bind(Date.now())
      .all<{ order_id: string; snapshot: string; api_secret: string }>()
  ).results
  for (const row of rows)
    await fulfillGrizzly(
      env,
      row.order_id,
      JSON.parse(row.snapshot),
      row.api_secret,
    )
}
