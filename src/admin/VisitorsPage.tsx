import { useState } from 'react'
import { ArrowUpRight } from 'lucide-react'
import { VisitorStats, VisitorStatsPanel, type VisitorPeriod, type VisitorSummary } from '@/components/visitor-stats'
import { useResource } from '@/lib/use-resource'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { partnerStorefrontPath } from '../../shared/partner-link.ts'
import { WorkspaceSelect } from '@/partner/workspace-ui'
import { ownerStoreOptions, storeScopeParams, type AdminAudience, type AdminStoreOption } from '../../shared/admin-store-scope'
import { AdminAudienceSwitch } from './AdminAudienceSwitch'

const VISITOR_POLL_INTERVAL = 60_000

type StoreTraffic = { id: string; name: string; active: number; visitors: number; pageViews: number; storefront_url?: string }
type AdminSummary = VisitorSummary & {
  platform: { visitors: number; pageViews: number }
  ownerStores?: StoreTraffic[]
  partners: { id: string; name: string; slug: string; active: number; visitors: number; pageViews: number }[]
}

export default function AdminVisitorsPage({ revision, stores }: { revision: number; stores: AdminStoreOption[] }) {
  const [selected, setSelected] = useState<{ id: string; name: string; owner: boolean }>()
  const [days, setDays] = useState<VisitorPeriod>(7)
  const [audience, setAudience] = useState<AdminAudience>('owner')
  const [store, setStore] = useState('owner')
  const hasStoreReporting = stores.length > 0
  const scope = hasStoreReporting ? audience === 'owner' ? store : 'agent' : 'all'
  const query = storeScopeParams(scope, new URLSearchParams({ days:String(days) }))
  const resource = useResource<AdminSummary>(`/api/admin/visitors?${query}`, revision, { pollInterval: VISITOR_POLL_INTERVAL, retainOnError: true })
  const { data } = resource
  const current = stores.find(store => store.id === scope)
  const title = current ? `${current.name}访问趋势` : scope === 'owner' ? '自营店访问趋势' : scope === 'agent' ? '代理店访问趋势' : '全站访问趋势'
  const ownerStores: StoreTraffic[] = data?.ownerStores ?? (data ? [{ id: 'platform', name: '平台直营', active: 1, storefront_url: '/', ...data.platform }] : [])

  return (
    <>
      {hasStoreReporting && <AdminAudienceSwitch label="访客渠道" ownerLabel="直营访客" agentLabel="代理访客" audience={audience} onChange={setAudience} />}
      <VisitorStatsPanel
        {...resource}
        updatedAt={resource.fetchedAt}
        title={title}
        description={days === 1 ? '北京时间今日的访客与浏览量' : `北京时间 · 最近 ${days} 天的访客与浏览量`}
        action={hasStoreReporting && audience === 'owner' && <div className="admin-store-control"><label htmlFor="visitor-store">访问店铺</label><WorkspaceSelect id="visitor-store" label="访问店铺" value={store} options={ownerStoreOptions(stores)} onValueChange={setStore} /></div>}
        days={days}
        onDaysChange={setDays}
      />
      {!current && data && <section className="admin-panel visitor-shops-panel" aria-label="各店访问分布">
        <div className="admin-panel-title">
          <div>
            <h2>{scope === 'owner' ? '自营店访问分布' : scope === 'agent' ? '代理店访问分布' : '各店访问分布'}</h2>
            <span>{days === 1 ? '今天' : `最近 ${days} 天`} · 独立访客按店去重</span>
          </div>
          <span>{data.partners.length + ownerStores.length} 家店铺</span>
        </div>
        {data.partners.length + ownerStores.length > 0 ? (
          <div className="admin-table-scroll">
            <table className="admin-table admin-traffic-table">
              <colgroup>{[18,26,14,14,15,13].map((width,index) => <col key={index} style={{ width:width+'%' }} />)}</colgroup>
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
                  <td><Button variant="ghost" size="sm" onClick={() => hasStoreReporting ? setStore(store.id) : setSelected({ ...store, owner:true })}>查看趋势 <ArrowUpRight size={13} /></Button></td>
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
        ) : <div className="admin-empty"><h3>此范围暂无店铺</h3></div>}
      </section>}
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
              pollInterval={VISITOR_POLL_INTERVAL}
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
