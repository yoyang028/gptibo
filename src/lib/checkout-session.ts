import { credentialExpiryProblem } from '../../shared/credential-expiry.ts'

const encoder = new TextEncoder()
const maxInputBytes = 1024 * 1024
// Keep a pasted Session in Session mode, including its account identity. Large
// feature-flag dumps must not silently switch the upstream credential parser.
// Budget serialized bytes too: escaping JSON can exceed the API body limit.
const maxCredentialBytes = 32000
const sessionCredential = (session: string) => ({ mode: 'session' as const, session })
// Use the real field and request limits. An older accepted Session (including
// its whitespace/escaping) must keep its exact bytes when recovering by key.
const fits = (credential: ReturnType<typeof sessionCredential>) => credential.session.length <= maxCredentialBytes && encoder.encode(JSON.stringify({ action: 'submit', key: '00000000-0000-4000-8000-000000000000', customerConfirmedEmail: true, credential })).length <= 40000

export function checkoutSession(value: string, retryMode?: 'session' | 'access_token' | null) {
  if (!value.trim()) return { email: '', problem: '', credential: null }
  if (encoder.encode(value).length > maxInputBytes) return { email: '', problem: '粘贴内容超过 1 MB，请确认只复制了获取入口返回的 Session JSON。', credential: null }
  let session: { user?: { email?: unknown }; accessToken?: unknown; expires?: unknown; account?: unknown; authProvider?: unknown }
  try { session = JSON.parse(value) }
  catch { return { email: '', problem: '请复制并粘贴完整的 Session JSON。', credential: null } }
  if (!session || typeof session.user?.email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(session.user.email) || typeof session.accessToken !== 'string' || !session.accessToken.trim()) {
    return { email: '', problem: 'Session 缺少账号信息，请重新获取完整内容。', credential: null }
  }
  // An unknown original request must retain its exact payload, even if it has
  // since expired. The server independently verifies the original key/hash.
  const problem = retryMode ? '' : credentialExpiryProblem(session.accessToken, session.expires)
  if (problem) return { email: '', problem, credential: null }
  // An uncertain request must keep its original mode/bytes and idempotency key.
  // This includes token-mode requests created before Session compaction.
  const tokenCredential = { mode: 'access_token' as const, access_token: session.accessToken }
  if (encoder.encode(session.accessToken).length > maxCredentialBytes || encoder.encode(JSON.stringify(tokenCredential)).length > 36000) return { email: '', problem: 'Session 中的 Access Token 超过充值接口限制，请重新获取 Session，或联系客服核对原订单。', credential: null }
  if (retryMode === 'access_token') return { email: session.user.email, problem: '', credential: tokenCredential }
  const original = sessionCredential(value)
  if (fits(original)) return { email: session.user.email, problem: '', credential: original }
  // First remove formatting alone. If feature data still makes it too large,
  // preserve the complete user/account objects, token, expiry and provider.
  const minified = sessionCredential(JSON.stringify(session))
  if (fits(minified)) return { email: session.user.email, problem: '', credential: minified }
  const compact = sessionCredential(JSON.stringify({ user: session.user, accessToken: session.accessToken, expires: session.expires, account: session.account, authProvider: session.authProvider }))
  if (!fits(compact)) return { email: '', problem: 'Session 的必要账号资料超过充值接口限制，请重新获取 Session，或联系客服核对原订单。', credential: null }
  return { email: session.user.email, problem: '', credential: compact }
}
