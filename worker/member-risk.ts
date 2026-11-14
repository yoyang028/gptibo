import { ApiError, hash, type Env, type Statement } from './platform.ts'
import { identityKey } from './member-identity.ts'
import { enqueueMemberNotification } from './member-notifications.ts'
import { RISK_LABELS, RISK_WINDOW_MS, riskFlags, type RiskMetrics } from '../shared/member-risk.ts'
export { riskFlags } from '../shared/member-risk.ts'
export async function riskIpKey(env: Env, ip: string | null) {
  if (!ip || ip.length > 64 || !/^[0-9a-fA-F:.]+$/.test(ip)) return null
  return identityKey(env, 'risk-ip:' + Math.floor(Date.now() / RISK_WINDOW_MS), ip)
}
export async function riskMetrics(env: Env, context: { memberId?: string | null; customerKey?: string | null; browserKey?: string | null }, ipKey?: string | null): Promise<RiskMetrics> {
  const now = Date.now()
  const result = await env.INTEREST_DB.prepare(`SELECT COUNT(*) totalOrders,
    COALESCE(SUM(CASE WHEN o.payment_status='unpaid' AND o.status='pending' THEN 1 ELSE 0 END),0) unpaidOrders,
    COALESCE(SUM(CASE WHEN COALESCE(p.reward_cents,0)+COALESCE(p.newcomer_cents,0)+COALESCE(p.other_cents,c.discount_cents,0)>0
      AND (p.allocation_status='released' OR (p.order_id IS NULL AND o.status='cancelled')) AND o.payment_status='unpaid' THEN 1 ELSE 0 END),0) repeatedReservations,
    COALESCE(SUM(CASE WHEN COALESCE(p.reward_cents,0)+COALESCE(p.newcomer_cents,0)+COALESCE(p.other_cents,c.discount_cents,0)>0
      AND (p.allocation_status='reserved' OR p.order_id IS NULL) AND o.payment_status='unpaid' AND o.status='pending' THEN 1 ELSE 0 END),0) activeReservations
    FROM orders o LEFT JOIN member_order_promotions p ON p.order_id=o.id LEFT JOIN member_order_signals s ON s.order_id=o.id LEFT JOIN shop_coupon_uses c ON c.order_id=o.id
    WHERE o.owner_store_id='store-3' AND o.partner_id IS NULL AND o.mode='live' AND o.is_test=0
      AND o.plan IN ('plus','pro-5x','pro-20x','pro-25x') AND o.created_at>?
      AND (p.member_id=? OR s.member_id=? OR p.customer_key=? OR s.customer_key=? OR o.owner_hash=?)`)
    .bind(now - RISK_WINDOW_MS, context.memberId ?? '', context.memberId ?? '', context.customerKey ?? '', context.customerKey ?? '', context.browserKey ?? '').first<Omit<RiskMetrics, 'ipOrders'>>()
  const ip = ipKey ? await env.INTEREST_DB.prepare('SELECT COUNT(*) n FROM member_order_signals WHERE ip_key=? AND created_at>?').bind(ipKey, now - 3600000).first<{ n: number }>() : null
  return { totalOrders: result?.totalOrders ?? 0, unpaidOrders: result?.unpaidOrders ?? 0, repeatedReservations: result?.repeatedReservations ?? 0, activeReservations: result?.activeReservations ?? 0, ipOrders: ip?.n ?? 0 }
}
export async function riskSignalStatements(request: Request, env: Env, id: string, email: string, memberId: string | null): Promise<Statement[]> {
  const db = env.INTEREST_DB, key = await identityKey(env, 'email', email), ip = await riskIpKey(env, request.headers.get('CF-Connecting-IP'))
  const statements = [db.prepare(`INSERT INTO member_order_signals(order_id,customer_key,member_id,ip_key,created_at)
    SELECT id,?,?,?,created_at FROM orders WHERE id=? AND owner_store_id='store-3' AND partner_id IS NULL AND mode='live' AND is_test=0
      AND plan IN ('plus','pro-5x','pro-20x','pro-25x') ON CONFLICT(order_id) DO NOTHING`).bind(key, memberId, ip, id)]
  for (const [kind, expression] of [['member','s.member_id'],['customer','s.customer_key'],['browser','o.owner_hash']] as const) {
    statements.push(db.prepare(`INSERT INTO member_risk_subjects(kind,subject_key,latest_order_id,last_order_at)
      SELECT ?,${expression},o.id,o.created_at FROM orders o JOIN member_order_signals s ON s.order_id=o.id WHERE o.id=? AND ${expression} IS NOT NULL
      ON CONFLICT(kind,subject_key) DO UPDATE SET latest_order_id=excluded.latest_order_id,last_order_at=excluded.last_order_at
        WHERE member_risk_subjects.last_order_at<=excluded.last_order_at`).bind(kind, id))
  }
  return statements
}
export async function scanMemberRisks(env: Env, limit = 3) {
  if (env.MEMBERSHIP_ENABLED === undefined) return { checked: 0 }
  const db = env.INTEREST_DB, now = Date.now()
  const subjects = (await db.prepare(`SELECT s.* FROM member_risk_subjects s WHERE s.checked_at<? AND (s.last_order_at>? OR EXISTS(
    SELECT 1 FROM member_risk_cases c WHERE c.kind=s.kind AND c.subject_key=s.subject_key AND c.status<>'resolved'))
    ORDER BY s.checked_at,s.last_order_at DESC,s.kind,s.subject_key LIMIT ?`).bind(now - 60000, now - RISK_WINDOW_MS, Math.max(1, Math.min(3, limit))).all<{ kind: 'member' | 'customer' | 'browser'; subject_key: string; latest_order_id: string }>()).results
  for (const subject of subjects) {
    const context = subject.kind === 'member' ? { memberId: subject.subject_key } : subject.kind === 'customer' ? { customerKey: subject.subject_key } : { browserKey: subject.subject_key }
    const signal = await db.prepare('SELECT ip_key FROM member_order_signals WHERE order_id=?').bind(subject.latest_order_id).first<{ ip_key: string | null }>()
    const metrics = await riskMetrics(env, context, signal?.ip_key), flags = riskFlags(metrics), id = 'risk_' + await hash(subject.kind + ':' + subject.subject_key)
    const existing = await db.prepare('SELECT fingerprint,status,episode,version FROM member_risk_cases WHERE id=?').bind(id).first<{ fingerprint: string; status: string; episode: number; version: number }>()
    if (flags.length) {
      const fingerprint = await hash(JSON.stringify({ flags, metrics }))
      await db.prepare(`INSERT INTO member_risk_cases(id,kind,subject_key,latest_order_id,flags,metrics,fingerprint,status,first_seen_at,updated_at)
        VALUES (?,?,?,?,?,?,?,'open',?,?) ON CONFLICT(id) DO UPDATE SET latest_order_id=excluded.latest_order_id,flags=excluded.flags,metrics=excluded.metrics,fingerprint=excluded.fingerprint,
        status=CASE WHEN member_risk_cases.status='resolved' OR member_risk_cases.flags<>excluded.flags THEN 'open' ELSE member_risk_cases.status END,
        episode=member_risk_cases.episode+CASE WHEN member_risk_cases.status='resolved' THEN 1 ELSE 0 END,version=member_risk_cases.version+1,updated_at=excluded.updated_at
        WHERE member_risk_cases.fingerprint<>excluded.fingerprint OR member_risk_cases.status='resolved'`)
        .bind(id, subject.kind, subject.subject_key, subject.latest_order_id, JSON.stringify(flags), JSON.stringify(metrics), fingerprint, now, now).run()
      const saved = await db.prepare('SELECT episode,version,fingerprint FROM member_risk_cases WHERE id=?').bind(id).first<{ episode: number; version: number; fingerprint: string }>()
      if (saved && saved.fingerprint === fingerprint) {
        if (existing?.fingerprint !== fingerprint || existing.status === 'resolved') await db.prepare("INSERT INTO member_operation_events(id,category,target_id,action,actor,note,details,created_at) VALUES (?,'risk',?,'detected','system','检测到近期订单异常记录',?,?) ON CONFLICT(id) DO NOTHING")
          .bind('risk:' + id + ':' + saved.version, id, JSON.stringify({ flags, metrics }), now).run()
        const notificationKey = 'risk:' + id + ':' + saved.episode + ':' + await hash(flags.join(','))
        await enqueueMemberNotification(env, notificationKey, 'risk', id, null, '会员活动出现异常订单记录', `关联订单：${subject.latest_order_id}\n提示：${flags.map(f => RISK_LABELS[f]).join('、')}\n请核对原订单和处理记录。IP仅作辅助，不自动封禁账号、释放占用或创建采购。`)
      }
    } else if (existing && existing.status !== 'resolved') {
      await db.batch([
        db.prepare("UPDATE member_risk_cases SET status='resolved',flags='[]',metrics=?,version=version+1,updated_at=? WHERE id=? AND version=?").bind(JSON.stringify(metrics), now, id, existing.version),
        db.prepare("INSERT INTO member_operation_events(id,category,target_id,action,actor,note,details,created_at) SELECT ?,'risk',id,'resolved','system','近期异常指标已消退，历史记录保留',?,? FROM member_risk_cases WHERE id=? AND version=? AND status='resolved'").bind(crypto.randomUUID(), JSON.stringify(metrics), now, id, existing.version + 1),
      ])
    }
    await db.prepare('UPDATE member_risk_subjects SET checked_at=? WHERE kind=? AND subject_key=?').bind(now, subject.kind, subject.subject_key).run()
  }
  // IP is only a rotating, keyed auxiliary signal; discard it after 24 hours.
  await db.prepare('UPDATE member_order_signals SET ip_key=NULL WHERE created_at<? AND ip_key IS NOT NULL').bind(now - RISK_WINDOW_MS).run()
  return { checked: subjects.length }
}
export async function acknowledgeRisk(env: Env, id: string, version: number, note: string) {
  const db = env.INTEREST_DB, event = crypto.randomUUID(), now = Date.now()
  await db.batch([
    db.prepare("UPDATE member_risk_cases SET status='acknowledged',version=version+1,updated_at=?,last_action_id=? WHERE id=? AND version=? AND status<>'resolved'").bind(now, event, id, version),
    db.prepare("INSERT INTO member_operation_events(id,category,target_id,action,actor,note,created_at) SELECT ?,'risk',id,'acknowledged',?,?,? FROM member_risk_cases WHERE id=? AND version=? AND status='acknowledged' AND last_action_id=?").bind(event, env.ADMIN_USERNAME ?? 'admin', note, now, id, version + 1, event),
  ])
  if (!await db.prepare('SELECT id FROM member_operation_events WHERE id=?').bind(event).first()) throw new ApiError('风险记录已变化，请刷新后再处理。', 409)
}
