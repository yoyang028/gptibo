import { useState } from 'react'
import { useResource } from '@/lib/use-resource'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Feedback } from '@/components/workspace-loading'
import { Pager } from './MemberOperations'
import { money, at } from './member-operation-format'

type Row = { id: string; email: string; orders: number; buyers: number; paid_orders: number; paid_buyers: number; paid_cents: number; refunded_cents: number; refunded_orders: number; delivered_orders: number; converted_buyers: number; rewards: number; issued_cents: number; pending_cents: number; available_cents: number; reserved_cents: number; used_cents: number; restored_cents: number }
const rate = (n: number, d: number) => d ? `${(100 * n / d).toFixed(1)}%` : '—'
export default function MemberStatisticsPage({ revision }: { revision: number }) {
  const [page, setPage] = useState(1), [q, setQ] = useState(''), [from, setFrom] = useState(''), [to, setTo] = useState(''), [query, setQuery] = useState('')
  const { data, error, loading } = useResource<{ rows: Row[]; totals: { inviters: number; orders: number; paid_cents: number; refunded_cents: number; delivered_orders: number; used_cents: number }; generatedAt: number }>(`/api/admin/member-ops/statistics?page=${page}&${query}`, revision)
  return <section className="admin-panel member-operations-panel"><h2>邀请效果统计</h2><p>按带邀请来源的订单创建日期筛选（北京时间），展示当前付款、退款与交付结果。下单转化以独立下单邮箱为分母；成功转化要求真实实付、成功交付且未全额退款。当前未统计链接点击量。</p>
    <form className="admin-filters" onSubmit={e => { e.preventDefault(); setPage(1); setQuery(new URLSearchParams({ q, from, to }).toString()) }}><Input aria-label="邀请者邮箱" value={q} onChange={e => setQ(e.target.value)} placeholder="邀请者邮箱" /><label>开始日期 <Input aria-label="统计开始日期" type="date" value={from} onChange={e => setFrom(e.target.value)} /></label><label>结束日期 <Input aria-label="统计结束日期" type="date" value={to} onChange={e => setTo(e.target.value)} /></label><Button type="submit">查询统计</Button></form><Feedback error={error} loading={loading} data={data} />
    {data && <><div className="admin-metrics">{[['邀请来源订单',data.totals.orders],['累计实付',money(data.totals.paid_cents)],['累计退款',money(data.totals.refunded_cents)],['成功交付',data.totals.delivered_orders],['净使用奖励',money(data.totals.used_cents)]].map(([l,v]) => <div key={l}><span>{l}</span><strong>{v}</strong></div>)}</div>
      <div className="admin-table-scroll"><table className="admin-table"><thead><tr><th>邀请者</th><th>下单／实付／交付</th><th>实付转化／成功转化</th><th>实付／退款／净收</th><th>奖励发放／待生效</th><th>奖励余额／占用／使用</th></tr></thead><tbody>{data.rows.map(r => <tr key={r.id}><td>{r.email}</td><td>{r.orders}／{r.paid_orders}／{r.delivered_orders}<small>{r.buyers} 位下单用户 · {r.refunded_orders} 笔退款</small></td><td>{rate(r.paid_buyers,r.buyers)}／{rate(r.converted_buyers,r.buyers)}<small>{r.converted_buyers} 位成功转化用户</small></td><td>{money(r.paid_cents)}／{money(r.refunded_cents)}<small>净收 {money(r.paid_cents-r.refunded_cents)}</small></td><td>{money(r.issued_cents)}／{money(r.pending_cents)}<small>{r.rewards} 笔（发放含后来撤销）</small></td><td>{money(r.available_cents)}／{money(r.reserved_cents)}／{money(r.used_cents)}<small>退款恢复 {money(r.restored_cents)}</small></td></tr>)}</tbody></table></div>{!data.rows.length && <p className="admin-empty">暂无符合条件的邀请者。</p>}<Pager page={page} size={data.rows.length} change={setPage} /><p>快照时间：{at(data.generatedAt)}。奖励使用和余额按这些来源订单产生的奖励计算，反映当前状态。</p></>}
  </section>
}
