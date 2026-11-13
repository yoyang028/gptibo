import { useState } from 'react'
import { ArrowUpRight } from 'lucide-react'
import { VisitorStats, type VisitorPeriod, type VisitorSummary } from '@/components/visitor-stats'
import { Feedback } from '@/components/workspace-loading'
import { useResource } from '@/lib/use-resource'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { partnerStorefrontPath } from '../../shared/partner-link.ts'

type StoreTraffic = { id: string; name: string; active: number; visitors: number; pageViews: number; storefront_url?: string }
type AdminSummary = VisitorSummary & {
  platform: { visitors: number; pageViews: number }
  ownerStores?: StoreTraffic[]
  partners: { id: string; name: string; slug: string; active: number; visitors: number; pageViews: number }[]
}

export default function AdminVisitorsPage({ revision }: { revision: number }) {
  const [selected, setSelected] = useState<{ id: string; name: string; owner: boolean }>()
  const [days, setDays] = useState<VisitorPeriod>(7)
  const { data, error, loading } = useResource<AdminSummary>(`/api/admin/visitors?days=${days}`, revision)
  const ownerStores: StoreTraffic[] = data?.ownerStores ?? (data ? [{ id: 'platform', name: '平台直营', active: 1, storefront_url: '/', ...data.platform }] : [])

  return (
    <>
      <VisitorStats
        endpoint="/api/admin/visitors"
        revision={revision}
        title="全站访问趋势"
        description="全平台直营与所有代理商店的综合访问与页面浏览走势"
        selectedDays={days}
        onDaysChange={setDays}
      />
      <section className="admin-panel visitor-shops-panel">
        <div className="admin-panel-title">
          <div>
            <h2>各商店渠道访客</h2>
            <span>最近 {days} 天 · 独立访客按商店分别去重统计</span>
          </div>
          {data && <span>共 {data.partners.length + ownerStores.length} 个访问来源</span>}
        </div>
        <Feedback error={error} loading={loading} data={data} shape="compact" />
        {data && (
          <div className="admin-table-scroll">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>商店渠道</th>
                  <th>商店访问入口</th>
                  <th>独立访客 (UV)</th>
                  <th>页面浏览量 (PV)</th>
                  <th>人均浏览深度</th>
                  <th><span className="sr-only">操作</span></th>
                </tr>
              </thead>
              <tbody>
                {ownerStores.map(store => <tr key={store.id}>
                  <td>
                    <strong>{store.name}</strong>
                    <small>自营商店 · {store.active ? '营业中' : '已停用'}</small>
                  </td>
                  <td>{store.storefront_url && <a href={store.storefront_url} target="_blank" rel="noreferrer">{store.storefront_url}</a>}</td>
                  <td className="admin-numeric"><strong>{store.visitors.toLocaleString('zh-CN')}</strong></td>
                  <td className="admin-numeric">{store.pageViews.toLocaleString('zh-CN')}</td>
                  <td className="admin-numeric">
                    {store.visitors > 0 ? (store.pageViews / store.visitors).toFixed(1) : '0.0'} 页/人
                  </td>
                  <td><Button variant="ghost" size="sm" onClick={() => setSelected({ ...store, owner: true })}>查看趋势 <ArrowUpRight size={13} /></Button></td>
                </tr>)}
                {data.partners.map((partner) => (
                  <tr key={partner.id}>
                    <td>
                      <strong>{partner.name}</strong>
                      <small className={partner.active ? 'text-success' : ''}>
                        {partner.active ? '已启用' : '已停用'}
                      </small>
                    </td>
                    <td><code>{partnerStorefrontPath(partner.slug)}</code></td>
                    <td className="admin-numeric"><strong>{partner.visitors.toLocaleString('zh-CN')}</strong></td>
                    <td className="admin-numeric">{partner.pageViews.toLocaleString('zh-CN')}</td>
                    <td className="admin-numeric">
                      {partner.visitors > 0 ? (partner.pageViews / partner.visitors).toFixed(1) : '0.0'} 页/人
                    </td>
                    <td>
                      <Button variant="ghost" size="sm" onClick={() => setSelected({ ...partner, owner: false })}>
                        查看趋势 <ArrowUpRight size={13} />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      {selected && (
        <Dialog open onOpenChange={(open) => { if (!open) setSelected(undefined) }}>
          <DialogContent className="motion-dialog visitor-detail-dialog">
            <DialogHeader>
              <DialogTitle>{selected.name} · 专属商店访问趋势</DialogTitle>
              <DialogDescription>
                {selected.owner ? '仅统计所选自营店及对应商品页面的访问数据。' : '仅统计该代理专属推广链接及对应商品的浏览数据。'}
              </DialogDescription>
            </DialogHeader>
            <VisitorStats
              endpoint={selected.owner ? `/api/admin/my-shop/visitors?store=${selected.id}` : `/api/admin/partners/${selected.id}/visitors`}
              revision={revision}
              title={`${selected.name} 访客走势`}
              description={selected.owner ? '所选店铺独立访客与浏览量趋势' : '专属推广链接独立访客与浏览量趋势'}
              selectedDays={days}
              onDaysChange={setDays}
            />
          </DialogContent>
        </Dialog>
      )}
    </>
  )
}
