import { useState, type ReactNode } from 'react'
import {
  ArrowUpRight,
  Bell,
  ChartNoAxesCombined,
  Contact,
  ReceiptText,
  Settings2,
  Store,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { StoresWorkspace } from '@/partner/StoresWorkspace'
import { ProductManagement } from '@/partner/ProductManagement'
import { NotificationSettings } from '@/partner/NotificationSettings'
import { WorkspaceTabs } from '@/partner/workspace-ui'
import { VisitorStats } from '@/components/visitor-stats'
import { useResource } from '@/lib/use-resource'
import type { StorefrontProductId } from '../../shared/product-order'
import type { Offer } from '@/partner/model'
import ProductPublisher from './ProductPublisher'
import '@/partner/partner.css'
import '@/partner/workspace.css'
import '@/components/shop-products.css'

export default function MyShop({
  revision,
  onSaved,
  orders,
  customers,
  accounting,
  refunds,
}: {
  revision: number
  onSaved: () => void
  orders: ReactNode
  customers: ReactNode
  accounting: ReactNode
  refunds: ReactNode
}) {
  const [tab, setTab] = useState('stores')
  const { data } = useResource<{
    prices: {
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
  const offers: Offer[] = (data?.prices ?? []).map((p) => ({
    ...p,
    id: p.plan,
    enabled: Number(p.enabled),
    renewal_only: 0,
  }))
  return (
    <div className="owner-shop-canvas">
      <div className="partner-section-heading">
        <div>
          <h2>店铺管理</h2>
          <p>管理店铺形象、商品、订单与客户，经营自己的主商城。</p>
        </div>
        <a href="/" target="_blank" rel="noreferrer">
          预览主商城 <ArrowUpRight size={14} />
        </a>
      </div>
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
                prefix="/api/admin/my-shop"
                revision={revision}
                active={tab === 'stores'}
                onSaved={onSaved}
                publishingContent={
                  <ProductPublisher revision={revision} onSaved={onSaved} />
                }
                sortingContent={
                  <ProductManagement
                    customProducts={offers
                      .filter((p) => p.product_id.startsWith('custom-'))
                      .map((p) => ({
                        id: p.product_id as StorefrontProductId,
                        name: p.name,
                      }))}
                    endpoint="/api/admin/my-shop/product-order"
                    plans={offers}
                    storeUrl={location.origin + '/'}
                    onSaved={onSaved}
                  />
                }
              />
            ),
          },
          {
            value: 'orders',
            label: '订单收益',
            content: (
              <WorkspaceTabs
                label="订单与收益"
                items={[
                  { value: 'orders', label: '订单明细', content: orders },
                  {
                    value: 'accounting',
                    label: '清账与结算',
                    content: (
                      <>
                        <p className="stores-help">
                          平台代收的实际利润结算与提现在供货平台核对；这里展示本店订单账目，不生成虚拟提现记录。
                        </p>
                        {accounting}
                      </>
                    ),
                  },
                  { value: 'refunds', label: '退款与售后', content: refunds },
                ]}
              />
            ),
          },
          { value: 'customers', label: '我的客户', content: customers },
          {
            value: 'visitors',
            label: '访客统计',
            content: (
              <VisitorStats
                endpoint="/api/admin/my-shop/visitors"
                revision={revision}
                title="主商城访问趋势"
                description="统计主商城及商品详情页的访客与浏览量"
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
                        endpoint="/api/admin/my-shop/notification-settings"
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
      <div className="owner-shop-module">
        <Button variant="ghost" onClick={() => setTab('stores')}>
          <Store size={14} />
          商店
        </Button>
        <Button variant="ghost" onClick={() => setTab('orders')}>
          <ReceiptText size={14} />
          订单
        </Button>
        <Button variant="ghost" onClick={() => setTab('customers')}>
          <Contact size={14} />
          客户
        </Button>
        <Button variant="ghost" onClick={() => setTab('visitors')}>
          <ChartNoAxesCombined size={14} />
          访客
        </Button>
      </div>
    </div>
  )
}
