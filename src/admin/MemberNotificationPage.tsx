import { useState } from 'react'
import { useResource } from '@/lib/use-resource'
import { api, errorMessage } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Feedback } from '@/components/workspace-loading'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { Pager } from './MemberOperations'
import { at } from './member-operation-format'

const labels: Record<string, string> = { pending: '待发送', sending: '发送中', retry: '等待重试', sent: '邮件服务已接收', failed: '发送失败', unknown: '结果待人工核查', cancelled: '事项已处理，停止发送', reconciliation: '订单对账异常', review: '订单待审核', procurement: '采购／交付失败', backlog: '订单积压', reward_active: '奖励生效', reward_expiring: '奖励即将到期' }
type Notification = { id: string; kind: string; target_id: string; recipient: string; subject: string; status: string; attempts: number; first_attempt_at: number | null; next_attempt_at: number; provider_id: string | null; last_error: string; created_at: number; sent_at: number | null; version: number }
function SendingLog({ id, revision }: { id: string; revision: number }) {
  const [page, setPage] = useState(1)
  const { data, error, loading } = useResource<{ history: { id: string; action: string; note: string; created_at: number }[] }>(`/api/admin/member-ops/notifications?id=${encodeURIComponent(id)}&page=${page}`, revision)
  return <><Feedback error={error} loading={loading} data={data} />{data && <><ol>{data.history.map(h => <li key={h.id}>{at(h.created_at)} · {h.note}</li>)}</ol><Pager page={page} size={data.history.length} change={setPage} /></>}</>
}
export default function MemberNotificationPage({ revision }: { revision: number }) {
  const [page, setPage] = useState(1), [refresh, setRefresh] = useState(0), [selected, setSelected] = useState<Notification | null>(null), [note, setNote] = useState(''), [busy, setBusy] = useState(false), [message, setMessage] = useState('')
  const { data, error, loading } = useResource<{ configured: boolean; rows: Notification[] }>(`/api/admin/member-ops/notifications?page=${page}`, revision + refresh)
  async function act(action: string) {
    if (!selected || busy) return
    setBusy(true); setMessage('')
    try { await api('/api/admin/member-ops/notifications', { action, id: selected.id, version: selected.version, note }); setRefresh(v => v + 1); setSelected(null); setMessage(action === 'confirm' ? '已记录人工核验结果。' : '已加入原通知重试队列。') }
    catch (e) { setMessage(errorMessage(e)) } finally { setBusy(false) }
  }
  return <section className="admin-panel member-operations-panel"><h2>通知中心</h2><p>管理员接收待审核、采购失败及超过24小时的订单积压提醒；会员接收奖励生效和到期前三天提醒。沿用现有 Resend 与管理员邮箱，每个事项去重，失败自动重试，日志保留。</p>{data && !data.configured && <p role="alert">邮件服务或管理员邮箱尚未配置，通知将保留在队列中。</p>}{message && !selected && <p role="status">{message}</p>}<Feedback error={error} loading={loading} data={data} />
    {data && <><div className="admin-table-scroll"><table className="admin-table"><thead><tr><th>事项／接收人</th><th>状态</th><th>发送／下次重试</th><th>操作</th></tr></thead><tbody>{data.rows.map(n => <tr key={n.id}><td>{labels[n.kind] ?? n.kind}<small>{n.recipient}</small><small>{n.target_id}</small></td><td>{labels[n.status]}<small>{n.attempts} 次尝试 · {n.last_error}</small><small>{n.provider_id}</small></td><td>{at(n.sent_at ?? n.created_at)}{n.status === 'retry' && <small>下次：{at(n.next_attempt_at)}</small>}</td><td><Button variant="outline" onClick={() => { setSelected(n); setNote(''); setMessage('') }}>发送日志</Button></td></tr>)}</tbody></table></div>{!data.rows.length && <p className="admin-empty">暂无通知，符合条件的事项将由定时任务自动进入队列。</p>}<Pager page={page} size={data.rows.length} change={setPage} /></>}
    <Dialog open={!!selected} onOpenChange={v => { if (!v && !busy) setSelected(null) }}><DialogContent style={{ maxWidth: 'min(900px, calc(100vw - 2rem))', maxHeight: '85dvh', overflowY: 'auto' }}><DialogHeader><DialogTitle>通知发送日志</DialogTitle><DialogDescription>“邮件服务已接收”表示 Resend 接受了请求，实际投递请核对邮件服务记录。重试复用原编号和原内容；首次尝试23小时后停止自动重发。</DialogDescription></DialogHeader>{selected && <><p>{selected.subject}</p><SendingLog key={selected.id} id={selected.id} revision={refresh} />{!['sent','cancelled','sending'].includes(selected.status) && <><label htmlFor="notification-note">核查说明</label><Textarea id="notification-note" value={note} onChange={e => setNote(e.target.value)} maxLength={500} /><div><Button disabled={busy || !note.trim()} onClick={() => void act('retry')}>重试原通知</Button><Button variant="outline" disabled={busy || !note.trim()} onClick={() => void act('confirm')}>已在 Resend 核实发送成功</Button></div></>}</>}{message && <p role="status">{message}</p>}</DialogContent></Dialog>
  </section>
}
