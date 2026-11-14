import { lazy, Suspense, useState } from 'react'
import { useResource } from '@/lib/use-resource'
import { api, errorMessage } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { Feedback } from '@/components/workspace-loading'
import { money, at } from './member-operation-format'
import './member-operations.css'
const labels: Record<string, string> = { unchecked: '待核对', matched: '一致', difference: '有差异', expected: '正常等待', error: '查询失败', cash_amount: '客户实付金额不符', supply_amount: '采购金额不符', refund_amount: '退款金额不符', payment_status: '支付状态不符', delivery_status: '交付结果不符', close_status: '关单状态不符', held_order_submitted: '待处理订单出现上游采购', local_paid_without_upstream: '本店有付款或交付但无上游订单', upstream_identity_unknown: '上游提交结果待确认', upstream_identity_mismatch: '上游订单身份不符', upstream_identity_invalid: '上游编号无效', supplier_account_changed: '上游账号变化', upstream_query_failed: '上游查询未完成', awaiting_supplier: '等待上游补差方案', awaiting_review: '等待审核', not_submitted: '尚未提交上游', paid: '已付款', unpaid: '未付款', pending: '待付款', success: '交付成功', succeeded: '交付成功', failed: '失败', processing: '交付中', session: '等待充值资料', cancelled: '已取消', closed: '已关闭', expired: '已过期', refunded: '已退款', partially_refunded: '部分退款', queued: '排队中', running: '处理中' }
type Snapshot = { cashCents?: number; supplyCents?: number; refundCents?: number; payment?: string; delivery?: string; status?: string; idempotencyKey?: string; remoteId?: string }
type Reconciliation = { order_id: string; state: string; differences: string; local_snapshot: string; upstream_snapshot: string; checked_at: number }
function SnapshotView({ value }: { value: string }) {
  const s = JSON.parse(value) as Snapshot
  return <><strong>{money(s.cashCents)}</strong><small>采购 {money(s.supplyCents)} · 退款 {money(s.refundCents)}</small><small>{labels[s.payment ?? ''] ?? '—'} · {labels[s.delivery ?? s.status ?? ''] ?? '暂无交付结果'}</small>{s.remoteId && <small>{s.remoteId}</small>}</>
}
export function Pager({ page, size, change }: { page: number; size: number; change: (p: number) => void }) {
  return <div className="admin-pagination"><span>第 {page} 页</span><div><Button variant="outline" disabled={page === 1} onClick={() => change(page - 1)}>上一页</Button><Button variant="outline" disabled={size < 20} onClick={() => change(page + 1)}>下一页</Button></div></div>
}
function History({ id, revision }: { id: string; revision: number }) {
  const [page, setPage] = useState(1)
  const { data, error, loading } = useResource<{ history: { id: string; action: string; note: string; actor: string; created_at: number; details: string }[] }>(`/api/admin/member-ops/reconciliation?id=${encodeURIComponent(id)}&page=${page}`, revision)
  return <><Feedback error={error} loading={loading} data={data} />{data && <><ol>{data.history.map(h => <li key={h.id}><strong>{at(h.created_at)} · {h.actor}</strong><p>{h.note}</p>{h.action === 'check' && <p>{(JSON.parse(h.details).differences as string[]).map(v => labels[v] ?? v).join('、') || '核对一致'}</p>}</li>)}</ol><Pager page={page} size={data.history.length} change={setPage} /></>}</>
}
function ReconciliationPage({ revision }: { revision: number }) {
  const [page, setPage] = useState(1), [state, setState] = useState('issues'), [refresh, setRefresh] = useState(0)
  const [id, setId] = useState(''), [selected, setSelected] = useState(''), [note, setNote] = useState(''), [busy, setBusy] = useState(false), [message, setMessage] = useState('')
  const { data, error, loading } = useResource<{ rows: Reconciliation[]; counts: { state: string; count: number }[] }>(`/api/admin/member-ops/reconciliation?state=${state}&page=${page}`, revision + refresh)
  async function act(action: string, orderId = id) {
    if (busy) return
    setBusy(true); setMessage('')
    try { await api('/api/admin/member-ops/reconciliation', { action, id: orderId, note }); setRefresh(v => v + 1); setMessage(action === 'scan' ? '已核对一批到期订单，其余由定时任务继续核对。' : '已完成，处理记录已保存。') }
    catch (e) { setMessage(errorMessage(e)) } finally { setBusy(false) }
  }
  return <section className="admin-panel member-operations-panel"><h2>异常订单对账</h2><p>核对通用店 ChatGPT 订单与原上游订单。自动核对只查询；状态同步沿用原订单，不新建采购、扣款或人工发券。等待补差或审核单单独展示。</p>
    <div className="admin-metrics">{data?.counts.map(c => <div key={c.state}><span>{labels[c.state]}</span><strong>{c.count}</strong></div>)}</div>
    <form className="admin-filters" onSubmit={e => { e.preventDefault(); void act('check') }}><Input aria-label="核对订单号" value={id} onChange={e => setId(e.target.value)} placeholder="输入本店原订单号" /><Button disabled={busy || !id.trim()} type="submit">核对指定订单</Button><Button variant="outline" type="button" disabled={busy} onClick={() => void act('scan')}>核对一批订单</Button><label>显示 <select aria-label="对账筛选" value={state} onChange={e => { setState(e.target.value); setPage(1) }}>{[['issues','差异与失败'],['all','全部'],['expected','正常等待'],['matched','一致']].map(([v,l]) => <option key={v} value={v}>{l}</option>)}</select></label></form>
    {message && <p role="status">{message}</p>}<Feedback error={error} loading={loading} data={data} />
    {data && <><div className="admin-table-scroll"><table className="admin-table"><thead><tr><th>订单／最近核对</th><th>本店</th><th>上游</th><th>差异</th><th>操作</th></tr></thead><tbody>{data.rows.map(r => <tr key={r.order_id}><td>{r.order_id}<small>{at(r.checked_at)}</small></td><td><SnapshotView value={r.local_snapshot} /></td><td><SnapshotView value={r.upstream_snapshot} /></td><td>{labels[r.state]}<small>{(JSON.parse(r.differences) as string[]).map(d => labels[d] ?? d).join('、')}</small></td><td><Button variant="outline" disabled={busy} onClick={() => void act('check', r.order_id)}>复核</Button><Button variant="outline" onClick={() => { setSelected(r.order_id); setNote(''); setMessage('') }}>处理记录</Button></td></tr>)}</tbody></table></div>{!data.rows.length && <p className="admin-empty">当前没有符合筛选条件的对账记录。</p>}<Pager page={page} size={data.rows.length} change={setPage} /></>}
    <Dialog open={!!selected} onOpenChange={v => { if (!v && !busy) setSelected('') }}><DialogContent style={{ maxWidth: 'min(900px, calc(100vw - 2rem))', maxHeight: '85dvh', overflowY: 'auto' }}><DialogHeader><DialogTitle>订单处理记录</DialogTitle><DialogDescription>{selected} · 同步只读取原上游结果；金额不符时会拒绝同步，记录说明不会抹去差异。</DialogDescription></DialogHeader><label htmlFor="reconciliation-note">处理说明</label><Textarea id="reconciliation-note" value={note} onChange={e => setNote(e.target.value)} maxLength={500} /><div><Button disabled={busy || !note.trim()} onClick={() => void act('note', selected)}>保存说明</Button><Button variant="outline" disabled={busy || !note.trim()} onClick={() => void act('sync', selected)}>同步原上游状态</Button></div>{message && <p role="status">{message}</p>}{selected && <History key={selected} id={selected} revision={refresh} />}</DialogContent></Dialog>
  </section>
}
const Notifications=lazy(()=>import('./MemberNotificationPage'))
const Statistics=lazy(()=>import('./MemberStatisticsPage'))
const Simulation=lazy(()=>import('./MemberSimulationPage'))
const LedgerAudit=lazy(()=>import('./MemberLedgerAuditPage'))
export default function MemberOperations({ revision }: { revision: number }) {
 const [tab,setTab]=useState('reconciliation')
 return <><nav className="member-operations-nav" aria-label="会员运营分类"><Button variant={tab==='reconciliation'?'default':'outline'} onClick={()=>setTab('reconciliation')}>订单对账</Button><Button variant={tab==='notifications'?'default':'outline'} onClick={()=>setTab('notifications')}>通知中心</Button><Button variant={tab==='statistics'?'default':'outline'} onClick={()=>setTab('statistics')}>邀请效果</Button><Button variant={tab==='simulation'?'default':'outline'} onClick={()=>setTab('simulation')}>优惠预演</Button><Button variant={tab==='ledger'?'default':'outline'} onClick={()=>setTab('ledger')}>账本核对</Button></nav>{tab==='reconciliation'?<ReconciliationPage revision={revision}/>:<Suspense fallback={<p>正在加载通知…</p>}>{tab==='ledger'?<LedgerAudit revision={revision}/>:tab==='simulation'?<Simulation/>:tab==='statistics'?<Statistics revision={revision}/>:<Notifications revision={revision}/>}</Suspense>}</>
}
