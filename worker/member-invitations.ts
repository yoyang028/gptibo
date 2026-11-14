import { ApiError, type Env } from './platform.ts'
import { memberStore } from './member-auth.ts'

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
  return { inviteUrl: new URL('/i/' + chosen.alias, origin).href, inviteAlias: chosen.alias, inviteCustomized: !!custom }
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

export async function invitationRedirect(request: Request, env: Env) {
  if (!memberStore(request, env)) return new Response('未找到邀请链接。', { status: 404 })
  if (request.method !== 'GET') throw new ApiError('请求方式不支持。', 405)
  const url = new URL(request.url), candidate = url.pathname.slice(3).toLowerCase()
  const found = /^[a-z0-9][a-z0-9-]{1,18}[a-z0-9]$/.test(candidate) ? await env.INTEREST_DB.prepare(`SELECT p.invite_code
    FROM member_invite_aliases a JOIN member_profiles p ON p.id=a.member_id JOIN member_s3_user u ON u.id=p.id
    WHERE a.alias=? AND p.store_id='store-3' AND p.frozen=0 AND u.emailVerified=1`).bind(candidate).first<{ invite_code: string }>() : null
  if (!found) return new Response('邀请链接无效或暂不可用，请返回商店购买。', { status: 404, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' } })
  // Public attribution, never an authentication credential. The browser moves
  // this into the existing local storage; the address bar returns to a clean /.
  return new Response(null, { status: 302, headers: { Location: '/', 'Cache-Control': 'no-store',
    'Set-Cookie': `scholai_s3_invitation=${found.invite_code}; Path=/; Max-Age=2592000; SameSite=Lax${url.protocol === 'https:' ? '; Secure' : ''}` } })
}
