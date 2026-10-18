import { customProductId } from '../shared/shop-products.ts'
import { ApiError, body, json, type Env } from './platform.ts'
import { shopProducts } from './shop-products.ts'
import { authorizedProduct, checkoutEnabled, config, configured, productMap, request as upstreamRequest, type Product } from './recharge/client.ts'

/** Admin-only inventory. Loading this endpoint never contacts or purchases upstream. */
export async function supplierManagement(request: Request, env: Env, path: string) {
  if (path === '/api/admin/suppliers' && request.method === 'GET') {
    const [products, plans, links] = await Promise.all([
      shopProducts(env, true),
      env.INTEREST_DB.prepare('SELECT * FROM catalog_plans ORDER BY rowid').all<{ id: string }>(),
      env.INTEREST_DB.prepare('SELECT local_id FROM hanfolk_product_links').all<{ local_id: string }>(),
    ])
    const ready = configured(env)
    return json({
      products,
      plans: plans.results.filter(p => !customProductId.test(p.id)),
      linkedSuppliers: Object.fromEntries(links.results.map(p => [p.local_id, 'hanfolk'])),
      bugan: {
        configured: ready,
        salesEnabled: checkoutEnabled(env),
        origin: ready ? new URL(config(env).base).origin : '',
        productMap: productMap(env),
      },
      xiaojiuEnabled: env.XIAOJIU_PURCHASE_ENABLED === 'true',
    })
  }
  if (path === '/api/admin/suppliers/bugan/check' && request.method === 'POST') {
    await body(request)
    if (!configured(env)) throw new ApiError('bugan 供货 API 尚未配置。', 409)
    const mappings = Object.entries(productMap(env))
    const [catalog, ...costs] = await Promise.all([
      upstreamRequest<Product[]>(env, '/products'),
      ...mappings.map(([, code]) => authorizedProduct(env, code)),
    ])
    if (!Array.isArray(catalog)) throw new ApiError('上游商品目录格式无效。', 503)
    return json({
      checkedAt: Date.now(),
      products: mappings.map(([plan, code], index) => ({
        plan, code, costCents: costs[index],
        available: catalog.some(p => p.product_code === code && p.available === true),
      })),
    })
  }
  throw new ApiError('请求方式或服务商入口无效。', 405)
}
