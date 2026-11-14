import { betterAuth, type BetterAuthOptions } from 'better-auth'
import { emailOTP } from 'better-auth/plugins/email-otp'
import { ApiError, body, hash, json, type Env } from './platform.ts'
import { partnerLimit } from './partner-auth.ts'
import { storefrontHostStore } from './storefront-hosts.ts'
import { ownerShop } from './owner-shop.ts'
import { identityKey } from './member-identity.ts'
import { escapeMail, shopBrand, shopMailFrom } from './store-branding.ts'

export const MEMBER_STORE = 'store-3'
export function membershipEnabled(env: Env) { return env.MEMBERSHIP_ENABLED === 'true' }
export function memberStore(request: Request, env: Env) {
  return membershipEnabled(env) && storefrontHostStore(request, env) === MEMBER_STORE
}

async function memberMail(env: Env, to: string, otp: string, purpose: string) {
  if (!env.RESEND_API_KEY || !env.RESEND_FROM) throw new ApiError('会员邮件服务暂不可用。', 503)
  if (!/^\d{6}$/.test(otp) || !['email-verification', 'forget-password'].includes(purpose)) throw new Error('Unsupported member mail')
  await partnerLimit(env, 'member:s3:delivery:' + to.toLowerCase(), 5, 3600000)
  const shop = await ownerShop(env, MEMBER_STORE)
  const name = shopBrand(shop), title = purpose === 'email-verification' ? '验证注册邮箱' : '重置登录密码'
  const result = await fetch('https://api.resend.com/emails', {
    method: 'POST', redirect: 'manual', signal: AbortSignal.timeout(10000),
    headers: { Authorization: 'Bearer ' + env.RESEND_API_KEY, 'Content-Type': 'application/json', 'Idempotency-Key': 'member-mail/' + await hash(purpose + ':' + to + ':' + crypto.randomUUID()) },
    body: JSON.stringify({ from: shopMailFrom(env.RESEND_FROM, shop), to: [to], subject: `${name} · ${title}`,
      text: `${name}\n${title}\n\n验证码：${otp}\n\n请在商店页面输入验证码，10 分钟内有效。请勿向他人提供验证码。若非本人操作，请忽略此邮件。`,
      html: `<main style="font-family:Arial,sans-serif;line-height:1.8;max-width:560px;margin:40px auto"><h1>${escapeMail(name)}</h1><h2>${title}</h2><p>请在商店页面输入验证码：</p><p style="font-size:32px;font-weight:bold;letter-spacing:8px">${otp}</p><p>10 分钟内有效。请勿向他人提供验证码。若非本人操作，请忽略此邮件。</p></main>` }),
  })
  if (!result.ok) throw new Error('Member mail delivery failed')
}

export function memberAuth(env: Env, origin: string) {
  if (!env.MEMBER_AUTH_SECRET || env.MEMBER_AUTH_SECRET.length < 32) throw new ApiError('会员登录尚未配置。', 503)
  return betterAuth({
    appName: '商店会员', secret: env.MEMBER_AUTH_SECRET,
    baseURL: origin, basePath: '/api/member/auth', trustedOrigins: [origin],
    database: env.INTEREST_DB as NonNullable<BetterAuthOptions['database']>,
    user: { modelName: 'member_s3_user' }, session: { modelName: 'member_s3_session', expiresIn: 30 * 86400, updateAge: 86400 },
    account: { modelName: 'member_s3_account' }, verification: { modelName: 'member_s3_verification' },
    emailAndPassword: { enabled: true, requireEmailVerification: true, autoSignIn: false, minPasswordLength: 10,
      resetPasswordTokenExpiresIn: 3600, revokeSessionsOnPasswordReset: true },
    emailVerification: { sendOnSignUp: true, sendOnSignIn: false, expiresIn: 3600, autoSignInAfterVerification: true },
    plugins: [emailOTP({ overrideDefaultEmailVerification: true, disableSignUp: true,
      otpLength: 6, expiresIn: 600, allowedAttempts: 5, resendStrategy: 'rotate',
      storeOTP: { hash: otp => identityKey(env, 'email-otp', otp) },
      sendVerificationOTP: async ({ email, otp, type }) => memberMail(env, email, otp, type) })],
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
  // Keep consuming pre-upgrade verification/reset links, but issue only codes.
  if (url.pathname.endsWith('/request-password-reset') && !url.pathname.includes('/email-otp/')) return json({ error: '请刷新页面，使用邮箱验证码重置密码。' }, 409)
  if (['/sign-in/email-otp','/forget-password/email-otp','/email-otp/change-email','/email-otp/request-email-change','/email-otp/check-verification-otp'].some(path => url.pathname.endsWith(path))) return json({ error: '未找到接口。' }, 404)
  if (request.method === 'POST') {
    const data = await body(request.clone(), 8192)
    const ip = request.headers.get('CF-Connecting-IP') ?? 'local'
    await partnerLimit(env, 'member:s3:ip:' + ip, 30, 60000)
    if (url.pathname.endsWith('/email-otp/send-verification-otp') && data.type !== 'email-verification') return json({ error: '验证用途无效。' }, 400)
    if (typeof data.email === 'string' && /\/(sign-up\/email|request-password-reset|send-verification-email|send-verification-otp)$/.test(url.pathname)) {
      await partnerLimit(env, 'member:s3:mail:' + data.email.trim().toLowerCase(), 5, 3600000)
      const purpose = url.pathname.endsWith('/email-otp/request-password-reset') ? 'reset' : 'verify'
      await partnerLimit(env, 'member:s3:cooldown:' + purpose + ':' + data.email.trim().toLowerCase(), 1, 60000)
    }
    if (url.pathname.endsWith('/sign-up/email')) {
      // The business registration form needs only email and password.
      data.name = '会员'
      request = new Request(request, { body: JSON.stringify(data) })
    }
  }
  return memberAuth(env, url.origin).handler(request)
}
