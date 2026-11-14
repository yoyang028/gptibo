import { useState } from 'react'
import { api, errorMessage } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { money } from './member-operation-format'
import { RISK_LABELS } from '../../shared/member-risk'

type Result = { originalCents: number; supplyCents: number; availableCents: number; rewardCents: number; newcomerCents: number; otherCents: number; cashCents: number; remainingCents: number; reviewStatus: string; reviewTier: string; procurementPath: string; flags: string[]; message: string; basis: string }
const pathLabels: Record<string, string> = { hold_for_supplier: '锁券等待上游补差方案，取消恢复额度', review_then_platform_collect: '先人工审核，通过后按实付向上游代收', platform_collect: '按实付金额向原上游代收' }
const tiers: Record<string, string> = { automatic: '正常处理', enhanced: '增强检查', manual: '必须人工审核' }
export default function MemberSimulationPage() {
  const [mode, setMode] = useState('scenario'), [plan, setPlan] = useState('plus'), [balance, setBalance] = useState('140'), [reward, setReward] = useState('140'), [memberEmail, setMemberEmail] = useState(''), [customerEmail, setCustomerEmail] = useState(''), [inviteCode, setInviteCode] = useState(''), [couponCode, setCouponCode] = useState(''), [recent, setRecent] = useState('0')
  const [newcomer, setNewcomer] = useState(false), [invite, setInvite] = useState(true), [fresh, setFresh] = useState(true), [abnormal, setAbnormal] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState(''), [result, setResult] = useState<Result | null>(null)
  async function run() {
    if (busy) return
    setBusy(true); setError(''); setResult(null)
    try { setResult(await api<Result>('/api/admin/member-ops/simulation', { mode, plan, availableCents: Math.round(Number(balance) * 100), rewardCents: Math.round(Number(reward) * 100), memberEmail, customerEmail, inviteCode, couponCode, recentOrders: Number(recent), newcomer, assumeInvite: invite, assumeNewCustomer: fresh, abnormal })) }
    catch (e) { setError(errorMessage(e)) } finally { setBusy(false) }
  }
  return <section className="admin-panel member-operations-panel"><h2>优惠规则预演</h2><p>使用当前商品售价与上游只读采购报价。可输入假设余额，或读取已验证会员的真实可用余额。预演不会生成订单、占券、核销优惠码或发起付款。</p>
    <form className="member-simulation-form" onSubmit={e => { e.preventDefault(); void run() }}><label>商品规格<select aria-label="预演商品" value={plan} onChange={e => setPlan(e.target.value)}>{[['plus','ChatGPT Plus'],['pro-5x','ChatGPT Pro 5x'],['pro-20x','ChatGPT Pro 20x'],['pro-25x','ChatGPT Pro 25x']].map(([v,l]) => <option key={v} value={v}>{l}</option>)}</select></label>
      <label>余额来源<select aria-label="预演余额来源" value={mode} onChange={e => setMode(e.target.value)}><option value="scenario">假设场景</option><option value="member">读取真实会员余额</option></select></label>
      {mode === 'scenario' ? <><label>假设可用奖励（元）<Input aria-label="假设可用奖励" type="number" min="0" step="0.01" value={balance} onChange={e => setBalance(e.target.value)} required /></label><label>假设24小时内活动订单数<Input aria-label="假设近期订单数" type="number" min="0" step="1" value={recent} onChange={e => setRecent(e.target.value)} /></label><label className="member-simulation-check"><input type="checkbox" checked={invite} onChange={e => setInvite(e.target.checked)} />假设持有效邀请</label><label className="member-simulation-check"><input type="checkbox" checked={fresh} onChange={e => setFresh(e.target.checked)} />假设符合首次购买资格</label></> : <label>已验证会员邮箱<Input aria-label="预演会员邮箱" type="email" value={memberEmail} onChange={e => setMemberEmail(e.target.value)} required /></label>}
      <label>本次奖励抵扣（元）<Input aria-label="预演奖励抵扣" type="number" min="0" step="0.01" value={reward} onChange={e => setReward(e.target.value)} required /></label><label className="member-simulation-check"><input type="checkbox" checked={newcomer} onChange={e => setNewcomer(e.target.checked)} />新人减5元（与其他优惠互斥）</label>
      <label>购买邮箱（可选，填写后核查真实首购记录）<Input aria-label="预演购买邮箱" type="email" value={customerEmail} onChange={e => setCustomerEmail(e.target.value)} /></label><label>邀请码（可选，填写后核查真实资格）<Input aria-label="预演邀请码" value={inviteCode} onChange={e => setInviteCode(e.target.value)} maxLength={32} /></label><label>普通优惠码（可选）<Input aria-label="预演普通优惠码" value={couponCode} onChange={e => setCouponCode(e.target.value)} maxLength={32} /></label><label className="member-simulation-check"><input type="checkbox" checked={abnormal} onChange={e => setAbnormal(e.target.checked)} />模拟其他异常，触发人工审核</label>
      <Button type="submit" disabled={busy}>{busy ? '正在读取报价并预演…' : '开始预演'}</Button></form>
    {error && <p role="alert">{error}</p>}{result && <div className="member-simulation-result" role="status"><h3>预演结果 · {result.basis === 'member' ? '真实会员余额快照' : '假设场景'}</h3><dl>{[['商品原价',money(result.originalCents)],['上游采购价',money(result.supplyCents)],['奖励抵扣',money(result.rewardCents)],['新人／其他优惠',`${money(result.newcomerCents)}／${money(result.otherCents)}`],['应付金额',money(result.cashCents)],['预演后剩余额度',money(result.remainingCents)],['审核方式',tiers[result.reviewTier]],['采购路径',pathLabels[result.procurementPath]]].map(([l,v]) => <div key={l}><dt>{l}</dt><dd>{v}</dd></div>)}</dl>{result.flags.length>0&&<p>风险提示：{result.flags.map(f=>RISK_LABELS[f]??f).join('、')}</p>}<p>{result.message}</p><p>预演未包含实际购买浏览器的辅助记录，实际下单会重新检查。</p></div>}
  </section>
}
