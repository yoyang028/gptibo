import { hanfolkFamily, supplierText } from '../../shared/hanfolk-catalog.ts'
import { ApiError, body, hash, json, type Env } from '../platform.ts'
import { seal, unseal } from '../product-secrets.ts'
import { HanfolkClient, HanfolkError, hanfolkKey } from './client.ts'
import { importHanfolkDrafts } from './importer.ts'
type Settings = {
  api_secret: string
  key_hash: string
  checked_key_hash: string
  balance_cents: number | null
  checked_at: number
  version: number
}
async function settings(env: Env) {
  const s = await env.INTEREST_DB.prepare(
    "SELECT * FROM hanfolk_settings WHERE id='main'",
  ).first<Settings>()
  if (!s) throw new ApiError('代理商品数据库尚未迁移。', 503)
  return s
}
async function state(env: Env, s: Settings) {
  const rows = (
    await env.INTEREST_DB.prepare(
      'SELECT product_id,summary,detail,checked_at FROM hanfolk_catalog WHERE key_hash=? ORDER BY product_id',
    )
      .bind(s.key_hash)
      .all<{
        product_id: number
        summary: string
        detail: string | null
        checked_at: number
      }>()
  ).results
  const links = (
    await env.INTEREST_DB.prepare(
      'SELECT l.*,p.public_json,p.version,c.price_cents FROM hanfolk_product_links l JOIN shop_products p ON p.id=l.local_id JOIN catalog_plans c ON c.id=p.id ORDER BY l.imported_at DESC',
    ).all<{
      local_id: string
      product_id: number
      sku: string
      cost_cents: number
      public_json: string
      version: number
      price_cents: number
      related_plan_id: string | null
      match_note: string
    }>()
  ).results
  return {
    version: s.version,
    configured: Boolean(s.api_secret),
    verified: Boolean(s.key_hash && s.key_hash === s.checked_key_hash),
    balanceCents: s.balance_cents,
    checkedAt: s.checked_at,
    products: rows.map((r) => {
      const p = JSON.parse(r.summary),
        d = r.detail ? JSON.parse(r.detail) : null
      return {
        ...p,
        family: hanfolkFamily(p.title),
        detail: d ? { ...d, description: supplierText(d.description) } : null,
        checkedAt: r.checked_at,
      }
    }),
    drafts: links.map((r) => {
      const p = JSON.parse(r.public_json)
      return {
        id: r.local_id,
        productId: r.product_id,
        sku: r.sku,
        relatedPlanId: r.related_plan_id,
        matchNote: r.match_note,
        costCents: r.cost_cents,
        name: p.name,
        family: p.groupId,
        status: p.status,
        pricePending: p.pricePending === true,
        priceCents: r.price_cents,
      }
    }),
    procurementEnabled: false,
  }
}
export async function hanfolkManagement(request: Request, env: Env) {
  let s = await settings(env)
  if (request.method === 'GET') return json(await state(env, s))
  if (request.method !== 'POST') throw new ApiError('请求方式不支持。', 405)
  const data = await body(request, 50000)
  if (data.version !== s.version)
    throw new ApiError('代理商品设置已更新，请重新读取。', 409)
  try {
    if (data.action === 'save-key') {
      const key = hanfolkKey(data.apiKey),
        event = crypto.randomUUID()
      await env.INTEREST_DB.batch([
        env.INTEREST_DB.prepare(
          "UPDATE hanfolk_settings SET api_secret=?,key_hash=?,checked_key_hash='',balance_cents=NULL,checked_at=0,version=version+1,change_id=? WHERE id='main' AND version=?",
        ).bind(await seal(env, key), await hash(key), event, s.version),
        env.INTEREST_DB.prepare(
          "INSERT INTO admin_audit(id,target_id,action,note,created_at) SELECT ?,'hanfolk','hanfolk-key','保存加密代理 API 凭据（不回显）',? FROM hanfolk_settings WHERE change_id=?",
        ).bind(event, Date.now(), event),
      ])
      if (
        !(await env.INTEREST_DB.prepare('SELECT id FROM admin_audit WHERE id=?')
          .bind(event)
          .first())
      )
        throw new ApiError('设置已更新，请重新读取。', 409)
    } else {
      if (!s.api_secret)
        throw new ApiError('请先在遮蔽输入框保存大橘 API Key。', 409)
      const client = new HanfolkClient(env, await unseal(env, s.api_secret))
      if (data.action === 'refresh') {
        const balance = await client.balance(),
          products = (await client.products()).filter((p) =>
            hanfolkFamily(p.title),
          ),
          now = Date.now(),
          event = crypto.randomUUID()
        await env.INTEREST_DB.batch([
          env.INTEREST_DB.prepare(
            "UPDATE hanfolk_settings SET checked_key_hash=key_hash,balance_cents=?,checked_at=?,version=version+1,change_id=? WHERE id='main' AND version=?",
          ).bind(balance.balanceCents, now, event, s.version),
          ...products.map((p) =>
            env.INTEREST_DB.prepare(
              'INSERT INTO hanfolk_catalog(product_id,summary,key_hash,checked_at) SELECT ?,?,?,? WHERE EXISTS(SELECT 1 FROM hanfolk_settings WHERE change_id=?) ON CONFLICT(product_id) DO UPDATE SET summary=excluded.summary,key_hash=excluded.key_hash,checked_at=excluded.checked_at,detail=CASE WHEN hanfolk_catalog.key_hash=excluded.key_hash THEN hanfolk_catalog.detail ELSE NULL END',
            ).bind(p.id, JSON.stringify(p), s.key_hash, now, event),
          ),
          env.INTEREST_DB.prepare(
            'DELETE FROM hanfolk_catalog WHERE (key_hash<>? OR checked_at<>?) AND EXISTS(SELECT 1 FROM hanfolk_settings WHERE change_id=?)',
          ).bind(s.key_hash, now, event),
          env.INTEREST_DB.prepare(
            "INSERT INTO admin_audit(id,target_id,action,note,created_at) SELECT ?,'hanfolk','hanfolk-refresh','只读更新商品目录和余额；未采购',? FROM hanfolk_settings WHERE change_id=?",
          ).bind(event, now, event),
        ])
        if (
          !(await env.INTEREST_DB.prepare(
            'SELECT id FROM admin_audit WHERE id=?',
          )
            .bind(event)
            .first())
        )
          throw new ApiError('设置已更新，请重新读取。', 409)
      } else if (data.action === 'detail') {
        const id = Number(data.productId),
          cached = await env.INTEREST_DB.prepare(
            'SELECT product_id FROM hanfolk_catalog WHERE product_id=? AND key_hash=?',
          )
            .bind(id, s.key_hash)
            .first()
        if (!cached || !s.checked_key_hash || s.checked_key_hash !== s.key_hash)
          throw new ApiError('请先读取商品目录，并仅选择指定九类商品。', 409)
        const detail = await client.detail(id)
        if (!hanfolkFamily(detail.title))
          throw new ApiError('源商品分类已变化，请重新读取目录。', 409)
        await env.INTEREST_DB.prepare(
          'UPDATE hanfolk_catalog SET detail=?,summary=?,checked_at=? WHERE product_id=? AND key_hash=? AND EXISTS(SELECT 1 FROM hanfolk_settings WHERE version=? AND key_hash=?)',
        )
          .bind(
            JSON.stringify(detail),
            JSON.stringify(detail),
            Date.now(),
            id,
            s.key_hash,
            s.version,
            s.key_hash,
          )
          .run()
      } else if (data.action === 'import') {
        if (
          !Array.isArray(data.selection) ||
          data.selection.some(
            (v) =>
              !v ||
              typeof v !== 'object' ||
              !Number.isSafeInteger(v.productId) ||
              typeof v.sku !== 'string',
          )
        )
          throw new ApiError('请选择实际商品规格。')
        if (!s.checked_at || s.checked_key_hash !== s.key_hash)
          throw new ApiError('请先只读检查供货目录。', 409)
        const rows = (
          await env.INTEREST_DB.prepare(
            'SELECT detail FROM hanfolk_catalog WHERE key_hash=? AND detail IS NOT NULL',
          )
            .bind(s.key_hash)
            .all<{ detail: string }>()
        ).results
        const result = await importHanfolkDrafts(
          env,
          rows.map((r) => JSON.parse(r.detail)),
          data.selection,
        )
        return json({ ...(await state(env, s)), result })
      } else throw new ApiError('代理商品操作无效。')
    }
  } catch (e) {
    if (e instanceof HanfolkError)
      throw new ApiError(e.message, e.code === 'AUTH' ? 409 : 503)
    throw e
  }
  s = await settings(env)
  return json(await state(env, s))
}
