import { adminProductRoute, type ProductSection } from './admin-suppliers.ts'

export type AdminPartnerTab = 'partners' | 'payouts' | 'defaults' | 'tickets'
export type AdminRoute = { view: string; supplier: ProductSection; partnerTab: AdminPartnerTab }

export function adminPartnerTab(value: unknown): AdminPartnerTab {
  return value === 'payouts' || value === 'defaults' || value === 'tickets' ? value : 'partners'
}

export function readAdminRoute(search: string): AdminRoute {
  const route = adminProductRoute(search)
  if (route.view === 'tickets') return { view: 'partners', supplier: 'all', partnerTab: 'tickets' }
  const tab = route.view === 'partners' ? new URLSearchParams(search).get('tab') : null
  return { ...route, partnerTab: adminPartnerTab(tab) }
}

export function writeAdminRoute(params: URLSearchParams, { view, supplier, partnerTab }: AdminRoute) {
  params.set('view', view)
  if (view === 'products' && supplier !== 'all') params.set('supplier', supplier)
  else params.delete('supplier')
  if (view === 'partners' && partnerTab !== 'partners') params.set('tab', partnerTab)
  else params.delete('tab')
}
