// Storefront aliases explicitly confirmed by the owner. These are local names,
// not a statement that OpenAI officially uses the same tier names.
export const QUEFA_GPT_PRODUCT_MAP = {
  plus: 'chatgpt_plus_cdk_1m',
  'pro-5x': 'chatgpt_pro_5x_cdk_1m',
  'pro-20x': 'chatgpt_pro_20x_cdk_1m', // Storefront: Pro 10×.
  'pro-25x': 'chatgpt_pro_50x_cdk_1m', // Storefront: Pro 25×.
} as const

export function quefaPurchaseNote(productCode: string | undefined, existing: string | null | undefined) {
  const region = productCode === QUEFA_GPT_PRODUCT_MAP['pro-25x']
    ? '供货版本：菲律宾（PH/PHP）。请确认适用条件后再购买。'
    : ''
  return [...new Set([existing?.trim(), region].filter(Boolean))].join('\n')
}
