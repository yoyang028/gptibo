import { ApiError, hash, type Env } from './platform.ts'
import { ownerShop } from './owner-shop.ts'
import { ownerStorefrontLinks } from './storefront-hosts.ts'
import { operationEvent } from './member-reconciliation.ts'

export const NOTIFICATION_RETRY_WINDOW = 23 * 3600000
type Notification = { id: string; kind: string; target_id: string; member_id: string | null; mail_body: string; status: string; attempts: number; first_attempt_at: number | null; lease_token: string | null; version: number }
const escape = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)
export async function enqueueMemberNotification(env: Env, eventKey: string, kind: string, target: string, memberId: string | null, subject: string, text: string) {
  const db = env.INTEREST_DB, id = 'mn_' + await hash(eventKey)
  if (await db.prepare('SELECT id FROM member_notifications WHERE id=?').bind(id).first()) return id
  const to = memberId ? (await db.prepare('SELECT email FROM member_s3_user WHERE id=? AND emailVerified=1').bind(memberId).first<{ email: string }>())?.email : env.ADMIN_EMAIL
  if (!to || !env.RESEND_FROM || !/^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(to)) return null
  const shop = await ownerShop(env, 'store-3'), name = (shop.brandName || shop.name).replace(/[\r\n"\\]/g, '')
  const address = env.RESEND_FROM.match(/<([^<>]+)>$/)?.[1] ?? env.RESEND_FROM
  const fallback = env.RECHARGE_NOTIFY_URL ? new URL(env.RECHARGE_NOTIFY_URL).origin : 'https://shop.example.invalid'
  const origin = ownerStorefrontLinks(env, fallback, 'store-3', '').storefront_url
  const link = memberId ? new URL('/account', origin).href : new URL('/admin?view=members', fallback).href
  const message = { from: `"${name}" <${address}>`, to: [to], subject: `${name} · ${subject}`, text: text + '\n\n查看详情：' + link,
    html: `<main style="font-family:Arial,sans-serif;line-height:1.8;max-width:560px;margin:40px auto"><h1>${escape(name)}</h1><h2>${escape(subject)}</h2><p>${escape(text).replaceAll('\n', '<br>')}</p><p><a href="${escape(link)}">查看详情</a></p></main>` }
  await db.prepare('INSERT INTO member_notifications(id,event_key,kind,target_id,member_id,mail_body,created_at) VALUES (?,?,?,?,?,?,?) ON CONFLICT(event_key) DO NOTHING')
    .bind(id, eventKey, kind, target, memberId, JSON.stringify(message), Date.now()).run()
  return id
}
export async function collectMemberNotifications(env: Env) {
  const db = env.INTEREST_DB, now = Date.now()
  const rows = (await db.prepare(`SELECT 'review:'||p.order_id event_key,'review' kind,p.order_id target_id,NULL member_id FROM member_order_promotions p JOIN orders o ON o.id=p.order_id
    WHERE p.review_status='required' AND o.status<>'cancelled' AND p.allocation_status NOT IN ('released','restored') AND NOT EXISTS(SELECT 1 FROM member_notifications n WHERE n.event_key='review:'||p.order_id) LIMIT 20`).all<{ event_key: string; kind: string; target_id: string; member_id: string | null }>()).results
  rows.push(...(await db.prepare(`SELECT 'procurement:'||o.id event_key,'procurement' kind,o.id target_id,NULL member_id FROM orders o JOIN recharge_orders r ON r.order_id=o.id
    WHERE o.owner_store_id='store-3' AND o.partner_id IS NULL AND o.mode='live' AND o.is_test=0 AND o.status='failed'
      AND NOT EXISTS(SELECT 1 FROM member_notifications n WHERE n.event_key='procurement:'||o.id) LIMIT 20`).all<(typeof rows)[number]>()).results)
  rows.push(...(await db.prepare(`SELECT 'reconciliation:'||c.order_id||':'||c.fingerprint event_key,'reconciliation' kind,c.order_id target_id,NULL member_id FROM member_order_reconciliations c
    WHERE c.state IN ('difference','error') AND NOT EXISTS(SELECT 1 FROM member_notifications n WHERE n.event_key='reconciliation:'||c.order_id||':'||c.fingerprint) LIMIT 20`).all<(typeof rows)[number]>()).results)
  rows.push(...(await db.prepare(`SELECT 'backlog:'||o.id event_key,'backlog' kind,o.id target_id,NULL member_id FROM orders o
    WHERE o.owner_store_id='store-3' AND o.partner_id IS NULL AND o.mode='live' AND o.is_test=0 AND o.status NOT IN ('success','cancelled','failed')
      AND o.created_at<? AND (o.payment_status='paid' OR EXISTS(SELECT 1 FROM member_order_promotions p WHERE p.order_id=o.id AND (p.reward_cents>0 OR p.procurement_status='awaiting_supplier')))
      AND NOT EXISTS(SELECT 1 FROM member_notifications n WHERE n.event_key='backlog:'||o.id) LIMIT 20`).bind(now - 24 * 3600000).all<(typeof rows)[number]>()).results)
  rows.push(...(await db.prepare(`SELECT 'active:'||g.id event_key,'reward_active' kind,g.id target_id,g.member_id FROM member_reward_grants g JOIN member_reward_ledger l ON l.grant_id=g.id AND l.kind='activate'
    WHERE g.status='active' AND g.expires_at>? AND l.created_at>=(SELECT enabled_since FROM member_notification_settings WHERE id=1)
      AND NOT EXISTS(SELECT 1 FROM member_notifications n WHERE n.event_key='active:'||g.id) ORDER BY l.created_at LIMIT 20`).bind(now).all<(typeof rows)[number]>()).results)
  rows.push(...(await db.prepare(`SELECT 'expiring:'||g.id event_key,'reward_expiring' kind,g.id target_id,g.member_id FROM member_reward_grants g
    WHERE g.status='active' AND g.remaining_cents>g.reserved_cents AND g.expires_at>? AND g.expires_at<=?
      AND NOT EXISTS(SELECT 1 FROM member_notifications n WHERE n.event_key='expiring:'||g.id) ORDER BY g.expires_at LIMIT 20`).bind(now, now + 3 * 86400000).all<(typeof rows)[number]>()).results)
  const titles: Record<string, string> = { review: '活动订单待审核', procurement: '采购或交付失败待核对', reconciliation: '订单对账出现差异或查询失败', backlog: '订单积压超过24小时', reward_active: '邀请奖励已生效', reward_expiring: '邀请奖励即将到期' }
  for (const r of rows) {
    let text = `订单：${r.target_id}\n请在后台核对原订单后处理。`
    if (r.member_id) {
      const g = await db.prepare('SELECT remaining_cents,reserved_cents,expires_at FROM member_reward_grants WHERE id=?').bind(r.target_id).first<{ remaining_cents: number; reserved_cents: number; expires_at: number }>()
      if (!g) continue
      text = `${r.kind === 'reward_active' ? '10元邀请奖励已结束24小时观察期。' : '你有邀请奖励将在三天内到期。'}\n该笔可用额度：¥${((g.remaining_cents - g.reserved_cents) / 100).toFixed(2)}\n有效期至：${new Date(g.expires_at).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false })}（北京时间）\n请以会员中心的实时余额和状态为准。`
    }
    await enqueueMemberNotification(env, r.event_key, r.kind, r.target_id, r.member_id, titles[r.kind], text)
  }
  return rows.length
}
async function stillRelevant(env: Env, row: Notification) {
  const db = env.INTEREST_DB
  if (row.member_id) return !!await db.prepare("SELECT 1 FROM member_reward_grants g JOIN member_profiles p ON p.id=g.member_id WHERE g.id=? AND g.status='active' AND g.expires_at>? AND g.remaining_cents>g.reserved_cents AND p.frozen=0").bind(row.target_id, Date.now()).first()
  if (row.kind === 'review') return !!await db.prepare("SELECT 1 FROM member_order_promotions p JOIN orders o ON o.id=p.order_id WHERE p.order_id=? AND p.review_status='required' AND o.status<>'cancelled' AND p.allocation_status NOT IN ('released','restored')").bind(row.target_id).first()
  if (row.kind === 'reconciliation') return !!await db.prepare("SELECT 1 FROM member_order_reconciliations WHERE order_id=? AND state IN ('difference','error')").bind(row.target_id).first()
  if (row.kind === 'ledger') return !!await db.prepare("SELECT 1 FROM member_reward_audits WHERE grant_id=? AND state='difference'").bind(row.target_id).first()
  if (row.kind === 'procurement' || row.kind === 'backlog') return !!await db.prepare("SELECT 1 FROM orders WHERE id=? AND status NOT IN ('success','cancelled')").bind(row.target_id).first()
  return true
}
export async function sendMemberNotification(env: Env, id: string) {
  if (!env.RESEND_API_KEY || !env.RESEND_FROM) return
  const db = env.INTEREST_DB, now = Date.now(), token = crypto.randomUUID()
  await db.prepare("UPDATE member_notifications SET lease_token=?,lease_until=?,status='sending',attempts=attempts+1,first_attempt_at=COALESCE(first_attempt_at,?),version=version+1 WHERE id=? AND status IN ('pending','retry','sending') AND next_attempt_at<=? AND lease_until<=? AND (first_attempt_at IS NULL OR first_attempt_at>?)")
    .bind(token, now + 60000, now, id, now, now, now - NOTIFICATION_RETRY_WINDOW).run()
  const row = await db.prepare('SELECT * FROM member_notifications WHERE id=? AND lease_token=?').bind(id, token).first<Notification>()
  if (!row) return
  const finish = async (status: string, error: string, provider: string | null = null, next = 0) => {
    await db.batch([
      db.prepare('UPDATE member_notifications SET status=?,last_error=?,provider_id=COALESCE(?,provider_id),sent_at=CASE WHEN ?=\'sent\' THEN ? ELSE sent_at END,next_attempt_at=?,lease_until=0,lease_token=NULL,version=version+1 WHERE id=? AND lease_token=?')
        .bind(status, error, provider, status, Date.now(), next, id, token),
      db.prepare("INSERT INTO member_operation_events(id,category,target_id,action,actor,note,details,created_at) SELECT ?,'notification',id,?,'system',?,?,? FROM member_notifications WHERE id=? AND version=? AND status=?")
        .bind(crypto.randomUUID(), status, error || (status === 'sent' ? '邮件服务已接收' : '通知状态更新'), JSON.stringify({ attempt: row.attempts, providerId: provider }), Date.now(), id, row.version + 1, status),
    ])
  }
  // Once a send was attempted, its immutable payload must be replayed even if
  // the event has changed: Resend may already have accepted the original send.
  if (row.attempts === 1 && !await stillRelevant(env, row)) { await finish('cancelled', '事项已处理或奖励状态已变化'); return }
  await operationEvent(env, 'notification', id, 'attempt', '开始发送原通知', { attempt: row.attempts })
  let status = 0
  try {
    const response = await fetch('https://api.resend.com/emails', { method: 'POST', redirect: 'manual', signal: AbortSignal.timeout(10000),
      headers: { Authorization: 'Bearer ' + env.RESEND_API_KEY, 'Content-Type': 'application/json', 'Idempotency-Key': id }, body: row.mail_body })
    status = response.status
    if (!response.ok) {
      if (status !== 429 && status < 500) { await finish('failed', '邮件服务拒绝请求（HTTP ' + status + '）'); return }
      throw new Error('Retryable provider response')
    }
    const data = await response.json() as { id?: unknown }
    if (typeof data.id !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(data.id)) throw new Error('Unconfirmed mail response')
    await finish('sent', '', data.id)
  } catch {
    await finish(row.attempts >= 8 ? 'unknown' : 'retry', status ? '邮件服务暂未确认（HTTP ' + status + '）' : '邮件发送结果未确认', null, now + Math.min(3600000, 60000 * 2 ** Math.min(row.attempts - 1, 6)))
  }
}
export async function retryMemberNotification(env: Env, id: string, version: number, note: string, confirm = false) {
  const db = env.INTEREST_DB, row = await db.prepare('SELECT * FROM member_notifications WHERE id=?').bind(id).first<Notification>()
  if (!row || row.version !== version || ['sent','cancelled','sending'].includes(row.status)) throw new ApiError('通知状态已变化或无需重试，请刷新。', 409)
  if (confirm && row.first_attempt_at === null) throw new ApiError('此通知尚未尝试发送，不能确认成功。', 409)
  if (!confirm && row.first_attempt_at !== null && Date.now() - row.first_attempt_at >= NOTIFICATION_RETRY_WINDOW) throw new ApiError('已超过安全重试时限，请核对 Resend 原记录后确认；不能自动重发。', 409)
  const next = confirm ? 'sent' : 'retry', event = crypto.randomUUID()
  await db.batch([
    db.prepare('UPDATE member_notifications SET status=?,next_attempt_at=0,version=version+1,sent_at=CASE WHEN ?=\'sent\' THEN ? ELSE sent_at END WHERE id=? AND version=? AND lease_until<=?').bind(next, next, Date.now(), id, version, Date.now()),
    db.prepare("INSERT INTO member_operation_events(id,category,target_id,action,actor,note,created_at) SELECT ?,'notification',id,?,?,?,? FROM member_notifications WHERE id=? AND version=? AND status=?").bind(event, confirm ? 'confirmed_sent' : 'retry_requested', env.ADMIN_USERNAME ?? 'admin', note, Date.now(), id, version + 1, next),
  ])
  if (!await db.prepare('SELECT id FROM member_operation_events WHERE id=?').bind(event).first()) throw new ApiError('通知已更新，请刷新。', 409)
}
export async function maintainMemberNotifications(env: Env) {
  if (env.MEMBERSHIP_ENABLED === undefined) return
  await collectMemberNotifications(env)
  const db = env.INTEREST_DB, now = Date.now()
  await db.prepare("UPDATE member_notifications SET status='unknown',last_error='超过安全重试时限，需核对邮件服务记录',version=version+1 WHERE status IN ('retry','sending') AND first_attempt_at<=? AND lease_until<=?").bind(now - NOTIFICATION_RETRY_WINDOW, now).run()
  const rows = (await db.prepare("SELECT id FROM member_notifications WHERE status IN ('pending','retry','sending') AND next_attempt_at<=? AND lease_until<=? ORDER BY next_attempt_at,created_at,id LIMIT 5").bind(now, now).all<{ id: string }>()).results
  for (const row of rows) await sendMemberNotification(env, row.id)
}
