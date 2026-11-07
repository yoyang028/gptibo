import { credentialExpiryProblem } from './credential-expiry.ts'

export const RECHARGE_TOKEN_MAX_CHARS = 131072
export const RECHARGE_BODY_MAX_BYTES = 256 * 1024
export type RechargeCredential = { mode: 'session'; session: string } | { mode: 'access_token'; access_token: string }
const record = (value: unknown): Record<string, unknown> | null => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
const emailOf = (source: Record<string, unknown>) => {
  const email = record(source.user)?.email
  return typeof email === 'string' && email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : ''
}
// These explicit JWT markers identify an access credential. This is only a
// rejection hint, never authentication or proof that another token is valid.
function looksLikeAccessToken(token: string) {
  const parts = token.split('.')
  if (parts.length !== 3) return false
  try {
    const decode = (part: string) => { const b64 = part.replace(/-/g, '+').replace(/_/g, '/'); return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(atob(b64.padEnd(Math.ceil(b64.length / 4) * 4, '=')), c => c.charCodeAt(0)))) }
    const header = record(decode(parts[0])), claims = record(decode(parts[1]))
    const audienceValue = claims?.aud
    const audiences: unknown[] = Array.isArray(audienceValue) ? audienceValue : [audienceValue]
    return ['at+jwt', 'application/at+jwt'].includes(String(header?.typ).toLowerCase()) || claims?.token_use === 'access' || audiences.some(a => typeof a === 'string' && /^https:\/\/api\.openai\.com(?:\/|$)/.test(a)) || Boolean(claims?.['https://api.openai.com/auth'])
  } catch { return false }
}

// Match the upstream's root/data/auth extraction contract. Input JSON can be
// much larger than its token; never cap or discard it before extraction.
export function readRechargeInput(raw: string, mode: 'session' | 'access_token' = 'session', checkExpiry = true) {
  const text = raw.trim()
  if (!text) return { email: '', token: '', problem: '', expires: undefined as unknown }
  let token = text, email = '', expires: unknown
  if (text.startsWith('{') || text.startsWith('[')) {
    let parsed: unknown
    try { parsed = JSON.parse(text) } catch { return { email: '', token: '', problem: '复制内容不完整，请重新完整复制后再提交。', expires } }
    const root = record(parsed)
    if (!root) return { email: '', token: '', problem: '请粘贴完整的凭据 JSON 或 sessionToken 本身。', expires }
    const sources = [root, record(root.data), record(root.auth)].filter((s): s is Record<string, unknown> => Boolean(s))
    email = sources.map(emailOf).find(Boolean) ?? ''
    expires = sources.map(s => s.expires).find(value => typeof value === 'string')
    token = ''
    const keys = mode === 'session' ? ['sessionToken', 'session'] : ['accessToken', 'access_token']
    for (const source of sources) {
      for (const key of keys) { const value = source[key]; if (typeof value === 'string' && value.trim()) { token = value.trim(); break } }
      if (token) break
    }
    if (!token) return { email, token: '', problem: mode === 'session' ? '未找到 sessionToken。请在当前登录账号的获取页面完整复制 Session JSON，不要只复制 accessToken。仍有问题请联系支持核对，无需重新付款。' : '未找到 accessToken，请核对原提交资料。', expires }
  } else if (mode === 'session' && text.includes('__Secure-next-auth.session-token')) {
    // Only extract the named ChatGPT cookie. Other cookies are never forwarded.
    const chunks = new Map<number, string>(); let single = ''
    for (const part of text.replace(/^Cookie:\s*/i, '').split(/[;\r\n]+/)) {
      const match = /^\s*__Secure-next-auth\.session-token(?:\.(\d+))?\s*=\s*([^\s;]+)\s*$/.exec(part)
      if (!match) continue
      if (match[1] === undefined) { if (single) return { email, token: '', problem: '会话凭据有重复项，请重新复制。', expires }; single = match[2] }
      else { const index = Number(match[1]); if (!Number.isSafeInteger(index) || index > 128 || chunks.has(index)) return { email, token: '', problem: '会话凭据分段有误，请重新复制。', expires }; chunks.set(index, match[2]) }
    }
    if (single && chunks.size) return { email, token: '', problem: '会话凭据同时包含整段与分段，请仅复制当前有效的一组。', expires }
    if (single) token = single
    else {
      const indexes = [...chunks.keys()].sort((a, b) => a - b)
      if (indexes.length < 2 || indexes.some((index, position) => index !== position)) return { email, token: '', problem: '会话凭据分段不完整，请从 .0 开始复制全部分段。', expires }
      token = indexes.map(index => chunks.get(index)).join('')
    }
  }
  if (token.length > RECHARGE_TOKEN_MAX_CHARS) return { email, token: '', problem: '提取后的充值令牌超过 128 KiB 字符限制，请核对复制内容。', expires }
  if (!token || /[^\x21-\x7e]/.test(token) || token === 'null' || token === 'undefined' || token.startsWith('"')) return { email, token: '', problem: '充值凭据格式无效，请复制 sessionToken 的完整值或包含它的 JSON。', expires }
  if (mode === 'session' && looksLikeAccessToken(token)) return { email, token: '', problem: '这段内容是 Access Token，请完整复制获取页面的 Session JSON，不要只截取其中的 accessToken。', expires }
  const problem = checkExpiry ? credentialExpiryProblem(token, expires) : ''
  return { email, token: problem ? '' : token, problem, expires }
}

export function normalizeRechargeCredential(value: unknown, checkExpiry = true): RechargeCredential {
  const input = record(value)
  if (input?.mode !== 'session' || typeof input.session !== 'string') throw new Error('当前充值通道需要 sessionToken，不能使用 Access Token。请查看充值凭据说明。')
  const parsed = readRechargeInput(input.session, 'session', checkExpiry)
  if (!parsed.token || parsed.problem) throw new Error(parsed.problem || '请填写本次授权的 sessionToken。')
  return { mode: 'session', session: parsed.token }
}

// Reconstruct only a pre-upgrade request for hash-matched recovery. These
// formats must never authorize a new attempt or relabel an Access Token.
export function legacyRechargeSession(value: string): RechargeCredential | null {
  let input: { user?: { email?: unknown }; accessToken?: unknown; expires?: unknown; account?: unknown; authProvider?: unknown }
  try { input = JSON.parse(value) } catch { return null }
  if (!input || typeof input.user?.email !== 'string' || typeof input.accessToken !== 'string') return null
  const wrap = (session: string): RechargeCredential => ({ mode: 'session', session })
  const fits = (credential: RechargeCredential) => credential.mode === 'session' && credential.session.length <= 32000 && new TextEncoder().encode(JSON.stringify({ action: 'submit', key: '00000000-0000-4000-8000-000000000000', customerConfirmedEmail: true, credential })).length <= 40000
  const original = wrap(value); if (fits(original)) return original
  const minified = wrap(JSON.stringify(input)); if (fits(minified)) return minified
  const compact = wrap(JSON.stringify({ user: input.user, accessToken: input.accessToken, expires: input.expires, account: input.account, authProvider: input.authProvider }))
  return fits(compact) ? compact : null
}
