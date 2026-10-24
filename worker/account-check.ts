import { ApiError, body, hash, json, type Env } from './platform.ts'
import { boundedResponseText } from './bounded-response.ts'
import { ACCOUNT_CHECK_BODY_MAX_BYTES, readAccountSession, type AccountCheckReport } from '../shared/chatgpt-account.ts'

const accountEndpoint = 'https://chatgpt.com/backend-api/accounts/check/v4-2023-04-27?timezone_offset_min=-480'
type ObjectValue = Record<string, unknown>
const object = (value: unknown): ObjectValue | null => value && typeof value === 'object' && !Array.isArray(value) ? value as ObjectValue : null
const text = (value: unknown) => typeof value === 'string' ? value : null
function timestamp(value: unknown) {
  const time = typeof value === 'number' && value > 0 ? value * (value < 1e12 ? 1000 : 1) : typeof value === 'string' && /^\d{4}-\d\d-\d\dT/.test(value) ? Date.parse(value) : NaN
  return Number.isFinite(time) && time > 0 && time < 8.64e15 ? new Date(time).toISOString() : null
}
export function emptyAccountReport(state: AccountCheckReport['state'], code: string, now = Date.now()): AccountCheckReport {
  return { state, code, checkedAt: new Date(now).toISOString(), plan: null, subscriptionActive: null, source: null, region: null, subscriptionExpiresAt: null, autoRenew: null }
}

// Only provider-returned account data can describe a subscription. Session/JWT
// claims are user-controlled hints, never a successful subscription/eligibility check.
export function accountReport(value: unknown, accountId: string | null, now = Date.now()): AccountCheckReport {
  const root = object(value), accounts = object(root?.accounts)
  if (!accounts) return emptyAccountReport('unknown', 'missing_account_data', now)
  const entries = Object.entries(accounts).map(([key, value]) => ({ key, value: object(value) })).filter(entry => entry.value)
  const matching = accountId ? entries.filter(entry => entry.key === accountId || object(entry.value?.account)?.account_id === accountId || object(entry.value?.account)?.id === accountId) : entries.filter(entry => entry.key === 'default')
  const selected = matching.length === 1 ? matching[0].value : !accountId && entries.length === 1 ? entries[0].value : null
  const account = object(selected?.account), entitlement = object(selected?.entitlement)
  if (!selected || !account || selected.can_access_with_session === false) return emptyAccountReport('unknown', 'account_not_confirmed', now)
  const rawPlan = text(account.plan_type)?.toLowerCase()
  const subscriptionPlan = text(entitlement?.subscription_plan)?.toLowerCase()
  const structure = text(account.structure)?.toLowerCase()
  let plan: AccountCheckReport['plan'] = null
  if (structure && ['team', 'business', 'enterprise', 'edu', 'workspace'].includes(structure) || rawPlan && /^(team|business|enterprise|edu)(_|$)/.test(rawPlan)) plan = 'workspace'
  else if (rawPlan === 'free') plan = 'free'
  else if (rawPlan && /^(go|plus|pro)(_|$)/.test(rawPlan)) plan = rawPlan.split('_')[0] as 'go' | 'plus' | 'pro'
  else if (subscriptionPlan && /^(chatgpt)?(go|plus|pro)(plan|_|$)/.test(subscriptionPlan)) plan = subscriptionPlan.replace(/^chatgpt/, '').match(/^(go|plus|pro)/)![0] as 'go' | 'plus' | 'pro'
  if (!plan) return emptyAccountReport('unknown', 'unknown_plan', now)
  const subscription = object(selected.subscription) ?? object(selected.last_active_subscription)
  const rawSource = text(subscription?.subscription_source ?? entitlement?.subscription_source)?.toLowerCase()
  const source = rawSource && ['web', 'stripe'].includes(rawSource) ? 'web' : rawSource && ['ios', 'apple', 'app_store'].includes(rawSource) ? 'ios' : rawSource && ['android', 'google_play'].includes(rawSource) ? 'android' : null
  const rawRegion = text(subscription?.billing_country ?? account.billing_country)?.toUpperCase()
  const active = typeof entitlement?.has_active_subscription === 'boolean' ? entitlement.has_active_subscription : null
  // A contradictory or partial reply cannot establish that a paid subscription is absent.
  if (plan === 'free' && active === true) return emptyAccountReport('unknown', 'conflicting_plan', now)
  return {
    ...emptyAccountReport('checked', 'provider_account_read', now), plan,
    subscriptionActive: active,
    source,
    region: rawRegion && /^[A-Z]{2}$/.test(rawRegion) ? rawRegion : null,
    subscriptionExpiresAt: timestamp(entitlement?.expires_at ?? subscription?.expires_at),
    autoRenew: typeof subscription?.will_renew === 'boolean' ? subscription.will_renew : typeof subscription?.cancel_at_period_end === 'boolean' ? !subscription.cancel_at_period_end : null,
  }
}

export async function checkAccount(request: Request, env: Env) {
  try {
    if (request.method !== 'POST') throw new ApiError('请通过检测页面提交。', 405)
    const input = await body(request, ACCOUNT_CHECK_BODY_MAX_BYTES)
    if (input.consent !== true) throw new ApiError('请先同意本次只读查询授权。')
    const parsed = readAccountSession(typeof input.session === 'string' ? input.session : '')
    if (!parsed.ok) {
      if (parsed.code === 'expired') return json({ report: emptyAccountReport('expired', 'locally_expired') })
      throw new ApiError(parsed.message)
    }
    const source = await hash(request.headers.get('CF-Connecting-IP') ?? 'local')
    if (!(await env.INTEREST_LIMITER.limit({ key: 'account-check:' + source })).success) throw new ApiError('检测较频繁，请一分钟后重试。', 429)
    const headers: Record<string, string> = { Accept: 'application/json', Authorization: 'Bearer ' + parsed.session.accessToken }
    if (parsed.session.accountId) headers['ChatGPT-Account-Id'] = parsed.session.accountId
    let response: Response
    try {
      // Fixed HTTPS origin and GET only. Never use user-controlled URLs, forward
      // cookies, follow redirects, store credentials, or call a recharge endpoint.
      response = await fetch(accountEndpoint, { method: 'GET', headers, redirect: 'manual', signal: AbortSignal.timeout(12000) })
    } catch { return json({ report: emptyAccountReport('unavailable', 'provider_unreachable') }) }
    if (response.status !== 200) {
      await response.body?.cancel().catch(() => {})
      const state = response.status === 401 ? 'expired' : response.status === 429 ? 'limited' : 'unavailable'
      return json({ report: emptyAccountReport(state, response.status === 401 ? 'provider_rejected_session' : response.status === 429 ? 'provider_rate_limited' : 'provider_unavailable') })
    }
    let value: unknown
    try { value = JSON.parse(await boundedResponseText(response, 128000)) }
    catch { return json({ report: emptyAccountReport('unknown', 'provider_invalid_response') }) }
    // Email, credentials, account IDs, upstream error bodies and all extra fields
    // stay out of the response. The UI identifies the input locally.
    return json({ report: accountReport(value, parsed.session.accountId) })
  } catch (error) {
    return json({ error: error instanceof ApiError ? error.message : '账号检测暂时不可用，请稍后重试。' }, error instanceof ApiError ? error.status : 503, error instanceof ApiError && error.status === 429 ? { 'Retry-After': '60' } : {})
  }
}
