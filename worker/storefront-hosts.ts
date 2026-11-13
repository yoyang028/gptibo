import { ApiError, type Env } from './platform.ts'

export function ownerStorefrontLinks(env: Env, origin: string, id: string, slug: string) {
  const legacy = new URL(slug ? '/s/' + encodeURIComponent(slug) : '/', origin)
  let hosts: unknown = {}
  try { hosts = JSON.parse(env.OWNER_STOREFRONT_HOSTS || '{}') } catch { throw new ApiError('商店域名配置暂不可用。', 503) }
  if (!hosts || typeof hosts !== 'object' || Array.isArray(hosts)) throw new ApiError('商店域名配置暂不可用。', 503)
  const domains = Object.entries(hosts).filter(([, store]) => store === id).map(([hostname]) => {
    let url: URL
    try { url = new URL('https://' + hostname) } catch { throw new ApiError('商店域名配置暂不可用。', 503) }
    if (url.hostname !== hostname || url.port || url.username || url.password || url.pathname !== '/' || url.search || url.hash)
      throw new ApiError('商店域名配置暂不可用。', 503)
    return hostname
  }).sort((a, b) => Number(a.startsWith('www.')) - Number(b.startsWith('www.')))
  return {
    storefront_url: id === 'platform' || !domains.length ? legacy.href : 'https://' + domains[0] + '/',
    legacy_url: legacy.href,
    domains: id === 'platform' ? [legacy.hostname] : domains,
  }
}

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
