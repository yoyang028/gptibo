import { useState } from 'react'
import { ArrowUpRight } from 'lucide-react'
import { VisitorStats, VisitorTrend, type VisitorPeriod, type VisitorSummary } from '@/components/visitor-stats'
import { useResource } from '@/lib/use-resource'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { ownerStoreId, type AdminStoreScope } from '../../shared/admin-workspace'

type StoreTraffic = { id: string; name: string; active: number; visitors: number; pageViews: number }
type AdminSummary = VisitorSummary & { ownerStores?: StoreTraffic[]; partners?: StoreTraffic[] }

export default function AdminVisitorsPage({ revision, scope, scopeLabel, onScopeChange }: {
  revision: number
  scope: AdminStoreScope
  scopeLabel: string
  onScopeChange: (scope: AdminStoreScope) => void
}) {
  const [partner, setPartner] = useState<StoreTraffic>()
  const [days, setDays] = useState<VisitorPeriod>(7)
  const store = ownerStoreId(scope)
  const endpoint = store ? `/api/admin/my-shop/visitors?store=${store}&days=${days}` : `/api/admin/visitors?scope=${scope}&days=${days}`
  const resource = useResource<AdminSummary>(endpoint, revision)
  const owners = resource.data?.ownerStores ?? []
  const partners = resource.data?.partners ?? []

  return <>
    <VisitorTrend {...resource} days={days} setDays={setDays} title={`${scopeLabel} · 访问趋势`} />
    {!store && resource.data && (
      <section className="admin-panel visitor-shops-panel">
        <div className="admin-panel-title">
          <div><h2>渠道分布</h2><span>独立访客按各店分别去重</span></div>
        </div>
        <div className="admin-table-scroll">
          <table className="admin-table">
            <thead><tr><th>渠道</th><th>独立访客 (UV)</th><th>页面浏览量 (PV)</th><th>人均浏览</th><th><span className="sr-only">操作</span></th></tr></thead>
            <tbody>
              {[...owners.map(row => ({ row, ownStore: ownerStoreId(row.id) })), ...partners.map(row => ({ row, ownStore: undefined }))].map(({ row, ownStore }) => (
                <tr key={row.id}>
                  <td><strong>{row.name}</strong><small>{ownStore ? '自营店铺' : '代理渠道'} · {row.active ? '营业中' : '已停用'}</small></td>
                  <td className="admin-numeric">{row.visitors.toLocaleString('zh-CN')}</td>
                  <td className="admin-numeric">{row.pageViews.toLocaleString('zh-CN')}</td>
                  <td className="admin-numeric">{row.visitors ? (row.pageViews / row.visitors).toFixed(1) : '0.0'} 页/人</td>
                  <td><Button variant="ghost" size="sm" onClick={() => ownStore ? onScopeChange(ownStore) : setPartner(row)}>查看趋势 <ArrowUpRight size={13} /></Button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    )}
    {partner && <Dialog open onOpenChange={open => { if (!open) setPartner(undefined) }}>
      <DialogContent className="motion-dialog visitor-detail-dialog">
        <DialogHeader>
          <DialogTitle>{partner.name} · 代理商店访问趋势</DialogTitle>
          <DialogDescription>该代理推广链接及对应商品的访问数据。</DialogDescription>
        </DialogHeader>
        <VisitorStats endpoint={`/api/admin/partners/${partner.id}/visitors`} revision={revision} title="访问趋势" selectedDays={days} onDaysChange={setDays} />
      </DialogContent>
    </Dialog>}
  </>
}
