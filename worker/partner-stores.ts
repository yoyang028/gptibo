import { ApiError, body, json, type Env } from './platform.ts'
import { emailValue, type Partner } from './partner-auth.ts'
import { supportContactsSettings } from './support-contacts.ts'
import { announcementSettings } from './announcements.ts'
import { visitorSummary } from './visitors.ts'
import { profitSql, eligibleSql } from './finance.ts'
import { safeImage, hasControlCharacters } from '../shared/shop-products.ts'

type StoreSettings = {
  name: string; active: boolean; brandName: string; logo: string; pageTitle: string
  headline: string; description: string
}
export async function partnerStore(env: Env, partner: Partner) {
  const row = await env.INTEREST_DB.prepare('SELECT settings,version FROM partner_store_settings WHERE partner_id=?')
    .bind(partner.id).first<{ settings: string; version: number }>()
  return { name: partner.name, active: true, brandName: '', logo: '', pageTitle: '', headline: '', description: '',
    ...JSON.parse(row?.settings ?? '{}'), version: row?.version ?? 0 } as StoreSettings & { version: number }
}
function text(value: unknown, max: number, label: string, required = false) {
  if (typeof value !== 'string' || value.length > max || hasControlCharacters(value) || (required && !value.trim())) throw new ApiError(`请填写有效的${label}。`)
  return value.trim()
}
async function changed(env: Env, id: string) {
  if (!await env.INTEREST_DB.prepare('SELECT id FROM admin_audit WHERE id=?').bind(id).first()) throw new ApiError('账号或数据已更新，请刷新后重试。', 409)
}

// The existing upstream StoresWorkspace consumes this contract. Cloudflare
// currently exposes the account's default shop; Go retains its multi-shop API.
export async function partnerStoreRoutes(request: Request, env: Env, url: URL, p: Partner, suffix: string, readOnly = false) {
  const db = env.INTEREST_DB
  if (readOnly && request.method !== 'GET') throw new ApiError('平台预览为只读，请由代理在工作台保存。', 405)
  if (suffix === '/stores' && request.method === 'GET') {
    const [settings, contacts, announcement, prices, stats, visits] = await Promise.all([
      partnerStore(env, p), supportContactsSettings(env, p.id), announcementSettings(env, p.id),
      db.prepare('SELECT pp.plan,c.name,c.product_id,pp.cost_cents,pp.price_cents,pp.enabled,pp.version FROM partner_prices pp JOIN catalog_plans c ON c.id=pp.plan WHERE pp.partner_id=? ORDER BY c.rowid').bind(p.id).all<{ enabled: number; version: number }>(),
      db.prepare(`SELECT COUNT(*) order_count,COALESCE(SUM(CASE WHEN ${eligibleSql()} THEN ${profitSql()} ELSE 0 END),0) earned_cents FROM orders WHERE partner_id=?`).bind(p.id).first<{ order_count: number; earned_cents: number }>(),
      visitorSummary(env, new URL('?days=30', url), p.id),
    ])
    return json({ referralOrigin: url.origin, capabilities: { maxStores: 1, coupons: false, customDomains: false },
      stores: [{ id: p.id, slot: 1, slug: p.slug, name: settings.name, active: settings.active, version: settings.version,
        settings: { ...settings, ...contacts.contacts, announcement: announcement.enabled ? announcement.content : '', announcementTitle: announcement.title, announcementPlacement: announcement.placement },
        ...stats, visitors: visits.visitors }],
      prices: prices.results.map(row => ({ ...row, store_id: p.id, supply_version: row.version, child_cost_cents: null, enabled: Boolean(row.enabled) })), coupons: [], charges: [] })
  }
  if (suffix === '/stores' && request.method === 'POST') {
    const data = await body(request, 500000)
    if (data.id !== p.id) throw new ApiError('请编辑当前账号的商店。', 404)
    if (typeof data.active !== 'boolean' || !data.settings || typeof data.settings !== 'object' || Array.isArray(data.settings)) throw new ApiError('商店设置无效。')
    const raw = data.settings as Record<string, unknown>
    const [current, contacts, announcement] = await Promise.all([partnerStore(env, p), supportContactsSettings(env, p.id), announcementSettings(env, p.id)])
    if (data.version !== current.version) throw new ApiError('商店已更新，请刷新。', 409)
    const settings: StoreSettings = { name: text(data.name, 32, '商店名称', true), active: data.active,
      brandName: text(raw.brandName ?? '', 32, '品牌名称'), logo: text(raw.logo ?? '', 400000, 'Logo'),
      pageTitle: text(raw.pageTitle ?? '', 120, '页面标题'), headline: text(raw.headline ?? '', 120, '首页标题'), description: text(raw.description ?? '', 500, '商店简介') }
    if (!safeImage(settings.logo)) throw new ApiError('请上传 PNG、JPG 或 WebP 图片。')
    const wechat = text(raw.wechat ?? '', 64, '微信'), qq = text(raw.qq ?? '', 20, 'QQ'), email = raw.email ? emailValue(raw.email) : ''
    if (qq && !/^\d{5,20}$/.test(qq)) throw new ApiError('QQ 号需为 5–20 位数字。')
    const content = text(raw.announcement ?? '', 2000, '商店公告'), title = text(raw.announcementTitle ?? '', 100, '公告标题')
    const placement = raw.announcementPlacement ?? 'both'
    if (!['home', 'product', 'both'].includes(String(placement))) throw new ApiError('公告位置无效。')
    const id = crypto.randomUUID(), now = Date.now()
    await db.batch([
      db.prepare(`INSERT INTO partner_store_settings(partner_id,settings,version,change_id,updated_at)
        SELECT id,?,1,?,? FROM partners WHERE id=? AND active=1 AND auth_version=?
        AND COALESCE((SELECT version FROM partner_store_settings WHERE partner_id=partners.id),0)=?
        AND COALESCE((SELECT version FROM support_contacts WHERE owner=partners.id),0)=?
        AND COALESCE((SELECT version FROM partner_announcements WHERE partner_id=partners.id),0)=?
        ON CONFLICT(partner_id) DO UPDATE SET settings=excluded.settings,version=partner_store_settings.version+1,change_id=excluded.change_id,updated_at=excluded.updated_at`)
        .bind(JSON.stringify(settings), id, now, p.id, p.auth_version, current.version, contacts.version, announcement.version),
      db.prepare(`INSERT INTO support_contacts(owner,partner_id,wechat,qq,email,version,change_id,updated_at)
        SELECT partner_id,partner_id,?,?,?,1,?,? FROM partner_store_settings WHERE partner_id=? AND change_id=?
        ON CONFLICT(owner) DO UPDATE SET wechat=excluded.wechat,qq=excluded.qq,email=excluded.email,version=support_contacts.version+1,change_id=excluded.change_id,updated_at=excluded.updated_at`).bind(wechat, qq, email, id, now, p.id, id),
      db.prepare(`INSERT INTO partner_announcements(partner_id,enabled,placement,title,content,version,change_id,updated_at)
        SELECT partner_id,?,?,?,?,1,?,? FROM partner_store_settings WHERE partner_id=? AND change_id=?
        ON CONFLICT(partner_id) DO UPDATE SET enabled=excluded.enabled,placement=excluded.placement,title=excluded.title,content=excluded.content,version=partner_announcements.version+1,change_id=excluded.change_id,updated_at=excluded.updated_at`).bind(Number(Boolean(content)), String(placement), title || '店铺公告', content, id, now, p.id, id),
      db.prepare("INSERT INTO admin_audit(id,target_id,action,note,created_at) SELECT ?,partner_id,'partner-store','代理更新商店形象、联系方式与公告',? FROM partner_store_settings WHERE partner_id=? AND change_id=?").bind(id, now, p.id, id),
    ])
    await changed(env, id)
    return json({ ok: true, version: current.version + 1 })
  }
  if (suffix === '/stores/prices' && request.method === 'POST') {
    const data = await body(request)
    if (data.storeId !== p.id) throw new ApiError('商店不存在。', 404)
    if (typeof data.plan !== 'string' || typeof data.enabled !== 'boolean' || !Number.isSafeInteger(data.priceCents) || Number(data.priceCents) < 1 || Number(data.priceCents) > 10000000) throw new ApiError('请填写有效的售价和销售状态。')
    const row = await db.prepare('SELECT cost_cents,version FROM partner_prices WHERE partner_id=? AND plan=?').bind(p.id, data.plan).first<{ cost_cents: number; version: number }>()
    if (!row || data.version !== row.version) throw new ApiError('供货价或售价已更新，请刷新。', 409)
    if (Number(data.priceCents) < row.cost_cents) throw new ApiError('售价不能低于供货价。')
    const id = crypto.randomUUID(), now = Date.now()
    await db.batch([
      db.prepare("INSERT INTO admin_audit(id,target_id,action,note,created_at) SELECT ?,partner_id,'partner-price','代理修改商品售价与上下架状态',? FROM partner_prices WHERE partner_id=? AND plan=? AND version=? AND EXISTS(SELECT 1 FROM partners WHERE id=? AND active=1 AND auth_version=?)").bind(id, now, p.id, data.plan, row.version, p.id, p.auth_version),
      db.prepare('UPDATE partner_prices SET price_cents=?,enabled=?,version=version+1 WHERE partner_id=? AND plan=? AND version=? AND EXISTS(SELECT 1 FROM admin_audit WHERE id=?)').bind(Number(data.priceCents), Number(data.enabled), p.id, data.plan, row.version, id),
    ])
    await changed(env, id)
    return json({ ok: true })
  }
  if (suffix === '/branding/logo' && request.method === 'POST') {
    const data = await body(request, 500000)
    if (typeof data.logo !== 'string' || data.logo.length > 400000 || !data.logo.startsWith('data:image/') || !safeImage(data.logo)) throw new ApiError('请上传有效图片。')
    return json({ logo: data.logo })
  }
  if (suffix === '/domain' && request.method === 'GET') return json({ enabled: false, eligible: false, domains: [], monthlyFeeCents: 0, completedOrders: 0, requiredOrders: 0 })
  throw new ApiError('未找到商店接口。', 404)
}

export async function payoutAccount(env: Env, id: string) {
  return await env.INTEREST_DB.prepare('SELECT phone,name,version FROM partner_payout_accounts WHERE partner_id=?').bind(id).first<{ phone: string; name: string; version: number }>() ?? { phone: '', name: '', version: 0 }
}
export async function payoutAccountRoute(request: Request, env: Env, p: Partner) {
  if (request.method === 'GET') return json(await payoutAccount(env, p.id))
  if (request.method !== 'POST') throw new ApiError('请通过收款信息表单保存。', 405)
  const data = await body(request), current = await payoutAccount(env, p.id)
  const phone = text(data.phone, 11, '支付宝手机号'), name = text(data.name, 50, '收款人姓名', true)
  if (!/^1[3-9][0-9]{9}$/.test(phone)) throw new ApiError('请填写有效的支付宝手机号。')
  if (data.version !== current.version) throw new ApiError('收款信息已更新，请刷新。', 409)
  const id = crypto.randomUUID(), now = Date.now()
  await env.INTEREST_DB.batch([
    env.INTEREST_DB.prepare(`INSERT INTO partner_payout_accounts(partner_id,phone,name,version,change_id,updated_at)
      SELECT id,?,?,1,?,? FROM partners WHERE id=? AND active=1 AND auth_version=?
      AND COALESCE((SELECT version FROM partner_payout_accounts WHERE partner_id=partners.id),0)=?
      ON CONFLICT(partner_id) DO UPDATE SET phone=excluded.phone,name=excluded.name,version=partner_payout_accounts.version+1,change_id=excluded.change_id,updated_at=excluded.updated_at`).bind(phone, name, id, now, p.id, p.auth_version, current.version),
    env.INTEREST_DB.prepare("INSERT INTO admin_audit(id,target_id,action,note,created_at) SELECT ?,partner_id,'partner-payout-account','代理修改收款信息',? FROM partner_payout_accounts WHERE partner_id=? AND change_id=?").bind(id, now, p.id, id),
  ])
  await changed(env, id)
  return json(await payoutAccount(env, p.id))
}
