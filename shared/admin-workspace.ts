import { adminProductRoute, type ProductSection } from './admin-suppliers.ts'

export const ADMIN_WORKSPACES = {
  overview: { label: '工作台', tabs: [] },
  'my-shop': { label: '店铺管理', tabs: [['stores', '店铺列表'], ['domains', '域名'], ['notifications', '订单通知']] },
  products: { label: '商品管理', tabs: [['catalog', '商品库'], ['prices', '店铺售价'], ['sorting', '陈列与排序'], ['coupons', '优惠码']] },
  orders: { label: '订单与售后', tabs: [['list', '订单明细'], ['refunds', '退款与售后']] },
  customers: { label: '客户运营', tabs: [['directory', '客户档案'], ['members', '会员与邀新'], ['interest', '上线提醒']] },
  reports: { label: '数据与财务', tabs: [['visitors', '访客趋势'], ['profit', '收款与利润'], ['accounting', '清账记录'], ['invoices', '开票']] },
  partners: { label: '代理管理', tabs: [['partners', '代理列表'], ['payouts', '结算申请'], ['defaults', '默认拿货价'], ['tickets', '代理工单']] },
  settings: { label: '系统设置', tabs: [['services', '支付与邮件'], ['security', '安全审计']] },
} as const

export type AdminView = keyof typeof ADMIN_WORKSPACES
export type OwnerStoreId = 'platform' | 'store-2' | 'store-3'
export type AdminStoreScope = 'all' | 'owner' | OwnerStoreId

export function ownerStoreId(value: string | null | undefined): OwnerStoreId | undefined {
  if (value === 'platform' || value === 'store-2' || value === 'store-3') return value
}

type AdminLocation = {
  tab?: string
  store?: OwnerStoreId
  scope?: 'all' | 'owner'
  supplier?: ProductSection
  edit?: OwnerStoreId
  status?: 'active'
}

const legacyViews: Record<string, { view: AdminView } & AdminLocation> = {
  refunds: { view: 'orders', tab: 'refunds' },
  customers: { view: 'customers', tab: 'directory', scope: 'all' },
  orders: { view: 'orders', tab: 'list', scope: 'all' },
  members: { view: 'customers', tab: 'members' },
  interest: { view: 'customers', tab: 'interest' },
  visitors: { view: 'reports', tab: 'visitors', scope: 'all' },
  accounting: { view: 'reports', tab: 'profit' },
  invoices: { view: 'reports', tab: 'invoices' },
  tickets: { view: 'partners', tab: 'tickets' },
  contacts: { view: 'my-shop', tab: 'stores', edit: 'platform' },
  integrations: { view: 'settings', tab: 'services' },
  security: { view: 'settings', tab: 'security' },
}

export function adminScopeKind(view: AdminView, tab: string) {
  if ((view === 'orders' && tab === 'list') || (view === 'customers' && tab === 'directory') || (view === 'reports' && tab === 'visitors')) return 'data'
  if (view === 'customers' && tab === 'members') return 'membership'
  if ((view === 'my-shop' && tab !== 'stores') || (view === 'products' && (tab === 'prices' || tab === 'sorting'))) return 'store'
}

export function adminWorkspaceRoute(search: string) {
  const params = new URLSearchParams(search)
  const productRoute = adminProductRoute(search)
  const requestedTab = params.get('tab')
  const legacy = !requestedTab && Object.hasOwn(legacyViews, productRoute.view) ? legacyViews[productRoute.view] : undefined
  const view: AdminView = legacy?.view ?? (Object.hasOwn(ADMIN_WORKSPACES, productRoute.view) ? productRoute.view as AdminView : 'overview')
  const tabs: readonly (readonly [string, string])[] = ADMIN_WORKSPACES[view].tabs
  const tab = tabs.find(([id]) => id === requestedTab)?.[0] ?? legacy?.tab ?? tabs[0]?.[0] ?? ''
  const kind = adminScopeKind(view, tab)
  const storeList = view === 'my-shop' && tab === 'stores'
  // Old global pages carried an unrelated store parameter after navigation.
  const store = (kind || storeList) && !(legacy?.scope === 'all' && !params.has('scope')) ? ownerStoreId(params.get('store')) : undefined
  const explicitScope = params.get('scope')
  const scope = kind === 'data' && !store ? (explicitScope === 'all' || explicitScope === 'owner' ? explicitScope : legacy?.scope ?? 'owner') : undefined
  const status = params.get('status')
  return {
    view,
    tab,
    store,
    scope,
    supplier: view === 'products' && tab === 'catalog' ? productRoute.supplier : undefined,
    edit: storeList ? legacy?.edit ?? ownerStoreId(params.get('edit')) : undefined,
    status: view === 'orders' && tab === 'list' && status === 'active' ? status : undefined,
  } satisfies AdminLocation & { view: AdminView }
}

export function adminWorkspaceUrl(view: AdminView, options: AdminLocation = {}) {
  const params = new URLSearchParams({ view })
  if (options.tab) params.set('tab', options.tab)
  if (options.store) params.set('store', options.store)
  else if (options.scope) params.set('scope', options.scope)
  if (options.supplier && options.supplier !== 'all') params.set('supplier', options.supplier)
  if (options.edit) params.set('edit', options.edit)
  if (options.status) params.set('status', options.status)
  return '/admin?' + params
}

export type AdminStore = { id: OwnerStoreId; name: string; active: boolean; storefront_url: string }
