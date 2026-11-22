import { ApiError, type Env } from './platform.ts'
import { memberEnvironment, memberStore } from './member-scope.ts'
import { memberInvitationPath } from '../shared/member-invitation-path.ts'
import { memberInvitationCookie } from '../shared/member-promotions.ts'

const reserved = new Set(['admin','api','account','login','register','shop','store','support','help','invite','member','checkout','assets','www'])
export function invitationAlias(value: unknown) {
  const alias = typeof value === 'string' ? value.trim().toLowerCase() : ''
  if (!/^[a-z0-9][a-z0-9-]{1,18}[a-z0-9]$/.test(alias) || reserved.has(alias)) throw new ApiError('请输入 3～20 位字母、数字或短横线；首尾须为字母或数字，不能使用系统保留名称。')
  return alias
}

type Alias = { alias: string; kind: 'default' | 'custom' }
async function aliases(env: Env, id: string) {
  return (await env.INTEREST_DB.prepare('SELECT alias,kind FROM member_invite_aliases WHERE member_id=? ORDER BY kind').bind(id).all<Alias>()).results
}
export async function memberInvitation(env: Env, id: string, origin: string) {
  let rows = await aliases(env, id)
  for (let attempt = 0; !rows.length && attempt < 3; attempt++) {
    const alias = crypto.randomUUID().replaceAll('-', '').slice(0, 10)
    await env.INTEREST_DB.prepare("INSERT INTO member_invite_aliases(alias,member_id,kind,created_at) VALUES (?,?,'default',?) ON CONFLICT DO NOTHING").bind(alias, id, Date.now()).run()
    rows = await aliases(env, id)
  }
  const custom = rows.find(r => r.kind === 'custom'), chosen = custom ?? rows[0]
  if (!chosen) throw new ApiError('邀请链接暂不可用，请稍后重试。', 503)
  return { inviteUrl: new URL('/ref/' + chosen.alias, origin).href, inviteAlias: chosen.alias, inviteCustomized: !!custom }
}

export async function customizeInvitation(env: Env, id: string, value: unknown, origin: string) {
  const alias = invitationAlias(value)
  // Both uniqueness rules are enforced in D1, including concurrent requests.
  await env.INTEREST_DB.prepare(`INSERT INTO member_invite_aliases(alias,member_id,kind,created_at)
    SELECT ?,p.id,'custom',? FROM member_profiles p JOIN member_s3_user u ON u.id=p.id
    WHERE p.id=? AND p.frozen=0 AND u.emailVerified=1 ON CONFLICT DO NOTHING`).bind(alias, Date.now(), id).run()
  const current = (await aliases(env, id)).find(r => r.kind === 'custom')
  if (current?.alias === alias) return memberInvitation(env, id, origin)
  if (current) throw new ApiError('自定义机会已使用，邀请地址不能再次修改。', 409)
  throw new ApiError('此地址已被使用，请换一个。', 409)
}

export async function invitationEntry(request: Request, env: Env) {
  const store = memberStore(request, env)
  if (!store) return new Response('未找到邀请链接。', { status: 404 })
  env = memberEnvironment(env, store)
  if (request.method !== 'GET') throw new ApiError('请求方式不支持。', 405)
  const url = new URL(request.url), entry = memberInvitationPath(url.pathname), candidate = entry?.alias ?? ''
  const found = /^[a-z0-9][a-z0-9-]{1,18}[a-z0-9]$/.test(candidate) ? await env.INTEREST_DB.prepare(`SELECT p.invite_code
    FROM member_invite_aliases a JOIN member_profiles p ON p.id=a.member_id JOIN member_s3_user u ON u.id=p.id
    WHERE a.alias=? AND p.store_id=? AND p.frozen=0 AND u.emailVerified=1`).bind(candidate, store).first<{ invite_code: string }>() : null
  if (!found) return new Response('邀请链接无效或暂不可用，请返回商店购买。', { status: 404, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' } })
  if (!entry || !/^[A-Z0-9]{32}$/.test(found.invite_code)) throw new ApiError('邀请链接暂不可用。', 503)
  const cookieName = memberInvitationCookie(store)
  const cookie = `${cookieName}=${found.invite_code}; Path=/; Max-Age=2592000; SameSite=Lax${url.protocol === 'https:' ? '; Secure' : ''}`
  const canonical = entry.canonicalBase + (entry.suffix === '/' ? '' : entry.suffix)
  if (url.pathname !== canonical) return new Response(null, { status: 302, headers: {
    Location: canonical + url.search, 'Cache-Control': 'no-store', 'Set-Cookie': cookie,
  } })
  // Serve the existing storefront at its referral URL. The public identity in
  // this document also survives disabled storage and history navigation.
  const assetHeaders = new Headers(request.headers)
  for (const name of ['If-None-Match', 'If-Modified-Since', 'Range', 'If-Range']) assetHeaders.delete(name)
  const asset = await env.ASSETS.fetch(new Request(new URL('/', url), { headers: assetHeaders }))
  if (!asset.ok || !asset.headers.get('Content-Type')?.includes('text/html')) throw new ApiError('邀请页面暂不可用，请稍后重试。', 503)
  const html = await asset.text()
  if (!/<\/head>/i.test(html)) throw new ApiError('邀请页面暂不可用，请稍后重试。', 503)
  const meta = `<meta name="scholai-member-invitation" content="${found.invite_code}" data-alias="${entry.alias}" data-store="${store}">`
  const headers = new Headers(asset.headers)
  for (const name of ['Content-Length', 'ETag', 'Last-Modified']) headers.delete(name)
  headers.set('Cache-Control', 'no-store')
  headers.set('Set-Cookie', cookie)
  return new Response(html.replace(/<\/head>/i, meta + '</head>'), { status: 200, headers })
}
