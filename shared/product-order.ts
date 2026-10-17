export const STOREFRONT_PRODUCTS = [
  { id: 'chatgpt', name: 'ChatGPT' },
  { id: 'gemini', name: 'Gemini Pro' },
  { id: 'duolingo', name: '多邻国' },
  { id: 'x-premium', name: 'X Premium' },
  { id: 'gmail', name: 'Gmail 账号' },
  { id: 'claude', name: 'Claude', upcoming: true },
  { id: 'codex-credits', name: 'Codex 额度' },
  { id: 'grok', name: 'Grok', upcoming: true },
  { id: 'codex-sms', name: 'SMS接码' },
  { id: 'student-verification', name: 'Plus 学生认证' },
  { id: 'muse', name: 'Muse AI' },
] as const

export type StorefrontProductId =
  (typeof STOREFRONT_PRODUCTS)[number]['id'] | `custom-${string}`
export type ProductOrderSettings = {
  productIds: StorefrontProductId[]
  version: number
  hiddenProductIds?: StorefrontProductId[]
}
export const DEFAULT_PRODUCT_ORDER = STOREFRONT_PRODUCTS.map(
  (product) => product.id,
)

// Keep saved positions when products are added or retired.
export function normalizeProductOrder(
  saved: readonly string[] = [],
): StorefrontProductId[] {
  return [...new Set([...saved, ...DEFAULT_PRODUCT_ORDER])].filter(
    (id): id is StorefrontProductId =>
      DEFAULT_PRODUCT_ORDER.some((known) => known === id),
  )
}
