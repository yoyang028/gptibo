import { ApiError, type Env } from '../platform.ts'
export type HanfolkSettings = {
  api_secret: string; key_hash: string; checked_key_hash: string; balance_cents: number | null
  checked_at: number; version: number
}
export async function hanfolkSettings(env: Env) {
  const row = await env.INTEREST_DB.prepare("SELECT * FROM hanfolk_settings WHERE id='main'").first<HanfolkSettings>()
  if (!row) throw new ApiError('代理商品数据库尚未迁移。', 503)
  return row
}
