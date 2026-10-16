export type ShopDelivery = 'manual' | 'api'
export const SHOP_PRODUCT_GROUPS = {
  claude: 'Claude',
  'codex-credits': 'Codex 额度',
  'student-verification': 'Plus 学生认证',
  muse: 'Muse AI',
  grok: 'Grok',
} as const
export type ShopProductGroupId = keyof typeof SHOP_PRODUCT_GROUPS
export type ShopPayment = {
  label: string
  instructions: string
  url: string
  qr: string
}
export type ShopProduct = {
  id: string
  groupId?: ShopProductGroupId
  name: string
  category: string
  tagline: string
  description: string
  image: string
  badge: string
  unit: string
  duration: string
  priceCents: number
  stock: number
  features: string[]
  purchaseNote: string
  deliveryInstructions: string
  steps: { title: string; description: string }[]
  faq: { question: string; answer: string }[]
  fields: { key: string; label: string; required: boolean }[]
  delivery: ShopDelivery
  payment: ShopPayment
  status: 'draft' | 'listed' | 'published' | 'archived'
  version: number
  api?: {
    provider?: 'json-v1' | 'xiaojiu'
    baseUrl: string
    productCode: string
    supplierProductId?: number
    maxCostCents?: number
    configured: boolean
    verified: boolean
  }
}
export type ShopProductInput = ShopProduct & {
  apiToken?: string
  apiKey?: string
}
export const shopProductDisplayId = (
  product: Pick<ShopProduct, 'id' | 'groupId'>,
) => product.groupId ?? product.id
export function groupShopProducts(products: readonly ShopProduct[]) {
  const groups = new Map<
    string,
    { id: string; name: string; products: ShopProduct[] }
  >()
  for (const product of products) {
    const id = shopProductDisplayId(product)
    let group = groups.get(id)
    if (!group) {
      group = {
        id,
        name: product.groupId
          ? SHOP_PRODUCT_GROUPS[product.groupId]
          : product.name,
        products: [],
      }
      groups.set(id, group)
    }
    group.products.push(product)
  }
  for (const group of groups.values())
    group.products.sort(
      (a, b) => a.priceCents - b.priceCents || a.id.localeCompare(b.id),
    )
  return [...groups.values()]
}
export type CustomOrderView = {
  productId: string
  productName: string
  image: string
  duration: string
  payment: ShopPayment
  delivery: ShopDelivery
  deliveryInstructions: string
  deliveryContent: string | null
  paymentClaimed: boolean
  paymentReference: string
  fields: Record<string, string>
  supplierState: string | null
  supplierError?: string
}
export const customProductId = /^custom-[a-f0-9]{32}$/
export const hasControlCharacters = (value: string) =>
  Array.from(value).some((c) => {
    const n = c.charCodeAt(0)
    return (n < 32 && ![9, 10, 13].includes(n)) || n === 127
  })
export const safeImage = (value: string) =>
  !value ||
  (/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(value) &&
    value.length <= 400000) ||
  safeHttps(value)
export function safeHttps(value: string) {
  try {
    const url = new URL(value)
    const host = url.hostname.toLowerCase()
    return (
      url.protocol === 'https:' &&
      !url.username &&
      !url.password &&
      !url.hash &&
      !url.port &&
      host.includes('.') &&
      !/^[\d.]+$/.test(host) &&
      !host.includes(':') &&
      !/(^|\.)(localhost|local|internal|lan|test|invalid)$/.test(host)
    )
  } catch {
    return false
  }
}
export function productProblems(
  product: ShopProduct,
  requirePublished = false,
): string[] {
  const errors: string[] = []
  const text = (value: unknown, max: number) =>
    typeof value === 'string' &&
    value.trim().length > 0 &&
    value.length <= max &&
    !hasControlCharacters(value)
  if (!text(product.name, 80)) errors.push('商品名称（1–80 字）')
  if (!['draft', 'listed', 'published', 'archived'].includes(product.status))
    errors.push('发布状态')
  if (
    product.groupId !== undefined &&
    !Object.hasOwn(SHOP_PRODUCT_GROUPS, product.groupId)
  )
    errors.push('商品分组')
  if (!['manual', 'api'].includes(product.delivery)) errors.push('交付方式')
  if (
    product.api?.provider &&
    !['json-v1', 'xiaojiu'].includes(product.api.provider)
  )
    errors.push('供货接口类型')
  if (
    product.delivery === 'api' &&
    product.api?.provider === 'xiaojiu' &&
    ((product.api.supplierProductId !== undefined &&
      (!Number.isSafeInteger(product.api.supplierProductId) ||
        Number(product.api.supplierProductId) < 1)) ||
      (product.api.productCode !== '' &&
        !/^[1-9]\d{0,14}$/.test(product.api.productCode)) ||
      product.api.baseUrl !== 'https://98-xj.com')
  )
    errors.push('小久商品 ID、SKU ID 与正确的采购接口地址')
  if (
    !Number.isSafeInteger(product.priceCents) ||
    product.priceCents < 1 ||
    product.priceCents > 10000000
  )
    errors.push('售价（0.01–100000 元）')
  if (
    !Number.isSafeInteger(product.stock) ||
    product.stock < -1 ||
    product.stock > 1000000
  )
    errors.push('库存（-1 表示不限量）')
  if (typeof product.image !== 'string' || !safeImage(product.image))
    errors.push('有效的商品图片')
  if (
    !Array.isArray(product.features) ||
    product.features.length > 12 ||
    product.features.some((value) => !text(value, 160))
  )
    errors.push('商品特点（最多 12 项）')
  if (
    !Array.isArray(product.steps) ||
    product.steps.length > 8 ||
    product.steps.some(
      (value) =>
        !value ||
        typeof value !== 'object' ||
        !text(value.title, 80) ||
        !text(value.description, 500),
    )
  )
    errors.push('交付流程')
  if (
    !Array.isArray(product.faq) ||
    product.faq.length > 12 ||
    product.faq.some(
      (value) =>
        !value ||
        typeof value !== 'object' ||
        !text(value.question, 160) ||
        !text(value.answer, 2000),
    )
  )
    errors.push('常见问题')
  if (
    !Array.isArray(product.fields) ||
    product.fields.length > 8 ||
    new Set(product.fields.map((value) => value?.key)).size !==
      product.fields.length ||
    product.fields.some(
      (value) =>
        !value ||
        typeof value !== 'object' ||
        !/^[a-z][a-z0-9_]{0,31}$/.test(value.key) ||
        !text(value.label, 60) ||
        typeof value.required !== 'boolean' ||
        /password|secret|token|session|credential|密码|密钥|凭据/i.test(
          value.key + ' ' + value.label,
        ),
    )
  )
    errors.push('下单信息（不得收集密码、Session 或密钥）')
  for (const [key, max] of Object.entries({
    category: 40,
    tagline: 160,
    description: 4000,
    badge: 40,
    unit: 40,
    duration: 80,
    purchaseNote: 4000,
    deliveryInstructions: 4000,
  })) {
    const value = product[key as keyof ShopProduct]
    if (typeof value !== 'string' || value.length > max) errors.push(key)
  }
  if (
    !product.payment ||
    typeof product.payment.label !== 'string' ||
    product.payment.label.length > 80 ||
    typeof product.payment.instructions !== 'string' ||
    product.payment.instructions.length > 2000 ||
    typeof product.payment.url !== 'string' ||
    (product.payment.url && !safeHttps(product.payment.url)) ||
    typeof product.payment.qr !== 'string' ||
    !safeImage(product.payment.qr)
  )
    errors.push('收款方式与说明')
  if (requirePublished || ['listed', 'published'].includes(product.status)) {
    for (const [key, label] of Object.entries({
      category: '商品分类',
      tagline: '商品短介绍',
      description: '详细说明',
      image: '商品图片',
      unit: '计价单位',
      duration: '规格／服务周期',
      purchaseNote: '购买须知与售后范围',
      deliveryInstructions: '交付说明',
    }))
      if (!String(product[key as keyof ShopProduct] ?? '').trim())
        errors.push(label)
    if (!product.features?.length) errors.push('至少一项商品特点')
    if (!product.steps?.length) errors.push('至少一个交付步骤')
    if (!product.faq?.length) errors.push('至少一个常见问题')
  }
  if (requirePublished || product.status === 'published') {
    if (
      !product.payment?.label.trim() ||
      !product.payment?.instructions.trim() ||
      (!product.payment?.url && !product.payment?.qr)
    )
      errors.push('收款名称、付款说明与收款链接／二维码')
    if (
      product.delivery === 'api' &&
      (!product.api?.configured ||
        !product.api?.verified ||
        !Number.isSafeInteger(product.api.maxCostCents) ||
        Number(product.api.maxCostCents) < 1 ||
        product.priceCents < Number(product.api.maxCostCents) ||
        !safeHttps(product.api.baseUrl) ||
        !text(product.api.productCode, 100))
    )
      errors.push('已验证的供货 API、商品编码与不高于售价的最高采购成本')
  }
  return [...new Set(errors)]
}
