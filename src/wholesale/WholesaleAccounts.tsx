import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { api, errorMessage } from '@/lib/api'
import { useResource } from '@/lib/use-resource'
import type { WholesaleAgent, WholesaleLedger } from '../../shared/wholesale'
import { date, Empty, Field, Message, money, Pages } from './ui'

function Ledger({ agent, close }: { agent: WholesaleAgent; close: () => void }) {
  const [page, setPage] = useState(1)
  const { data, error, loading } = useResource<{ ledger: WholesaleLedger[]; total: number }>(`/api/admin/wholesale/accounts/${agent.id}/ledger?page=${page}`)
  return <Dialog open onOpenChange={open => { if (!open) close() }}><DialogContent className="ws-dialog"><DialogHeader><DialogTitle>{agent.name} · 资金流水</DialogTitle><DialogDescription>余额变动与对应订单、充值记录。</DialogDescription></DialogHeader><Message error={error} />{loading && <p role="status">读取中…</p>}{data?.ledger.map(l => <div className="ws-ledger-entry" key={l.id}><strong>{{ topup: '充值入账', purchase: '采购扣款', refund: '退款' }[l.kind]} · {money(l.amount_cents)}</strong><p>{date(l.created_at)} · 变动后余额 {money(l.balance_cents)}</p><small>{l.reference_id}</small></div>)}{data && !data.ledger.length && <Empty>暂无流水</Empty>}{data && <Pages page={page} total={data.total} onChange={setPage} />}</DialogContent></Dialog>
}

export default function WholesaleAccounts({ accounts, changed }: { accounts: WholesaleAgent[]; changed: () => void }) {
  const [create, setCreate] = useState(false), [action, setAction] = useState<WholesaleAgent | null>(null), [ledger, setLedger] = useState<WholesaleAgent | null>(null)
  const [busy, setBusy] = useState(false), [error, setError] = useState('')
  async function save(form?: HTMLFormElement) {
    if (busy) return
    setBusy(true); setError('')
    try {
      if (form) { const fields = new FormData(form); await api('/api/admin/wholesale/accounts', { name: fields.get('name'), email: fields.get('email') }) }
      else if (action) await api('/api/admin/wholesale/accounts/' + action.id, { active: !action.active, version: action.version })
      setCreate(false); setAction(null); changed()
    } catch (e) { setError(errorMessage(e)) } finally { setBusy(false) }
  }
  return <><div className="ws-admin-tools"><p>开通后，代理可用邮箱验证码登录。余额与流水独立保存。</p><Button onClick={() => { setError(''); setCreate(true) }}>开通代理</Button></div>{accounts.length ? <div className="ws-table-wrap"><table><thead><tr><th>代理 / 登录邮箱</th><th>可用余额</th><th>状态</th><th>操作</th></tr></thead><tbody>{accounts.map(a => <tr key={a.id}><td><strong>{a.name}</strong><small>{a.email}</small></td><td>{money(a.balance_cents)}</td><td>{a.active ? '正常' : '已停用'}</td><td><div className="ws-admin-actions"><Button variant="outline" onClick={() => setLedger(a)}>资金流水</Button><Button variant="ghost" onClick={() => { setError(''); setAction(a) }}>{a.active ? '停用' : '重新启用'}</Button></div></td></tr>)}</tbody></table></div> : <Empty>还没有代理账号。</Empty>}{(create || action) && <Dialog open onOpenChange={open => { if (!open && !busy) { setCreate(false); setAction(null) } }}><DialogContent className="ws-dialog"><DialogHeader><DialogTitle>{create ? '开通代理账号' : action?.active ? '停用代理账号' : '重新启用代理'}</DialogTitle><DialogDescription>{create ? '填写代理姓名与用于登录的邮箱。新账号余额为零。' : `${action?.name} · ${action?.email}。当前会话和 API 密钥会失效，余额与订单保留。`}</DialogDescription></DialogHeader><Message error={error} />{create ? <form onSubmit={e => { e.preventDefault(); void save(e.currentTarget) }}><Field label="代理名称" name="name" maxLength={80} /><Field label="登录邮箱" name="email" type="email" maxLength={254} /><Button type="submit" disabled={busy}>确认开通</Button></form> : <Button disabled={busy} onClick={() => void save()}>确认{action?.active ? '停用' : '启用'}</Button>}</DialogContent></Dialog>}{ledger && <Ledger agent={ledger} close={() => setLedger(null)} />}</>
}
