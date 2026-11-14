import { ApiError, hash, type Env } from './platform.ts'
import { twoCalendarMonths } from '../shared/member-promotions.ts'
import { enqueueMemberNotification } from './member-notifications.ts'

type Grant = { id: string; member_id: string; amount_cents: number; remaining_cents: number; reserved_cents: number; status: string; eligible_at: number; delivered_at: number; expires_at: number | null; version: number; source_valid: number }
type Ledger = { id: string; sequence: number | null; kind: string; order_id: string | null; amount_cents: number; remaining_after: number; reserved_after: number }
type Allocation = { order_id: string; amount_cents: number; restored_cents: number; status: string }
function verify(g: Grant, ledger: Ledger[], allocations: Allocation[]) {
  const differences = new Set<string>(), now = Date.now()
  let remaining = 0, reserved = 0, issued = 0, captured = 0, released = 0, restored = 0, expired = 0, cancelled = 0, grants = 0, activated = 0
  const perOrder = new Map<string, { reserve: number; captured: number; released: number; restored: number }>()
  for (const l of ledger) {
    if (l.sequence === null) differences.add('missing_sequence')
    if (l.kind === 'grant') { remaining += l.amount_cents; issued += l.amount_cents; grants++ }
    else if (l.kind === 'reserve') reserved += l.amount_cents
    else if (l.kind === 'captured') { remaining -= l.amount_cents; reserved -= l.amount_cents; captured += l.amount_cents }
    else if (l.kind === 'released') { reserved -= l.amount_cents; released += l.amount_cents }
    else if (l.kind === 'restored') { remaining += l.amount_cents; restored += l.amount_cents }
    else if (l.kind === 'expire') { remaining -= l.amount_cents; expired += l.amount_cents }
    else if (l.kind === 'cancelled') { remaining += l.amount_cents; cancelled -= l.amount_cents }
    else if (l.kind === 'activate') activated++
    else if (l.kind !== 'frozen') differences.add('unknown_event')
    if (l.kind === 'cancelled' ? l.amount_cents > 0 : l.amount_cents < 0) differences.add('invalid_event_amount')
    if (['activate','frozen'].includes(l.kind) && l.amount_cents !== 0) differences.add('invalid_event_amount')
    if (remaining !== l.remaining_after || reserved !== l.reserved_after || reserved < 0 || remaining < reserved || remaining > g.amount_cents) differences.add('ledger_snapshot')
    if (l.order_id && ['reserve','captured','released','restored'].includes(l.kind)) {
      const totals = perOrder.get(l.order_id) ?? { reserve: 0, captured: 0, released: 0, restored: 0 }
      totals[l.kind as keyof typeof totals] += l.amount_cents; perOrder.set(l.order_id, totals)
    }
  }
  if (grants !== 1 || issued !== g.amount_cents || g.amount_cents !== 1000) differences.add('issued_amount')
  if (activated > 1 || (['active','expired','frozen'].includes(g.status) && activated !== 1) || (g.status === 'pending' && activated)) differences.add('activation_history')
  if (remaining !== g.remaining_cents) differences.add('remaining_balance')
  if (reserved !== g.reserved_cents) differences.add('reservation_balance')
  let allocatedReserved = 0, allocatedUsed = 0, allocatedRestored = 0
  for (const a of allocations) {
    const l = perOrder.get(a.order_id)
    if (!l || l.reserve !== a.amount_cents || l.captured !== (['captured','restored'].includes(a.status) ? a.amount_cents : 0) || l.released !== (a.status === 'released' ? a.amount_cents : 0) || l.restored !== a.restored_cents) differences.add('allocation_history')
    if (a.status === 'reserved') allocatedReserved += a.amount_cents
    if (a.status === 'captured') allocatedUsed += a.amount_cents - a.restored_cents
    allocatedRestored += a.restored_cents
    perOrder.delete(a.order_id)
  }
  if (perOrder.size || allocatedReserved !== g.reserved_cents || allocatedUsed !== captured - restored || allocatedRestored !== restored) differences.add('allocation_balance')
  if (!g.source_valid || g.eligible_at !== g.delivered_at + 86400000) differences.add('reward_source')
  if (g.expires_at !== null && g.expires_at !== twoCalendarMonths(g.eligible_at)) differences.add('expiry_clock')
  if (['active','expired','frozen'].includes(g.status) && g.expires_at === null) differences.add('expiry_clock')
  if (g.expires_at !== null && g.expires_at < now - 300000 && (g.status === 'active' || (g.status === 'expired' && g.remaining_cents > g.reserved_cents))) differences.add('expiry_overdue')
  return { differences: [...differences], snapshot: { remainingCents: g.remaining_cents, reservedCents: g.reserved_cents, calculatedRemainingCents: remaining, calculatedReservedCents: reserved,
    issuedCents: issued, capturedCents: captured, releasedCents: released, restoredCents: restored, expiredCents: expired, cancelledCents: cancelled,
    netUsedCents: captured - restored, entries: ledger.length, grantVersion: g.version, latestSequence: ledger.at(-1)?.sequence ?? null } }
}
export async function auditReward(env: Env, id: string, actor = 'system') {
  const db = env.INTEREST_DB, now = Date.now(), token = crypto.randomUUID()
  const exists = await db.prepare("SELECT id FROM member_reward_grants WHERE id=? AND store_id='store-3'").bind(id).first()
  if (!exists) throw new ApiError('未找到奖励。', 404)
  await db.prepare('INSERT INTO member_reward_audits(grant_id) VALUES (?) ON CONFLICT(grant_id) DO NOTHING').bind(id).run()
  await db.prepare('UPDATE member_reward_audits SET lease_token=?,lease_until=? WHERE grant_id=? AND lease_until<=?').bind(token, now + 60000, id, now).run()
  const claim = await db.prepare('SELECT fingerprint FROM member_reward_audits WHERE grant_id=? AND lease_token=?').bind(id, token).first<{ fingerprint: string }>()
  if (!claim) throw new ApiError('奖励正在核对，请稍后刷新。', 409)
  try {
    const results = await db.batch([
      db.prepare(`SELECT g.*,CASE WHEN p.referrer_id=g.member_id AND p.cash_cents>0 AND p.store_id=g.store_id THEN 1 ELSE 0 END source_valid
        FROM member_reward_grants g JOIN member_order_promotions p ON p.order_id=g.source_order_id WHERE g.id=?`).bind(id),
      db.prepare('SELECT l.*,s.sequence FROM member_reward_ledger l LEFT JOIN member_ledger_sequence s ON s.ledger_id=l.id WHERE l.grant_id=? ORDER BY COALESCE(s.sequence,0),l.rowid LIMIT 20001').bind(id),
      db.prepare('SELECT order_id,amount_cents,restored_cents,status FROM member_reward_allocations WHERE grant_id=?').bind(id),
    ]) as [{ results: Grant[] }, { results: Ledger[] }, { results: Allocation[] }]
    const g = results[0].results[0]
    if (!g) throw new ApiError('奖励来源需要人工核对。', 409)
    const result = verify(g, results[1].results, results[2].results)
    if (results[1].results.length > 20000) result.differences.push('audit_incomplete')
    const state = result.differences.length ? 'difference' : 'matched', fingerprint = await hash(JSON.stringify({ state, ...result }))
    const statements = [db.prepare('UPDATE member_reward_audits SET state=?,differences=?,snapshot=?,fingerprint=?,grant_version=?,checked_at=?,version=version+1 WHERE grant_id=? AND lease_token=? AND EXISTS(SELECT 1 FROM member_reward_grants WHERE id=? AND version=?)')
      .bind(state, JSON.stringify(result.differences), JSON.stringify(result.snapshot), fingerprint, g.version, now, id, token, id, g.version)]
    if (claim.fingerprint !== fingerprint || actor !== 'system') statements.push(db.prepare("INSERT INTO member_operation_events(id,category,target_id,action,actor,note,details,created_at) SELECT ?,'ledger',grant_id,'check',?,'按原始流水复算奖励余额与占用',?,? FROM member_reward_audits WHERE grant_id=? AND lease_token=? AND fingerprint=?")
      .bind(crypto.randomUUID(), actor, JSON.stringify(result), now, id, token, fingerprint))
    await db.batch(statements)
    const saved = await db.prepare('SELECT fingerprint,grant_version FROM member_reward_audits WHERE grant_id=?').bind(id).first<{ fingerprint: string; grant_version: number }>()
    const current = await db.prepare('SELECT version FROM member_reward_grants WHERE id=?').bind(id).first<{ version: number }>()
    if (saved?.fingerprint !== fingerprint || saved.grant_version !== g.version || current?.version !== g.version) throw new ApiError('奖励在核对期间已变化，请重试。', 409)
    if (state === 'difference') await enqueueMemberNotification(env, 'ledger:' + id + ':' + fingerprint, 'ledger', id, null, '奖励账本核对发现差异', `奖励编号：${id}\n差异：${result.differences.join('、')}\n原始流水和余额未被修改，请在运营中心核查。`)
    return { state, ...result }
  } finally { await db.prepare('UPDATE member_reward_audits SET lease_token=NULL,lease_until=0 WHERE grant_id=? AND lease_token=?').bind(id, token).run() }
}
export async function scanRewardAudits(env: Env, limit = 3) {
  if (env.MEMBERSHIP_ENABLED === undefined) return { checked: 0 }
  const rows = (await env.INTEREST_DB.prepare(`SELECT g.id FROM member_reward_grants g LEFT JOIN member_reward_audits a ON a.grant_id=g.id
    WHERE COALESCE(a.lease_until,0)<=? AND (COALESCE(a.checked_at,0)<? OR COALESCE(a.grant_version,-1)<>g.version)
    ORDER BY COALESCE(a.checked_at,0),g.id LIMIT ?`).bind(Date.now(), Date.now() - 3600000, Math.max(1, Math.min(3, limit))).all<{ id: string }>()).results
  for (const g of rows) await auditReward(env, g.id).catch(() => console.error('Reward audit requires retry'))
  return { checked: rows.length }
}
