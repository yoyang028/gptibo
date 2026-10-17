import type { ShopProduct } from './shop-products.ts'

export const GRIZZLY_ORIGIN = 'https://api.grizzlysms.com'
export const GRIZZLY_USA = '187'
export const GRIZZLY_SERVICES = {
  dr: 'AI 聊天',
  acz: 'Claude',
  go: 'Google / Gmail',
} as const
export const GRIZZLY_RETAIL_CENTS = { dr: 1580, acz: 1980, go: 2580 } as const
export type GrizzlyService = keyof typeof GRIZZLY_SERVICES
export type GrizzlyConfig = {
  country: string
  maxPriceUsd: string
  cnyPerUsd: string
}
export type SmsView = {
  /** Only populated by the authenticated administrator order response. */
  activationId?: string | null
  costUsd?: string | null
  state:
    | 'ready'
    | 'allocating'
    | 'waiting'
    | 'received'
    | 'cancelled'
    | 'unknown'
    | 'failed'
    | 'review'
  phone: string | null
  code: string | null
  expiresAt: number | null
  message: string
}

// Integer arithmetic keeps sub-cent USD prices and conservative CNY rounding.
export function decimalUnits(value: unknown, precision = 6): number {
  const text = typeof value === 'number' ? String(value) : value
  if (
    typeof text !== 'string' ||
    !new RegExp(`^\\d{1,6}(?:\\.\\d{1,${precision}})?$`).test(text)
  )
    throw new Error('Invalid decimal')
  const [whole, fraction = ''] = text.split('.')
  const units =
    Number(whole) * 10 ** precision + Number(fraction.padEnd(precision, '0'))
  if (!Number.isSafeInteger(units)) throw new Error('Invalid decimal')
  return units
}
export function grizzlyCostCents(usd: unknown, rate: unknown) {
  const micros = decimalUnits(usd),
    exchange = decimalUnits(rate, 4)
  if (micros < 1 || micros > 1000_000000 || exchange < 1 || exchange > 100_0000)
    throw new Error('Invalid amount')
  return Number(
    (BigInt(micros) * BigInt(exchange) + 99_999_999n) / 100_000_000n,
  )
}
export function validGrizzlyConfig(api: ShopProduct['api']): boolean {
  try {
    return Boolean(
      api &&
      api.baseUrl === GRIZZLY_ORIGIN &&
      Object.hasOwn(GRIZZLY_SERVICES, api.productCode) &&
      api.sms?.country === GRIZZLY_USA &&
      grizzlyCostCents(api.sms.maxPriceUsd, api.sms.cnyPerUsd) ===
        api.maxCostCents,
    )
  } catch {
    return false
  }
}
export function grizzlyProduct(service: GrizzlyService): ShopProduct {
  const name = GRIZZLY_SERVICES[service]
  return {
    id: '',
    version: 0,
    status: 'draft',
    name: `${name} · 美国接码`,
    category: '短信接码',
    tagline: '付款后获取美国手机号，在原订单接收一次短信验证码。',
    description: `提供 ${name} 项目的美国单次短信接收服务。一个订单对应一个手机号和一次验证码。号码仅用于所选项目，不是长期手机号；目标网站是否接受该号码以实际结果为准。`,
    image: '',
    badge: '美国号码',
    unit: '次',
    duration: `${name} · 美国 · 单次短信`,
    priceCents: GRIZZLY_RETAIL_CENTS[service],
    stock: -1,
    features: [
      '付款确认后自动分配号码',
      '手机号与验证码可复制',
      '原订单持续查询进度',
    ],
    purchaseNote:
      '仅适用于所选项目及美国地区。请在取号后及时发送验证码，最长等待 20 分钟。未收到短信可在原订单停止接码并申请售后；停止接码不代表已退款。请勿重复付款。',
    deliveryInstructions:
      '付款确认后自动获取手机号，复制到所选服务，再回到本订单等待验证码。请保留订单号。',
    steps: [
      {
        title: '选择并付款',
        description: '核对接码项目、国家和金额，完成付款。',
      },
      {
        title: '使用手机号',
        description: '在所选服务填写本订单分配的美国手机号并发送验证码。',
      },
      {
        title: '查看验证码',
        description: '订单自动查询短信，收到后可复制验证码。',
      },
    ],
    faq: [
      {
        question: '一直没收到短信怎么办？',
        answer:
          '可停止接码并在原订单申请售后，退款以审核及实际到账为准，无需再付一笔。',
      },
      {
        question: '可以一直使用这个号码吗？',
        answer: '这是所选项目的一次短信接收服务，不提供长期持有或跨项目使用。',
      },
    ],
    fields: [],
    delivery: 'api',
    payment: {
      provider: 'alipay',
      label: '支付宝',
      instructions: '使用本订单生成的支付宝付款码付款，到账后自动分配号码。',
      url: '',
      qr: '',
    },
    api: {
      provider: 'grizzly',
      baseUrl: GRIZZLY_ORIGIN,
      productCode: service,
      configured: false,
      verified: false,
      sms: { country: GRIZZLY_USA, maxPriceUsd: '', cnyPerUsd: '' },
    },
  }
}
