import {
  hanfolkFamily,
  hanfolkMoney,
  type HanfolkDetail,
} from '../../shared/hanfolk-catalog.ts'
import {
  productProblems,
  type ShopProduct,
} from '../../shared/shop-products.ts'
import { ApiError, hash, type Env } from '../platform.ts'
import {
  hanfolkBuyerCopy,
  SourceCopyChanged,
} from '../../shared/hanfolk-buyer-copy.ts'

export async function hanfolkDraft(
  detail: HanfolkDetail,
  sku: string,
): Promise<ShopProduct> {
  const family = hanfolkFamily(detail.title),
    variant = detail.sku_variants.find((v) => v.sku === sku)
  if (!family || !variant)
    throw new ApiError('仅可导入已选九类商品及接口确认的实际规格。')
  let image = ''
  try {
    const url = new URL(detail.cover)
    if (url.protocol === 'https:' && !url.username && !url.password)
      image = url.href
  } catch {}
  let copy
  try {
    copy = hanfolkBuyerCopy(detail, sku)
  } catch (e) {
    if (e instanceof SourceCopyChanged) throw new ApiError(e.message, 409)
    throw e
  }
  return {
    ...copy,
    id:
      'custom-' + (await hash('hanfolk:' + detail.id + ':' + sku)).slice(0, 32),
    groupId: family,
    category:
      family === 'gmail'
        ? '邮箱账号'
        : family === 'duolingo'
          ? '语言学习'
          : ['grok', 'gemini', 'muse'].includes(family)
            ? 'AI 服务'
            : family === 'apple-id'
              ? '账号服务'
              : '创作与生活',
    image,
    badge: '待定价草稿',
    unit: '份',
    priceCents: 1,
    pricePending: true,
    stock: Math.min(variant.stock, 1000000),
    fields: [],
    delivery: 'manual',
    payment: { label: '', instructions: '', url: '', qr: '' },
    status: 'draft',
    version: 0,
  }
}

export async function importHanfolkDrafts(
  env: Env,
  details: HanfolkDetail[],
  selection: { productId: number; sku: string }[],
) {
  if (
    selection.length < 1 ||
    selection.length > 100 ||
    new Set(selection.map((v) => v.productId + ':' + v.sku)).size !==
      selection.length
  )
    throw new ApiError('每次请选择 1–100 个不重复规格。')
  const prepared = await Promise.all(
    selection.map(async (item) => {
      const detail = details.find((p) => p.id === item.productId),
        variant = detail?.sku_variants.find((v) => v.sku === item.sku)
      if (!detail || !variant)
        throw new ApiError('商品规格缓存已变化，请重新读取。', 409)
      const p = await hanfolkDraft(detail, item.sku),
        errors = productProblems(p)
      if (errors.length)
        throw new ApiError('源商品资料需要补全：' + errors.join('、'))
      return { item, detail, variant, p }
    }),
  )
  const imported: string[] = [],
    existing: string[] = []
  for (const { item, detail, variant, p } of prepared) {
    const linked = await env.INTEREST_DB.prepare(
      'SELECT local_id FROM hanfolk_product_links WHERE product_id=? AND sku=?',
    )
      .bind(item.productId, item.sku)
      .first<{ local_id: string }>()
    if (linked) {
      existing.push(linked.local_id)
      continue
    }
    const db = env.INTEREST_DB,
      now = Date.now(),
      event = crypto.randomUUID(),
      fingerprint = await hash(JSON.stringify(detail)),
      cost = hanfolkMoney(variant.price)
    // Deterministic IDs and one transaction prevent duplicate local drafts. An
    // existing product is preserved even when the source price or text changes.
    await db.batch([
      db
        .prepare(
          'INSERT INTO catalog_plans(id,product_id,name,price_cents,enabled,partner_enabled,purchase_note,delivery_instructions,updated_at) VALUES(?,?,?,?,0,0,?,?,?) ON CONFLICT(id) DO NOTHING',
        )
        .bind(
          p.id,
          p.groupId!,
          p.name,
          p.priceCents,
          p.purchaseNote,
          p.deliveryInstructions,
          now,
        ),
      db
        .prepare(
          'INSERT INTO shop_products(id,public_json,stock_remaining,version,updated_at,change_id) VALUES(?,?,?,0,?,?) ON CONFLICT(id) DO NOTHING',
        )
        .bind(p.id, JSON.stringify(p), p.stock, now, event),
      db
        .prepare(
          'INSERT INTO hanfolk_product_links(local_id,product_id,sku,cost_cents,imported_at,source_hash) SELECT ?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM shop_products WHERE id=? AND change_id=?) ON CONFLICT(product_id,sku) DO NOTHING',
        )
        .bind(
          p.id,
          item.productId,
          item.sku,
          cost,
          now,
          fingerprint,
          p.id,
          event,
        ),
      db
        .prepare(
          "INSERT INTO admin_audit(id,target_id,action,note,created_at) SELECT ?,id,'hanfolk-draft','导入代理商品待定价草稿；未采购、未开售',? FROM shop_products WHERE id=? AND change_id=?",
        )
        .bind(event, now, p.id, event),
    ])
    if (
      await db
        .prepare('SELECT id FROM admin_audit WHERE id=?')
        .bind(event)
        .first()
    )
      imported.push(p.id)
    else existing.push(p.id)
  }
  return { imported, existing }
}
