import { credentialExpiryProblem } from './credential-expiry.ts'

export const ACCOUNT_SESSION_MAX_BYTES = 1024 * 1024
export const ACCOUNT_CHECK_BODY_MAX_BYTES = 96 * 1024

export type AccountSession = { email: string; accessToken: string; accountId: string | null; expiresAt: string | null }
export type AccountSessionInput = { ok: true; session: AccountSession } | { ok: false; code: 'empty' | 'format' | 'incomplete' | 'expired' | 'size'; message: string }
export type AccountCheckReport = {
  state: 'checked' | 'expired' | 'limited' | 'unavailable' | 'unknown'
  code: string
  checkedAt: string
  plan: 'free' | 'go' | 'plus' | 'pro' | 'workspace' | null
  subscriptionActive: boolean | null
  source: 'web' | 'ios' | 'android' | null
  region: string | null
  subscriptionExpiresAt: string | null
  autoRenew: boolean | null
}

export function readAccountSession(raw: string, now = Date.now()): AccountSessionInput {
  if (!raw.trim()) return { ok: false, code: 'empty', message: '请先粘贴完整的 ChatGPT Session。' }
  if (new TextEncoder().encode(raw).length > ACCOUNT_SESSION_MAX_BYTES) return { ok: false, code: 'size', message: 'Session 内容超过 1 MB，请确认只复制了 Session 页的完整 JSON。' }
  let input: Record<string, unknown>
  try { input = JSON.parse(raw) } catch { return { ok: false, code: 'format', message: '内容不完整，请在 Session 页全选并复制完整 JSON。' } }
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { ok: false, code: 'format', message: '请粘贴 Session 页的完整 JSON。' }
  const user = input.user as Record<string, unknown> | undefined
  const email = typeof user?.email === 'string' ? user.email.trim() : ''
  const accessToken = typeof input.accessToken === 'string' ? input.accessToken.trim() : ''
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !accessToken || accessToken.length > 16000 || /[^\x21-\x7e]/.test(accessToken)) {
    return { ok: false, code: 'incomplete', message: '缺少有效的邮箱或 Access Token。请先登录 ChatGPT，再重新复制 Session。' }
  }
  const expiryProblem = credentialExpiryProblem(accessToken, input.expires, now)
  if (expiryProblem) return { ok: false, code: 'expired', message: expiryProblem }
  const account = input.account as Record<string, unknown> | undefined
  const accountId = typeof account?.id === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(account.id) ? account.id : null
  const expiry = typeof input.expires === 'string' && Number.isFinite(Date.parse(input.expires)) ? new Date(input.expires).toISOString() : null
  return { ok: true, session: { email, accessToken, accountId, expiresAt: expiry } }
}

// Feature flags and other unrelated Session fields can be very large. Send
// only the validated fields needed for this account read, never the full dump.
export function compactAccountSession(session: AccountSession) {
  return JSON.stringify({
    user: { email: session.email }, accessToken: session.accessToken,
    ...(session.accountId ? { account: { id: session.accountId } } : {}),
    ...(session.expiresAt ? { expires: session.expiresAt } : {}),
  })
}

export const accountPlanLabel = (plan: AccountCheckReport['plan']) => plan ? ({ free: '免费版', go: 'Go', plus: 'Plus', pro: 'Pro', workspace: '团队 / 企业工作区' })[plan] : '待确认'
