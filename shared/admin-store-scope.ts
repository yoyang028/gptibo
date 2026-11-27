export type AdminStoreOption = { id: string; name: string; active: number }

export function adminStoreOptions(stores: AdminStoreOption[]) {
  return [
    { value: 'all', label: '全部渠道' },
    { value: 'owner', label: '全部自营店铺' },
    ...stores.map(store => ({ value: store.id, label: store.name })),
    { value: 'agent', label: '代理渠道' },
  ]
}

export function storeScopeParams(scope: string, params = new URLSearchParams()) {
  if (scope === 'owner' || scope === 'agent') params.set('scope', scope)
  else if (scope !== 'all') params.set('store', scope)
  return params
}
