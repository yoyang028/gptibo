import { StoresWorkspace } from '@/partner/StoresWorkspace'
import { ProductManagement } from '@/partner/ProductManagement'
import { NotificationSettings } from '@/partner/NotificationSettings'
import { Feedback } from '@/components/workspace-loading'
import { useResource } from '@/lib/use-resource'
import type { StorefrontProductId } from '../../shared/product-order'
import type { AdminStore, OwnerStoreId } from '../../shared/admin-workspace'
import type { Offer } from '@/partner/model'
import '@/partner/partner.css'
import '@/partner/workspace.css'
import '@/components/shop-products.css'

const endpoint = '/api/admin/my-shop'

export default function MyShop({ section, storeId, edit, onCloseEditor, onOpen, revision, onSaved }: {
  section: 'stores' | 'domains' | 'notifications' | 'prices' | 'coupons'
  storeId: OwnerStoreId
  edit?: OwnerStoreId
  onCloseEditor?: () => void
  onOpen?: (store: string, section: 'orders' | 'customers' | 'visitors') => void
  revision: number
  onSaved: () => void
}) {
  if (section === 'notifications') {
    return <NotificationSettings key={storeId} endpoint={`${endpoint}/notification-settings?store=${storeId}`} revision={revision} readOnly={false} />
  }
  return <StoresWorkspace prefix={endpoint} owner={{ section, storeId, edit, onCloseEditor, onOpen }} revision={revision} onSaved={onSaved} />
}

type StorePrice = {
  store_id: string
  plan: string
  name: string
  product_id: string
  cost_cents: number
  cost_known?: boolean
  price_cents: number
  version: number
  enabled: boolean
}

export function StoreDisplay({ store, revision, onSaved }: { store: AdminStore; revision: number; onSaved: () => void }) {
  const { data, error, loading } = useResource<{ prices: StorePrice[] }>(`${endpoint}/stores`, revision)
  if (!data) return <Feedback error={error} loading={loading} />
  const offers: Offer[] = data.prices.filter(price => price.store_id === store.id).map(price => ({
    ...price, id: price.plan, enabled: Number(price.enabled), renewal_only: 0,
  }))
  const products = new Map<StorefrontProductId, string>()
  for (const price of offers) {
    if (price.product_id.startsWith('custom-')) products.set(price.product_id as StorefrontProductId, price.name)
  }
  return <ProductManagement key={store.id}
    customProducts={Array.from(products, ([id, name]) => ({ id, name }))}
    endpoint={`${endpoint}/product-order?store=${store.id}`}
    plans={offers}
    storeUrl={store.storefront_url}
    onSaved={onSaved}
  />
}
