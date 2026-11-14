import { ApiError, type Env } from './platform.ts'

export async function identityKey(env: Env, kind: string, value: string) {
  if (!env.MEMBER_AUTH_SECRET) throw new ApiError('会员活动尚未配置。', 503)
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(env.MEMBER_AUTH_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  return Array.from(new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`store-3:${kind}:${value.toLowerCase().trim()}`))), b => b.toString(16).padStart(2, '0')).join('')
}
