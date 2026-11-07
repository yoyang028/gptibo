import { legacyRechargeSession, readRechargeInput, RECHARGE_BODY_MAX_BYTES, type RechargeCredential } from '../../shared/recharge-credential.ts'

export function checkoutSession(value: string, retryMode?: 'session' | 'access_token' | null) {
  if (!value.trim()) return { email: '', problem: '', credential: null }
  // Unknown submissions may predate this upgrade. The server alone selects a
  // hash-matched original body; this path must never create a different task.
  if (retryMode) {
    const parsed = readRechargeInput(value, retryMode, false)
    let credential: RechargeCredential
    if (retryMode === 'access_token') {
      let token = value
      try { const input = JSON.parse(value); if (typeof input?.accessToken === 'string') token = input.accessToken } catch { /* Original raw token. */ }
      credential = { mode: 'access_token', access_token: token }
    } else credential = { mode: 'session', session: value }
    const bytes = new TextEncoder().encode(JSON.stringify({ action: 'submit', key: '00000000-0000-4000-8000-000000000000', customerConfirmedEmail: true, credential })).length
    if (bytes > RECHARGE_BODY_MAX_BYTES) {
      if (parsed.token) credential = { mode: 'session', session: parsed.token }
      else { const original = legacyRechargeSession(value); if (!original) return { email: parsed.email, problem: '原提交资料超过恢复请求限制，请联系客服核对原任务，勿重新付款。', credential: null }; credential = original }
    }
    return { email: parsed.email, problem: '', credential }
  }
  const parsed = readRechargeInput(value)
  return { email: parsed.email, problem: parsed.problem, credential: parsed.token ? { mode: 'session' as const, session: parsed.token } : null }
}
