import { ApiError, type Env } from './platform.ts'

const encoder = new TextEncoder()
async function secretKey(env: Env) {
  if (!env.PARTNER_AUTH_SECRET || env.PARTNER_AUTH_SECRET.length < 32)
    throw new ApiError('商品 API 凭据加密尚未配置。', 503)
  return crypto.subtle.importKey(
    'raw',
    await crypto.subtle.digest(
      'SHA-256',
      encoder.encode('shop-product-v1:' + env.PARTNER_AUTH_SECRET),
    ),
    { name: 'AES-GCM' },
    false,
    ['encrypt', 'decrypt'],
  )
}
export async function seal(env: Env, value: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const result = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    await secretKey(env),
    encoder.encode(value),
  )
  return btoa(String.fromCharCode(...iv, ...new Uint8Array(result)))
}
export async function unseal(env: Env, value: string) {
  const raw = Uint8Array.from(atob(value), (c) => c.charCodeAt(0))
  return new TextDecoder().decode(
    await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: raw.slice(0, 12) },
      await secretKey(env),
      raw.slice(12),
    ),
  )
}
