import {
  HANFOLK_ORIGIN,
  HANFOLK_API_PATH,
  hanfolkMoney,
  skuName,
  type HanfolkProduct,
  type HanfolkDetail,
} from '../../shared/hanfolk-catalog.ts'
import { boundedResponseText } from '../bounded-response.ts'
import { hash, type Env } from '../platform.ts'
export class HanfolkError extends Error {
  code: string
  constructor(code: string) {
    super(
      (
        {
          AUTH: '供货密钥或 IP 授权未通过，请核对后再检查。',
          RATE_LIMIT: '上游请求较频繁，请稍后再读取。',
          NETWORK: '供货平台暂未响应，保留现有草稿，请稍后检查。',
          INVALID: '上游商品资料格式未通过核对，请保留现有草稿。',
        } as Record<string, string>
      )[code] ?? '供货读取失败，请核对原配置。',
    )
    this.code = code
  }
}
export function hanfolkKey(value: unknown) {
  if (typeof value !== 'string' || !/^daju_[a-fA-F0-9]{32}$/.test(value))
    throw new HanfolkError('AUTH')
  return value
}
export class HanfolkClient {
  private key: string
  private env: Pick<Env, 'API_LIMITER'>
  constructor(env: Pick<Env, 'API_LIMITER'>, key: string) {
    this.env = env
    this.key = hanfolkKey(key)
  }
  private async read(action: 'balance' | 'products' | 'product', id?: number) {
    if (
      !(
        await this.env.API_LIMITER.limit({
          key: 'hanfolk:' + (await hash(this.key)),
        })
      ).success
    )
      throw new HanfolkError('RATE_LIMIT')
    const url = new URL(HANFOLK_API_PATH, HANFOLK_ORIGIN)
    url.searchParams.set('do', action)
    if (id !== undefined) {
      if (!Number.isSafeInteger(id) || id < 1) throw new HanfolkError('INVALID')
      url.searchParams.set('id', String(id))
    }
    let response: Response
    try {
      response = await fetch(url.toString(), {
        method: 'GET',
        headers: { 'X-API-Key': this.key, Accept: 'application/json' },
        redirect: 'manual',
        cache: 'no-store',
        signal: AbortSignal.timeout(15000),
      })
    } catch {
      throw new HanfolkError('NETWORK')
    }
    if ([401, 403].includes(response.status)) throw new HanfolkError('AUTH')
    if (response.status === 429) throw new HanfolkError('RATE_LIMIT')
    if (!response.ok) throw new HanfolkError('NETWORK')
    try {
      const raw = await boundedResponseText(response, 1200000)
      if (raw.includes(this.key)) throw new Error()
      const data = JSON.parse(raw)
      if (data.success !== true) throw new Error()
      return data as Record<string, unknown>
    } catch {
      throw new HanfolkError('INVALID')
    }
  }
  async balance() {
    const data = await this.read('balance')
    try {
      return { balanceCents: hanfolkMoney(data.balance) }
    } catch {
      throw new HanfolkError('INVALID')
    }
  }
  async products() {
    const data = await this.read('products')
    if (!Array.isArray(data.products) || data.products.length > 2000)
      throw new HanfolkError('INVALID')
    const products = data.products.map((value) => this.product(value))
    if (new Set(products.map((p) => p.id)).size !== products.length)
      throw new HanfolkError('INVALID')
    return products
  }
  private product(value: unknown): HanfolkProduct {
    if (!value || typeof value !== 'object') throw new HanfolkError('INVALID')
    const p = value as HanfolkProduct
    if (
      !Number.isSafeInteger(p.id) ||
      p.id < 1 ||
      typeof p.title !== 'string' ||
      !p.title.trim() ||
      p.title.length > 300 ||
      !Number.isSafeInteger(p.stock) ||
      p.stock < 0 ||
      typeof p.is_auto !== 'boolean' ||
      typeof p.cover !== 'string' ||
      p.cover.length > 2000
    )
      throw new HanfolkError('INVALID')
    try {
      hanfolkMoney(p.price)
    } catch {
      throw new HanfolkError('INVALID')
    }
    return {
      id: p.id,
      title: p.title,
      price: hanfolkMoney(p.price) / 100,
      stock: p.stock,
      sales: Number.isSafeInteger(p.sales) ? p.sales : 0,
      is_auto: p.is_auto,
      cover: p.cover,
      sort_id: Number.isSafeInteger(p.sort_id) ? p.sort_id : 0,
    }
  }
  async detail(id: number): Promise<HanfolkDetail> {
    const data = await this.read('product', id),
      p = data.product as HanfolkDetail,
      base = this.product(p)
    if (
      base.id !== id ||
      typeof p.description !== 'string' ||
      p.description.length > 100000 ||
      typeof p.is_sku !== 'boolean' ||
      !Array.isArray(p.specs) ||
      p.specs.length > 8 ||
      !Array.isArray(p.sku_variants) ||
      p.sku_variants.length > 200 ||
      !Array.isArray(p.required_inputs) ||
      p.required_inputs.length > 20 ||
      !Number.isSafeInteger(p.min_qty) ||
      p.min_qty < 1 ||
      !Number.isSafeInteger(p.max_qty) ||
      p.max_qty < 0
    )
      throw new HanfolkError('INVALID')
    const specs = p.specs.map((g) => {
      if (
        typeof g.title !== 'string' ||
        g.title.length > 100 ||
        !Array.isArray(g.values) ||
        g.values.length > 100
      )
        throw new HanfolkError('INVALID')
      return {
        title: g.title,
        values: g.values.map((v) => {
          if (
            typeof v.id !== 'string' ||
            !v.id ||
            v.id.length > 50 ||
            typeof v.name !== 'string' ||
            !v.name ||
            v.name.length > 150
          )
            throw new HanfolkError('INVALID')
          return { id: v.id, name: v.name }
        }),
      }
    })
    const sku_variants = p.sku_variants.map((v) => {
      if (
        typeof v.sku !== 'string' ||
        !/^\w+(?:-\w+)*$/.test(v.sku) ||
        v.sku.length > 100 ||
        !Number.isSafeInteger(v.stock) ||
        v.stock < 0
      )
        throw new HanfolkError('INVALID')
      try {
        hanfolkMoney(v.price)
      } catch {
        throw new HanfolkError('INVALID')
      }
      return { sku: v.sku, price: hanfolkMoney(v.price) / 100, stock: v.stock }
    })
    if (new Set(sku_variants.map((v) => v.sku)).size !== sku_variants.length)
      throw new HanfolkError('INVALID')
    const required_inputs = p.required_inputs.map((v) => {
      if (
        typeof v.key !== 'string' ||
        v.key.length > 80 ||
        typeof v.name !== 'string' ||
        v.name.length > 100 ||
        typeof v.required !== 'boolean'
      )
        throw new HanfolkError('INVALID')
      return { key: v.key, name: v.name, required: v.required }
    })
    const detail: HanfolkDetail = {
      ...base,
      is_sku: p.is_sku,
      description: p.description,
      min_qty: p.min_qty,
      max_qty: p.max_qty,
      specs,
      sku_variants,
      required_inputs,
    }
    try {
      for (const v of sku_variants) skuName(detail, v.sku)
    } catch {
      throw new HanfolkError('INVALID')
    }
    return detail
  }
}
