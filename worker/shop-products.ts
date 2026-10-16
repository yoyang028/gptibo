import {
  customProductId,
  productProblems,
  safeHttps,
  type ShopProduct,
  type CustomOrderView,
  type ShopProductInput,
  shopProductDisplayId,
} from '../shared/shop-products.ts'
import { ApiError, body, hash, json, type Env } from './platform.ts'
import { boundedResponseText } from './bounded-response.ts'
import { change, getOrder, type Order } from './order-state.ts'
import { ownerShop } from './owner-shop.ts'
import { couponQuote, couponReservation } from './shop-coupons.ts'
import {
  XiaojiuPurchaseClient,
  XiaojiuPurchaseError,
  fulfillXiaojiuPurchase,
  purchaseCredentials,
} from './xiaojiu/purchase.ts'

type Row = {
  id: string
  public_json: string
  api_secret: string
  api_verified_fingerprint: string
  stock_remaining: number
  version: number
  price_cents?: number
  catalog_version?: number
  enabled?: number
}
type Detail = {
  order_id: string
  product_id: string
  snapshot: string
  fields: string
  payment_claimed: number
  payment_reference: string
  delivery_content: string
  supplier_id: string | null
  supplier_state: string | null
  lease_until: number
  lease_token: string
  api_secret: string
  supplier_error: string
  supplier_attempted: number
}
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
async function seal(env: Env, value: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12)),
    result = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      await secretKey(env),
      encoder.encode(value),
    )
  return btoa(String.fromCharCode(...iv, ...new Uint8Array(result)))
}
async function unseal(env: Env, value: string) {
  const raw = Uint8Array.from(atob(value), (c) => c.charCodeAt(0))
  return new TextDecoder().decode(
    await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: raw.slice(0, 12) },
      await secretKey(env),
      raw.slice(12),
    ),
  )
}
const rowProduct = (r: Row): ShopProduct => ({
  ...JSON.parse(r.public_json),
  version: r.version,
  stock: r.stock_remaining,
  ...(r.price_cents != null ? { priceCents: r.price_cents } : {}),
})
export async function shopProducts(env: Env, includeDrafts = false) {
  const rows = (
    await env.INTEREST_DB.prepare(
      'SELECT p.*,c.price_cents,c.enabled FROM shop_products p JOIN catalog_plans c ON c.id=p.id ORDER BY p.updated_at DESC',
    ).all<Row>()
  ).results
  return rows
    .map(rowProduct)
    .filter(
      (p) =>
        includeDrafts ||
        p.status === 'listed' ||
        (p.status === 'published' &&
          !(
            p.delivery === 'api' &&
            p.api?.provider === 'xiaojiu' &&
            env.XIAOJIU_PURCHASE_ENABLED !== 'true'
          )),
    )
    .map((p) => {
      if (!includeDrafts) delete p.api
      return p
    })
}
async function productRow(env: Env, id: string) {
  return env.INTEREST_DB.prepare(
    'SELECT p.*,c.price_cents,c.enabled,c.version catalog_version FROM shop_products p JOIN catalog_plans c ON c.id=p.id WHERE p.id=?',
  )
    .bind(id)
    .first<Row>()
}
async function supplierRequest(
  env: Env,
  product: ShopProduct,
  sealed: string,
  path: string,
  data?: unknown,
  idempotency?: string,
) {
  if (!product.api || !safeHttps(product.api.baseUrl))
    throw new ApiError('供货 API 地址无效。', 409)
  const base = new URL(product.api.baseUrl.replace(/\/$/, '') + '/')
  if (
    base.search ||
    base.hash ||
    !/^\/(?:products|orders(?:\/[A-Za-z0-9_-]{1,128})?)$/.test(path)
  )
    throw new ApiError('供货请求路径无效。', 409)
  let response: Response
  try {
    response = await fetch(
      new URL(base.pathname.replace(/\/$/, '') + path, base.origin),
      {
        method: data ? 'POST' : 'GET',
        redirect: 'manual',
        headers: {
          Authorization: 'Bearer ' + (await unseal(env, sealed)),
          'Content-Type': 'application/json',
          ...(idempotency ? { 'Idempotency-Key': idempotency } : {}),
        },
        ...(data ? { body: JSON.stringify(data) } : {}),
        signal: AbortSignal.timeout(15000),
      },
    )
  } catch {
    throw new ApiError('供货连接未确认，请查询原订单，勿重复采购。', 503)
  }
  if (!response.ok)
    throw new ApiError('供货接口未接受请求，请核对配置或查询原订单。', 502)
  try {
    return JSON.parse(await boundedResponseText(response, 128000)) as Record<
      string,
      unknown
    >
  } catch {
    throw new ApiError('供货响应格式无效。', 502)
  }
}
const fingerprint = (p: ShopProduct, sealed: string) =>
  hash(
    JSON.stringify([
      p.api?.baseUrl,
      p.api?.productCode,
      p.api?.maxCostCents,
      p.api?.provider ?? 'json-v1',
      p.api?.supplierProductId ?? null,
      sealed,
    ]),
  )
export async function customRetailFloor(env: Env, id: string) {
  if (!customProductId.test(id)) return 0
  const row = await env.INTEREST_DB.prepare(
    'SELECT public_json FROM shop_products WHERE id=?',
  )
    .bind(id)
    .first<{ public_json: string }>()
  const product = row ? (JSON.parse(row.public_json) as ShopProduct) : null
  return product?.delivery === 'api'
    ? Number(product.api?.maxCostCents ?? 0)
    : 0
}
export async function shopProductRoutes(request: Request, env: Env, url: URL) {
  const suffix = url.pathname.slice('/api/admin/my-shop/products'.length)
  if (!suffix && request.method === 'GET')
    return json({ products: await shopProducts(env, true) })
  if (request.method !== 'POST') throw new ApiError('请求方式不支持。', 405)
  const data = await body(request, 1000000)
  if (suffix === '/xiaojiu-catalog') {
    try {
      let credential: string
      if (data.apiKey || data.apiToken)
        credential = JSON.stringify({ key: data.apiKey, secret: data.apiToken })
      else {
        const row = customProductId.test(String(data.id))
          ? await productRow(env, String(data.id))
          : null
        if (
          !row ||
          row.version !== data.version ||
          rowProduct(row).api?.provider !== 'xiaojiu'
        )
          throw new ApiError(
            '请先填写小久 API Key 和完整 Secret，或重新读取已保存商品。',
            409,
          )
        credential = await unseal(env, row.api_secret)
      }
      const client = new XiaojiuPurchaseClient(
        env,
        purchaseCredentials(credential),
      )
      const wallet = await client.ping(true)
      return json({
        ...(await client.catalog(
          data.page === undefined ? 1 : Number(data.page),
        )),
        ...wallet,
      })
    } catch (e) {
      if (e instanceof XiaojiuPurchaseError)
        throw new ApiError(e.message, e.retryable ? 503 : 409)
      throw e
    }
  }
  const id =
    typeof data.id === 'string' && data.id
      ? data.id
      : 'custom-' + crypto.randomUUID().replaceAll('-', '')
  if (!customProductId.test(id)) throw new ApiError('商品编号无效。')
  const previous = await productRow(env, id)
  if ((previous?.version ?? 0) !== data.version)
    throw new ApiError('商品已更新，请重新读取。', 409)
  const input = data as unknown as ShopProductInput
  const api = input.api
    ? {
        ...(input.api.provider ? { provider: input.api.provider } : {}),
        baseUrl: String(input.api.baseUrl ?? '').replace(/\/$/, ''),
        productCode: String(input.api.productCode ?? '').trim(),
        ...(input.api.supplierProductId !== undefined
          ? { supplierProductId: input.api.supplierProductId }
          : {}),
        maxCostCents: input.api.maxCostCents,
        configured: false,
        verified: false,
      }
    : undefined
  if (api?.baseUrl && (!safeHttps(api.baseUrl) || new URL(api.baseUrl).search))
    throw new ApiError(
      '供货 API 请使用无账号、密码或查询参数的公开 HTTPS 基础地址。',
    )
  const product: ShopProduct = {
    id,
    ...(input.groupId !== undefined ? { groupId: input.groupId } : {}),
    name: input.name,
    category: input.category,
    tagline: input.tagline,
    description: input.description,
    image: input.image,
    badge: input.badge,
    unit: input.unit,
    duration: input.duration,
    priceCents: input.priceCents,
    stock: input.stock,
    features: input.features,
    purchaseNote: input.purchaseNote,
    deliveryInstructions: input.deliveryInstructions,
    steps: input.steps,
    faq: input.faq,
    fields: input.fields,
    delivery: input.delivery,
    payment: input.payment,
    status: input.status,
    version: input.version,
    ...(api ? { api } : {}),
  }
  if (
    input.apiToken != null &&
    (typeof input.apiToken !== 'string' ||
      input.apiToken.length > 4000 ||
      /[\r\n]/.test(input.apiToken))
  )
    throw new ApiError('API 密钥格式无效。')
  const previousProduct = previous ? rowProduct(previous) : null
  const sameProvider =
    (previousProduct?.api?.provider ?? 'json-v1') ===
    (api?.provider ?? 'json-v1')
  let credential = input.apiToken ?? ''
  if (api?.provider === 'xiaojiu' && (input.apiToken || input.apiKey)) {
    try {
      const pair = purchaseCredentials(
        JSON.stringify({ key: input.apiKey, secret: input.apiToken }),
      )
      credential = JSON.stringify(pair)
    } catch (e) {
      if (e instanceof XiaojiuPurchaseError) throw new ApiError(e.message)
      throw e
    }
  }
  const sealed = credential
    ? await seal(env, credential)
    : sameProvider
      ? (previous?.api_secret ?? '')
      : ''
  const verified = sealed && api ? await fingerprint(product, sealed) : ''
  if (api) {
    api.configured = Boolean(sealed)
    api.verified = Boolean(
      verified && verified === previous?.api_verified_fingerprint,
    )
  }
  const problems = productProblems({ ...product, status: 'draft' })
  if (problems.length) throw new ApiError('请检查：' + problems.join('、'))
  if (suffix === '/verify-api') {
    if (
      !api?.configured ||
      !safeHttps(api.baseUrl) ||
      !api.productCode ||
      !Number.isSafeInteger(api.maxCostCents) ||
      Number(api.maxCostCents) < 1 ||
      Number(api.maxCostCents) > 10000000
    )
      throw new ApiError('请填写 API 地址、商品编码、最高采购成本及密钥。')
    if (api.provider === 'xiaojiu') {
      try {
        const client = new XiaojiuPurchaseClient(
          env,
          purchaseCredentials(await unseal(env, sealed)),
        )
        await client.ping(true)
        await client.product(
          Number(api.supplierProductId),
          Number(api.productCode),
          Number(api.maxCostCents),
        )
      } catch (e) {
        if (e instanceof XiaojiuPurchaseError)
          throw new ApiError(e.message, e.retryable ? 503 : 409)
        throw e
      }
    } else {
      const result = await supplierRequest(env, product, sealed, '/products')
      const products = Array.isArray(result.products) ? result.products : []
      if (
        !products.some(
          (p) =>
            p &&
            typeof p === 'object' &&
            (p as Record<string, unknown>).product_code === api.productCode &&
            (p as Record<string, unknown>).available === true,
        )
      )
        throw new ApiError(
          '供货目录未返回当前商品可售；请按 JSON v1 接口契约适配。',
          409,
        )
    }
    api.verified = true
  } else if (suffix) throw new ApiError('未找到商品操作。', 404)
  const finalProblems = productProblems(product)
  if (
    product.status === 'published' &&
    product.delivery === 'api' &&
    product.api?.provider === 'xiaojiu' &&
    env.XIAOJIU_PURCHASE_ENABLED !== 'true'
  )
    throw new ApiError(
      '小久余额采购尚未启用，可先保存草稿并进行只读检查。',
      409,
    )
  if (finalProblems.length)
    throw new ApiError('发布前请补全：' + finalProblems.join('、'))
  const next = { ...product, version: product.version + 1 },
    changeId = crypto.randomUUID(),
    now = Date.now(),
    db = env.INTEREST_DB
  await db.batch([
    db
      .prepare(
        'INSERT INTO catalog_plans(id,product_id,name,price_cents,enabled,partner_enabled,updated_at,purchase_note,delivery_instructions) SELECT ?,?,?,?,?,0,?,?,? WHERE NOT EXISTS(SELECT 1 FROM shop_products WHERE id=? AND version<>?) ON CONFLICT(id) DO UPDATE SET product_id=excluded.product_id,name=excluded.name,price_cents=excluded.price_cents,enabled=excluded.enabled,version=catalog_plans.version+1,updated_at=excluded.updated_at,purchase_note=excluded.purchase_note,delivery_instructions=excluded.delivery_instructions WHERE EXISTS(SELECT 1 FROM shop_products WHERE id=? AND version=?)',
      )
      .bind(
        id,
        shopProductDisplayId(product),
        product.name,
        product.priceCents,
        Number(product.status === 'published'),
        now,
        product.purchaseNote,
        product.deliveryInstructions,
        id,
        product.version,
        id,
        product.version,
      ),
    db
      .prepare(
        'INSERT INTO shop_products(id,public_json,api_secret,api_verified_fingerprint,stock_remaining,version,updated_at,change_id) VALUES (?,?,?,?,?,1,?,?) ON CONFLICT(id) DO UPDATE SET public_json=excluded.public_json,api_secret=excluded.api_secret,api_verified_fingerprint=excluded.api_verified_fingerprint,stock_remaining=excluded.stock_remaining,version=shop_products.version+1,updated_at=excluded.updated_at,change_id=excluded.change_id WHERE shop_products.version=?',
      )
      .bind(
        id,
        JSON.stringify(next),
        sealed,
        api?.verified ? verified : '',
        product.stock,
        now,
        changeId,
        product.version,
      ),
    db
      .prepare(
        "INSERT INTO admin_audit(id,target_id,action,note,created_at) SELECT ?,id,'shop-product',?,? FROM shop_products WHERE id=? AND change_id=?",
      )
      .bind(
        changeId,
        product.status === 'published' ? '发布主店铺商品' : '保存主店铺商品',
        now,
        id,
        changeId,
      ),
  ])
  if (
    !(await db
      .prepare('SELECT id FROM admin_audit WHERE id=?')
      .bind(changeId)
      .first())
  )
    throw new ApiError('商品已更新，请刷新后重试。', 409)
  return json(
    {
      product: rowProduct((await productRow(env, id))!),
      apiVerified: api?.verified ?? false,
    },
    previous ? 200 : 201,
  )
}
export async function customOrderSummary(
  env: Env,
  order: Order,
): Promise<CustomOrderView | null> {
  if (!customProductId.test(order.plan)) return null
  const d = await env.INTEREST_DB.prepare(
    'SELECT * FROM shop_order_details WHERE order_id=?',
  )
    .bind(order.id)
    .first<Detail>()
  if (!d) return null
  const p = JSON.parse(d.snapshot) as ShopProduct
  return {
    productId: p.id,
    productName: p.name,
    image: p.image,
    duration: p.duration,
    payment: p.payment,
    delivery: p.delivery,
    deliveryInstructions: p.deliveryInstructions,
    deliveryContent:
      order.payment_status === 'paid' &&
      !order.refund_hold &&
      order.refunded_cents < order.price_cents
        ? d.delivery_content || null
        : null,
    paymentClaimed: Boolean(d.payment_claimed),
    paymentReference: d.payment_reference,
    fields: JSON.parse(d.fields),
    supplierState: d.supplier_state,
    supplierError: d.supplier_error ?? '',
  }
}
export async function createCustomOrder(
  env: Env,
  data: Record<string, unknown>,
  ownerHash: string,
  email: string,
) {
  const id = String(data.plan)
  if (typeof data.key !== 'string' || !/^[a-f0-9-]{36}$/.test(data.key))
    throw new ApiError('订单请求编号无效。')
  const incoming =
    data.fields && typeof data.fields === 'object'
      ? (data.fields as Record<string, unknown>)
      : {}
  const fields = Object.fromEntries(
    Object.entries(incoming)
      .filter(([, v]) => v !== '')
      .sort(([a], [b]) => a.localeCompare(b)),
  )
  const existing = await env.INTEREST_DB.prepare(
    'SELECT * FROM orders WHERE owner_hash=? AND idempotency_key=?',
  )
    .bind(ownerHash, data.key)
    .first<Order>()
  if (existing) {
    const old = await customOrderSummary(env, existing)
    if (
      existing.plan !== id ||
      existing.customer_email !== email ||
      JSON.stringify(old?.fields) !== JSON.stringify(fields)
    )
      throw new ApiError('该请求编号已用于其他订单。', 409)
    return existing
  }
  const row = await productRow(env, id),
    shop = await ownerShop(env)
  if (
    !row ||
    !row.enabled ||
    !shop.active ||
    shop.hiddenProductIds.includes(id) ||
    data.partner ||
    rowProduct(row).status !== 'published'
  )
    throw new ApiError('该商品暂未开放购买。', 409)
  const p = rowProduct(row)
  if (shop.hiddenProductIds.includes(shopProductDisplayId(p)))
    throw new ApiError('该商品暂未开放购买。', 409)
  if (
    p.delivery === 'api' &&
    p.api?.provider === 'xiaojiu' &&
    env.XIAOJIU_PURCHASE_ENABLED !== 'true'
  )
    throw new ApiError('小久商品暂未开放余额采购。', 409)
  const coupon = data.couponCode
    ? await couponQuote(env, id, email, data.couponCode)
    : null
  const price = coupon?.priceCents ?? p.priceCents
  if (p.delivery === 'api' && price < Number(p.api?.maxCostCents ?? Infinity))
    throw new ApiError(
      '商品售价或优惠后金额低于最高采购成本，请重新核对。',
      409,
    )
  if (data.expectedPrice !== price)
    throw new ApiError('商品价格已更新，请刷新后重试。', 409)
  if (
    Object.keys(fields).some((key) => !p.fields.some((f) => f.key === key)) ||
    p.fields.some((f) =>
      fields[f.key] === undefined
        ? f.required
        : typeof fields[f.key] !== 'string' ||
          String(fields[f.key]).length > 1000 ||
          (f.required && !String(fields[f.key]).trim()),
    )
  )
    throw new ApiError('请完整填写商品要求的下单信息。')
  const orderId =
      'YMX-' + crypto.randomUUID().replaceAll('-', '').toUpperCase(),
    event = crypto.randomUUID(),
    now = Date.now(),
    db = env.INTEREST_DB
  await db.batch([
    db
      .prepare(
        "INSERT INTO orders(id,owner_hash,idempotency_key,plan,plan_name,price_cents,status,mode,created_at,updated_at,last_event_id,customer_email,purchase_note) SELECT ?,?,?,c.id,c.name,?,'pending','live',?,?,?,?,c.purchase_note FROM catalog_plans c JOIN shop_products p ON p.id=c.id WHERE c.id=? AND c.enabled=1 AND c.version=? AND p.stock_remaining<>0 AND json_extract(p.public_json,'$.status')='published' AND COALESCE(json_extract((SELECT settings FROM owner_shop_settings WHERE id='platform'),'$.active'),1)=1 AND NOT EXISTS(SELECT 1 FROM owner_shop_settings s,json_each(s.settings,'$.hiddenProductIds') h WHERE s.id='platform' AND h.value=c.product_id) ON CONFLICT(owner_hash,idempotency_key) DO NOTHING",
      )
      .bind(
        orderId,
        ownerHash,
        data.key,
        price,
        now,
        now,
        event,
        email,
        id,
        row.catalog_version!,
      ),
    ...(coupon ? [couponReservation(env, coupon, orderId, email)] : []),
    db
      .prepare(
        'INSERT INTO shop_order_details(order_id,product_id,snapshot,fields,api_secret) SELECT id,?,?,?,? FROM orders WHERE id=?',
      )
      .bind(
        id,
        JSON.stringify(p),
        JSON.stringify(fields),
        row.api_secret,
        orderId,
      ),
    db
      .prepare(
        'UPDATE shop_products SET stock_remaining=CASE WHEN stock_remaining>0 THEN stock_remaining-1 ELSE stock_remaining END,version=version+1 WHERE id=? AND EXISTS(SELECT 1 FROM orders WHERE id=?)',
      )
      .bind(id, orderId),
    db
      .prepare(
        "INSERT INTO order_events(id,order_id,actor,action,to_status,note,order_version,created_at) SELECT ?,id,'customer','create','pending','创建自营商品订单，等待付款核对',0,? FROM orders WHERE id=?",
      )
      .bind(event, now, orderId),
  ])
  const created = await db
    .prepare('SELECT * FROM orders WHERE owner_hash=? AND idempotency_key=?')
    .bind(ownerHash, data.key)
    .first<Order>()
  if (!created) throw new ApiError('商品已售罄或已更新，请重新选择。', 409)
  const view = await customOrderSummary(env, created)
  if (
    created.plan !== id ||
    created.customer_email !== email ||
    JSON.stringify(view?.fields) !== JSON.stringify(fields)
  )
    throw new ApiError('该请求编号已用于其他订单。', 409)
  return created
}
export async function customBuyerAction(
  request: Request,
  env: Env,
  order: Order,
) {
  const data = await body(request),
    db = env.INTEREST_DB
  if (data.version !== order.version)
    throw new ApiError('订单已更新，请刷新。', 409)
  if (
    order.refund_hold ||
    order.redemption_blocked ||
    order.refunded_cents >= order.price_cents
  )
    throw new ApiError('订单售后处理中，暂不能继续。', 409)
  if (
    data.action === 'claim-payment' &&
    order.status === 'pending' &&
    order.payment_status === 'unpaid'
  ) {
    if (
      typeof data.reference !== 'string' ||
      data.reference.trim().length < 3 ||
      data.reference.length > 200
    )
      throw new ApiError('请填写付款交易号或付款备注（3–200 字）。')
    await db
      .prepare(
        "UPDATE shop_order_details SET payment_claimed=1,payment_reference=? WHERE order_id=? AND EXISTS(SELECT 1 FROM orders WHERE id=? AND version=? AND payment_status='unpaid')",
      )
      .bind(data.reference.trim(), order.id, order.id, order.version)
      .run()
    // A buyer's declaration never changes payment_status or triggers procurement.
    return getOrder(env, order.id)
  }
  if (
    data.action === 'cancel' &&
    order.status === 'pending' &&
    order.payment_status === 'unpaid'
  ) {
    const detail = await customOrderSummary(env, order)
    if (detail?.paymentClaimed)
      throw new ApiError(
        '已提交付款核对，请联系客服处理，避免关闭已付款订单。',
        409,
      )
    return cancelUnpaidCustom(env, order, 'customer', '客户关闭未付款订单')
  }
  throw new ApiError('当前订单状态不支持此操作。', 409)
}
async function cancelUnpaidCustom(
  env: Env,
  order: Order,
  actor: string,
  note: string,
) {
  const db = env.INTEREST_DB,
    event = crypto.randomUUID(),
    now = Date.now()
  await db.batch([
    db
      .prepare(
        "UPDATE orders SET status='cancelled',version=version+1,updated_at=?,last_event_id=? WHERE id=? AND version=? AND status='pending' AND payment_status='unpaid' AND refund_hold=0 AND EXISTS(SELECT 1 FROM shop_order_details d WHERE d.order_id=orders.id AND d.payment_claimed=0)",
      )
      .bind(now, event, order.id, order.version),
    db
      .prepare(
        'UPDATE shop_products SET stock_remaining=stock_remaining+1,version=version+1 WHERE id=? AND stock_remaining>=0 AND EXISTS(SELECT 1 FROM orders WHERE id=? AND last_event_id=?)',
      )
      .bind(order.plan, order.id, event),
    db
      .prepare(
        "INSERT INTO order_events(id,order_id,actor,action,from_status,to_status,note,order_version,created_at) SELECT ?,id,?,'custom-cancel','pending','cancelled',?,version,? FROM orders WHERE id=? AND last_event_id=?",
      )
      .bind(event, actor, note, now, order.id, event),
  ])
  if (
    !(await db
      .prepare('SELECT id FROM order_events WHERE id=?')
      .bind(event)
      .first())
  )
    throw new ApiError('订单已更新或已提交付款核对，不能关闭。', 409)
  return getOrder(env, order.id)
}
export async function customAdminAction(
  request: Request,
  env: Env,
  order: Order,
) {
  const data = await body(request, 20000)
  if (
    data.version !== order.version ||
    order.refund_hold ||
    order.redemption_blocked ||
    order.refunded_cents >= order.price_cents
  )
    throw new ApiError('订单已更新或正在售后，请刷新。', 409)
  if (
    typeof data.note !== 'string' ||
    data.note.trim().length < 3 ||
    data.note.length > 500
  )
    throw new ApiError('请填写至少 3 字的核对／交付说明。')
  if (data.action === 'close-unpaid')
    return cancelUnpaidCustom(env, order, 'admin', data.note.trim())
  if (
    data.action === 'confirm-payment' &&
    order.payment_status === 'unpaid' &&
    order.status === 'pending'
  ) {
    const view = await customOrderSummary(env, order)
    if (!view?.paymentClaimed)
      throw new ApiError('客户尚未提交付款交易号，请先核对原始收款记录。', 409)
    const next = await change(
      env,
      order,
      { payment_status: 'paid', status: 'processing', started_at: Date.now() },
      'admin',
      'manual-payment-confirmed',
      data.note.trim(),
    )
    await fulfillCustomOrder(env, next.id)
    return getOrder(env, next.id)
  }
  if (
    data.action === 'deliver' &&
    order.payment_status === 'paid' &&
    ['processing', 'failed'].includes(order.status)
  ) {
    if (
      typeof data.content !== 'string' ||
      !data.content.trim() ||
      data.content.length > 12000
    )
      throw new ApiError('请填写交付内容，最多 12000 字。')
    const d = await env.INTEREST_DB.prepare(
      'SELECT lease_until,supplier_state FROM shop_order_details WHERE order_id=?',
    )
      .bind(order.id)
      .first<Detail>()
    if (
      !d ||
      d.lease_until > Date.now() ||
      ['creating', 'pending', 'unknown', 'review'].includes(
        d.supplier_state ?? '',
      )
    )
      throw new ApiError('自动供货状态尚未确认，请先核对原任务。', 409)
    const event = crypto.randomUUID(),
      now = Date.now(),
      db = env.INTEREST_DB
    await db.batch([
      db
        .prepare(
          "UPDATE orders SET status='success',version=version+1,updated_at=?,last_event_id=? WHERE id=? AND version=? AND payment_status='paid' AND refund_hold=0 AND redemption_blocked=0 AND refunded_cents=0 AND status IN ('processing','failed') AND EXISTS(SELECT 1 FROM shop_order_details d WHERE d.order_id=orders.id AND d.lease_until<=? AND COALESCE(d.supplier_state,'') NOT IN ('creating','pending','unknown','review'))",
        )
        .bind(now, event, order.id, order.version, now),
      db
        .prepare(
          'UPDATE shop_order_details SET delivery_content=? WHERE order_id=? AND EXISTS(SELECT 1 FROM orders WHERE id=? AND last_event_id=?)',
        )
        .bind(data.content.trim(), order.id, order.id, event),
      db
        .prepare(
          "INSERT INTO order_events(id,order_id,actor,action,from_status,to_status,note,order_version,created_at) SELECT ?,id,'admin','custom-delivered',?,'success',?,version,? FROM orders WHERE id=? AND last_event_id=?",
        )
        .bind(event, order.status, data.note.trim(), now, order.id, event),
    ])
    if (
      !(await db
        .prepare('SELECT id FROM order_events WHERE id=?')
        .bind(event)
        .first())
    )
      throw new ApiError('订单已更新，请刷新后重试。', 409)
    return getOrder(env, order.id)
  }
  if (data.action === 'sync' && order.payment_status === 'paid') {
    await fulfillCustomOrder(env, order.id, true)
    return getOrder(env, order.id)
  }
  throw new ApiError('当前订单状态不支持此操作。', 409)
}
export async function fulfillCustomOrder(
  env: Env,
  id: string,
  forceQuery = false,
) {
  const order = await getOrder(env, id),
    db = env.INTEREST_DB
  if (
    order.payment_status !== 'paid' ||
    order.status === 'success' ||
    order.status === 'cancelled' ||
    order.refund_hold ||
    order.redemption_blocked ||
    order.refunded_cents > 0
  )
    return
  const detail = await db
    .prepare('SELECT * FROM shop_order_details WHERE order_id=?')
    .bind(id)
    .first<Detail>()
  if (!detail || detail.lease_until > Date.now()) return
  if (['failed', 'review'].includes(detail.supplier_state ?? '') && !forceQuery)
    return
  const product = JSON.parse(detail.snapshot) as ShopProduct
  if (product.delivery !== 'api') return
  const lease = Date.now() + 90000,
    token = crypto.randomUUID()
  await db
    .prepare(
      "UPDATE shop_order_details SET lease_until=?,lease_token=?,supplier_state=CASE WHEN supplier_state IS NULL THEN 'creating' ELSE supplier_state END WHERE order_id=? AND lease_until<=? AND EXISTS(SELECT 1 FROM orders WHERE id=? AND payment_status='paid' AND refund_hold=0 AND refunded_cents=0 AND redemption_blocked=0 AND status IN ('processing','failed'))",
    )
    .bind(lease, token, id, Date.now(), id)
    .run()
  if (
    !(await db
      .prepare(
        'SELECT 1 FROM shop_order_details WHERE order_id=? AND lease_token=?',
      )
      .bind(id, token)
      .first())
  )
    return
  try {
    // Each protocol keeps its documented recovery contract. Xiaojiu replays the
    // same downstream number only when the original response did not supply an ID.
    const remote =
      product.api?.provider === 'xiaojiu'
        ? await fulfillXiaojiuPurchase(
            new XiaojiuPurchaseClient(
              env,
              purchaseCredentials(await unseal(env, detail.api_secret)),
            ),
            {
              productId: Number(product.api.supplierProductId),
              skuId: Number(product.api.productCode),
              maximum: Number(product.api.maxCostCents),
              merchant: id,
              remoteId: detail.supplier_id,
              replay: Boolean(detail.supplier_attempted),
              beforeCreate: async () => {
                if (env.XIAOJIU_PURCHASE_ENABLED !== 'true')
                  throw new XiaojiuPurchaseError('purchase_disabled')
                const prepared = await db
                  .prepare(
                    "UPDATE shop_order_details SET supplier_attempted=1 WHERE order_id=? AND lease_token=? AND lease_until>? AND EXISTS(SELECT 1 FROM orders o WHERE o.id=shop_order_details.order_id AND o.payment_status='paid' AND o.refund_hold=0 AND o.refunded_cents=0 AND o.redemption_blocked=0 AND o.status IN ('processing','failed')) RETURNING order_id",
                  )
                  .bind(id, token, Date.now())
                  .first()
                if (!prepared)
                  throw new XiaojiuPurchaseError('invalid_response')
              },
              remember: async (remoteId, cost) => {
                const current = await db
                  .prepare(
                    'SELECT supplier_id FROM shop_order_details WHERE order_id=? AND lease_token=? AND lease_until>?',
                  )
                  .bind(id, token, Date.now())
                  .first<{ supplier_id: string | null }>()
                if (
                  !current ||
                  (current.supplier_id && current.supplier_id !== remoteId)
                )
                  throw new XiaojiuPurchaseError('invalid_response')
                await db.batch([
                  db
                    .prepare(
                      "UPDATE shop_order_details SET supplier_id=?,supplier_state='pending' WHERE order_id=? AND lease_token=? AND lease_until>?",
                    )
                    .bind(remoteId, id, token, Date.now()),
                  ...(cost >= 0
                    ? [
                        db
                          .prepare(
                            'UPDATE orders SET cost_cents=? WHERE id=? AND EXISTS(SELECT 1 FROM shop_order_details d WHERE d.order_id=orders.id AND d.lease_token=?)',
                          )
                          .bind(cost, id, token),
                      ]
                    : []),
                ])
              },
            },
          )
        : detail.supplier_state
          ? await supplierRequest(
              env,
              product,
              detail.api_secret,
              '/orders/' + (detail.supplier_id ?? id),
            )
          : await supplierRequest(
              env,
              product,
              detail.api_secret,
              '/orders',
              {
                merchant_order_no: id,
                product_code: product.api!.productCode,
                max_cost_cents: product.api!.maxCostCents,
                email: order.customer_email,
                fields: JSON.parse(detail.fields),
              },
              id,
            )
    if (
      remote.merchant_order_no !== id ||
      typeof remote.order_id !== 'string' ||
      !/^[A-Za-z0-9_-]{1,128}$/.test(remote.order_id) ||
      (detail.supplier_id && remote.order_id !== detail.supplier_id) ||
      !['pending', 'success', 'failed'].includes(String(remote.status))
    )
      throw new Error('Unverified supplier response')
    if (
      !Number.isSafeInteger(remote.cost_cents) ||
      Number(remote.cost_cents) < 0 ||
      Number(remote.cost_cents) > Number(product.api?.maxCostCents ?? -1)
    )
      throw new Error(
        'Supplier cost was not confirmed within the authorized limit',
      )
    if (
      remote.status === 'success' &&
      (typeof remote.delivery_content !== 'string' ||
        !remote.delivery_content.trim() ||
        remote.delivery_content.length > 12000)
    )
      throw new Error('Missing delivery')
    const event = crypto.randomUUID(),
      now = Date.now()
    await db.batch([
      db
        .prepare(
          "UPDATE orders SET cost_cents=? WHERE id=? AND payment_status='paid' AND EXISTS(SELECT 1 FROM shop_order_details d WHERE d.order_id=orders.id AND d.lease_token=?)",
        )
        .bind(Number(remote.cost_cents), id, token),
      db
        .prepare(
          "UPDATE shop_order_details SET supplier_id=?,supplier_state=?,delivery_content=?,last_checked_at=?,supplier_error='' WHERE order_id=? AND lease_token=? AND (COALESCE(supplier_state,'')<>'success' OR ?='success')",
        )
        .bind(
          remote.order_id,
          String(remote.status),
          remote.status === 'success' ? String(remote.delivery_content) : '',
          now,
          id,
          token,
          String(remote.status),
        ),
      ...(remote.status === 'pending'
        ? []
        : [
            db
              .prepare(
                "UPDATE orders SET status=?,version=version+1,updated_at=?,last_event_id=? WHERE id=? AND payment_status='paid' AND status IN ('processing','failed') AND refund_hold=0 AND refunded_cents=0 AND redemption_blocked=0 AND EXISTS(SELECT 1 FROM shop_order_details d WHERE d.order_id=orders.id AND d.lease_token=? AND d.supplier_state=?)",
              )
              .bind(
                remote.status === 'success' ? 'success' : 'failed',
                now,
                event,
                id,
                token,
                String(remote.status),
              ),
            db
              .prepare(
                "INSERT INTO order_events(id,order_id,actor,action,to_status,note,order_version,created_at) SELECT ?,id,'system','custom-supplier-result',status,?,version,? FROM orders WHERE id=? AND last_event_id=?",
              )
              .bind(
                event,
                remote.status === 'success'
                  ? '供货接口确认交付完成'
                  : '供货接口返回失败，请人工核对',
                now,
                id,
                event,
              ),
          ]),
    ])
  } catch (error) {
    if (error instanceof XiaojiuPurchaseError) {
      await db
        .prepare(
          "UPDATE shop_order_details SET supplier_state=CASE WHEN ?=0 THEN 'review' WHEN supplier_id IS NULL THEN 'unknown' ELSE 'pending' END,supplier_error=?,last_checked_at=? WHERE order_id=? AND lease_token=?",
        )
        .bind(Number(error.retryable), error.message, Date.now(), id, token)
        .run()
      return
    }
    await db
      .prepare(
        "UPDATE shop_order_details SET supplier_state=CASE WHEN supplier_state IN ('creating','unknown') THEN 'unknown' ELSE supplier_state END,last_checked_at=? WHERE order_id=? AND lease_token=?",
      )
      .bind(Date.now(), id, token)
      .run()
  } finally {
    await db
      .prepare(
        "UPDATE shop_order_details SET lease_until=0,lease_token='' WHERE order_id=? AND lease_token=?",
      )
      .bind(id, token)
      .run()
  }
}
export async function reconcileShopProducts(env: Env) {
  const rows = await env.INTEREST_DB.prepare(
    "SELECT d.order_id FROM shop_order_details d JOIN orders o ON o.id=d.order_id WHERE o.payment_status='paid' AND o.status IN ('processing','failed') AND o.refund_hold=0 AND o.refunded_cents=0 AND COALESCE(d.supplier_state,'') NOT IN ('failed','review') AND json_extract(d.snapshot,'$.delivery')='api' AND d.last_checked_at<? ORDER BY d.last_checked_at LIMIT 10",
  )
    .bind(Date.now() - 60000)
    .all<{ order_id: string }>()
  // One credential can be shared by several products; serialize reconciliation
  // instead of exhausting the upstream's two-write concurrency allowance.
  for (const row of rows.results) await fulfillCustomOrder(env, row.order_id)
}
