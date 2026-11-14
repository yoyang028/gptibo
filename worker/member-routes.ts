import { ApiError, body, json, type Env } from './platform.ts'
import { memberStore, membershipEnabled, verifiedMember } from './member-auth.ts'
import { memberProfile, availableRewards, promotionFor, approvePromotion } from './member-promotions.ts'
import { reconcileMemberRewards, revokeReward } from './member-rewards.ts'

function pageOf(url: URL) {
  const page = Number(url.searchParams.get('page') || '1')
  if (!Number.isInteger(page) || page < 1 || page > 100000) throw new ApiError('页码无效。')
  return { page, offset: (page - 1) * 20 }
}
export async function memberRoutes(request: Request, env: Env) {
  const url = new URL(request.url)
  if (url.pathname !== '/api/member/session') throw new ApiError('未找到接口。', 404)
  if (!memberStore(request, env)) return json({ enabled: false, member: null })
  if (request.method !== 'GET') throw new ApiError('请求方式不支持。', 405)
  const member = await verifiedMember(request, env)
  if (!member) return json({ enabled: true, member: null })
  const profile = await memberProfile(env, member.id), db = env.INTEREST_DB
  const { page, offset } = pageOf(url)
  const [available, totals, rewards, ledger, invitations, notifications] = await Promise.all([
    availableRewards(env, member.id),
    db.prepare("SELECT COALESCE(SUM(amount_cents),0) earned,COALESCE(SUM(CASE WHEN status='pending' THEN remaining_cents ELSE 0 END),0) pending,COALESCE(SUM(reserved_cents),0) reserved FROM member_reward_grants WHERE member_id=?").bind(member.id).first(),
    db.prepare('SELECT id,source_order_id,amount_cents,remaining_cents,reserved_cents,status,eligible_at,expires_at,version FROM member_reward_grants WHERE member_id=? ORDER BY created_at DESC,id LIMIT 20 OFFSET ?').bind(member.id, offset).all(),
    db.prepare('SELECT l.* FROM member_reward_ledger l JOIN member_reward_grants g ON g.id=l.grant_id WHERE g.member_id=? ORDER BY l.created_at DESC,l.id LIMIT 20 OFFSET ?').bind(member.id, offset).all(),
    db.prepare("SELECT COUNT(*) total,SUM(CASE WHEN status<>'cancelled' THEN 1 ELSE 0 END) effective FROM member_reward_grants WHERE member_id=?").bind(member.id).first(),
    db.prepare("SELECT id,json_extract(mail_body,'$.subject') subject,json_extract(mail_body,'$.text') text,created_at FROM member_notifications WHERE member_id=? AND status<>'cancelled' ORDER BY created_at DESC,id LIMIT 20 OFFSET ?").bind(member.id, offset).all(),
  ])
  const used = await db.prepare("SELECT COALESCE(SUM(a.amount_cents-a.restored_cents),0) cents FROM member_reward_allocations a JOIN member_order_promotions p ON p.order_id=a.order_id WHERE p.member_id=? AND a.status='captured'").bind(member.id).first<{ cents: number }>()
  return json({ enabled: true, member: { id: member.id, email: member.email, frozen: !!profile.frozen,
    inviteUrl: new URL('/?invite=' + profile.invite_code, url.origin).href },
    balanceCents: profile.frozen ? 0 : available.reduce((s, g) => s + g.available, 0), totals, usedCents: used?.cents ?? 0,
    rewards: rewards.results, ledger: ledger.results, invitations, notifications: notifications.results, page })
}

export async function adminMemberRoutes(request: Request, env: Env, url: URL) {
  if (!membershipEnabled(env)) return json({ enabled: false })
  const db = env.INTEREST_DB
  if (request.method === 'GET' && url.pathname === '/api/admin/members') {
    const { page, offset } = pageOf(url), q = (url.searchParams.get('q') ?? '').trim().toLowerCase()
    const grantId = url.searchParams.get('grant')
    if (grantId) {
      if (grantId.length > 160) throw new ApiError('奖励编号无效。')
      const grant = await db.prepare("SELECT id,source_order_id FROM member_reward_grants WHERE id=? AND store_id='store-3'").bind(grantId).first()
      if (!grant) throw new ApiError('未找到该奖励。', 404)
      const ledger = await db.prepare('SELECT * FROM member_reward_ledger WHERE grant_id=? ORDER BY created_at DESC,id LIMIT 20 OFFSET ?').bind(grantId,offset).all()
      return json({ enabled: true, grant, ledger: ledger.results, page })
    }
    if (q.length > 254) throw new ApiError('查询内容过长。')
    const [members, orders, rewards, stats] = await Promise.all([
      db.prepare(`SELECT u.id,u.email,u.emailVerified,u.createdAt,p.invite_code,COALESCE(p.frozen,0) frozen,COALESCE(p.version,0) version,
        (SELECT COUNT(*) FROM member_reward_grants g WHERE g.member_id=u.id) invited,
        (SELECT COALESCE(SUM(remaining_cents-reserved_cents),0) FROM member_reward_grants g WHERE g.member_id=u.id AND g.status='active' AND g.expires_at>?) balance_cents
        FROM member_s3_user u LEFT JOIN member_profiles p ON p.id=u.id WHERE instr(lower(u.email),?)>0 ORDER BY u.createdAt DESC LIMIT 20 OFFSET ?`).bind(Date.now(), q, offset).all(),
      db.prepare(`SELECT p.*,o.customer_email,o.plan_name,o.status,o.payment_status,o.version order_version,
        u.email referrer_email FROM member_order_promotions p JOIN orders o ON o.id=p.order_id LEFT JOIN member_s3_user u ON u.id=p.referrer_id
        WHERE instr(lower(o.customer_email||' '||o.id),?)>0 ORDER BY CASE WHEN p.review_status='required' THEN 0 WHEN p.procurement_status='awaiting_supplier' AND o.status<>'cancelled' THEN 1 ELSE 2 END,p.created_at DESC LIMIT 20 OFFSET ?`).bind(q, offset).all(),
      db.prepare('SELECT g.*,u.email FROM member_reward_grants g JOIN member_s3_user u ON u.id=g.member_id WHERE instr(lower(u.email),?)>0 ORDER BY g.created_at DESC LIMIT 20 OFFSET ?').bind(q, offset).all(),
      db.prepare(`SELECT (SELECT COUNT(*) FROM member_s3_user) members,(SELECT COUNT(*) FROM member_order_promotions WHERE review_status='required' AND allocation_status NOT IN ('released','restored')) reviews,
        (SELECT COALESCE(SUM(amount_cents),0) FROM member_reward_grants) issued_cents,
        (SELECT COALESCE(SUM(cash_cents),0) FROM member_order_promotions p JOIN orders o ON o.id=p.order_id WHERE o.payment_status='paid') received_cents,
        (SELECT COUNT(*) FROM member_reward_grants) reward_count,(SELECT COUNT(*) FROM member_order_promotions) order_count`).first(),
    ])
    return json({ enabled: true, members: members.results, orders: orders.results, rewards: rewards.results, stats, page })
  }
  if (request.method !== 'POST' || url.pathname !== '/api/admin/members') throw new ApiError('未找到接口。', 404)
  const data = await body(request)
  if (typeof data.note !== 'string' || !data.note.trim() || data.note.length > 500) throw new ApiError('请填写审核说明（1～500字）。')
  const note = data.note.trim(), id = typeof data.id === 'string' ? data.id : ''
  if (data.action === 'approve' || data.action === 'reject') {
    const p = await promotionFor(env, id)
    if (!p || p.updated_at !== data.updatedAt) throw new ApiError('订单已更新，请刷新后再审核。', 409)
    if (data.action === 'approve') await approvePromotion(env, p, note)
    else await db.prepare("INSERT INTO member_review_actions(id,order_id,expected_updated_at,decision,note,created_at) VALUES (?,?,?,'rejected',?,?)").bind(crypto.randomUUID(), id, p.updated_at, note, Date.now()).run()
  } else if (data.action === 'revoke') {
    const g = await db.prepare('SELECT version FROM member_reward_grants WHERE id=?').bind(id).first<{ version: number }>()
    if (!g || g.version !== data.version) throw new ApiError('奖励已更新，请刷新后重试。', 409)
    await revokeReward(env, id, note, g.version)
  } else if (data.action === 'freeze' || data.action === 'unfreeze') {
    await memberProfile(env,id)
    const frozen = data.action === 'freeze' ? 1 : 0, claim = crypto.randomUUID()
    await db.batch([
      db.prepare('UPDATE member_profiles SET frozen=?,version=version+1 WHERE id=? AND version=?').bind(frozen, id, Number(data.version)),
      db.prepare("INSERT INTO admin_audit(id,action,target_id,note,created_at) SELECT ?,'member-freeze',id,?,? FROM member_profiles WHERE id=? AND version=? AND frozen=?").bind(claim, note, Date.now(), id, Number(data.version) + 1, frozen),
    ])
    if (!await db.prepare('SELECT id FROM admin_audit WHERE id=?').bind(claim).first()) throw new ApiError('会员状态已变化，请刷新后重试。', 409)
  } else throw new ApiError('操作无效。')
  return json({ ok: true })
}

export async function rewardMaintenance(env: Env) {
  // Run independently of supplier polling; a supplier outage must not skip it.
  return reconcileMemberRewards(env).catch(() => { console.error('Member reward reconciliation requires retry'); return { checked: 0 } })
}
