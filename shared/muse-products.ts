import type { ShopProduct } from './shop-products.ts'

export type MuseKind = 'account' | 'invitation'

/** Explicit import/editor metadata takes precedence over legacy account names. */
export function museKind(product: Pick<ShopProduct, 'groupId' | 'museKind' | 'name'>): MuseKind | undefined {
  if (product.groupId !== 'muse') return undefined
  if (product.museKind) return product.museKind
  if (/邀请/.test(product.name)) return 'invitation'
  return 'account'
}

export function museVariants(products: readonly ShopProduct[], kind: MuseKind) {
  return products.filter(p => museKind(p) === kind).sort((a, b) => {
    const amount = (p: ShopProduct) => {
      const billions = p.name.match(/(\d+)\s*B\b/i)
      return billions ? Number(billions[1]) * 10 : Number(p.name.match(/(\d+)\s*亿/)?.[1] ?? 0)
    }
    return amount(a) - amount(b) || a.id.localeCompare(b.id)
  })
}

export const MUSE_GUIDE_PATHS = ['/guides/muse-change-email', '/guides/muse-invite-tokens'] as const
export const MUSE_ACCOUNT_GUIDE = MUSE_GUIDE_PATHS[0]
export const MUSE_INVITE_GUIDE = MUSE_GUIDE_PATHS[1]
