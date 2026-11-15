import { useEffect, useRef, useState, type MouseEvent } from 'react'
import { Button } from './ui/button'
import { CopyButton } from './copy-button'
import { MemberAuthForm } from './member-auth-form'
import { MemberInviteCard } from './member-invite-card'
import { InvitationRules } from './member-invitation-rules'
import { api, errorMessage } from '@/lib/api'
import './member-center.css'

type Reward = { id: string; source_order_id: string; amount_cents: number; remaining_cents: number; reserved_cents: number; status: string; eligible_at: number; expires_at: number | null }
type Ledger = { id: string; order_id: string | null; kind: string; amount_cents: number; remaining_after: number; reserved_after: number; created_at: number }
type MemberData = { enabled: boolean; member: { id: string; email: string; frozen: boolean; inviteUrl: string; inviteAlias: string; inviteCustomized: boolean } | null; balanceCents: number; usedCents: number; totals: { earned: number; pending: number; reserved: number }; invitations: { total: number; effective: number }; rewards: Reward[]; ledger: Ledger[]; notifications: {id:string;subject:string;text:string;created_at:number}[] }
const money = (n: number) => `¥${(n / 100).toFixed(2)}`
const date = (n: number) => new Date(n).toLocaleString('zh-CN', { hour12: false })
const statusLabel: Record<string,string> = { pending: '观察期内', active: '已生效', cancelled: '已撤销', expired: '已到期', frozen: '审核中' }
const eventLabel: Record<string,string> = { grant: '邀请奖励待生效', activate: '奖励生效', reserve: '订单占用', captured: '订单抵扣', released: '取消后释放', restored: '退款后恢复', expire: '额度到期', cancelled: '撤销奖励', frozen: '冻结审核' }
export default function MemberCenter({ onSessionChanged }: { onSessionChanged: () => void }) {
  const [busy,setBusy]=useState(false)
  const rulesRef = useRef<HTMLDetailsElement>(null)
  const [data,setData]=useState<MemberData|null>(null),[error,setError]=useState(''),[revision,setRevision]=useState(0),[page,setPage]=useState(1)
  useEffect(()=>{const c=new AbortController();void api<MemberData>('/api/member/session?page='+page,undefined,c.signal).then(setData).catch(e=>{if(!c.signal.aborted)setError(errorMessage(e))});return()=>c.abort()},[revision,page])
  function changed(){setRevision(v=>v+1);onSessionChanged();window.dispatchEvent(new Event('scholai-member-session'))}
  async function logout(){setBusy(true);setError('');try{await api('/api/member/auth/sign-out',{});setData(null);changed()}catch(e){setError(errorMessage(e))}finally{setBusy(false)}}
  function beginInviting() {
    document.getElementById('member-auth')?.scrollIntoView({ block: 'start', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' })
    document.getElementById('member-email')?.focus({ preventScroll: true })
  }
  function showRules(event: MouseEvent<HTMLAnchorElement>) {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
    event.preventDefault()
    const details = rulesRef.current
    if (!details) return
    details.open = true
    history.replaceState(null, '', '#member-invitation-rules')
    details.scrollIntoView({ block: 'start', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' })
    details.querySelector('summary')?.focus({ preventScroll: true })
  }
  return <section className="member-page page-width"><div className="member-heading"><div><h1>会员中心</h1><p>查看邀请、奖励与使用记录。游客也可以直接购买商品。</p></div>{data?.member&&<div className="member-account"><div className="member-account-identity"><small>已验证邮箱</small><span>{data.member.email}</span></div><Button variant="outline" disabled={busy} onClick={()=>void logout()}>退出登录</Button></div>}</div>
    {error&&<p className="member-error" role="alert">{error}<Button variant="ghost" onClick={()=>{setError('');setRevision(v=>v+1)}}>重试</Button></p>}
    {data?.enabled&&<section className="member-invite-hero" aria-labelledby="member-invite-headline">
      <div className="member-invite-message"><p className="member-invite-kicker">邀请新客 · 双向有礼</p><h2 id="member-invite-headline">每邀 1 位新客，<span>得 10 元购物奖励</span></h2>
        <div className="member-invite-benefits"><div><span>你得购物奖励</span><p><small>¥</small><strong>10</strong><span>/ 位新客</span></p></div><div><span>好友首单可减</span><p><small>¥</small><strong>5</strong></p></div></div>
        <p className="member-invite-perks">多邀多得 · 多张奖励叠加 · 用不完的额度继续保留</p>
        <p className="member-invite-condition">好友首次实付且充值成功，观察满 24 小时、无异常后奖励生效。每笔有效期两个月。</p>
      </div>
      <div className="member-invite-actions">
        {data.member ? <CopyButton className="member-invite-cta" size="lg" label="立即邀请好友" value={data.member.inviteUrl} disabled={busy||data.member.frozen}/> : <Button className="member-invite-cta" size="lg" onClick={beginInviting}>立即邀请好友</Button>}
        <a href="#member-invitation-rules" onClick={showRules}>查看活动规则</a>
      </div>
    </section>}
    {!data&&!error&&<p role="status">正在读取会员信息…</p>}
    {data&&!data.enabled&&<p className="member-notice">当前商店尚未开放会员功能。</p>}
    {data?.enabled&&!data.member&&<MemberAuthForm onAuthenticated={changed}/>}
    {data?.member&&<>
      <MemberInviteCard member={data.member} onSaved={changed}/>
      <div className="member-metrics">{[['可用奖励',money(data.balanceCents)],['待生效',money(data.totals.pending)],['订单占用',money(data.totals.reserved)],['累计奖励',money(data.totals.earned)],['已使用',money(data.usedCents)],['有效邀请',data.invitations.effective??0]].map(([label,value])=><div className="member-card" key={label}><span>{label}</span><strong>{value}</strong></div>)}</div>
      {data.member.frozen&&<p className="member-notice">账号权益正在审核。历史记录保留，请联系支持处理。</p>}
      <section className="member-card"><h2>通知中心</h2>{data.notifications?.length?<ul>{data.notifications.map(n=><li key={n.id}><strong>{n.subject}</strong><small>{date(n.created_at)}</small><p style={{whiteSpace:'pre-line'}}>{n.text.split('\n\n查看详情：')[0]}</p></li>)}</ul>:<p>奖励生效或即将到期时，提醒会显示在这里并发送到已验证邮箱。</p>}</section>
      <section className="member-card"><h2>奖励与有效期</h2>{data.rewards.length?<div className="member-table-scroll"><table><thead><tr><th>来源订单</th><th>状态</th><th>剩余额度／占用</th><th>生效／到期</th></tr></thead><tbody>{data.rewards.map(g=><tr key={g.id}><td>{g.source_order_id}</td><td>{statusLabel[g.status]??g.status}</td><td>{money(g.remaining_cents)}／{money(g.reserved_cents)}</td><td>{g.status==='pending'?date(g.eligible_at)+' 后生效':g.expires_at?date(g.expires_at)+' 到期':'—'}</td></tr>)}</tbody></table></div>:<p>还没有邀请奖励。分享链接后，可在这里查看进度。</p>}</section>
      <section className="member-card"><h2>额度变化与使用记录</h2>{data.ledger.length?<div className="member-table-scroll"><table><thead><tr><th>时间</th><th>事项</th><th>金额</th><th>该笔剩余／占用</th></tr></thead><tbody>{data.ledger.map(l=><tr key={l.id}><td>{date(l.created_at)}</td><td>{eventLabel[l.kind]??l.kind}<small>{l.order_id}</small></td><td>{money(l.amount_cents)}</td><td>{money(l.remaining_after)}／{money(l.reserved_after)}</td></tr>)}</tbody></table></div>:<p>暂无额度变化记录。</p>}</section>
      <div className="member-pagination"><Button variant="outline" disabled={page===1} onClick={()=>setPage(v=>v-1)}>上一页</Button><span>第 {page} 页</span><Button variant="outline" disabled={data.rewards.length<20&&data.ledger.length<20} onClick={()=>setPage(v=>v+1)}>下一页</Button></div>
    </>}
    {data?.enabled&&<InvitationRules detailsRef={rulesRef}/>}
  </section>
}
