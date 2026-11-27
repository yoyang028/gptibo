import { ApiError, body, hash, json, type Env } from './platform.ts'
import { storefrontSelection, ownerStorefrontLinks } from './storefront-hosts.ts'
import { readAdminStoreScope } from './admin-store-scope.ts'

const localDay = (time: number) => new Date(time + 8 * 3600000).toISOString().slice(0, 10)

function period(url: URL) {
  const value = url.searchParams.get('days') ?? '7'
  if (value !== '1' && value !== '7' && value !== '30' && value !== '90') throw new ApiError('仅支持最近 1 天、7 天、30 天或 90 天。')
  return Number(value)
}

export async function recordVisitor(request: Request, env: Env) {
  if (request.method !== 'POST') throw new ApiError('请使用 POST 提交。', 405)
  const data = await body(request, 512)
  if (typeof data.visitorId !== 'string' || !/^[a-f0-9-]{36}$/.test(data.visitorId)) throw new ApiError('访客标识无效。')
  if (typeof data.path !== 'string' || data.path.length > 120) throw new ApiError('页面路径无效。')
  const path = data.path.replace(/\/$/, '') || '/'
  const match = path.match(/^\/(?:r|s)\/([^/]+)(?:\/(?:orders|check|product\/[a-z0-9-]+))?$/)
  if (!match && path !== '/' && path !== '/orders' && path !== '/check' && !/^\/product\/[a-z0-9-]+$/.test(path)) throw new ApiError('页面路径无效。')
  let shopId = 'platform'
  const selection = storefrontSelection(request, env, match?.[1])
  if (selection) {
    const partner = await env.INTEREST_DB.prepare('SELECT id FROM partners WHERE slug=?1 AND active=1 UNION ALL SELECT id FROM owner_shop_settings WHERE slug=?1').bind(String(selection)).first<{ id: string }>()
    if (!partner) throw new ApiError('代理商店不可用。', 404)
    shopId = partner.id
  }
  await env.INTEREST_DB.prepare('INSERT INTO visitor_days(day,shop_id,visitor_hash,page_views) VALUES (?,?,?,1) ON CONFLICT(day,shop_id,visitor_hash) DO UPDATE SET page_views=page_views+1')
    .bind(localDay(Date.now()), shopId, await hash(data.visitorId)).run()
  return json({ ok: true })
}

async function summarizeVisitors(env: Env, days: number, now: number, shopFilter = '', shopIds: string[] = []) {
  const filter = 'day>=?' + (shopFilter ? ' AND ' + shopFilter : '')
  const args = [localDay(now - (days - 1) * 86400000), ...shopIds]
  const [daily, total] = await Promise.all([
    env.INTEREST_DB.prepare(`SELECT day,SUM(page_views) pageViews,COUNT(DISTINCT visitor_hash) visitors FROM visitor_days WHERE ${filter} GROUP BY day ORDER BY day`).bind(...args).all<{ day: string; pageViews: number; visitors: number }>(),
    env.INTEREST_DB.prepare(`SELECT COALESCE(SUM(page_views),0) pageViews,COUNT(DISTINCT visitor_hash) visitors FROM visitor_days WHERE ${filter}`).bind(...args).first<{ pageViews: number; visitors: number }>(),
  ])
  const byDay = new Map(daily.results.map(row => [row.day, row]))
  const trend = Array.from({ length: days }, (_, index) => {
    const day = localDay(now - (days - 1 - index) * 86400000)
    return byDay.get(day) ?? { day, pageViews: 0, visitors: 0 }
  })
  return { days, pageViews: total?.pageViews ?? 0, visitors: total?.visitors ?? 0, trend }
}

export async function visitorSummary(env: Env, url: URL, shopId?: string) {
  return summarizeVisitors(env, period(url), Date.now(), shopId ? 'shop_id=?' : '', shopId ? [shopId] : [])
}

export async function adminVisitorSummary(env: Env, url: URL) {
  const { channel, storeId } = await readAdminStoreScope(env, url)
  const now = Date.now(), days = period(url), since = localDay(now - (days - 1) * 86400000)
  const shopFilter = storeId ? 'shop_id=?' : channel === 'owner' ? 'shop_id IN (SELECT id FROM owner_shop_settings)'
    : channel === 'agent' ? 'shop_id IN (SELECT id FROM partners)' : ''
  type Traffic = { id: string; name: string; slug: string; active: number; pageViews: number; visitors: number }
  const [summary, partners, stores] = await Promise.all([
    summarizeVisitors(env, days, now, shopFilter, storeId ? [storeId] : []),
    channel !== 'owner' ? env.INTEREST_DB.prepare(`SELECT p.id,p.name,p.slug,p.active,COALESCE(SUM(v.page_views),0) pageViews,COUNT(DISTINCT v.visitor_hash) visitors
      FROM partners p LEFT JOIN visitor_days v ON v.shop_id=p.id AND v.day>=? GROUP BY p.id ORDER BY visitors DESC,pageViews DESC,p.created_at DESC`).bind(since).all<Traffic>() : null,
    channel !== 'agent' ? env.INTEREST_DB.prepare(`SELECT s.id,s.slug,COALESCE(NULLIF(json_extract(s.settings,'$.name'),''),'GPTibo') name,
      COALESCE(json_extract(s.settings,'$.active'),1) active,COALESCE(SUM(v.page_views),0) pageViews,COUNT(DISTINCT v.visitor_hash) visitors
      FROM owner_shop_settings s LEFT JOIN visitor_days v ON v.shop_id=s.id AND v.day>=? ${storeId ? 'WHERE s.id=?' : ''}
      GROUP BY s.id ORDER BY COALESCE(json_extract(s.settings,'$.displayOrder'),s.slot)`).bind(since, ...(storeId ? [storeId] : [])).all<Traffic>() : null,
  ])
  const ownerStores = (stores?.results ?? []).map(store => ({ ...store, ...ownerStorefrontLinks(env, url.origin, store.id, store.slug) }))
  const platform = ownerStores.find(store => store.id === 'platform')
  return { ...summary, platform: { pageViews: platform?.pageViews ?? 0, visitors: platform?.visitors ?? 0 }, ownerStores, partners: partners?.results ?? [] }
}
