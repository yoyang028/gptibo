import { ApiError, body, json, type Env } from './platform.ts'
import { getOrder } from './order-state.ts'
import { assertPilotOrder, operationEvent, reconcilePilotOrder, scanPilotOrders, syncPilotOrder } from './member-reconciliation.ts'

export function operationPage(url: URL) {
  const page = Number(url.searchParams.get('page') || 1)
  if (!Number.isInteger(page) || page < 1 || page > 100000) throw new ApiError('页码无效。')
  return { page, offset: (page - 1) * 20 }
}
export function operationNote(data: Record<string, unknown>) {
  if (typeof data.note !== 'string' || !data.note.trim() || data.note.length > 500) throw new ApiError('请填写 1～500 字处理说明。')
  return data.note.trim()
}
export async function memberOperations(request: Request, env: Env, url: URL) {
  if (env.MEMBERSHIP_ENABLED === undefined) throw new ApiError('会员运营尚未启用。', 409)
  const db = env.INTEREST_DB, { page, offset } = operationPage(url)
  if (url.pathname !== '/api/admin/member-ops/reconciliation') throw new ApiError('未找到接口。', 404)
  if (request.method === 'GET') {
    const id = url.searchParams.get('id')
    if (id) {
      assertPilotOrder(await getOrder(env, id))
      return json({ history: (await db.prepare("SELECT * FROM member_operation_events WHERE category='reconciliation' AND target_id=? ORDER BY created_at DESC,id LIMIT 20 OFFSET ?").bind(id, offset).all()).results, page })
    }
    const state = url.searchParams.get('state') || 'issues'
    if (!['issues','all','matched','expected','difference','error'].includes(state)) throw new ApiError('筛选无效。')
    const where = state === 'issues' ? "state IN ('difference','error')" : state === 'all' ? '1=1' : 'state=?'
    const rows = await db.prepare(`SELECT * FROM member_order_reconciliations WHERE ${where} ORDER BY checked_at DESC,order_id LIMIT 20 OFFSET ?`).bind(...(state === 'all' || state === 'issues' ? [] : [state]), offset).all()
    const counts = await db.prepare('SELECT state,COUNT(*) count FROM member_order_reconciliations GROUP BY state').all()
    return json({ rows: rows.results, counts: counts.results, page })
  }
  if (request.method !== 'POST') throw new ApiError('请求方式不支持。', 405)
  const data = await body(request)
  if (data.action === 'scan') return json(await scanPilotOrders(env))
  if (typeof data.id !== 'string' || data.id.length > 100) throw new ApiError('订单号无效。')
  assertPilotOrder(await getOrder(env, data.id))
  if (data.action === 'check') return json(await reconcilePilotOrder(env, data.id, env.ADMIN_USERNAME ?? 'admin'))
  if (data.action === 'sync') return json(await syncPilotOrder(env, data.id, operationNote(data)))
  if (data.action === 'note') { await operationEvent(env, 'reconciliation', data.id, 'note', operationNote(data), {}, env.ADMIN_USERNAME ?? 'admin'); return json({ ok: true }) }
  throw new ApiError('操作无效。')
}
