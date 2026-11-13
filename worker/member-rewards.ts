import { ApiError, type Env } from './platform.ts'
import { identityKey, promotionFor } from './member-promotions.ts'
import { readRechargeInput, type RechargeCredential } from '../shared/recharge-credential.ts'
import { REWARD_OBSERVATION_MS, twoCalendarMonths } from '../shared/member-promotions.ts'

export async function captureRewards(env: Env, orderId: string) {
  const p = await promotionFor(env, orderId)
  if (!p || p.allocation_status !== 'reserved') return
  await env.INTEREST_DB.batch([
    env.INTEREST_DB.prepare("UPDATE member_reward_allocations SET status='captured' WHERE order_id=? AND status='reserved'").bind(orderId),
    env.INTEREST_DB.prepare("UPDATE member_order_promotions SET allocation_status='captured',updated_at=? WHERE order_id=? AND allocation_status='reserved' AND review_status IN ('none','approved') AND procurement_status='ready' AND EXISTS(SELECT 1 FROM orders WHERE id=? AND payment_status='paid' AND refund_hold=0 AND refunded_cents=0)").bind(Date.now(), orderId, orderId),
  ])
}

export async function promotionPaymentConfirmed(env: Env, orderId: string) {
  const p=await promotionFor(env,orderId)
  if(!p)return
  if(['released','restored'].includes(p.allocation_status)){
    await env.INTEREST_DB.prepare("UPDATE member_order_promotions SET review_status='required',risk_flags=json_insert(risk_flags,'$[#]','late_payment'),updated_at=? WHERE order_id=? AND NOT EXISTS(SELECT 1 FROM json_each(risk_flags) WHERE value='late_payment')").bind(Date.now(),orderId).run()
    return
  }
  if(p.procurement_status==='ready'&&['none','approved'].includes(p.review_status)){
    try{await captureRewards(env,orderId)}catch{
      await env.INTEREST_DB.prepare("UPDATE member_order_promotions SET review_status='required',updated_at=? WHERE order_id=?").bind(Date.now(),orderId).run()
    }
  }
}

export async function checkRewardTarget(env: Env, orderId: string, credential: RechargeCredential) {
  const p = await promotionFor(env, orderId)
  if (!p) return
  const email = readRechargeInput(credential.mode === 'session' ? credential.session : credential.access_token, credential.mode, false).email
  if (!email) return // An opaque credential is not proof of a different customer.
  const key = await identityKey(env, 'target', email)
  await env.INTEREST_DB.prepare('INSERT INTO member_target_claims(target_key,order_id) VALUES (?,?) ON CONFLICT(target_key) DO NOTHING').bind(key, orderId).run()
  const previous = await env.INTEREST_DB.prepare('SELECT order_id FROM member_target_claims WHERE target_key=? AND order_id<>?').bind(key, orderId).first()
  const firstCandidate = await env.INTEREST_DB.prepare('SELECT 1 FROM member_first_purchases WHERE order_id=?').bind(orderId).first()
  if (previous && firstCandidate && !JSON.parse(p.risk_flags).includes('target_repeat')) {
    await env.INTEREST_DB.batch([
      env.INTEREST_DB.prepare("UPDATE member_order_promotions SET review_status='required',risk_flags=json_insert(risk_flags,'$[#]','target_repeat'),updated_at=? WHERE order_id=?").bind(Date.now(), orderId),
      env.INTEREST_DB.prepare("INSERT INTO admin_audit(id,action,target_id,note,created_at) VALUES (?,'member-target-review',?,'充值目标存在重复活动记录，暂停履约等待审核',?)").bind(crypto.randomUUID(), orderId, Date.now()),
    ])
    throw new ApiError('该充值账号已有活动记录，订单已转人工审核，付款及优惠额度保留。', 409)
  }
  await env.INTEREST_DB.prepare('INSERT INTO member_target_uses(order_id,target_key,created_at) VALUES (?,?,?) ON CONFLICT(order_id) DO NOTHING').bind(orderId, key, Date.now()).run()
  const saved = await env.INTEREST_DB.prepare('SELECT target_key FROM member_target_uses WHERE order_id=?').bind(orderId).first<{ target_key: string }>()
  if (saved?.target_key !== key) throw new ApiError('此订单已绑定其他充值账号，请联系支持核对。', 409)
}

export async function reconcileMemberRewards(env: Env) {
  if (env.MEMBERSHIP_ENABLED === undefined) return { checked: 0 }
  const db = env.INTEREST_DB, now = Date.now()
  // Capture only confirmed payments. If a task fails, credit remains attached to
  // that order until a confirmed refund or cancellation; an unknown write never
  // becomes permission to spend the same credit again.
  const captures = (await db.prepare("SELECT p.order_id FROM member_order_promotions p JOIN orders o ON o.id=p.order_id WHERE p.allocation_status='reserved' AND p.review_status IN ('none','approved') AND p.procurement_status='ready' AND o.payment_status='paid' AND o.refund_hold=0 AND o.refunded_cents=0 LIMIT 100").all<{ order_id: string }>()).results
  for (const p of captures) {
    try { await captureRewards(env, p.order_id) }
    catch {
      await db.prepare("UPDATE member_order_promotions SET review_status='required',updated_at=? WHERE order_id=? AND review_status IN ('none','approved')").bind(now,p.order_id).run()
    }
  }

  const released = (await db.prepare(`SELECT p.order_id,p.allocation_status,o.payment_status,o.refunded_cents,p.cash_cents FROM member_order_promotions p JOIN orders o ON o.id=p.order_id
    LEFT JOIN recharge_orders r ON r.order_id=o.id WHERE p.allocation_status='reserved' AND (
      (o.status='cancelled' AND o.payment_status='unpaid' AND (r.order_id IS NULL OR (r.attempted_at IS NULL AND r.remote_id IS NULL) OR r.payment_status IN ('closed','expired')))
      OR (o.payment_status='paid' AND p.cash_cents>0 AND o.refunded_cents>=p.cash_cents)
    ) LIMIT 100`).all<{ order_id: string; allocation_status: string; payment_status: string }>()).results
  for (const p of released) {
    const next = 'released'
    await db.batch([
      db.prepare('UPDATE member_reward_allocations SET status=? WHERE order_id=? AND status=?').bind(next, p.order_id, p.allocation_status),
      db.prepare('UPDATE member_order_promotions SET allocation_status=?,updated_at=? WHERE order_id=? AND allocation_status=?').bind(next, now, p.order_id, p.allocation_status),
      ...(p.payment_status === 'unpaid' ? [db.prepare('DELETE FROM member_first_purchases WHERE order_id=?').bind(p.order_id)] : []),
    ])
  }
  const refunds = (await db.prepare("SELECT p.order_id,p.reward_cents,p.cash_cents,o.refunded_cents FROM member_order_promotions p JOIN orders o ON o.id=p.order_id WHERE p.allocation_status='captured' AND p.cash_cents>0 AND o.refunded_cents>p.refund_observed_cents LIMIT 100").all<{order_id:string;reward_cents:number;cash_cents:number;refunded_cents:number}>()).results
  for(const p of refunds){
    let restore = Math.floor(p.reward_cents * p.refunded_cents / p.cash_cents)
    const allocations=(await db.prepare('SELECT a.grant_id,a.amount_cents,a.restored_cents FROM member_reward_allocations a JOIN member_reward_grants g ON g.id=a.grant_id WHERE a.order_id=? ORDER BY g.expires_at,g.created_at,g.id').bind(p.order_id).all<{grant_id:string;amount_cents:number;restored_cents:number}>()).results
    const statements=[]
    for(const a of allocations){const amount=Math.min(a.amount_cents,restore);restore-=amount;if(amount>a.restored_cents)statements.push(db.prepare("UPDATE member_reward_allocations SET restored_cents=?,status=CASE WHEN ?=amount_cents THEN 'restored' ELSE 'captured' END WHERE order_id=? AND grant_id=? AND status='captured' AND restored_cents<?").bind(amount,amount,p.order_id,a.grant_id,amount))}
    if(p.refunded_cents>=p.cash_cents)statements.push(db.prepare("UPDATE member_order_promotions SET allocation_status='restored',updated_at=? WHERE order_id=? AND allocation_status='captured'").bind(now,p.order_id))
    statements.push(db.prepare('UPDATE member_order_promotions SET refund_observed_cents=MAX(refund_observed_cents,?) WHERE order_id=?').bind(p.refunded_cents,p.order_id))
    await db.batch(statements)
  }
  // Both the order and its delivered event must be real. No reward for a free
  // exchange, a test payment, a callback alone, or a queued fulfillment.
  const delivered = (await db.prepare(`SELECT p.order_id,p.referrer_id,
      COALESCE((SELECT MIN(created_at) FROM order_events WHERE order_id=o.id AND to_status='success'),
        (SELECT MIN(finished_at) FROM recharge_redemptions WHERE order_id=o.id AND status='succeeded')) delivered_at
    FROM member_order_promotions p JOIN orders o ON o.id=p.order_id
    JOIN member_first_purchases c ON c.order_id=p.order_id
    JOIN member_profiles m ON m.id=p.referrer_id
    WHERE p.referrer_id IS NOT NULL AND p.cash_cents>0 AND p.review_status IN ('none','approved')
      AND p.allocation_status NOT IN ('released','restored') AND o.mode='live' AND o.is_test=0
      AND o.status='success' AND o.payment_status='paid' AND o.refund_hold=0 AND o.refunded_cents=0 AND m.frozen=0
      AND NOT EXISTS(SELECT 1 FROM member_reward_grants WHERE source_order_id=o.id)
      AND NOT EXISTS(SELECT 1 FROM orders old WHERE old.id<>o.id AND old.owner_store_id=p.store_id AND old.partner_id IS NULL
        AND old.mode='live' AND old.is_test=0 AND lower(old.customer_email)=lower(o.customer_email)
        AND old.payment_status='paid' AND old.refunded_cents<old.price_cents AND old.created_at<o.created_at)
      AND NOT EXISTS(SELECT 1 FROM json_each(p.risk_flags) WHERE value IN ('self_invitation','target_repeat'))
    LIMIT 100`).all<{ order_id: string; referrer_id: string; delivered_at: number | null }>()).results
  for (const p of delivered) {
    if (!p.delivered_at) continue
    await db.prepare(`INSERT INTO member_reward_grants(id,store_id,member_id,source_order_id,status,delivered_at,eligible_at,created_at)
      SELECT ?,store_id,referrer_id,order_id,'pending',?,?,? FROM member_order_promotions WHERE order_id=?
      AND EXISTS(SELECT 1 FROM orders WHERE id=? AND status='success' AND payment_status='paid' AND refund_hold=0 AND refunded_cents=0)
      ON CONFLICT(source_order_id) DO NOTHING`).bind('invite:' + p.order_id, p.delivered_at, p.delivered_at + REWARD_OBSERVATION_MS, now, p.order_id, p.order_id).run()
  }
  const pending = (await db.prepare("SELECT g.*,o.status order_status,o.refunded_cents,o.refund_hold FROM member_reward_grants g JOIN orders o ON o.id=g.source_order_id JOIN member_profiles m ON m.id=g.member_id WHERE g.status='pending' AND (o.refunded_cents>0 OR o.status IN ('failed','cancelled') OR (g.eligible_at<=? AND o.status='success' AND o.refund_hold=0 AND m.frozen=0)) ORDER BY g.eligible_at LIMIT 200").bind(now).all<{ id: string; eligible_at: number; order_status: string; refunded_cents: number; refund_hold: number }>()).results
  for (const g of pending) {
    if (g.refunded_cents || ['failed','cancelled'].includes(g.order_status)) await cancelPendingGrant(env, g.id, now)
    else if (!g.refund_hold && g.order_status === 'success' && g.eligible_at <= now) {
      await db.batch([
        db.prepare("UPDATE member_reward_grants SET status='active',expires_at=?,version=version+1 WHERE id=? AND status='pending' AND EXISTS(SELECT 1 FROM orders o WHERE o.id=source_order_id AND o.payment_status='paid' AND o.status='success' AND o.refund_hold=0 AND o.refunded_cents=0) AND EXISTS(SELECT 1 FROM member_profiles m WHERE m.id=member_id AND m.frozen=0)").bind(twoCalendarMonths(g.eligible_at), g.id),
        db.prepare("INSERT INTO member_reward_ledger SELECT 'activate:'||id,id,source_order_id,'activate',0,remaining_cents,reserved_cents,? FROM member_reward_grants WHERE id=? AND status='active' ON CONFLICT(id) DO NOTHING").bind(now, g.id),
      ])
    }
  }
  await db.batch([
    db.prepare("DELETE FROM member_first_purchases WHERE order_id IN (SELECT o.id FROM orders o JOIN member_order_promotions p ON p.order_id=o.id WHERE p.cash_cents>0 AND o.refunded_cents>=p.cash_cents AND NOT EXISTS(SELECT 1 FROM member_reward_grants g WHERE g.source_order_id=o.id AND g.status IN ('active','expired','frozen')))") ,
    db.prepare("DELETE FROM member_target_claims WHERE order_id IN (SELECT o.id FROM orders o JOIN member_order_promotions p ON p.order_id=o.id WHERE p.cash_cents>0 AND o.refunded_cents>=p.cash_cents AND NOT EXISTS(SELECT 1 FROM member_reward_grants g WHERE g.source_order_id=o.id AND g.status IN ('active','expired','frozen')))") ,
  ])
  const expired = (await db.prepare("SELECT id,version,remaining_cents-reserved_cents amount FROM member_reward_grants WHERE status IN ('active','expired') AND expires_at<=? AND (remaining_cents>reserved_cents OR status='active') LIMIT 200").bind(now).all<{ id: string; version: number; amount: number }>()).results
  for (const g of expired) await db.batch([
    db.prepare("UPDATE member_reward_grants SET status='expired',remaining_cents=reserved_cents,version=version+1 WHERE id=? AND version=? AND expires_at<=?").bind(g.id, g.version, now),
    db.prepare("INSERT INTO member_reward_ledger SELECT ?,id,NULL,'expire',?,remaining_cents,reserved_cents,? FROM member_reward_grants WHERE id=? AND version=? ON CONFLICT(id) DO NOTHING").bind('expire:' + g.id + ':' + g.version, g.amount, now, g.id, g.version + 1),
  ])
  return { checked: captures.length + delivered.length + pending.length + released.length + expired.length }
}

async function cancelPendingGrant(env: Env, id: string, at: number) {
  await env.INTEREST_DB.batch([
    env.INTEREST_DB.prepare("INSERT INTO member_reward_ledger SELECT ?,id,source_order_id,'cancelled',-remaining_cents,0,0,? FROM member_reward_grants WHERE id=? AND status='pending' ON CONFLICT(id) DO NOTHING").bind('cancelled:' + id, at, id),
    env.INTEREST_DB.prepare("UPDATE member_reward_grants SET status='cancelled',remaining_cents=0,version=version+1 WHERE id=? AND status='pending'").bind(id),
  ])
}

export async function revokeReward(env: Env, id: string, note: string, expectedVersion?: number) {
  const grant = await env.INTEREST_DB.prepare('SELECT version FROM member_reward_grants WHERE id=?').bind(id).first<{ version: number }>()
  if (!grant) throw new ApiError('未找到该奖励。', 404)
  if (expectedVersion !== undefined && grant.version !== expectedVersion) throw new ApiError('奖励已更新，请刷新后重试。', 409)
  await env.INTEREST_DB.prepare('INSERT INTO member_reward_actions(id,grant_id,expected_version,note,created_at) VALUES (?,?,?,?,?)').bind(crypto.randomUUID(),id,grant.version,note,Date.now()).run()
}
