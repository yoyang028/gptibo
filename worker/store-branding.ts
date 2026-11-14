type ShopIdentity = { name: string; brandName?: string }

export function shopBrand(shop: ShopIdentity) {
  return (shop.brandName || shop.name).replace(/[\r\n]/g, ' ').trim()
}

export function shopMailFrom(configuredFrom: string | undefined, shop: ShopIdentity) {
  const address = configuredFrom?.match(/<([^<>]+)>$/)?.[1] ?? configuredFrom
  if (!address || !/^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(address)) throw new Error('Mail sender is not configured')
  return `"${shopBrand(shop).replace(/(["\\])/g, '\\$1')}" <${address}>`
}

export const escapeMail = (value: string) => value.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)
