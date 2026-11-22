import { ApiError, type Env } from './platform.ts'
import { storefrontHostStore } from './storefront-hosts.ts'
import { isMemberStoreId, MEMBER_STORE_IDS, type MemberStoreId } from '../shared/member-promotions.ts'

const scopes = new WeakMap<Env, { store: MemberStoreId; original: Env }>()
const memberTables = [
  'member_s3_user', 'member_s3_session', 'member_s3_account', 'member_s3_verification',
  'member_profiles', 'member_order_promotions', 'member_first_purchases', 'member_reward_grants',
  'member_reward_allocations', 'member_reward_ledger', 'member_target_uses', 'member_target_claims',
  'member_reward_actions', 'member_review_actions', 'member_order_assertions', 'member_order_reconciliations',
  'member_operation_events', 'member_notification_settings', 'member_notifications', 'member_ledger_sequence',
  'member_reward_audits', 'member_order_signals', 'member_risk_subjects', 'member_risk_cases', 'member_invite_aliases',
]
const tablePattern = new RegExp(`\\b(?:${memberTables.join('|')})\\b`, 'g')

export function scopedMemberStore(env: Env) { return scopes.get(env)?.store }
export function memberScope(env: Env): MemberStoreId { return scopedMemberStore(env) ?? 'store-3' }

export function memberEnvironment(env: Env, store: MemberStoreId): Env {
  const scope = scopes.get(env)
  if (scope?.store === store) return env
  const original = scope?.original ?? env
  // Both shops use one D1 binding, so an order and its own promotion still commit
  // in a single batch. Only the known member tables are qualified for the primary shop.
  const db = store === 'store-3' ? original.INTEREST_DB : new Proxy(original.INTEREST_DB, {
    get(target, property) {
      if (property === 'prepare') return (sql: string) => target.prepare(sql.replace(tablePattern, table => table.replace(/^member_(?:s3_)?/, 'member_platform_')))
      const value: unknown = Reflect.get(target, property, target)
      return typeof value === 'function' ? value.bind(target) : value
    },
  })
  const scoped = { ...original, INTEREST_DB: db }
  scopes.set(scoped, { store, original })
  return scoped
}

export function platformMemberHost(env: Env) {
  const hostname = env.MEMBERSHIP_PLATFORM_HOST?.trim().toLowerCase()
  return hostname && /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/.test(hostname) && hostname !== 'false' ? hostname : undefined
}

export function membershipEnabled(env: Env, store = memberScope(env)) {
  return store === 'platform' ? !!platformMemberHost(env) && env.MEMBERSHIP_PLATFORM_ENABLED !== 'false' : env.MEMBERSHIP_ENABLED === 'true'
}

export function membershipConfigured(env: Env, store = memberScope(env)) {
  return store === 'platform' ? !!platformMemberHost(env) : env.MEMBERSHIP_ENABLED !== undefined
}

export function configuredMemberStores(env: Env) {
  return MEMBER_STORE_IDS.filter(store => membershipConfigured(env, store))
}

export function memberHostStore(request: Request, env: Env): MemberStoreId | null {
  const mapped = storefrontHostStore(request, env)
  const hostname = new URL(request.url).hostname.toLowerCase().replace(/\.$/, '')
  const store = mapped ?? (hostname === platformMemberHost(env) ? 'platform' : null)
  const selector = request.headers.get('X-Storefront-Shop')
  return isMemberStoreId(store) && (!selector || selector === store) ? store : null
}

export function memberStore(request: Request, env: Env): MemberStoreId | null {
  const store = memberHostStore(request, env)
  return store && membershipEnabled(env, store) ? store : null
}

export function adminMemberEnvironment(request: Request, env: Env, url: URL) {
  const store = url.searchParams.get('store') ?? memberHostStore(request, env) ?? 'store-3'
  if (!isMemberStoreId(store)) throw new ApiError('请选择已开通邀新活动的店铺。', 404)
  return memberEnvironment(env, store)
}
