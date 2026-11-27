export type AdminStoreOption = { id: string; name: string; active: number }
export type AdminAudience = 'owner' | 'agent'

export function ownerStoreOptions(stores: AdminStoreOption[]) {
  return [
    { value: 'owner', label: '全部自营店铺' },
    ...stores.map(store => ({ value: store.id, label: store.name })),
  ]
}

export function storeScopeParams(scope: string, params = new URLSearchParams()) {
  if (scope !== 'all') {
    params.set('scope', scope === 'agent' ? 'agent' : 'owner')
    if (scope !== 'owner' && scope !== 'agent') params.set('store', scope)
  }
  return params
}
