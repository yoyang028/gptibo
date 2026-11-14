import { useEffect, useState } from 'react'
import { Button } from './ui/button'
import { CopyButton } from './copy-button'
import { MemberAuthForm } from './member-auth-form'
import { MemberInviteCard } from './member-invite-card'
import { api, errorMessage } from '@/lib/api'
import './member-center.css'

type Reward = { id: string; source_order_id: string; amount_cents: number; remaining_cents: number; reserved_cents: number; status: string; eligible_at: number; expires_at: number | null }
type Ledger = { id: string; order_id: string | null; kind: string; amount_cents: number; remaining_after: number; reserved_after: number; created_at: number }
type MemberData = { enabled: boolean; member: { id: string; email: string; frozen: boolean; inviteUrl: string; inviteAlias: string; inviteCustomized: boolean } | null; balanceCents: number; usedCents: number; totals: { earned: number; pending: number; reserved: number }; invitations: { total: number; effective: number }; rewards: Reward[]; ledger: Ledger[]; notifications: {id:string;subject:string;text:string;created_at:number}[] }
const money = (n: number) => `¥${(n / 100).toFixed(2)}`
const date = (n: number) => new Date(n).toLocaleString('zh-CN', { hour12: false })
const statusLabel: Record<string,string> = { pending: '观察期内', active: '已生效', cancelled: '已撤销', expired: '已到期', frozen: '审核中' }
const eventLabel: Record<string,string> = { grant: '邀请奖励待生效', activate: '奖励生效', reserve: '订单占用', captured: '订单抵扣', released: '取消后释放', restored: '退款后恢复', expire: '额度到期', cancelled: '撤销奖励', frozen: '冻结审核' }
export function InvitationRules() {
  return <section id="member-invitation-rules" className="member-card member-rules"><h2>邀请好友，新人减 5 元，你得 10 元</h2><p>验证邮箱后即可分享，无需先购买。活动仅限本店 ChatGPT 商品的四个规格。</p><ul><li>好友通过你的链接首次购买，可自选减 5 元；这项优惠不与其他优惠叠加。不使用新人优惠也能为你带来奖励。</li><li>好友完成首次真实付款及充值后，你获得 10 元待生效奖励；经过 24 小时观察期，无异常自动生效。</li><li>奖励有效期两个月，多张可累计、完全叠加，支持免费兑换。超出订单金额的剩余额度保留，奖励仅限本人账号使用。</li><li>大额、全额抵扣或异常订单需审核；部分优惠订单需要人工确认供货后继续。未完成订单保留优惠占用，取消后按原有效期恢复。</li></ul></section>
}
export default function MemberCenter({ onSessionChanged }: { onSessionChanged: () => void }) {
  const [busy,setBusy]=useState(false)
  const [data,setData]=useState<MemberData|null>(null),[error,setError]=useState(''),[revision,setRevision]=useState(0),[page,setPage]=useState(1)
  useEffect(()=>{const c=new AbortController();void api<MemberData>('/api/member/session?page='+page,undefined,c.signal).then(setData).catch(e=>{if(!c.signal.aborted)setError(errorMessage(e))});return()=>c.abort()},[revision,page])
  function changed(){setRevision(v=>v+1);onSessionChanged();window.dispatchEvent(new Event('scholai-member-session'))}
  async function logout(){setBusy(true);setError('');try{await api('/api/member/auth/sign-out',{});setData(null);changed()}catch(e){setError(errorMessage(e))}finally{setBusy(false)}}
  function beginInviting() {
    document.getElementById('member-auth')?.scrollIntoView({ block: 'start', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' })
    document.getElementById('member-email')?.focus({ preventScroll: true })
  }
  return <section className="member-page page-width"><div className="member-heading"><div><h1>会员中心</h1><p>查看邀请、奖励与使用记录。游客也可以直接购买商品。</p></div>{data?.member&&<Button variant="outline" disabled={busy} onClick={()=>void logout()}>退出登录</Button>}</div>
    {error&&<p className="member-error" role="alert">{error}<Button variant="ghost" onClick={()=>{setError('');setRevision(v=>v+1)}}>重试</Button></p>}
    {data?.enabled&&<section className="member-invite-hero" aria-labelledby="member-invite-headline">
      <div><h2 id="member-invite-headline">邀请好友，你得<strong>10</strong>元，<span>好友首单减<strong>5</strong>元</span></h2><p>多邀多得 · 多张可叠加 · 最高抵至0元</p></div>
      <div className="member-invite-actions">
        {data.member ? <CopyButton className="member-invite-cta" size="lg" label="立即邀请好友" value={data.member.inviteUrl} disabled={busy||data.member.frozen}/> : <Button className="member-invite-cta" size="lg" onClick={beginInviting}>立即邀请好友</Button>}
        <a href="#member-invitation-rules">查看活动规则</a>
      </div>
    </section>}
    {!data&&!error&&<p role="status">正在读取会员信息…</p>}
    {data&&!data.enabled&&<p className="member-notice">当前商店尚未开放会员功能。</p>}
    {data?.enabled&&!data.member&&<MemberAuthForm onAuthenticated={changed}/>}
    {data?.member&&<><p>已验证邮箱：{data.member.email}</p>{data.member.frozen&&<p className="member-notice">账号权益正在审核。历史记录保留，请联系支持处理。</p>}
      <MemberInviteCard member={data.member} onSaved={changed}/>
      <div className="member-metrics">{[['可用奖励',money(data.balanceCents)],['待生效',money(data.totals.pending)],['订单占用',money(data.totals.reserved)],['累计奖励',money(data.totals.earned)],['已使用',money(data.usedCents)],['有效邀请',data.invitations.effective??0]].map(([label,value])=><div className="member-card" key={label}><span>{label}</span><strong>{value}</strong></div>)}</div>
      <section className="member-card"><h2>通知中心</h2>{data.notifications?.length?<ul>{data.notifications.map(n=><li key={n.id}><strong>{n.subject}</strong><small>{date(n.created_at)}</small><p style={{whiteSpace:'pre-line'}}>{n.text.split('\n\n查看详情：')[0]}</p></li>)}</ul>:<p>奖励生效或即将到期时，提醒会显示在这里并发送到已验证邮箱。</p>}</section>
      <section className="member-card"><h2>奖励与有效期</h2>{data.rewards.length?<div className="member-table-scroll"><table><thead><tr><th>来源订单</th><th>状态</th><th>剩余额度／占用</th><th>生效／到期</th></tr></thead><tbody>{data.rewards.map(g=><tr key={g.id}><td>{g.source_order_id}</td><td>{statusLabel[g.status]??g.status}</td><td>{money(g.remaining_cents)}／{money(g.reserved_cents)}</td><td>{g.status==='pending'?date(g.eligible_at)+' 后生效':g.expires_at?date(g.expires_at)+' 到期':'—'}</td></tr>)}</tbody></table></div>:<p>还没有邀请奖励。分享链接后，可在这里查看进度。</p>}</section>
      <section className="member-card"><h2>额度变化与使用记录</h2>{data.ledger.length?<div className="member-table-scroll"><table><thead><tr><th>时间</th><th>事项</th><th>金额</th><th>该笔剩余／占用</th></tr></thead><tbody>{data.ledger.map(l=><tr key={l.id}><td>{date(l.created_at)}</td><td>{eventLabel[l.kind]??l.kind}<small>{l.order_id}</small></td><td>{money(l.amount_cents)}</td><td>{money(l.remaining_after)}／{money(l.reserved_after)}</td></tr>)}</tbody></table></div>:<p>暂无额度变化记录。</p>}</section>
      <div className="member-pagination"><Button variant="outline" disabled={page===1} onClick={()=>setPage(v=>v-1)}>上一页</Button><span>第 {page} 页</span><Button variant="outline" disabled={data.rewards.length<20&&data.ledger.length<20} onClick={()=>setPage(v=>v+1)}>下一页</Button></div>
    </>}
    {data?.enabled&&<InvitationRules/>}
  </section>
}
