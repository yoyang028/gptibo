import { useState } from 'react'
import {
  ArrowUpRight,
  Bell,
  Settings2,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { StoresWorkspace } from '@/partner/StoresWorkspace'
import { ProductManagement } from '@/partner/ProductManagement'
import { NotificationSettings } from '@/partner/NotificationSettings'
import { WorkspaceTabs, WorkspaceSelect } from '@/partner/workspace-ui'
import { useResource } from '@/lib/use-resource'
import type { StorefrontProductId } from '../../shared/product-order'
import type { Offer } from '@/partner/model'
import '@/partner/partner.css'
import '@/partner/workspace.css'
import '@/components/shop-products.css'

export default function MyShop({
  revision,
  storeId,
  onStoreChange: setStoreId,
  onSaved,
  onManageProducts,
}: {
  revision: number
  storeId: string
  onStoreChange: (id: string) => void
  onSaved: () => void
  onManageProducts: () => void
}) {
  const [tab, setTab] = useState('stores')
  const { data } = useResource<{
    stores: { id: string; name: string; slug: string; storefront_url: string }[]
    prices: {
      store_id: string
      plan: string
      name: string
      product_id: string
      cost_cents: number
      cost_known?: boolean
      price_cents: number
      version: number
      enabled: boolean
    }[]
  }>('/api/admin/my-shop/stores', revision)
  const offers: Offer[] = (data?.prices ?? []).filter(p => p.store_id === storeId).map((p) => ({
    ...p,
    id: p.plan,
    enabled: Number(p.enabled),
    renewal_only: 0,
  }))
  const selected = data?.stores.find(s => s.id === storeId)
  const storePath = selected?.slug ? '/s/' + selected.slug : '/'
  const storeUrl = selected?.storefront_url ?? location.origin + storePath
  return (
    <div className="owner-shop-canvas">
      <div className="partner-section-heading">
        <div>
          <h2>店铺管理</h2>
          <p>管理自营店铺的形象、售价、商品排序和通知。</p>
        </div>
        <a href={storeUrl} target="_blank" rel="noreferrer">
          预览当前店铺 <ArrowUpRight size={14} />
        </a>
      </div>
      {data && <WorkspaceSelect label="当前店铺" value={storeId} options={data.stores.map(s => ({value:s.id,label:s.name}))} onValueChange={setStoreId} />}
      <WorkspaceTabs
        label="我的店铺工作台"
        value={tab}
        onValueChange={setTab}
        items={[
          {
            value: 'stores',
            label: '我的商店',
            content: (
              <StoresWorkspace
                owner
                selectedStoreId={storeId}
                onStoreChange={setStoreId}
                prefix="/api/admin/my-shop"
                revision={revision}
                active={tab === 'stores'}
                onSaved={onSaved}
                publishingContent={
                  <div className="admin-panel-title"><div><h3>商品管理</h3><p className="stores-help">商品上架、定价与供货 API 已按服务商统一管理。</p></div><Button variant="outline" onClick={onManageProducts}>进入商品管理</Button></div>
                }
                sortingContent={
                  <ProductManagement
                    customProducts={[
                      ...new Map(
                        offers
                          .filter((p) => p.product_id.startsWith('custom-'))
                          .map((p) => ({
                            id: p.product_id as StorefrontProductId,
                            name: p.name,
                          }))
                          .map((p) => [p.id, p]),
                      ).values(),
                    ]}
                    endpoint={'/api/admin/my-shop/product-order?store=' + storeId}
                    plans={offers}
                    storeUrl={storeUrl}
                    onSaved={onSaved}
                  />
                }
              />
            ),
          },
          {
            value: 'settings',
            label: '账号设置',
            content: (
              <WorkspaceTabs
                label="店铺账号设置"
                items={[
                  {
                    value: 'notifications',
                    label: '订单通知',
                    content: (
                      <NotificationSettings
                        endpoint={'/api/admin/my-shop/notification-settings?store=' + storeId}
                        revision={revision}
                        readOnly={false}
                      />
                    ),
                  },
                  {
                    value: 'appearance',
                    label: '显示偏好',
                    content: (
                      <div className="admin-panel">
                        <h3>
                          <Settings2 size={18} />
                          工作台显示
                        </h3>
                        <p>
                          外观与主后台保持一致，使用左侧底部的主题按钮切换。
                        </p>
                        <p>
                          <Bell size={15} />
                          店铺形象、联系方式和公告在「我的商店 →
                          编辑商店」中管理。
                        </p>
                      </div>
                    ),
                  },
                ]}
              />
            ),
          },
        ]}
      />
    </div>
  )
}
