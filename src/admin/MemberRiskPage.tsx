import { useState } from 'react'
import { useResource } from '@/lib/use-resource'
import { api, errorMessage } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Feedback } from '@/components/workspace-loading'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { Pager } from './MemberOperations'
import { at } from './member-operation-format'
import { RISK_LABELS, type RiskMetrics } from '../../shared/member-risk'

type Row = { id: string; kind: string; latest_order_id: string; customer_email: string; flags: string; metrics: string; status: string; version: number; updated_at: number }
const statuses: Record<string, string> = { open: '待核查', acknowledged: '已记录处理，持续观察', resolved: '近期指标已消退' }
function History({ id, revision }: { id: string; revision: number }) {
  const [page, setPage] = useState(1)
  const { data, error, loading } = useResource<{ history: { id: string; note: string; actor: string; created_at: number }[] }>(`/api/admin/member-ops/risk?id=${encodeURIComponent(id)}&page=${page}`, revision)
  return <><Feedback error={error} loading={loading} data={data} />{data && <><ol>{data.history.map(h => <li key={h.id}>{at(h.created_at)} · {h.actor}<p>{h.note}</p></li>)}</ol><Pager page={page} size={data.history.length} change={setPage} /></>}</>
}
export default function MemberRiskPage({ revision }: { revision: number }) {
  const [page, setPage] = useState(1), [refresh, setRefresh] = useState(0), [selected, setSelected] = useState<Row | null>(null), [note, setNote] = useState(''), [busy, setBusy] = useState(false), [message, setMessage] = useState('')
  const { data, error, loading } = useResource<{ rows: Row[] }>(`/api/admin/member-ops/risk?page=${page}`, revision + refresh)
  async function act(scan: boolean) {
    if (busy || (!scan && !selected)) return
    setBusy(true); setMessage('')
    try { await api('/api/admin/member-ops/risk', scan ? { action: 'scan' } : { action: 'acknowledge', id: selected!.id, version: selected!.version, note }); setRefresh(v => v + 1); setSelected(null); setMessage(scan ? '已检查一批近期订单来源，定时任务会继续巡检。' : '处理说明已保存，后续变化会继续记录。') }
    catch (e) { setMessage(errorMessage(e)) } finally { setBusy(false) }
  }
  return <section className="admin-panel member-operations-panel"><h2>轻量风控</h2><p>识别同会员、购买邮箱或购买浏览器在24小时内的异常：10笔待付款订单、5次占券后取消、5笔同时锁券。新活动订单命中这些记录时进入原人工审核流程，原有取消恢复、退款和采购门禁继续适用。</p><p>IP只作辅助：同网络1小时内20笔订单本身不会触发审核、封禁或增加游客购买步骤。仅保留按日变化的 HMAC 辅助标识，24小时后清除。</p><div className="admin-filters"><Button disabled={busy} onClick={() => void act(true)}>检查一批近期记录</Button></div>{message && !selected && <p role="status">{message}</p>}<Feedback error={error} loading={loading} data={data} />
    {data && <><div className="admin-table-scroll"><table className="admin-table"><thead><tr><th>关联订单／识别依据</th><th>异常提示</th><th>24小时记录</th><th>状态／时间</th><th>操作</th></tr></thead><tbody>{data.rows.map(r => { const m = JSON.parse(r.metrics) as RiskMetrics; return <tr key={r.id}><td>{r.latest_order_id}<small>{r.customer_email}</small><small>{({ member: '会员账号', customer: '购买邮箱', browser: '购买浏览器' } as Record<string, string>)[r.kind]}</small></td><td>{(JSON.parse(r.flags) as string[]).map(f => RISK_LABELS[f] ?? f).join('、') || '当前无异常指标'}</td><td>待付款 {m.unpaidOrders} · 占券后取消 {m.repeatedReservations}<small>同时锁券 {m.activeReservations} · 合计下单 {m.totalOrders}</small>{m.ipOrders >= 20 && <small>同网络近期 {m.ipOrders} 笔（辅助）</small>}</td><td>{statuses[r.status]}<small>{at(r.updated_at)}</small></td><td><Button variant="outline" onClick={() => { setSelected(r); setNote(''); setMessage('') }}>核查与记录</Button></td></tr> })}</tbody></table></div>{!data.rows.length && <p className="admin-empty">暂无命中异常指标的记录，正常游客继续沿用原购买流程。</p>}<Pager page={page} size={data.rows.length} change={setPage} /></>}
    <Dialog open={!!selected} onOpenChange={v => { if (!v && !busy) setSelected(null) }}><DialogContent style={{ maxWidth: 'min(900px, calc(100vw - 2rem))', maxHeight: '85dvh', overflowY: 'auto' }}><DialogHeader><DialogTitle>风险核查与处理记录</DialogTitle><DialogDescription>请结合原订单核查。这里记录处理说明；订单审核和权益冻结仍使用原有操作，不会自动扣款、发券或释放占用。</DialogDescription></DialogHeader>{selected && <><History key={selected.id} id={selected.id} revision={refresh} />{selected.status !== 'resolved' && <><label htmlFor="risk-note">核查说明</label><Textarea id="risk-note" value={note} maxLength={500} onChange={e => setNote(e.target.value)} /><Button disabled={busy || !note.trim()} onClick={() => void act(false)}>保存处理说明</Button></>}</>}{message && <p role="status">{message}</p>}</DialogContent></Dialog>
  </section>
}
