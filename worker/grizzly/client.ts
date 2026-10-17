import { GRIZZLY_ORIGIN, decimalUnits } from '../../shared/grizzly-sms.ts'
import { boundedResponseText } from '../bounded-response.ts'
import { hash, type Env } from '../platform.ts'

const messages: Record<string, string> = {
  BAD_KEY: '供货凭据无效，请联系店主检查。',
  NO_KEY: '尚未配置接码凭据。',
  NO_BALANCE: '供货账户余额不足，请联系店主处理原订单。',
  NO_NUMBERS: '当前美国项目暂无可用号码，请联系店主处理原订单或申请售后。',
  BAD_SERVICE: '供货项目不可用，请联系店主核对。',
  BAD_STATUS: '当前接码状态暂不允许此操作，请稍后查询。',
  NO_ACTIVATION: '上游未找到本次接码，请联系店主核对原订单。',
  SERVICE_UNAVAILABLE_REGION: '供货服务暂不支持当前服务器区域。',
  USERS_IP_IS_NOT_ALLOWED: '供货 IP 授权未通过，请联系店主检查。',
  RATE_LIMIT: '接码查询较频繁，请稍后查询原订单。',
  NETWORK: '供货结果暂未确认，请保留原订单，勿重复付款。',
  INVALID: '供货返回结果待核对，请保留原订单。',
  DISABLED: '接码采购暂未开放，请联系店主处理原订单。',
  PROHIBITED: '供货平台已停止销售该项目。',
}
export class GrizzlyError extends Error {
  code: string
  definitive: boolean
  constructor(code: string, definitive = false) {
    super(messages[code] ?? messages.INVALID)
    this.code = code
    this.definitive = definitive
  }
}
export function grizzlyKey(value: unknown): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{16,256}$/.test(value))
    throw new GrizzlyError('BAD_KEY', true)
  return value
}
export class GrizzlyClient {
  private env: Env
  private key: string
  constructor(env: Env, key: string) {
    this.env = env
    this.key = grizzlyKey(key)
  }
  async request(
    action:
      'getBalance' | 'getPrices' | 'getNumberV2' | 'getStatus' | 'setStatus',
    values: Record<string, string> = {},
  ) {
    if (action === 'getNumberV2' && this.env.GRIZZLY_SMS_ENABLED !== 'true')
      throw new GrizzlyError('DISABLED', true)
    const url = new URL('/stubs/handler_api.php', GRIZZLY_ORIGIN)
    url.search = new URLSearchParams({
      api_key: this.key,
      action,
      ...values,
    }).toString()
    if (
      !(
        await this.env.API_LIMITER.limit({
          key: 'grizzly:' + (await hash(this.key)),
        })
      ).success
    )
      throw new GrizzlyError('RATE_LIMIT', true)
    let response: Response
    try {
      response = await fetch(url.toString(), {
        method: 'GET',
        redirect: 'manual',
        cache: 'no-store',
        signal: AbortSignal.timeout(10000),
        headers: { Accept: 'application/json, text/plain' },
      })
    } catch {
      throw new GrizzlyError('NETWORK')
    }
    if (!response.ok)
      throw new GrizzlyError(response.status === 429 ? 'RATE_LIMIT' : 'NETWORK')
    let raw: string
    try {
      raw = (await boundedResponseText(response, 64000)).trim()
    } catch {
      throw new GrizzlyError('INVALID')
    }
    if (Object.hasOwn(messages, raw)) throw new GrizzlyError(raw, true)
    if (raw === 'The service is prohibited for sale by administration')
      throw new GrizzlyError('PROHIBITED', true)
    return raw
  }
  async balance() {
    const raw = await this.request('getBalance')
    if (!/^ACCESS_BALANCE:\d+(?:\.\d{1,6})?$/.test(raw))
      throw new GrizzlyError('INVALID')
    return raw.slice('ACCESS_BALANCE:'.length)
  }
  async price(service: string, country: string) {
    const raw = await this.request('getPrices', { service, country })
    try {
      const offer = JSON.parse(raw)?.[country]?.[service]
      if (!offer || !Number.isSafeInteger(offer.count) || offer.count < 0)
        throw new Error()
      const cost = decimalUnits(offer.cost)
      if (cost <= 0) throw new Error()
      return { priceUsd: String(offer.cost), count: offer.count }
    } catch {
      throw new GrizzlyError('INVALID')
    }
  }
  async allocate(service: string, country: string, maxPrice: string) {
    const raw = await this.request('getNumberV2', {
      service,
      country,
      maxPrice,
    })
    try {
      const data = JSON.parse(raw)
      const id = String(data.activationId),
        phone = String(data.phoneNumber)
      if (
        !/^\d{1,20}$/.test(id) ||
        (typeof data.activationId === 'number' &&
          !Number.isSafeInteger(data.activationId)) ||
        !/^\d{8,15}$/.test(phone)
      )
        throw new Error()
      return {
        id,
        phone: '+' + phone,
        cost: data.activationCost as unknown,
        currency: data.currency as unknown,
        country: String(data.countryCode),
      }
    } catch {
      throw new GrizzlyError('INVALID')
    }
  }
  async status(id: string) {
    const raw = await this.request('getStatus', { id })
    if (raw === 'STATUS_CANCEL') return { state: 'cancelled' as const }
    if (
      ['STATUS_WAIT_CODE', 'STATUS_WAIT_RESEND'].includes(raw) ||
      /^STATUS_WAIT_RETRY:[^\r\n]{1,128}$/.test(raw)
    )
      return { state: 'waiting' as const }
    const code = raw.match(/^STATUS_OK:(.{1,128})$/u)?.[1]
    if (
      code?.trim() &&
      !Array.from(code).some(
        (c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127,
      )
    )
      return { state: 'received' as const, code }
    throw new GrizzlyError('INVALID')
  }
  async finish(id: string, cancel = false) {
    const raw = await this.request('setStatus', {
      id,
      status: cancel ? '8' : '6',
    })
    if (raw !== (cancel ? 'ACCESS_CANCEL' : 'ACCESS_ACTIVATION'))
      throw new GrizzlyError('INVALID')
  }
}
