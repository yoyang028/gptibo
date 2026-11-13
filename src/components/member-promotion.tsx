import { useEffect, useState } from 'react'
import { api, errorMessage } from '@/lib/api'
import { Button } from './ui/button'
import { Input } from './ui/input'
import type { ServerOrder } from '@/lib/use-store'
import type { PromotionQuote } from '../../shared/member-promotions'
import { readInvitation } from '@/lib/member-invitation'
import './member-center.css'

export type PromotionState = { key: string; quote: PromotionQuote | null; pending: boolean; error: string }
export function PromotionChooser({ email, plan, price, couponCode, onChange }: { email: string; plan: string; price: number; couponCode: string; onChange: (value: PromotionState) => void }) {
  const [inviteCode]=useState(readInvitation),[newcomer,setNewcomer]=useState(false),[spend,setSpend]=useState('0')
  const [quote,setQuote]=useState<PromotionQuote|null>(null),[error,setError]=useState(''),[loading,setLoading]=useState(false)
  const key=[email.trim().toLowerCase(),plan,couponCode].join('|')
  const rewardCents=Math.round(Number(spend)*100)
  useEffect(()=>{
    onChange({key,quote:null,pending:true,error:''})
    if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))return
    const c=new AbortController()
    const timer=setTimeout(()=>{
      setLoading(true);setError('')
      void api<PromotionQuote>('/api/orders/promotion-quote',{plan,email,couponCode:couponCode||undefined,promotion:{inviteCode,newcomer:couponCode?false:newcomer,rewardCents:couponCode?0:rewardCents}},c.signal)
        .then(q=>{if(c.signal.aborted)return;if(q.originalCents!==Math.round(price*100))throw new Error('商品价格已变化');setQuote(q);onChange({key,quote:q,pending:false,error:''})})
        .catch(e=>{if(c.signal.aborted)return;const message=errorMessage(e);setError(message);onChange({key,quote:null,pending:false,error:message})})
        .finally(()=>{if(!c.signal.aborted)setLoading(false)})
    },350)
    return()=>{clearTimeout(timer);c.abort()}
  },[email,plan,price,couponCode,inviteCode,newcomer,rewardCents,key,onChange])
  function change(f:()=>void){onChange({key,quote:null,pending:true,error:''});f()}
  return <section className="member-promotion" aria-label="邀请与奖励优惠"><h3>邀请与奖励优惠</h3>
    {inviteCode&&<p>{quote?.inviteValid?'已识别邀请来源。好友的首笔真实付费订单完成充值后，可为邀请者带来奖励。':'正在核对邀请来源。'}</p>}
    {!inviteCode&&<p>会员登录后可使用累计奖励。游客可直接购买，无需注册。</p>}
    {quote?.newcomerEligible&&<label><input type="checkbox" checked={newcomer&&!couponCode} disabled={!!couponCode||loading} onChange={e=>change(()=>{setNewcomer(e.target.checked);setSpend('0')})}/>本次使用新人优惠，立减 ¥5.00</label>}
    {!!quote?.availableCents&&<><label><input type="checkbox" checked={rewardCents>0&&!couponCode} disabled={!!couponCode||loading} onChange={e=>change(()=>{setNewcomer(false);setSpend(e.target.checked?(Math.min(quote.availableCents,Math.round(price*100))/100).toFixed(2):'0')})}/>使用奖励抵扣，可用 ¥{(quote.availableCents/100).toFixed(2)}</label>{rewardCents>0&&<><label htmlFor="member-spend">本次抵扣金额（元）</label><Input id="member-spend" type="number" inputMode="decimal" min="0" step="0.01" max={Math.min(quote.availableCents,Math.round(price*100))/100} value={spend} onChange={e=>change(()=>setSpend(e.target.value))}/></>}</>}
    {couponCode&&<p>已选择普通优惠码；新人优惠和奖励抵扣暂不同时使用，邀请来源仍会保存。</p>}
    {quote&&<dl><div><dt>商品原价</dt><dd>¥{(quote.originalCents/100).toFixed(2)}</dd></div>{quote.newcomerCents>0&&<div><dt>新人优惠</dt><dd>−¥5.00</dd></div>}{quote.rewardCents>0&&<div><dt>奖励抵扣</dt><dd>−¥{(quote.rewardCents/100).toFixed(2)}</dd></div>}{quote.otherCents>0&&<div><dt>优惠码减免</dt><dd>−¥{(quote.otherCents/100).toFixed(2)}</dd></div>}<div><dt>实际应付</dt><dd><strong>¥{(quote.cashCents/100).toFixed(2)}</strong></dd></div></dl>}
    {quote&&(quote.reviewStatus==='required'||quote.procurementStatus==='awaiting_supplier')&&<p>此优惠订单需人工确认后继续，优惠额度将保留。你可以在订单中查看进度或取消。</p>}
    {loading&&<p role="status">正在核对本次优惠…</p>}{error&&<p role="alert">{error}</p>}
  </section>
}

export function PromotionPending({order,onUpdated}: {order: ServerOrder; onUpdated?: () => void}){
  const [busy,setBusy]=useState(false),[error,setError]=useState('')
  async function cancel(){if(busy)return;setBusy(true);setError('');try{await api(`/api/orders/${order.id}/promotion-cancel`,{version:order.version});onUpdated?.()}catch(e){setError(errorMessage(e))}finally{setBusy(false)}}
  return <section className="member-hold" aria-label="优惠订单处理进度"><h3>{order.status==='cancelled'?'订单已取消':'订单待处理'}</h3><p>{order.promotion?.message}</p><div className="member-promotion"><dl><div><dt>商品原价</dt><dd>¥{((order.promotion?.originalCents??0)/100).toFixed(2)}</dd></div><div><dt>本次奖励抵扣</dt><dd>¥{((order.promotion?.rewardCents??0)/100).toFixed(2)}</dd></div><div><dt>实际应付</dt><dd>¥{order.price.toFixed(2)}</dd></div></dl></div><p>以订单中的实际付款和充值进度为准；审核通过后仍需确认供货及交付。</p>{error&&<p role="alert">{error}</p>}<div className="member-hold-actions"><Button variant="outline" disabled={busy} onClick={onUpdated}>刷新进度</Button>{order.status==='pending'&&order.paymentStatus==='unpaid'&&<Button variant="ghost" disabled={busy} onClick={()=>void cancel()}>{busy?'正在取消…':'取消订单，释放优惠'}</Button>}</div></section>
}
