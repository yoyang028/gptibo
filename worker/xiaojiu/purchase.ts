import { boundedResponseText } from '../bounded-response.ts'
import { hash, type Env } from '../platform.ts'

// Cardnet upstream API v2.1, 2026-10-14. Redemption uses a separate API/key.
export const XIAOJIU_PURCHASE_ORIGIN = 'https://98-xj.com'
const prefix = '/api/v1/upstream'
const encoder = new TextEncoder()
export type XiaojiuCredentials = { key: string; secret: string }
export class XiaojiuPurchaseError extends Error {
  code: string
  retryable: boolean
  constructor(code: string, retryable = false) {
    super('小久采购：' + (messages[code] ?? '接口结果尚未确认，请核对原订单。'))
    this.code = code
    this.retryable = retryable
  }
}
const messages: Record<string, string> = {
  credentials_missing: '请填写同一凭证的 64 位 API Key 和完整 128 位 Secret。',
  purchase_disabled: '余额采购尚未启用，请先完成配置与只读检查。',
  authentication_failed:
    '凭据或 IP 白名单校验失败，自动调用已暂停，请修正后手动检查连接。',
  credential_paused: '凭据已暂停，请联系上游并手动检查连接。',
  wallet_order_not_enabled: '尚未开通余额下单权限。',
  member_level_required: '当前账号没有该商品的购买权限。',
  insufficient_balance: '钱包余额不足，尚未自动重试采购。',
  insufficient_stock: '当前规格没有库存。',
  product_not_supported: '商品或规格未启用自动发货。',
  price_limit: '当前供货价超过设定的采购参考上限，请核对后再处理。',
  cost_review: '实际扣款超过采购参考上限，已保留原单，请人工核对。',
  idempotency_conflict: '原商家单号与采购参数冲突，请人工核对。',
  rate_limited: '请求较频繁，已暂停本轮调用，稍后查询原单。',
  service_unavailable: '上游暂不可用，请稍后查询原单。',
  invalid_response: '返回的订单、金额或交付内容未通过核对，请查询原单。',
  network_unknown: '连接结果未确认，保留原商家单号，不创建另一笔采购。',
}
export function purchaseCredentials(value: string): XiaojiuCredentials {
  let result: XiaojiuCredentials
  try {
    result = JSON.parse(value)
  } catch {
    throw new XiaojiuPurchaseError('credentials_missing')
  }
  if (
    !result ||
    !/^[a-fA-F0-9]{64}$/.test(result.key) ||
    !/^[a-fA-F0-9]{128}$/.test(result.secret)
  )
    throw new XiaojiuPurchaseError('credentials_missing')
  return result
}
export function purchaseMoney(value: unknown): number {
  if (typeof value !== 'string' || !/^\d{1,8}(?:\.\d{1,2})?$/.test(value))
    throw new XiaojiuPurchaseError('invalid_response')
  const [whole, decimals = ''] = value.split('.')
  const cents = Number(whole) * 100 + Number(decimals.padEnd(2, '0'))
  if (!Number.isSafeInteger(cents))
    throw new XiaojiuPurchaseError('invalid_response')
  return cents
}
export async function purchaseSignature(
  secret: string,
  method: string,
  path: string,
  timestamp: string,
  nonce: string,
  raw = '',
) {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const canonical = [
    method.toUpperCase(),
    path,
    timestamp,
    nonce,
    await hash(raw),
  ].join('\n')
  return Array.from(
    new Uint8Array(
      await crypto.subtle.sign('HMAC', key, encoder.encode(canonical)),
    ),
    (b) => b.toString(16).padStart(2, '0'),
  ).join('')
}
export class XiaojiuPurchaseClient {
  private env: Env
  private credentials: XiaojiuCredentials
  constructor(env: Env, credentials: XiaojiuCredentials) {
    this.env = env
    this.credentials = credentials
  }
  async request(
    method: 'GET' | 'POST',
    suffix: string,
    payload?: unknown,
    recovery = false,
    page?: number,
  ): Promise<Record<string, unknown>> {
    if (
      method === 'POST' &&
      suffix === '/orders' &&
      this.env.XIAOJIU_PURCHASE_ENABLED !== 'true'
    )
      throw new XiaojiuPurchaseError('purchase_disabled')
    if (!(
      (method === 'POST' && ['/ping', '/orders'].includes(suffix)) ||
      (method === 'GET' &&
        (suffix === '/products' ||
          /^\/(?:products|orders)\/[1-9]\d{0,14}$/.test(suffix)))
    ))
      throw new XiaojiuPurchaseError('invalid_response')
    if (
      page !== undefined &&
      (suffix !== '/products' ||
        !Number.isInteger(page) ||
        page < 1 ||
        page > 100)
    )
      throw new XiaojiuPurchaseError('invalid_response')
    const fingerprint = await hash(
      this.credentials.key + ':' + this.credentials.secret,
    )
    const db = this.env.INTEREST_DB,
      now = Date.now(),
      token = crypto.randomUUID()
    await db
      .prepare(
        'INSERT OR IGNORE INTO xiaojiu_api_controls(credential_hash) VALUES (?)',
      )
      .bind(fingerprint)
      .run()
    const lease = await db
      .prepare(
        'UPDATE xiaojiu_api_controls SET lease_token=?,lease_until=?,window_start=CASE WHEN window_start<=? THEN ? ELSE window_start END,requests=CASE WHEN window_start<=? THEN 1 ELSE requests+1 END WHERE credential_hash=? AND lease_until<=? AND (?=1 OR paused=0) AND retry_at<=? AND (window_start<=? OR requests<50) RETURNING credential_hash',
      )
      .bind(
        token,
        now + 20000,
        now - 60000,
        now,
        now - 60000,
        fingerprint,
        now,
        Number(recovery && suffix === '/ping'),
        now,
        now - 60000,
      )
      .first()
    if (!lease) {
      const state = await db
        .prepare(
          'SELECT paused FROM xiaojiu_api_controls WHERE credential_hash=?',
        )
        .bind(fingerprint)
        .first<{ paused: number }>()
      throw new XiaojiuPurchaseError(
        state?.paused ? 'authentication_failed' : 'rate_limited',
        !state?.paused,
      )
    }
    try {
      const raw = payload === undefined ? '' : JSON.stringify(payload),
        path = prefix + suffix
      const timestamp = String(Math.floor(Date.now() / 1000)),
        nonce = crypto.randomUUID()
      let response: Response
      try {
        response = await fetch(
          XIAOJIU_PURCHASE_ORIGIN +
            path +
            (page === undefined ? '' : `?page=${page}&page_size=10`),
          {
            method,
            redirect: 'manual',
            signal: AbortSignal.timeout(15000),
            headers: {
              'Dujiao-Next-Api-Key': this.credentials.key,
              'Dujiao-Next-Timestamp': timestamp,
              'Dujiao-Next-Nonce': nonce,
              'Dujiao-Next-Signature': await purchaseSignature(
                this.credentials.secret,
                method,
                path,
                timestamp,
                nonce,
                raw,
              ),
              ...(payload === undefined
                ? {}
                : { 'Content-Type': 'application/json' }),
            },
            ...(payload === undefined ? {} : { body: raw }),
          },
        )
      } catch {
        throw new XiaojiuPurchaseError('network_unknown', true)
      }
      // Authentication failures pause all products using this credential, including cron.
      if ([401, 403].includes(response.status)) {
        await db
          .prepare(
            'UPDATE xiaojiu_api_controls SET paused=1 WHERE credential_hash=? AND lease_token=?',
          )
          .bind(fingerprint, token)
          .run()
      }
      if (response.status === 429) {
        const seconds = Math.min(
          3600,
          Math.max(60, Number(response.headers.get('Retry-After')) || 60),
        )
        await db
          .prepare(
            'UPDATE xiaojiu_api_controls SET retry_at=? WHERE credential_hash=? AND lease_token=?',
          )
          .bind(Date.now() + seconds * 1000, fingerprint, token)
          .run()
      }
      let result: Record<string, unknown>
      try {
        // Catalogue rows include multilingual descriptions/content, although the
        // storefront only consumes identifiers, stock and prices from them.
        result = JSON.parse(
          await boundedResponseText(
            response,
            suffix === '/products' ? 1000000 : 256000,
          ),
        )
        if (!result || typeof result !== 'object' || Array.isArray(result))
          throw new Error()
      } catch {
        throw new XiaojiuPurchaseError('invalid_response')
      }
      if (!response.ok || result.ok !== true) {
        const code =
          typeof result.error_code === 'string' &&
          Object.hasOwn(messages, result.error_code)
            ? result.error_code
            : [401, 403].includes(response.status)
              ? 'authentication_failed'
              : response.status === 429
                ? 'rate_limited'
                : 'invalid_response'
        throw new XiaojiuPurchaseError(
          code,
          [429, 503].includes(response.status),
        )
      }
      if (recovery && suffix === '/ping')
        await db
          .prepare(
            'UPDATE xiaojiu_api_controls SET paused=0,retry_at=0 WHERE credential_hash=? AND lease_token=?',
          )
          .bind(fingerprint, token)
          .run()
      return result
    } finally {
      await db
        .prepare(
          "UPDATE xiaojiu_api_controls SET lease_token='',lease_until=0 WHERE credential_hash=? AND lease_token=?",
        )
        .bind(fingerprint, token)
        .run()
    }
  }
  async ping(recovery = false) {
    const result = await this.request('POST', '/ping', undefined, recovery)
    if (
      result.currency !== 'CNY' ||
      !Number.isSafeInteger(result.user_id) ||
      Number(result.user_id) < 1
    )
      throw new XiaojiuPurchaseError('invalid_response')
    return { balanceCents: purchaseMoney(result.balance) }
  }
  async product(productId: number, skuId: number, maximum: number) {
    if (
      !Number.isSafeInteger(productId) ||
      productId < 1 ||
      !Number.isSafeInteger(skuId) ||
      skuId < 1
    )
      throw new XiaojiuPurchaseError('product_not_supported')
    const response = await this.request('GET', '/products/' + productId)
    const product = response.product as Record<string, unknown> | undefined
    const sku = Array.isArray(product?.skus)
      ? (product.skus.find((v) => v && v.id === skuId) as
          Record<string, unknown> | undefined)
      : undefined
    if (
      !product ||
      product.id !== productId ||
      product.is_active !== true ||
      product.fulfillment_type !== 'auto' ||
      sku?.is_active !== true
    )
      throw new XiaojiuPurchaseError('product_not_supported')
    if (
      !['in_stock', 'low_stock', 'unlimited'].includes(
        String(sku.stock_status),
      ) ||
      !(Number(sku.stock_quantity) > 0 || sku.stock_quantity === -1)
    )
      throw new XiaojiuPurchaseError('insufficient_stock')
    const cost = purchaseMoney(sku.price_amount)
    if (cost < 1 || cost > maximum)
      throw new XiaojiuPurchaseError('price_limit')
    return { costCents: cost }
  }
  async catalog(page = 1) {
    const result = await this.request(
      'GET',
      '/products',
      undefined,
      false,
      page,
    )
    if (
      !Array.isArray(result.items) ||
      result.items.length > 10 ||
      !Number.isSafeInteger(result.total) ||
      Number(result.total) < 0
    )
      throw new XiaojiuPurchaseError('invalid_response')
    const text = (value: unknown): string => {
      if (typeof value === 'string') return value.slice(0, 160)
      if (value && typeof value === 'object') {
        const names = value as Record<string, unknown>
        return String(
          names['zh-CN'] ??
            names['en-US'] ??
            Object.values(names).find((v) => typeof v === 'string') ??
            '',
        ).slice(0, 160)
      }
      return ''
    }
    const items = result.items.flatMap((product: Record<string, unknown>) => {
      if (
        !product ||
        !Number.isSafeInteger(product.id) ||
        Number(product.id) < 1 ||
        product.is_active !== true ||
        product.fulfillment_type !== 'auto' ||
        !Array.isArray(product.skus)
      )
        return []
      return product.skus
        .filter(
          (sku) =>
            sku &&
            Number.isSafeInteger(sku.id) &&
            sku.id > 0 &&
            sku.is_active === true,
        )
        .map((sku) => ({
          productId: Number(product.id),
          skuId: Number(sku.id),
          name: text(product.title),
          skuCode: text(sku.sku_code),
          specification: text(sku.spec_values),
          priceCents: purchaseMoney(sku.price_amount),
          stock: Number.isSafeInteger(sku.stock_quantity)
            ? Number(sku.stock_quantity)
            : 0,
          available:
            ['in_stock', 'low_stock', 'unlimited'].includes(sku.stock_status) &&
            (sku.stock_quantity > 0 || sku.stock_quantity === -1),
        }))
    })
    return { items, page, total: Number(result.total), pageSize: 10 }
  }
}

export type XiaojiuPurchaseOptions = {
  productId: number
  skuId: number
  maximum: number
  merchant: string
  remoteId: string | null
  replay?: boolean
  beforeCreate?: () => Promise<void>
  remember: (id: string, cost: number) => Promise<void>
}
export async function fulfillXiaojiuPurchase(
  client: XiaojiuPurchaseClient,
  options: XiaojiuPurchaseOptions,
) {
  const { productId, skuId, maximum, merchant } = options
  let remoteId = options.remoteId
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/.test(merchant))
    throw new XiaojiuPurchaseError('invalid_response')
  if (!remoteId) {
    if (!options.replay) {
      const product = await client.product(productId, skuId, maximum)
      const wallet = await client.ping()
      if (wallet.balanceCents < product.costCents)
        throw new XiaojiuPurchaseError('insufficient_balance')
    }
    // The supplier's documented idempotency scope is (credential, downstream_order_no).
    // A timed-out creation replays exactly these fields with a fresh nonce/signature.
    await options.beforeCreate?.()
    const created = await client.request('POST', '/orders', {
      sku_id: skuId,
      quantity: 1,
      downstream_order_no: merchant,
      payment_mode: 'wallet',
    })
    if (
      !Number.isSafeInteger(created.order_id) ||
      Number(created.order_id) < 1 ||
      created.downstream_order_no !== merchant
    )
      throw new XiaojiuPurchaseError('invalid_response')
    remoteId = String(created.order_id)
    const cost = created.currency === 'CNY' ? purchaseMoney(created.amount) : -1
    await options.remember(remoteId, cost)
    if (cost < 0) throw new XiaojiuPurchaseError('invalid_response')
    if (cost > maximum) throw new XiaojiuPurchaseError('cost_review')
  }
  if (!/^[1-9]\d{0,14}$/.test(remoteId))
    throw new XiaojiuPurchaseError('invalid_response')
  const result = await client.request('GET', '/orders/' + remoteId)
  if (
    String(result.order_id) !== remoteId ||
    result.currency !== 'CNY' ||
    (result.downstream_order_no !== undefined &&
      result.downstream_order_no !== merchant)
  )
    throw new XiaojiuPurchaseError('invalid_response')
  const cost = purchaseMoney(result.amount)
  await options.remember(remoteId, cost)
  if (cost > maximum) throw new XiaojiuPurchaseError('cost_review')
  const refunded = purchaseMoney(result.refunded_amount)
  const states = [
    'paid',
    'fulfilling',
    'partially_delivered',
    'delivered',
    'completed',
    'partially_refunded',
    'refunded',
    'canceled',
  ]
  if (!states.includes(String(result.status)) || refunded > cost)
    throw new XiaojiuPurchaseError('invalid_response')
  const items = result.items as Record<string, unknown>[] | undefined
  if (
    !Array.isArray(items) ||
    items.length !== 1 ||
    items[0].product_id !== productId ||
    items[0].sku_id !== skuId ||
    items[0].quantity !== 1 ||
    items[0].fulfillment_type !== 'auto' ||
    purchaseMoney(items[0].unit_price) !== cost ||
    purchaseMoney(items[0].total_price) !== cost
  )
    throw new XiaojiuPurchaseError('invalid_response')
  const failed =
    refunded > 0 ||
    ['partially_refunded', 'refunded', 'canceled'].includes(
      String(result.status),
    )
  const fulfillment = result.fulfillment as Record<string, unknown> | undefined
  const success =
    !failed &&
    ['completed', 'delivered'].includes(String(result.status)) &&
    fulfillment?.type === 'auto' &&
    fulfillment.status === 'delivered'
  if (
    success &&
    (typeof fulfillment?.payload !== 'string' ||
      !fulfillment.payload.trim() ||
      fulfillment.payload.length > 12000)
  )
    throw new XiaojiuPurchaseError('invalid_response')
  return {
    merchant_order_no: merchant,
    order_id: remoteId,
    cost_cents: cost,
    status: failed ? 'failed' : success ? 'success' : 'pending',
    delivery_content: success ? String(fulfillment!.payload) : '',
  }
}
