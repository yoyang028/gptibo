import { legacyRechargeSession, readRechargeInput, RECHARGE_BODY_MAX_BYTES, RECHARGE_SESSION_SIZE_MESSAGE, type RechargeCredential } from '../../shared/recharge-credential.ts'

function fitsCheckout(credential: RechargeCredential) {
  const body = JSON.stringify({ action: 'submit', key: '00000000-0000-4000-8000-000000000000', customerConfirmedEmail: true, credential })
  return new TextEncoder().encode(body).length <= RECHARGE_BODY_MAX_BYTES
}

export function checkoutSession(value: string, retryMode?: 'session' | 'access_token' | null, acceptsCompleteSession = false) {
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
    if (!fitsCheckout(credential)) {
      if (parsed.token) credential = { mode: 'session', session: parsed.token }
      else { const original = legacyRechargeSession(value); if (!original) return { email: parsed.email, problem: '原提交资料超过恢复请求限制，请联系客服核对原任务，勿重新付款。', credential: null }; credential = original }
    }
    return { email: parsed.email, problem: '', credential }
  }
  if (acceptsCompleteSession) {
    const credential = { mode: 'session' as const, session: value }
    const { email } = readRechargeInput(value, 'session', false)
    if (fitsCheckout(credential)) return { email, problem: '', credential }
    const { token } = readRechargeInput(value)
    if (token) return { email, problem: '', credential: { mode: 'session' as const, session: token }, legacyTokenOnly: true }
    return { email, problem: RECHARGE_SESSION_SIZE_MESSAGE, credential: null }
  }
  const parsed = readRechargeInput(value)
  return { email: parsed.email, problem: parsed.problem, credential: parsed.token ? { mode: 'session' as const, session: parsed.token } : null }
}
