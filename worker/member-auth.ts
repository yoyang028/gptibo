import { betterAuth, type BetterAuthOptions } from 'better-auth'
import { ApiError, body, hash, json, type Env } from './platform.ts'
import { partnerLimit } from './partner-auth.ts'
import { storefrontHostStore } from './storefront-hosts.ts'
import { ownerShop } from './owner-shop.ts'

export const MEMBER_STORE = 'store-3'
export function membershipEnabled(env: Env) { return env.MEMBERSHIP_ENABLED === 'true' }
export function memberStore(request: Request, env: Env) {
  return membershipEnabled(env) && storefrontHostStore(request, env) === MEMBER_STORE
}

async function memberMail(env: Env, origin: string, to: string, url: string, purpose: 'verify' | 'reset') {
  if (!env.RESEND_API_KEY || !env.RESEND_FROM) throw new ApiError('会员邮件服务暂不可用。', 503)
  await partnerLimit(env, 'member:s3:delivery:' + to.toLowerCase(), 5, 3600000)
  const link = new URL(url)
  if (link.origin !== origin) throw new Error('Member email origin mismatch')
  const shop = await ownerShop(env, MEMBER_STORE)
  const name = (shop.brandName || shop.name).replace(/[\r\n"\\]/g, '')
  const address = env.RESEND_FROM.match(/<([^<>]+)>$/)?.[1] ?? env.RESEND_FROM
  const title = purpose === 'verify' ? '验证注册邮箱' : '重置登录密码'
  const escape = (v: string) => v.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)
  const result = await fetch('https://api.resend.com/emails', {
    method: 'POST', redirect: 'manual', signal: AbortSignal.timeout(10000),
    headers: { Authorization: 'Bearer ' + env.RESEND_API_KEY, 'Content-Type': 'application/json', 'Idempotency-Key': 'member-mail/' + await hash(purpose + ':' + url) },
    body: JSON.stringify({ from: `"${name}" <${address}>`, to: [to], subject: `${name} · ${title}`,
      text: `${title}\n\n请打开此链接：${link.href}\n\n若非本人操作，请忽略此邮件。`,
      html: `<main style="font-family:Arial,sans-serif;line-height:1.8;max-width:560px;margin:40px auto"><h1>${escape(name)}</h1><h2>${title}</h2><p><a href="${escape(link.href)}">${title}</a></p><p>链接有效期为一小时。若非本人操作，请忽略此邮件。</p></main>` }),
  })
  if (!result.ok) throw new Error('Member mail delivery failed')
}

export function memberAuth(env: Env, origin: string) {
  if (!env.MEMBER_AUTH_SECRET || env.MEMBER_AUTH_SECRET.length < 32) throw new ApiError('会员登录尚未配置。', 503)
  return betterAuth({
    appName: 'ScholAI 商店会员', secret: env.MEMBER_AUTH_SECRET,
    baseURL: origin, basePath: '/api/member/auth', trustedOrigins: [origin],
    database: env.INTEREST_DB as NonNullable<BetterAuthOptions['database']>,
    user: { modelName: 'member_s3_user' }, session: { modelName: 'member_s3_session', expiresIn: 30 * 86400, updateAge: 86400 },
    account: { modelName: 'member_s3_account' }, verification: { modelName: 'member_s3_verification' },
    emailAndPassword: { enabled: true, requireEmailVerification: true, autoSignIn: false, minPasswordLength: 10,
      resetPasswordTokenExpiresIn: 3600, revokeSessionsOnPasswordReset: true,
      sendResetPassword: async ({ user, url }) => memberMail(env, origin, user.email, url, 'reset') },
    emailVerification: { sendOnSignUp: true, expiresIn: 3600, autoSignInAfterVerification: true,
      sendVerificationEmail: async ({ user, url }) => memberMail(env, origin, user.email, url, 'verify') },
    advanced: { cookiePrefix: 'scholai_s3', useSecureCookies: new URL(origin).protocol === 'https:',
      ipAddress: { ipAddressHeaders: ['cf-connecting-ip'] }, database: { generateId: 'uuid' } },
    // The wrapper uses the existing persistent D1 request limiter, across isolates.
    rateLimit: { enabled: false }, logger: { disabled: true }, telemetry: { enabled: false },
  })
}

export async function verifiedMember(request: Request, env: Env) {
  if (!memberStore(request, env) || !request.headers.get('Cookie')?.includes('scholai_s3')) return null
  const session = await memberAuth(env, new URL(request.url).origin).api.getSession({ headers: request.headers })
  return session?.user.emailVerified ? { id: session.user.id, email: session.user.email } : null
}

export async function memberAuthRoute(request: Request, env: Env) {
  if (!memberStore(request, env)) return json({ error: '当前商店未开放会员功能。' }, 404)
  const url = new URL(request.url)
  if (request.method === 'POST') {
    const data = await body(request.clone(), 8192)
    const ip = request.headers.get('CF-Connecting-IP') ?? 'local'
    await partnerLimit(env, 'member:s3:ip:' + ip, 30, 60000)
    if (typeof data.email === 'string' && /\/(sign-up\/email|request-password-reset|send-verification-email)$/.test(url.pathname)) {
      await partnerLimit(env, 'member:s3:mail:' + data.email.trim().toLowerCase(), 5, 3600000)
    }
    if (url.pathname.endsWith('/sign-up/email')) {
      // The business registration form needs only email and password.
      data.name = '会员'
      request = new Request(request, { body: JSON.stringify(data) })
    }
  }
  return memberAuth(env, url.origin).handler(request)
}
