import { credentialExpiryProblem } from '../../shared/credential-expiry.ts'

const encoder = new TextEncoder()
const maxInputBytes = 1024 * 1024
// Quefa accepts either credential mode, with a 32,000-character field limit.
// Budget serialized bytes too: escaping Session JSON otherwise can exceed
// our 40,000-byte fulfillment request limit.
const maxCredentialBytes = 32000

export function checkoutSession(value: string, retryMode?: 'session' | 'access_token' | null) {
  if (!value.trim()) return { email: '', problem: '', credential: null }
  if (encoder.encode(value).length > maxInputBytes) return { email: '', problem: '粘贴内容超过 1 MB，请确认只复制了获取入口返回的 Session JSON。', credential: null }
  let session: { user?: { email?: unknown }; accessToken?: unknown; expires?: unknown }
  try { session = JSON.parse(value) }
  catch { return { email: '', problem: '请复制并粘贴完整的 Session JSON。', credential: null } }
  if (!session || typeof session.user?.email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(session.user.email) || typeof session.accessToken !== 'string' || !session.accessToken.trim()) {
    return { email: '', problem: 'Session 缺少账号信息，请重新获取完整内容。', credential: null }
  }
  // An unknown original request must retain its exact payload, even if it has
  // since expired. The server independently verifies the original key/hash.
  const problem = retryMode ? '' : credentialExpiryProblem(session.accessToken, session.expires)
  if (problem) return { email: '', problem, credential: null }
  // Preserve the exact credential mode and bytes of an uncertain submission.
  // Only a new oversized Session uses the documented token alternative; the
  // complete input still supplies the account confirmation and expiry checks.
  const sessionCredential = { mode: 'session' as const, session: value }
  const useToken = retryMode === 'access_token' || (!retryMode && encoder.encode(JSON.stringify(sessionCredential)).length > maxCredentialBytes)
  const tokenCredential = { mode: 'access_token' as const, access_token: session.accessToken }
  if (useToken && (encoder.encode(session.accessToken).length > maxCredentialBytes || encoder.encode(JSON.stringify(tokenCredential)).length > 36000)) return { email: '', problem: 'Session 中的 Access Token 超过充值接口限制，请重新获取 Session，或联系客服核对原订单。', credential: null }
  const credential = useToken ? tokenCredential : sessionCredential
  return { email: session.user.email, problem: '', credential }
}
