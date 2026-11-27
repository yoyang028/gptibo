import { Settings2 } from 'lucide-react'
import { StoresWorkspace } from '@/partner/StoresWorkspace'
import { NotificationSettings } from '@/partner/NotificationSettings'
import '@/partner/partner.css'
import '@/partner/workspace.css'
import '@/components/shop-products.css'

export default function MyShop({ revision, storeId, onStoreChange, onSaved }: {
  revision: number
  storeId: string
  onStoreChange: (id: string) => void
  onSaved: () => void
}) {
  return (
    <div className="owner-shop-canvas">
      <StoresWorkspace
        owner
        selectedStoreId={storeId}
        onStoreChange={onStoreChange}
        prefix="/api/admin/my-shop"
        revision={revision}
        onSaved={onSaved}
        ownerSettings={<>
          <div className="admin-panel owner-settings-card">
            <NotificationSettings
              key={storeId}
              endpoint={'/api/admin/my-shop/notification-settings?store=' + storeId}
              revision={revision}
              readOnly={false}
              recipientNote="使用后台配置的管理员邮箱。"
            />
          </div>
          <section className="admin-panel owner-settings-card">
            <div className="stores-heading"><h3><Settings2 size={18} />显示偏好</h3></div>
            <p className="stores-help">通过后台右上角的主题按钮切换浅色和深色模式。</p>
          </section>
        </>}
      />
    </div>
  )
}
