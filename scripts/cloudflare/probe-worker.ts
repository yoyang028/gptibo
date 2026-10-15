import { ApiError, type Env } from '../../worker/platform.ts'
import { authorizedProduct, checkoutEnabled, moneyCents, request, type Product } from '../../worker/recharge/client.ts'

export default {
  async fetch(_message: Request, env: Env) {
    try {
      const code = 'chatgpt_plus_cdk_1m'
      const authorizedCost = await authorizedProduct(env, code)
      const [products, methods] = await Promise.all([request<Product[]>(env, '/products'), request<{code: string}[]>(env, '/payment-methods')])
      const product = products.find(product => product.product_code === code)
      const checks = [
        {name: 'active matching agent, platform collection and automatic recharge authorized', passed: true},
        {name: 'ChatGPT Plus available', passed: product?.available === true},
        {name: 'CNY and quantity one allowed', passed: product?.currency === 'CNY' && product.max_quantity >= 1},
        {name: 'automatic recharge supported', passed: product?.delivery_modes?.includes('auto_recharge') === true},
        {name: 'catalogue and account supply prices match', passed: !!product && moneyCents(product.supply_price) === authorizedCost},
        {name: 'configured 139 CNY retail price covers current supply', passed: authorizedCost <= 13900},
        {name: 'supplier Alipay collection available', passed: Array.isArray(methods) && methods.some(method => method.code === 'alipay')},
        {name: 'checkout cannot open in read-only mode', passed: checkoutEnabled(env) === false},
      ]
      for (const [path, raw] of [['/orders', '{}'], ['/orders/blocked/payment-code', '{}'], ['/redemptions', '{}'], ['/orders/blocked/refunds', '{}'], ['/orders/blocked', undefined]] as const) {
        let blocked = false
        try { await request(env, path, raw, 'readonly-probe-only') }
        catch (error) { blocked = error instanceof ApiError && error.status === 409 }
        checks.push({name: 'read-only adapter blocks ' + path, passed: blocked})
      }
      return Response.json({ok: checks.every(check => check.passed), checks, supplyPriceCents: authorizedCost, realOrderCreated: false, realRechargeSubmitted: false})
    } catch { return Response.json({ok: false, error: 'Read-only supplier validation did not pass; no business request was permitted.'}, {status: 503}) }
  },
}
