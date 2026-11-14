import { useState } from 'react'
import { useResource } from '@/lib/use-resource'
import { api, errorMessage } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Feedback } from '@/components/workspace-loading'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { Pager } from './MemberOperations'
import { RewardLedger } from './MembersPage'
import { money, at } from './member-operation-format'

const differences: Record<string, string> = { missing_sequence: '原始流水顺序缺失', unknown_event: '存在未知流水事项', invalid_event_amount: '流水金额符号不符', ledger_snapshot: '流水逐笔余额不符', issued_amount: '发放金额或次数不符', activation_history: '生效记录不符', remaining_balance: '账面余额与流水不符', reservation_balance: '占用与流水不符', allocation_history: '订单分配与流水不符', allocation_balance: '分配合计不符', reward_source: '奖励来源或观察期不符', expiry_clock: '有效期与两个月规则不符', expiry_overdue: '到期待处理', audit_incomplete: '流水量较大，需人工完整核查' }
type Snapshot = { remainingCents: number; reservedCents: number; calculatedRemainingCents: number; calculatedReservedCents: number; issuedCents: number; capturedCents: number; releasedCents: number; restoredCents: number; expiredCents: number; cancelledCents: number; entries: number }
type Row = { id: string; email: string; remaining_cents: number; reserved_cents: number; grant_version: number; checked_version: number | null; state: string | null; differences: string | null; snapshot: string | null; checked_at: number | null }
function AuditSummary({ value }: { value: string | null }) {
  if (!value) return <p>尚未复算。</p>
  const s = JSON.parse(value) as Snapshot
  return <><p>已复算 {s.entries} 条原始流水。快照账面余额／占用：{money(s.remainingCents)}／{money(s.reservedCents)}；流水复算：{money(s.calculatedRemainingCents)}／{money(s.calculatedReservedCents)}。</p><p>发放 {money(s.issuedCents)} · 核销 {money(s.capturedCents)} · 释放 {money(s.releasedCents)} · 恢复 {money(s.restoredCents)} · 到期 {money(s.expiredCents)} · 撤销 {money(s.cancelledCents)}</p></>
}
export default function MemberLedgerAuditPage({ revision }: { revision: number }) {
  const [page, setPage] = useState(1), [refresh, setRefresh] = useState(0), [selected, setSelected] = useState<Row | null>(null), [busy, setBusy] = useState(false), [message, setMessage] = useState('')
  const { data, error, loading } = useResource<{ rows: Row[] }>(`/api/admin/member-ops/ledger?page=${page}`, revision + refresh)
  async function check(id?: string) {
    if (busy) return
    setBusy(true); setMessage('')
    try { await api('/api/admin/member-ops/ledger', { action: id ? 'check' : 'scan', id }); setRefresh(v => v + 1); setMessage('账本核对已完成。存在差异时会加入管理员通知队列，原始流水与余额保留。') }
    catch (e) { setMessage(errorMessage(e)) } finally { setBusy(false) }
  }
  return <section className="admin-panel member-operations-panel"><h2>奖励账本核对</h2><p>复算发放、占用、核销、恢复、到期与撤销，核对奖励余额和订单分配。定时任务持续巡检；检测到差异时告警，原始流水保持不变。</p><div className="admin-filters"><Button disabled={busy} onClick={() => void check()}>核对一批奖励</Button></div>{message && <p role="status">{message}</p>}<Feedback error={error} loading={loading} data={data} />
    {data && <><div className="admin-table-scroll"><table className="admin-table"><thead><tr><th>会员／奖励</th><th>核对状态</th><th>当前余额／占用</th><th>最近核对</th><th>操作</th></tr></thead><tbody>{data.rows.map(r => <tr key={r.id}><td>{r.email}<small>{r.id}</small></td><td>{r.checked_version !== r.grant_version ? '有新变化，等待复核' : r.state === 'matched' ? '一致' : r.state === 'difference' ? '有差异' : '待核对'}<small>{(JSON.parse(r.differences || '[]') as string[]).map(d => differences[d] ?? d).join('、')}</small></td><td>{money(r.remaining_cents)}／{money(r.reserved_cents)}</td><td>{at(r.checked_at ?? 0)}</td><td><Button variant="outline" disabled={busy} onClick={() => void check(r.id)}>复算</Button><Button variant="outline" onClick={() => setSelected(r)}>核对明细</Button></td></tr>)}</tbody></table></div>{!data.rows.length && <p className="admin-empty">暂无奖励可核对。</p>}<Pager page={page} size={data.rows.length} change={setPage} /></>}
    <Dialog open={!!selected} onOpenChange={v => { if (!v) setSelected(null) }}><DialogContent style={{ maxWidth: 'min(1000px, calc(100vw - 2rem))', maxHeight: '85dvh', overflowY: 'auto' }}><DialogHeader><DialogTitle>账本核对明细</DialogTitle><DialogDescription>{selected?.id} · 原始流水保留，不直接改写余额。</DialogDescription></DialogHeader>{selected && <><AuditSummary value={selected.snapshot} /><RewardLedger key={selected.id} id={selected.id} /></>}</DialogContent></Dialog>
  </section>
}
