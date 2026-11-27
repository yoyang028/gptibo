import { useRef, useState } from 'react'
import { Settings2, Check } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Alert,AlertDescription } from '@/components/ui/alert'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table'
import { Tabs,TabsList,TabsTrigger,TabsContent } from '@/components/ui/tabs'
import { WorkspacePanel,WorkspaceMetrics } from '@/components/workspace-controls'
import { WorkspaceSelect } from '@/partner/workspace-ui'
import { Feedback } from '@/components/workspace-loading'
import { api, errorMessage } from '@/lib/api'
import { useResource } from '@/lib/use-resource'
import type { AccountingCost, AccountingDetail, AccountingGroup, AccountingSummary, AccountingTotals } from '../../shared/accounting.ts'
import { ownerStoreOptions, storeScopeParams, type AdminAudience, type AdminStoreOption } from '../../shared/admin-store-scope'
import AccountingReport from './AccountingReport'
import { AdminAudienceSwitch } from './AdminAudienceSwitch'

const money=(cents:number)=>new Intl.NumberFormat('zh-CN',{style:'currency',currency:'CNY'}).format(cents/100)
const time=(value:number)=>new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false}).format(value)
const profit=(totals:AccountingTotals)=>totals.missing_cost_count?'待补成本':money(totals.profit_cents)
function Groups({groups}:{groups:AccountingGroup[]}) {
  return <><Table className="workspace-table"><TableHeader><TableRow>{['套餐','完成订单','付款金额','采购成本','退款扣减','利润'].map(s=><TableHead key={s}>{s}</TableHead>)}</TableRow></TableHeader><TableBody>{groups.map(g=><TableRow key={g.plan}><TableCell><strong>{g.plan_name}</strong>{g.adjustment_count>0&&<small>含 {g.adjustment_count} 笔退款调整</small>}</TableCell><TableCell>{g.order_count}</TableCell><TableCell>{money(g.sale_cents)}</TableCell><TableCell>{g.missing_cost_count?'待补成本':money(g.cost_cents)}</TableCell><TableCell>{money(g.refund_cents)}</TableCell><TableCell><strong>{profit(g)}</strong></TableCell></TableRow>)}</TableBody></Table>{!groups.length&&<div className="workspace-empty"><h3>暂无待清账订单</h3><p>真实付款且完成的订单会汇总在这里。</p></div>}</>
}
function Costs({costs,version,onUpdated,onClose}:{costs:AccountingCost[];version:number;onUpdated:()=>void;onClose:()=>void}) {
  const [values,setValues]=useState(()=>Object.fromEntries(costs.map(c=>[c.plan,c.cost_cents===null?'':String(c.cost_cents/100)])))
  const [busy,setBusy]=useState(false);const [error,setError]=useState('')
  async function save() {
    if(busy)return
    if(costs.some(c=>values[c.plan]!==''&&(!/^\d+(\.\d{1,2})?$/.test(values[c.plan])||Number(values[c.plan])>100000))){setError('请输入 0–100000 元的采购成本，最多两位小数。');return}
    setBusy(true);setError('')
    try{await api('/api/admin/accounting/costs',{version,costs:costs.map(c=>({plan:c.plan,cost_cents:values[c.plan]===''?null:Math.round(Number(values[c.plan])*100)}))});onUpdated();onClose()}catch(e){setError(errorMessage(e))}finally{setBusy(false)}
  }
  return <Dialog open onOpenChange={open=>{if(!open&&!busy)onClose()}}><DialogContent className="workspace-dialog workspace-edit-dialog motion-dialog"><DialogHeader><DialogTitle>采购成本设置</DialogTitle><DialogDescription>单位：元 / 单。修改仅用于尚未清账的订单，历史清账保留原成本。</DialogDescription></DialogHeader><form className="workspace-form" onSubmit={e=>{e.preventDefault();void save()}}><div className="workspace-form-grid">{costs.map(c=><div className="workspace-control" key={c.plan}><Label htmlFor={'cost-'+c.plan}>{c.name}{c.plan==='pro-20x'?'（原 20×）':''}</Label><Input id={'cost-'+c.plan} value={values[c.plan]} onChange={e=>setValues(v=>({...v,[c.plan]:e.target.value}))} inputMode="decimal" placeholder="待填写" disabled={busy}/></div>)}</div><p className="workspace-caption">未知成本请留空；需补齐相关订单成本后才能清账。</p><Feedback error={error}/><div className="workspace-actions"><Button variant="outline" type="button" disabled={busy} onClick={onClose}>取消</Button><Button type="submit" disabled={busy}>{busy?'保存中…':'保存采购成本'}</Button></div></form></DialogContent></Dialog>
}
function Detail({id,scope,onClose}:{id:string;scope:string;onClose:()=>void}) {
  const [page,setPage]=useState(1)
  const query = storeScopeParams(scope, new URLSearchParams({ page:String(page) }))
  const {data,error,loading}=useResource<AccountingDetail>(`/api/admin/accounting/${id}?${query}`)
  return <Dialog open onOpenChange={open=>{if(!open)onClose()}}><DialogContent className="workspace-dialog motion-dialog"><DialogHeader><DialogTitle>清账明细</DialogTitle><DialogDescription>{data?`${time(data.settlement.from_at)} 至 ${time(data.settlement.closed_at)}（北京时间）`:'查看已保存的订单和利润。'}</DialogDescription></DialogHeader><Feedback error={error} loading={loading} data={data}/>{data&&<><WorkspaceMetrics items={[{label:'本次利润',value:money(data.settlement.profit_cents),accent:true},{label:'完成订单',value:data.settlement.order_count},{label:'付款金额',value:money(data.settlement.sale_cents)},{label:'采购成本',value:money(data.settlement.cost_cents)}]}/><Groups groups={data.groups}/><Table className="workspace-table"><TableHeader><TableRow>{['订单','类型','付款','成本','退款','利润'].map(s=><TableHead key={s}>{s}</TableHead>)}</TableRow></TableHeader><TableBody>{data.items.map(i=><TableRow key={i.order_id + ':' + i.kind}><TableCell><strong>{i.plan_name}</strong><small>{i.order_id}</small>{i.store_name && <small>{i.store_name}</small>}</TableCell><TableCell>{i.kind==='refund'?'退款调整':'完成订单'}</TableCell><TableCell>{money(i.sale_cents)}</TableCell><TableCell>{money(i.cost_cents)}</TableCell><TableCell>{money(i.refund_cents)}</TableCell><TableCell>{money(i.sale_cents-i.cost_cents-i.refund_cents)}</TableCell></TableRow>)}</TableBody></Table>{data.total>50&&<div className="workspace-page-bar"><span>共 {data.total} 条 · 第 {page} 页</span><div><Button variant="outline" disabled={page===1||loading} onClick={()=>setPage(p=>p-1)}>上一页</Button><Button variant="outline" disabled={page*50>=data.total||loading} onClick={()=>setPage(p=>p+1)}>下一页</Button></div></div>}</>}</DialogContent></Dialog>
}
function PendingMetrics({ totals }: { totals: AccountingTotals }) {
  return <WorkspaceMetrics items={[
    { label:'本次利润', value:profit(totals), accent:true },
    { label:'完成订单', value:`${totals.order_count} 单` },
    { label:'付款金额', value:money(totals.sale_cents) },
    { label:'采购成本', value:totals.missing_cost_count ? '待补成本' : money(totals.cost_cents) },
  ]} />
}

function ClosePeriod({ onClose, onCompleted }: { onClose: () => void; onCompleted: (profitCents: number) => void }) {
  const [retry, setRetry] = useState(0)
  const { data, error, loading } = useResource<AccountingSummary>('/api/admin/accounting', retry)
  const [busy, setBusy] = useState(false)
  const [saveError, setSaveError] = useState('')
  const requestKey = useRef<{ version:number; key:string } | null>(null)
  const canRecord = data && !loading && !data.totals.missing_cost_count && (data.totals.order_count + data.totals.adjustment_count) > 0

  async function record() {
    if (!canRecord || busy) return
    if (requestKey.current?.version !== data.version) requestKey.current = { version:data.version, key:crypto.randomUUID() }
    setBusy(true); setSaveError('')
    try {
      const result = await api<{ settlement:AccountingDetail['settlement'] }>('/api/admin/accounting/close', requestKey.current)
      onCompleted(result.settlement.profit_cents)
    } catch (e) {
      setSaveError(errorMessage(e)); setRetry(v => v + 1)
    } finally { setBusy(false) }
  }

  return <Dialog open onOpenChange={open => { if (!open && !busy) onClose() }}>
    <DialogContent className="workspace-dialog motion-dialog" showCloseButton={!busy}>
      <DialogHeader>
        <DialogTitle>记录全站清账</DialogTitle>
        <DialogDescription>将直营和代理的待清账目一并存入全站账期，再开启下一期。</DialogDescription>
      </DialogHeader>
      <Feedback error={saveError || error} loading={loading} data={data} />
      {data && <>
        <PendingMetrics totals={data.totals} />
        <p className="workspace-caption">退款扣减 {money(data.totals.refund_cents)} · 待核对 {data.heldCount} 笔</p>
      </>}
      <div className="workspace-actions">
        <Button variant="outline" onClick={onClose} disabled={busy}>取消</Button>
        <Button onClick={() => void record()} disabled={busy || !canRecord}>{busy ? '记录中…' : '确认记录全站清账'}</Button>
      </div>
    </DialogContent>
  </Dialog>
}

function Settlements({ revision, scope, onUpdated }: { revision: number; scope: string; onUpdated: () => void }) {
  const [page, setPage] = useState(1)
  const query = storeScopeParams(scope, new URLSearchParams({ page:String(page) }))
  const { data, error, loading } = useResource<AccountingSummary>(`/api/admin/accounting?${query}`, revision)
  const [message, setMessage] = useState('')
  const [detail, setDetail] = useState<string>()
  const [costsOpen, setCostsOpen] = useState(false)
  const [closeOpen, setCloseOpen] = useState(false)

  return <>
    <Feedback error={error} loading={loading} data={data} />
    {message && <Alert><Check size={15} /><AlertDescription>{message}</AlertDescription></Alert>}
    {data && <>
      <WorkspacePanel title="本期待清账" description={data.fromAt === null ? '从最早的完成订单起算 · 北京时间' : `本期起算 ${time(data.fromAt)} · 北京时间`}
        action={<div className="workspace-contact-list">
          <Button variant="outline" onClick={() => setCostsOpen(true)}><Settings2 size={15} />采购成本</Button>
          <Button variant="outline" onClick={() => setCloseOpen(true)}>记录全站清账</Button>
        </div>}>
        <PendingMetrics totals={data.totals} />
        <Groups groups={data.groups} />
        <p className="workspace-caption">
          清账利润 = 客户付款 − 采购成本 − 退款（本期扣减 {money(data.totals.refund_cents)}），尚未扣除代理分成。较早下单、后来完成的订单会补入下一期。
          <br />待核对 {data.heldCount} 笔，解除后补入。更新于 {time(data.asOf)}。
        </p>
      </WorkspacePanel>
      <WorkspacePanel title="历史清账记录" description={`共 ${data.historyTotal} 次 · 每期沿用记录时的成本与金额`}>
        {data.history.length ? <Table className="workspace-table admin-accounting-table">
          <TableHeader><TableRow>{['统计周期（北京时间）','订单 / 调整','付款金额','采购成本','退款扣减','利润','操作'].map(title => <TableHead key={title}>{title}</TableHead>)}</TableRow></TableHeader>
          <TableBody>{data.history.map(h => <TableRow key={h.id}>
            <TableCell><strong>{time(h.closed_at)}</strong><small>起于 {time(h.from_at)}</small></TableCell>
            <TableCell>{h.order_count} 单 / {h.adjustment_count} 笔</TableCell>
            <TableCell>{money(h.sale_cents)}</TableCell><TableCell>{money(h.cost_cents)}</TableCell>
            <TableCell>{money(h.refund_cents)}</TableCell><TableCell><strong>{money(h.profit_cents)}</strong></TableCell>
            <TableCell><Button size="sm" variant="outline" onClick={() => setDetail(h.id)}>明细</Button></TableCell>
          </TableRow>)}</TableBody>
        </Table> : <div className="workspace-empty"><h3>此范围暂无清账记录</h3><p>账期保存后可以在这里查看。</p></div>}
        {data.historyTotal > 10 && <div className="workspace-page-bar"><span>第 {page} 页</span><div>
          <Button variant="outline" disabled={page === 1 || loading} onClick={() => setPage(p => p - 1)}>上一页</Button>
          <Button variant="outline" disabled={page * 10 >= data.historyTotal || loading} onClick={() => setPage(p => p + 1)}>下一页</Button>
        </div></div>}
      </WorkspacePanel>
    </>}
    {detail && <Detail key={detail} id={detail} scope={scope} onClose={() => setDetail(undefined)} />}
    {costsOpen && data && <Costs costs={data.costs} version={data.version} onUpdated={onUpdated} onClose={() => setCostsOpen(false)} />}
    {closeOpen && <ClosePeriod onClose={() => setCloseOpen(false)} onCompleted={profitCents => {
      setCloseOpen(false); setPage(1)
      setMessage(`全站清账已记录，本次利润 ${money(profitCents)}。`)
      onUpdated()
    }} />}
  </>
}

export default function AccountingPage({ revision, stores }: { revision:number; stores:AdminStoreOption[] }) {
  const [audience, setAudience] = useState<AdminAudience>('owner')
  const [store, setStore] = useState('owner')
  const [recordsRevision, setRecordsRevision] = useState(0)
  const hasStoreReporting = stores.length > 0
  const scope = hasStoreReporting ? audience === 'owner' ? store : 'agent' : 'all'
  return <>
    {hasStoreReporting && <AdminAudienceSwitch label="清账渠道" ownerLabel="直营清账" agentLabel="代理清账" audience={audience} onChange={setAudience} />}
    <Tabs defaultValue="report" className="accounting-workspace-tabs state-enter">
      <div className="admin-accounting-controls">
        <TabsList variant="line" aria-label="财务统计导航"><TabsTrigger value="report">订单利润分析</TabsTrigger><TabsTrigger value="settlements">清账与记录</TabsTrigger></TabsList>
        {hasStoreReporting && audience === 'owner' && <div className="admin-store-control"><label htmlFor="accounting-store">账目店铺</label><WorkspaceSelect id="accounting-store" label="账目店铺" value={store} options={ownerStoreOptions(stores)} onValueChange={setStore} /></div>}
      </div>
      <TabsContent value="report" className="state-enter"><AccountingReport revision={revision + recordsRevision} scope={scope} /></TabsContent>
      <TabsContent value="settlements" className="state-enter"><Settlements key={scope} revision={revision + recordsRevision} scope={scope} onUpdated={() => setRecordsRevision(v => v + 1)} /></TabsContent>
    </Tabs>
  </>
}
