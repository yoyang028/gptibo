// Server-side, read-only inspection. Never import this module into the browser.
import { opcpay, opcpayError } from 'opcpay'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const capabilityNames = [
  'purchase_entry', 'entitlement_query', 'consumption', 'purchase_request_query',
  'purchase_request_list', 'consumption_list', 'webhooks', 'entitlement_monitoring',
  'transaction_query', 'transaction_list', 'refund', 'refund_query', 'bills',
  'automatic_renewal', 'consumption_reversal',
]
const productStatuses = ['NOT_CONFIGURED', 'CONFIGURING', 'PENDING', 'ACTION_REQUIRED', 'ENABLED', 'DISABLED', 'TERMINATED']
const billingModes = ['ONE_TIME', 'ONE_TIME_DURATION', 'QUANTITY']
const errorCodes = new Set(['INVALID_API_KEY', 'RATE_LIMITED', 'INTERNAL_ERROR', 'PROVIDER_ERROR', 'SERVICE_UNAVAILABLE', 'CONFLICT', 'INVALID_RESPONSE'])

function object(value) { return value !== null && typeof value === 'object' && !Array.isArray(value) }
function text(value, key) {
  if (typeof value !== 'string') return ''
  return value.replaceAll(key, '[REDACTED]').slice(0, 500)
}
function invalid() { throw new Error('Invalid inspection response') }

function capabilitiesView(value) {
  if (!object(value) || typeof value.api_version !== 'string' || typeof value.provider_configured !== 'boolean' || !object(value.capabilities)) invalid()
  const flags = {}
  for (const name of capabilityNames) {
    if (typeof value.capabilities[name] !== 'boolean') invalid()
    flags[name] = value.capabilities[name]
  }
  // Free-form upstream messages and unknown fields are deliberately excluded.
  return { providerConfigured: value.provider_configured, flags }
}

function productView(value, key) {
  if (!object(value) || !productStatuses.includes(value.capability_status) || !Array.isArray(value.charging_options)) invalid()
  if (value.charging_options.length > 200) invalid()
  const options = value.charging_options.map(option => {
    if (!object(option) || typeof option.sku_id !== 'string' || !option.sku_id || typeof option.display_name !== 'string' || typeof option.price !== 'string' || typeof option.currency !== 'string' || !billingModes.includes(option.billing_mode)) invalid()
    return {
      skuId: text(option.sku_id, key), name: text(option.display_name, key),
      billingMode: option.billing_mode, price: text(option.price, key), currency: text(option.currency, key),
      ...(option.quota_unit === 'COUNT' || option.quota_unit === 'POINT' ? { quotaUnit: option.quota_unit } : {}),
      ...(Number.isSafeInteger(option.quota_amount) && option.quota_amount > 0 ? { quotaAmount: option.quota_amount } : {}),
      ...(['WEEK', 'MONTH', 'QUARTER', 'YEAR'].includes(option.duration_period) ? { durationPeriod: option.duration_period } : {}),
    }
  })
  return { status: value.capability_status, name: text(value.product_name, key), billingMode: billingModes.includes(value.billing_mode) ? value.billing_mode : null, options }
}

function failure(error) {
  if (error instanceof opcpayError) {
    return {
      ok: false, code: errorCodes.has(error.code) ? error.code : 'UPSTREAM_ERROR',
      httpStatus: Number.isInteger(error.status) ? error.status : null,
    }
  }
  return { ok: false, code: 'UNAVAILABLE_OR_INVALID_RESPONSE', httpStatus: null }
}

export async function inspectOpcpay({ apiKey = process.env.opcpay_api_key } = {}) {
  const configured = typeof apiKey === 'string' && apiKey.trim().length > 0
  const report = {
    configured, readOnly: true, queried: false, checks: {},
    capabilities: null, product: null, entitlementPurchaseAvailable: false,
    // SDK installation or even future capability flags do not implement an
    // order-bound create/query/refund adapter for the existing storefront.
    storefrontCollectionEnabled: false,
    missingTransactionCapabilities: null,
    message: '未配置服务端环境变量 opcpay_api_key；未发出请求。',
  }
  if (!configured) return report

  const client = new opcpay({ apiKey })
  const results = await Promise.allSettled([
    client.capabilities().then(capabilitiesView),
    client.product().then(value => productView(value, apiKey)),
  ])
  report.queried = true
  for (const [index, name] of ['capabilities', 'product'].entries()) {
    const result = results[index]
    report.checks[name] = result.status === 'fulfilled' ? { ok: true } : failure(result.reason)
    if (result.status === 'fulfilled') report[name] = result.value
  }
  const flags = report.capabilities?.flags
  report.entitlementPurchaseAvailable = Boolean(report.capabilities?.providerConfigured && flags?.purchase_entry && flags?.entitlement_query && report.product?.status === 'ENABLED' && report.product.options.length)
  report.missingTransactionCapabilities = flags ? ['transaction_query', 'transaction_list', 'refund', 'refund_query', 'bills'].filter(name => !flags[name]) : null
  report.message = results.some(result => result.status === 'rejected')
    ? '只读查询未全部通过；仅返回经过验证的字段，不据此开放收款。'
    : '只读查询完成。套餐购买入口和权益不代表某笔商城订单已付款；商城支付适配尚未接通。'
  return report
}

export function inspectionExitCode(report) {
  if (!report.configured) return 2
  return report.checks.capabilities?.ok && report.checks.product?.ok ? 0 : 1
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const report = await inspectOpcpay()
    // Only the projected report is printed, never SDK objects, error bodies,
    // request headers, raw responses or arbitrary exception messages.
    console.log(JSON.stringify(report, null, 2))
    process.exitCode = inspectionExitCode(report)
  } catch {
    console.error('一人付只读检查未完成；请检查服务端配置和网络。')
    process.exitCode = 1
  }
}
