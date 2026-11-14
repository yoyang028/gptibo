import { ApiError, json, type Env } from './platform.ts'

function boundary(value: string | null, end: boolean) {
  if (!value) return end ? Date.now() + 1 : 0
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new ApiError('日期格式应为 YYYY-MM-DD。')
  const at = Date.parse(value + 'T00:00:00+08:00')
  if (!Number.isFinite(at) || new Date(at + 8 * 3600000).toISOString().slice(0, 10) !== value) throw new ApiError('日期无效。')
  return at + (end ? 86400000 : 0)
}
export async function memberStatistics(env: Env, url: URL) {
  const db = env.INTEREST_DB, page = Number(url.searchParams.get('page') || 1), q = (url.searchParams.get('q') ?? '').trim().toLowerCase()
  const since = boundary(url.searchParams.get('from'), false), until = boundary(url.searchParams.get('to'), true)
  if (!Number.isInteger(page) || page < 1 || page > 100000 || q.length > 254 || since >= until) throw new ApiError('查询范围无效。')
  const cte = `WITH cohort AS (
    SELECT p.*,o.payment_status,o.refunded_cents,
      CASE WHEN o.status='success' OR EXISTS(SELECT 1 FROM order_events e WHERE e.order_id=o.id AND e.to_status='success') THEN 1 ELSE 0 END delivered
    FROM member_order_promotions p JOIN orders o ON o.id=p.order_id WHERE p.referrer_id IS NOT NULL
      AND p.store_id='store-3' AND o.owner_store_id='store-3' AND o.partner_id IS NULL AND o.is_test=0 AND o.mode='live'
      AND p.created_at>=? AND p.created_at<?
  ), order_stats AS (
    SELECT referrer_id,COUNT(*) orders,COUNT(DISTINCT customer_key) buyers,
      SUM(CASE WHEN payment_status='paid' AND cash_cents>0 THEN 1 ELSE 0 END) paid_orders,
      COUNT(DISTINCT CASE WHEN payment_status='paid' AND cash_cents>0 THEN customer_key END) paid_buyers,
      SUM(CASE WHEN payment_status='paid' THEN cash_cents ELSE 0 END) paid_cents,
      SUM(CASE WHEN payment_status='paid' THEN MIN(refunded_cents,cash_cents) ELSE 0 END) refunded_cents,
      SUM(CASE WHEN refunded_cents>0 THEN 1 ELSE 0 END) refunded_orders,
      SUM(delivered) delivered_orders,
      COUNT(DISTINCT CASE WHEN delivered=1 AND payment_status='paid' AND cash_cents>refunded_cents THEN customer_key END) converted_buyers
      FROM cohort GROUP BY referrer_id
  ), grant_stats AS (
    SELECT g.member_id,COUNT(*) rewards,SUM(g.amount_cents) issued_cents,
      SUM(CASE WHEN g.status='pending' THEN g.remaining_cents ELSE 0 END) pending_cents,
      SUM(CASE WHEN g.status='active' AND g.expires_at>? THEN g.remaining_cents-g.reserved_cents ELSE 0 END) available_cents,
      SUM(g.reserved_cents) reserved_cents
    FROM member_reward_grants g JOIN cohort c ON c.order_id=g.source_order_id GROUP BY g.member_id
  ), usage_stats AS (
    SELECT g.member_id,SUM(CASE WHEN a.status='captured' THEN a.amount_cents-a.restored_cents ELSE 0 END) used_cents,
      SUM(a.restored_cents) restored_cents FROM member_reward_allocations a JOIN member_reward_grants g ON g.id=a.grant_id
      JOIN cohort c ON c.order_id=g.source_order_id GROUP BY g.member_id
  ), report AS (
    SELECT p.id,u.email,p.invite_code,COALESCE(o.orders,0) orders,COALESCE(o.buyers,0) buyers,
      COALESCE(o.paid_orders,0) paid_orders,COALESCE(o.paid_buyers,0) paid_buyers,COALESCE(o.paid_cents,0) paid_cents,
      COALESCE(o.refunded_cents,0) refunded_cents,COALESCE(o.refunded_orders,0) refunded_orders,
      COALESCE(o.delivered_orders,0) delivered_orders,COALESCE(o.converted_buyers,0) converted_buyers,
      COALESCE(g.rewards,0) rewards,COALESCE(g.issued_cents,0) issued_cents,COALESCE(g.pending_cents,0) pending_cents,
      COALESCE(g.available_cents,0) available_cents,COALESCE(g.reserved_cents,0) reserved_cents,
      COALESCE(a.used_cents,0) used_cents,COALESCE(a.restored_cents,0) restored_cents
    FROM member_profiles p JOIN member_s3_user u ON u.id=p.id LEFT JOIN order_stats o ON o.referrer_id=p.id
      LEFT JOIN grant_stats g ON g.member_id=p.id LEFT JOIN usage_stats a ON a.member_id=p.id
    WHERE p.store_id='store-3' AND instr(lower(u.email),?)>0
  ) `
  const parameters = [since, until, Date.now(), q]
  const [rows, totals] = await Promise.all([
    db.prepare(cte + 'SELECT * FROM report ORDER BY converted_buyers DESC,paid_cents DESC,id LIMIT 20 OFFSET ?').bind(...parameters, (page - 1) * 20).all(),
    db.prepare(cte + 'SELECT COUNT(*) inviters,COALESCE(SUM(orders),0) orders,COALESCE(SUM(paid_cents),0) paid_cents,COALESCE(SUM(refunded_cents),0) refunded_cents,COALESCE(SUM(delivered_orders),0) delivered_orders,COALESCE(SUM(used_cents),0) used_cents FROM report').bind(...parameters).first(),
  ])
  return json({ rows: rows.results, totals, page, since, until, generatedAt: Date.now() })
}
