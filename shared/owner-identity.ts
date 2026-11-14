type Identity = { name?: unknown; brandName?: unknown; pageTitle?: unknown }

// Follow a rename for an unchanged/default title. An explicitly edited title
// remains the operator's choice, including an empty title (use the store name).
export function synchronizeOwnerIdentity<T extends Identity>(current: Identity, patch: T): T {
  const next = { ...patch }
  const oldName = String(current.name ?? ''), oldBrand = String(current.brandName || oldName)
  const name = typeof next.name === 'string' ? next.name.trim() : oldName
  if (name !== oldName && (!next.brandName || next.brandName === current.brandName || next.brandName === oldName)) next.brandName = name
  const brand = String(next.brandName || name), previousTitle = String(current.pageTitle ?? '')
  if (brand !== oldBrand && (next.pageTitle === undefined || next.pageTitle === previousTitle)) {
    const prefix = [oldBrand, oldName].filter(Boolean).find(value => previousTitle === value || [' ', '·', '・', '-', '—', '|'].some(separator => previousTitle.startsWith(value + separator)))
    if (prefix) next.pageTitle = brand + previousTitle.slice(prefix.length)
  }
  return next
}
