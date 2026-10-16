import { ApiError, body, json, type Env } from './platform.ts'
import { DEFAULT_PRODUCT_ORDER } from '../shared/product-order.ts'
import {
  safeImage,
  hasControlCharacters,
  shopProductDisplayId,
  type ShopProduct,
} from '../shared/shop-products.ts'
import { supportContactsSettings } from './support-contacts.ts'
import { visitorSummary } from './visitors.ts'
import { productMap, authorizedProduct } from './recharge/client.ts'

type OwnerSettings = {
  name: string
  active: boolean
  brandName: string
  logo: string
  pageTitle: string
  headline: string
  description: string
  announcementTitle: string
  announcement: string
  announcementPlacement: string
  productIds: string[]
  hiddenProductIds: string[]
  orderCompletedEmail: boolean
  notificationsSince?: number
}
const defaults: OwnerSettings = {
  name: 'GPTibo',
  active: true,
  brandName: '',
  logo: '',
  pageTitle: '',
  headline: '',
  description: '',
  announcementTitle: '',
  announcement: '',
  announcementPlacement: 'both',
  productIds: [...DEFAULT_PRODUCT_ORDER],
  hiddenProductIds: [],
  orderCompletedEmail: false,
}
export async function ownerShop(env: Env) {
  const row = await env.INTEREST_DB.prepare(
    "SELECT settings,version FROM owner_shop_settings WHERE id='platform'",
  ).first<{ settings: string; version: number }>()
  return {
    ...defaults,
    ...JSON.parse(row?.settings ?? '{}'),
    version: row?.version ?? 0,
  } as OwnerSettings & { version: number }
}
async function save(
  env: Env,
  version: unknown,
  patch: Partial<OwnerSettings>,
  note: string,
) {
  const current = await ownerShop(env)
  if (!Number.isSafeInteger(version) || version !== current.version)
    throw new ApiError('店铺设置已更新，请刷新后重试。', 409)
  const { version: unused, ...settings } = current
  void unused
  const id = crypto.randomUUID(),
    now = Date.now()
  await env.INTEREST_DB.batch([
    env.INTEREST_DB.prepare(
      "UPDATE owner_shop_settings SET settings=?,version=version+1,change_id=?,updated_at=? WHERE id='platform' AND version=?",
    ).bind(JSON.stringify({ ...settings, ...patch }), id, now, current.version),
    env.INTEREST_DB.prepare(
      "INSERT INTO admin_audit(id,target_id,action,note,created_at) SELECT ?,'platform','owner-shop',?,? FROM owner_shop_settings WHERE id='platform' AND change_id=?",
    ).bind(id, note, now, id),
  ])
  if (
    !(await env.INTEREST_DB.prepare('SELECT id FROM admin_audit WHERE id=?')
      .bind(id)
      .first())
  )
    throw new ApiError('店铺已更新，请重新读取。', 409)
  return ownerShop(env)
}
function text(value: unknown, max: number, label: string, required = false) {
  if (
    typeof value !== 'string' ||
    value.length > max ||
    hasControlCharacters(value) ||
    (required && !value.trim())
  )
    throw new ApiError(`请填写有效的${label}，最多 ${max} 字。`)
  return value.trim()
}
async function ownerProductIds(env: Env) {
  const ids = (
    await env.INTEREST_DB.prepare(
      "SELECT id,public_json FROM shop_products WHERE json_extract(public_json,'$.status')<>'archived' ORDER BY updated_at DESC",
    ).all<{ id: string; public_json: string }>()
  ).results.map((p) =>
    shopProductDisplayId(JSON.parse(p.public_json) as ShopProduct),
  )
  return [...new Set([...DEFAULT_PRODUCT_ORDER, ...ids])]
}
export async function ownerPublicSettings(env: Env) {
  const settings = await ownerShop(env)
  const known = await ownerProductIds(env)
  return {
    shop: {
      name: settings.name,
      brandName: settings.brandName || settings.name,
      logo: settings.logo,
      pageTitle: settings.pageTitle,
      headline: settings.headline,
      description: settings.description,
    },
    productOrder: [...new Set([...settings.productIds, ...known])].filter(
      (id) => known.includes(id),
    ),
    hiddenProductIds: settings.hiddenProductIds,
    announcement: settings.announcement
      ? {
          enabled: true,
          title: settings.announcementTitle || '店铺公告',
          content: settings.announcement,
          placement: settings.announcementPlacement,
          version: settings.version,
        }
      : null,
    active: settings.active,
  }
}
export async function ownerSupplyPrices(env: Env) {
  const map = productMap(env),
    costs: Record<string, number> = {}
  await Promise.all(
    Object.entries(map).map(async ([plan, code]) => {
      try {
        costs[plan] = await authorizedProduct(env, code)
      } catch {
        /* A supply quote is never fabricated. */
      }
    }),
  )
  return costs
}
export async function ownerShopRoutes(request: Request, env: Env, url: URL) {
  const suffix = url.pathname.slice('/api/admin/my-shop'.length),
    db = env.INTEREST_DB,
    settings = await ownerShop(env)
  if (suffix === '/stores' && request.method === 'GET') {
    const [plans, contacts, stats, visits, costs, coupons] = await Promise.all([
      db
        .prepare(
          "SELECT c.* FROM catalog_plans c LEFT JOIN shop_products p ON p.id=c.id WHERE p.id IS NULL OR json_extract(p.public_json,'$.status')<>'archived' ORDER BY c.rowid",
        )
        .all<{
          id: string
          name: string
          product_id: string
          price_cents: number
          enabled: number
          version: number
        }>(),
      supportContactsSettings(env),
      db
        .prepare(
          "SELECT COUNT(*) order_count,COALESCE(SUM(CASE WHEN o.mode='live' AND o.payment_status='paid' AND o.status='success' AND o.refund_hold=0 AND COALESCE(r.supply_cents,o.cost_cents) IS NOT NULL THEN MAX(0,o.price_cents-MAX(o.refunded_cents,COALESCE(r.refunded_cents,0))-COALESCE(r.supply_cents,o.cost_cents,0)) ELSE 0 END),0) earned_cents FROM orders o LEFT JOIN recharge_orders r ON r.order_id=o.id WHERE o.partner_id IS NULL AND o.is_test=0",
        )
        .first<{ order_count: number; earned_cents: number }>(),
      visitorSummary(env, new URL('?days=30', url), 'platform'),
      ownerSupplyPrices(env),
      db
        .prepare('SELECT * FROM shop_coupons ORDER BY updated_at DESC')
        .all<{ id: string; code: string; settings: string; version: number }>(),
    ])
    return json({
      referralOrigin: url.origin,
      stores: [
        {
          id: 'platform',
          slot: 1,
          slug: '',
          name: settings.name,
          active: settings.active,
          version: settings.version,
          settings: { ...settings, ...contacts.contacts },
          ...stats,
          visitors: visits.visitors,
        },
      ],
      prices: plans.results.map((p) => ({
        store_id: 'platform',
        plan: p.id,
        name: p.name,
        product_id: p.product_id,
        cost_cents: costs[p.id] ?? 0,
        cost_known: costs[p.id] != null,
        price_cents: p.price_cents,
        child_cost_cents: null,
        supply_version: 0,
        enabled: Boolean(p.enabled),
        version: p.version,
      })),
      coupons: await Promise.all(
        coupons.results.map(async (c) => ({
          ...JSON.parse(c.settings),
          id: c.id,
          code: c.code,
          version: c.version,
          uses:
            (
              await db
                .prepare(
                  "SELECT COUNT(*) n FROM shop_coupon_uses u JOIN orders o ON o.id=u.order_id WHERE u.coupon_id=? AND o.status<>'cancelled'",
                )
                .bind(c.id)
                .first<{ n: number }>()
            )?.n ?? 0,
        })),
      ),
      charges: [],
    })
  }
  if (suffix === '/stores' && request.method === 'POST') {
    const data = await body(request, 500000)
    if (
      data.id !== 'platform' ||
      typeof data.active !== 'boolean' ||
      !data.settings ||
      typeof data.settings !== 'object'
    )
      throw new ApiError('当前管理主商城，请编辑已有店铺。')
    const raw = data.settings as Record<string, unknown>,
      patch: Partial<OwnerSettings> = {
        name: text(data.name, 80, '店铺名称', true),
        active: data.active,
      }
    for (const [key, max] of Object.entries({
      brandName: 32,
      pageTitle: 120,
      headline: 120,
      description: 500,
      announcementTitle: 100,
      announcement: 2000,
    }))
      (patch as Record<string, unknown>)[key] = text(raw[key] ?? '', max, key)
    patch.logo = text(raw.logo ?? '', 400000, 'Logo')
    if (!safeImage(patch.logo))
      throw new ApiError('请上传 PNG、JPG 或 WebP 图片。')
    patch.announcementPlacement = ['home', 'product', 'both'].includes(
      String(raw.announcementPlacement),
    )
      ? String(raw.announcementPlacement)
      : 'both'
    const contacts = await supportContactsSettings(env)
    const { emailValue } = await import('./partner-auth.ts')
    const wechat = text(raw.wechat ?? '', 64, '微信'),
      qq = text(raw.qq ?? '', 20, 'QQ'),
      email = raw.email ? emailValue(raw.email) : ''
    if (qq && !/^\d{5,20}$/.test(qq))
      throw new ApiError('QQ 号需为 5–20 位数字。')
    if (data.version !== settings.version)
      throw new ApiError('店铺设置已更新，请刷新。', 409)
    const changeId = crypto.randomUUID(),
      now = Date.now()
    await db.batch([
      db
        .prepare(
          "UPDATE owner_shop_settings SET settings=?,version=version+1,change_id=?,updated_at=? WHERE id='platform' AND version=? AND COALESCE((SELECT version FROM support_contacts WHERE owner='platform'),0)=?",
        )
        .bind(
          JSON.stringify({ ...settings, ...patch, version: undefined }),
          changeId,
          now,
          settings.version,
          contacts.version,
        ),
      db
        .prepare(
          "INSERT INTO support_contacts(owner,partner_id,wechat,qq,email,version,change_id,updated_at) SELECT 'platform',NULL,?,?,?,1,?,? FROM owner_shop_settings WHERE id='platform' AND change_id=? ON CONFLICT(owner) DO UPDATE SET wechat=excluded.wechat,qq=excluded.qq,email=excluded.email,version=support_contacts.version+1,change_id=excluded.change_id,updated_at=excluded.updated_at",
        )
        .bind(wechat, qq, email, changeId, now, changeId),
      db
        .prepare(
          "INSERT INTO admin_audit(id,target_id,action,note,created_at) SELECT ?,'platform','owner-shop','更新主店铺形象与联系方式',? FROM owner_shop_settings WHERE id='platform' AND change_id=?",
        )
        .bind(changeId, now, changeId),
    ])
    if (
      !(await db
        .prepare('SELECT id FROM admin_audit WHERE id=?')
        .bind(changeId)
        .first())
    )
      throw new ApiError('店铺或联系方式已更新，请刷新。', 409)
    const result = await ownerShop(env)
    return json({ ok: true, version: result.version })
  }
  if (suffix === '/branding/logo' && request.method === 'POST') {
    const data = await body(request, 500000)
    if (
      typeof data.logo !== 'string' ||
      !safeImage(data.logo) ||
      !data.logo.startsWith('data:image/')
    )
      throw new ApiError('请上传有效图片。')
    return json({ logo: data.logo })
  }
  if (suffix === '/product-order') {
    const known = await ownerProductIds(env)
    if (request.method === 'GET')
      return json({
        productIds: [...new Set([...settings.productIds, ...known])].filter(
          (id) => known.includes(id),
        ),
        hiddenProductIds: settings.hiddenProductIds,
        version: settings.version,
      })
    const data = await body(request)
    if (
      !Array.isArray(data.productIds) ||
      data.productIds.length !== known.length ||
      new Set(data.productIds).size !== known.length ||
      data.productIds.some((id) => !known.includes(id)) ||
      !Array.isArray(data.hiddenProductIds) ||
      data.hiddenProductIds.some((id) => !known.includes(id))
    )
      throw new ApiError(
        '商品列表已变化或上下架与排序列表无效，请重新读取。',
        409,
      )
    const next = await save(
      env,
      data.version,
      {
        productIds: data.productIds,
        hiddenProductIds: [...new Set(data.hiddenProductIds)],
      },
      '调整主商城商品上下架与排序',
    )
    return json({
      productIds: next.productIds,
      hiddenProductIds: next.hiddenProductIds,
      version: next.version,
    })
  }
  if (suffix === '/stores/prices' && request.method === 'POST') {
    const data = await body(request)
    if (
      data.storeId !== 'platform' ||
      typeof data.plan !== 'string' ||
      !Number.isSafeInteger(data.priceCents) ||
      Number(data.priceCents) < 1 ||
      Number(data.priceCents) > 10000000 ||
      typeof data.enabled !== 'boolean' ||
      !Number.isSafeInteger(data.version)
    )
      throw new ApiError('请填写有效套餐售价和状态。')
    const costs = await ownerSupplyPrices(env)
    if (
      Number(data.priceCents) <
      (await (
        await import('./shop-products.ts')
      ).customRetailFloor(env, data.plan))
    )
      throw new ApiError('售价不得低于该商品的最高采购成本。')
    if (costs[data.plan] != null && Number(data.priceCents) < costs[data.plan])
      throw new ApiError('售价不得低于当前供货价。')
    const id = crypto.randomUUID(),
      now = Date.now()
    await db.batch([
      db
        .prepare(
          'UPDATE catalog_plans SET price_cents=?,enabled=?,version=version+1,updated_at=? WHERE id=? AND version=?',
        )
        .bind(
          Number(data.priceCents),
          Number(data.enabled),
          now,
          data.plan,
          Number(data.version),
        ),
      db
        .prepare(
          "INSERT INTO admin_audit(id,target_id,action,note,created_at) SELECT ?,id,'plan-update','主店铺修改套餐售价与销售状态',? FROM catalog_plans WHERE id=? AND updated_at=? AND version=?",
        )
        .bind(id, now, data.plan, now, Number(data.version) + 1),
      db
        .prepare(
          'UPDATE shop_products SET version=version+1 WHERE id=? AND EXISTS(SELECT 1 FROM admin_audit WHERE id=?)',
        )
        .bind(data.plan, id),
    ])
    if (
      !(await db
        .prepare('SELECT id FROM admin_audit WHERE id=?')
        .bind(id)
        .first())
    )
      throw new ApiError('套餐已更新，请刷新后保存。', 409)
    return json({ ok: true })
  }
  if (/^\/prices\/[a-z0-9-]+$/.test(suffix) && request.method === 'POST') {
    const data = await body(request),
      plan = suffix.split('/').at(-1)!
    const existing = await db
      .prepare('SELECT enabled FROM catalog_plans WHERE id=?')
      .bind(plan)
      .first<{ enabled: number }>()
    if (!existing) throw new ApiError('套餐不存在。', 404)
    return ownerShopRoutes(
      new Request(new URL('/api/admin/my-shop/stores/prices', url), {
        method: 'POST',
        headers: { Origin: url.origin, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...data,
          storeId: 'platform',
          plan,
          enabled: Boolean(existing.enabled),
        }),
      }),
      env,
      new URL('/api/admin/my-shop/stores/prices', url),
    )
  }
  if (suffix === '/domain' && request.method === 'GET')
    return json({
      enabled: true,
      eligible: true,
      completedOrders: 0,
      requiredOrders: 0,
      monthlyFeeCents: 0,
      managed: true,
      domains: [
        {
          id: 'platform',
          storeId: 'platform',
          hostname: url.hostname,
          free: true,
          state: 'active',
          message: '主商城域名由 Cloudflare 管理',
          billingState: 'paid',
          expiresAt: null,
          billingVersion: 0,
          records: [],
        },
      ],
    })
  if (suffix.startsWith('/domain'))
    throw new ApiError(
      '主商城域名已绑定。更换域名需同步 Cloudflare 与供货回调，不能只修改显示地址。',
      409,
    )
  if (suffix === '/notification-settings') {
    if (request.method === 'GET')
      return json({
        orderCompletedEmail: settings.orderCompletedEmail,
        recipient: env.ADMIN_EMAIL ?? '',
        version: settings.version,
      })
    const data = await body(request)
    if (typeof data.orderCompletedEmail !== 'boolean')
      throw new ApiError('通知设置无效。')
    const next = await save(
      env,
      data.version,
      {
        orderCompletedEmail: data.orderCompletedEmail,
        ...(data.orderCompletedEmail && !settings.orderCompletedEmail
          ? { notificationsSince: Date.now() }
          : {}),
      },
      '修改主店铺订单通知',
    )
    return json({
      orderCompletedEmail: next.orderCompletedEmail,
      recipient: env.ADMIN_EMAIL ?? '',
      version: next.version,
    })
  }
  if (suffix === '/visitors' && request.method === 'GET')
    return json(await visitorSummary(env, url, 'platform'))
  if (suffix === '/coupons' && request.method === 'POST') {
    const data = await body(request, 16000),
      id =
        typeof data.id === 'string' && data.id ? data.id : crypto.randomUUID()
    if (
      !/^[A-Za-z0-9_-]{3,32}$/.test(String(data.code)) ||
      !Number.isSafeInteger(data.discountCents) ||
      Number(data.discountCents) < 1 ||
      !Number.isInteger(data.maxUses) ||
      Number(data.maxUses) < 1 ||
      Number(data.maxUses) > 1000000 ||
      typeof data.oncePerEmail !== 'boolean' ||
      typeof data.active !== 'boolean' ||
      !Array.isArray(data.targets) ||
      !data.targets.length ||
      data.targets.length > 200
    )
      throw new ApiError('请完整填写优惠码、减免金额、次数与适用商品。')
    if (
      typeof data.startsAt !== 'string' ||
      typeof data.endsAt !== 'string' ||
      !Number.isFinite(Date.parse(data.startsAt)) ||
      !Number.isFinite(Date.parse(data.endsAt)) ||
      Date.parse(data.endsAt) <= Date.parse(data.startsAt)
    )
      throw new ApiError('优惠有效期无效。')
    const duplicate = await db
      .prepare('SELECT id FROM shop_coupons WHERE code=? COLLATE NOCASE')
      .bind(String(data.code))
      .first<{ id: string }>()
    if (duplicate && duplicate.id !== id)
      throw new ApiError('该优惠码已存在，请编辑已有优惠码或更换名称。', 409)
    const costs = await ownerSupplyPrices(env)
    for (const target of data.targets) {
      if (target.storeId !== 'platform' || typeof target.plan !== 'string')
        throw new ApiError('优惠仅适用于主店铺。')
      const p = await db
        .prepare('SELECT price_cents FROM catalog_plans WHERE id=?')
        .bind(target.plan)
        .first<{ price_cents: number }>()
      if (
        !p ||
        p.price_cents - Number(data.discountCents) <
          Math.max(
            1,
            costs[target.plan] ?? 1,
            await (
              await import('./shop-products.ts')
            ).customRetailFloor(env, target.plan),
          )
      )
        throw new ApiError('优惠后价格必须为正，且不得低于已知供货价。')
    }
    const current = await db
      .prepare('SELECT version FROM shop_coupons WHERE id=?')
      .bind(id)
      .first<{ version: number }>()
    if (data.version !== (current?.version ?? 0))
      throw new ApiError('优惠码已更新，请刷新后重试。', 409)
    const change = crypto.randomUUID(),
      now = Date.now(),
      value = {
        discount_cents: data.discountCents,
        starts_at: data.startsAt,
        ends_at: data.endsAt,
        max_uses: data.maxUses,
        once_per_email: data.oncePerEmail,
        active: data.active,
        targets: data.targets,
      }
    await db.batch([
      db
        .prepare(
          'INSERT INTO shop_coupons(id,code,settings,version,change_id,updated_at) VALUES (?,?,?,1,?,?) ON CONFLICT(id) DO UPDATE SET code=excluded.code,settings=excluded.settings,version=shop_coupons.version+1,change_id=excluded.change_id,updated_at=excluded.updated_at WHERE shop_coupons.version=?',
        )
        .bind(
          id,
          String(data.code).toUpperCase(),
          JSON.stringify(value),
          change,
          now,
          Number(data.version),
        ),
      db
        .prepare(
          "INSERT INTO admin_audit(id,target_id,action,note,created_at) SELECT ?,id,'owner-coupon','保存主店铺优惠码',? FROM shop_coupons WHERE id=? AND change_id=?",
        )
        .bind(change, now, id, change),
    ])
    if (
      !(await db
        .prepare('SELECT id FROM admin_audit WHERE id=?')
        .bind(change)
        .first())
    )
      throw new ApiError('优惠码已更新。', 409)
    return json({ ok: true })
  }
  throw new ApiError('未找到店铺操作。', 404)
}
export async function sendOwnerOrderNotifications(env: Env) {
  const shop = await ownerShop(env)
  if (
    !shop.orderCompletedEmail ||
    !env.ADMIN_EMAIL ||
    !env.RESEND_API_KEY ||
    !env.RESEND_FROM
  )
    return
  const db = env.INTEREST_DB,
    now = Date.now()
  const rows = (
    await db
      .prepare(
        "SELECT o.id,o.plan_name,o.price_cents FROM orders o LEFT JOIN owner_order_notifications n ON n.order_id=o.id WHERE o.partner_id IS NULL AND o.is_test=0 AND o.mode='live' AND o.payment_status='paid' AND o.status='success' AND o.created_at>=? AND n.sent_at IS NULL AND COALESCE(n.lease_until,0)<=? ORDER BY o.created_at LIMIT 5",
      )
      .bind(shop.notificationsSince ?? now, now)
      .all<{ id: string; plan_name: string; price_cents: number }>()
  ).results
  for (const row of rows) {
    const lease = Date.now() + 30000,
      token = crypto.randomUUID()
    await db
      .prepare(
        'INSERT INTO owner_order_notifications(order_id,lease_until,lease_token) VALUES (?,?,?) ON CONFLICT(order_id) DO UPDATE SET lease_until=excluded.lease_until,lease_token=excluded.lease_token WHERE owner_order_notifications.sent_at IS NULL AND owner_order_notifications.lease_until<=?',
      )
      .bind(row.id, lease, token, Date.now())
      .run()
    if (
      !(await db
        .prepare(
          'SELECT 1 FROM owner_order_notifications WHERE order_id=? AND lease_token=? AND sent_at IS NULL',
        )
        .bind(row.id, token)
        .first())
    )
      continue
    try {
      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        redirect: 'manual',
        headers: {
          Authorization: 'Bearer ' + env.RESEND_API_KEY,
          'Content-Type': 'application/json',
          'Idempotency-Key': 'owner-completed/' + row.id,
        },
        body: JSON.stringify({
          from: env.RESEND_FROM,
          to: [env.ADMIN_EMAIL],
          subject: '店铺订单已完成 · ' + row.id,
          text: `订单：${row.id}\n商品：${row.plan_name}\n金额：${(row.price_cents / 100).toFixed(2)} 元\n请在主后台查看详情。`,
        }),
        signal: AbortSignal.timeout(10000),
      })
      if (response.ok)
        await db
          .prepare(
            'UPDATE owner_order_notifications SET sent_at=? WHERE order_id=? AND lease_token=?',
          )
          .bind(Date.now(), row.id, token)
          .run()
    } catch {
      /* A later scheduled run retries the same notification key. */
    } finally {
      await db
        .prepare(
          "UPDATE owner_order_notifications SET lease_until=0,lease_token='' WHERE order_id=? AND lease_token=?",
        )
        .bind(row.id, token)
        .run()
    }
  }
}
