import { ApiError, type Env } from './platform.ts'

// Hostnames come from the actual request URL, never forwarding headers or the
// browser's shop selector. Production mappings stay in private deployment vars.
export function storefrontHostStore(request: Request, env: Env): string | undefined {
  if (!env.OWNER_STOREFRONT_HOSTS) return undefined
  let hosts: unknown
  try { hosts = JSON.parse(env.OWNER_STOREFRONT_HOSTS) } catch { throw new ApiError('商店域名配置暂不可用。', 503) }
  if (!hosts || typeof hosts !== 'object' || Array.isArray(hosts)) throw new ApiError('商店域名配置暂不可用。', 503)
  const hostname = new URL(request.url).hostname.toLowerCase().replace(/\.$/, '')
  if (!Object.hasOwn(hosts, hostname)) return undefined
  const store = (hosts as Record<string, unknown>)[hostname]
  if (store !== 'store-2' && store !== 'store-3') throw new ApiError('商店域名配置暂不可用。', 503)
  return store
}

export function storefrontSelection(request: Request, env: Env, supplied?: unknown) {
  const store = storefrontHostStore(request, env)
  if (!store) return supplied
  for (const selector of [supplied, request.headers.get('X-Storefront-Shop')]) {
    if (selector !== undefined && selector !== null && selector !== '' && selector !== store) throw new ApiError('当前域名不属于所选商店。', 404)
  }
  return store
}
