import { requireAdmin } from './admin-auth.ts'
import { requirePartner, partnerLimit, emailValue, type Partner } from './partner-auth.ts'
import { ApiError, body, hash, json, randomToken, type Env } from './platform.ts'
import { seal, unseal } from './product-secrets.ts'
import type { WholesaleOrder, WholesaleProduct, WholesaleTopup } from '../shared/wholesale.ts'

const catalogSql = `SELECT p.*,(SELECT COUNT(*) FROM wholesale_stock s WHERE s.product_id=p.id AND s.order_id IS NULL) stock FROM wholesale_products p`
const orderColumns = 'id,partner_id,request_key,product_id,product_name,unit_price_cents,quantity,amount_cents,fulfillment,status,buyer_note,handling_note,created_at,updated_at'
const topupColumns = 'id,partner_id,amount_cents,payment_reference,status,handling_note,created_at'
class WholesaleError extends ApiError {
  code: string
  constructor(message: string, status: number, code: string) { super(message, status); this.code = code }
}
function text(value: unknown, label: string, max: number, optional = false) {
  if (typeof value !== 'string' || value.length > max || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(value) || (!optional && !value.trim())) throw new ApiError(`请填写有效的${label}（最多 ${max} 字）。`)
  return value.trim()
}
function integer(value: unknown, label: string, max: number, min = 1): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max) throw new ApiError(`${label}必须是 ${min} 至 ${max} 的整数。`)
  return value
}
function requestKey(request: Request, data: Record<string, unknown>) {
  const key = request.headers.get('Idempotency-Key') ?? data.request_key
  if (typeof key !== 'string' || !/^[a-zA-Z0-9._:-]{8,128}$/.test(key)) throw new ApiError('请提供 8–128 位 Idempotency-Key，同一次操作重试时保持不变。')
  if (data.request_key !== undefined && data.request_key !== key) throw new ApiError('请求标识不一致。')
  return key
}
function pagination(url: URL) {
  const page = Number(url.searchParams.get('page') ?? 1)
  integer(page, '页码', 100000)
  return { page, offset: (page - 1) * 50 }
}
async function principal(request: Request, env: Env): Promise<{ partner: Partner; api: boolean }> {
  const authorization = request.headers.get('Authorization')
  if (authorization !== null) {
    if (!/^Bearer ws_[a-f0-9]{64}$/.test(authorization) || !env.PARTNER_AUTH_SECRET) throw new ApiError('API 密钥无效或已撤销。', 401)
    const partner = await env.INTEREST_DB.prepare(`SELECT p.* FROM wholesale_api_keys k JOIN partners p ON p.id=k.partner_id WHERE k.token_hash=? AND k.revoked_at IS NULL AND k.expires_at>? AND k.auth_version=p.auth_version AND k.credential_version=? AND p.active=1`).bind(await hash(authorization.slice(7)), Date.now(), await hash(env.PARTNER_AUTH_SECRET)).first<Partner>()
    if (!partner) throw new ApiError('API 密钥无效、已过期或账号已停用。', 401)
    return { partner, api: true }
  }
  return { partner: await requirePartner(request, env), api: false }
}
async function payload(request: Request, tokenAuth = false, maxBytes = 16384) {
  if (!tokenAuth) return body(request, maxBytes)
  // Only an already authenticated Bearer request can omit Origin. A browser
  // cross-origin request is still rejected; session writes always require Origin.
  const origin = new URL(request.url).origin
  if (request.headers.has('Origin') && request.headers.get('Origin') !== origin) throw new ApiError('不允许跨站请求。', 403)
  const headers = new Headers(request.headers)
  headers.set('Origin', origin)
  return body(new Request(request, { headers }), maxBytes)
}
async function orderView(env: Env, id: string, partnerId?: string) {
  const row = await env.INTEREST_DB.prepare(`SELECT ${orderColumns},delivery_cipher FROM wholesale_orders WHERE id=?${partnerId ? ' AND partner_id=?' : ''}`).bind(...(partnerId ? [id, partnerId] : [id])).first<WholesaleOrder & { delivery_cipher: string | null }>()
  if (!row) throw new ApiError('未找到订单。', 404)
  const { delivery_cipher, ...order } = row
  const delivery: string[] = []
  if (order.status === 'fulfilled') {
    if (delivery_cipher) delivery.push(await unseal(env, delivery_cipher))
    const stock = await env.INTEREST_DB.prepare('SELECT content_cipher FROM wholesale_stock WHERE order_id=? ORDER BY created_at,id').bind(id).all<{ content_cipher: string }>()
    delivery.push(...await Promise.all(stock.results.map(s => unseal(env, s.content_cipher))))
  }
  return { ...order, delivery }
}
async function createOrder(request: Request, env: Env, partner: Partner, data: Record<string, unknown>) {
  const key = requestKey(request, data)
  const productId = text(data.product_id, '商品编号', 80)
  const quantity = integer(data.quantity, '数量', 100)
  const maxPrice = integer(data.max_unit_price_cents, '单件最高价格（分）', 10000000)
  const note = text(data.buyer_note ?? '', '订单备注', 1000, true)
  const fingerprint = await hash(JSON.stringify([productId, quantity, maxPrice, note]))
  const existing = () => env.INTEREST_DB.prepare('SELECT id,request_hash FROM wholesale_orders WHERE partner_id=? AND request_key=?').bind(partner.id, key).first<{ id: string; request_hash: string }>()
  const previous = await existing()
  if (previous) {
    if (previous.request_hash !== fingerprint) throw new WholesaleError('该请求编号已用于不同订单，请核对原单。', 409, 'idempotency_conflict')
    return json({ order: await orderView(env, previous.id, partner.id), replayed: true })
  }
  const product = await env.INTEREST_DB.prepare('SELECT * FROM wholesale_products WHERE id=? AND active=1').bind(productId).first<WholesaleProduct>()
  if (!product) throw new ApiError('商品未上架或不存在。', 404)
  if (product.price_cents > maxPrice) throw new WholesaleError('代理价已变化，请重新确认价格。', 409, 'price_changed')
  const amount = integer(product.price_cents * quantity, '订单总额（分）', 100000000)
  const id = 'WS-' + crypto.randomUUID(), now = Date.now()
  await env.INTEREST_DB.prepare(`INSERT INTO wholesale_orders(id,partner_id,request_key,request_hash,product_id,product_name,product_version,unit_price_cents,quantity,amount_cents,fulfillment,buyer_note,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(partner_id,request_key) DO NOTHING`).bind(id, partner.id, key, fingerprint, product.id, product.name, product.version, product.price_cents, quantity, amount, product.fulfillment, note, now, now).run()
  const saved = await existing()
  if (!saved) throw new ApiError('订单结果暂时未知，请使用原请求编号查询或重试。', 503)
  if (saved.request_hash !== fingerprint) throw new WholesaleError('该请求编号已用于不同订单，请核对原单。', 409, 'idempotency_conflict')
  return json({ order: await orderView(env, saved.id, partner.id), replayed: saved.id !== id }, saved.id === id ? 201 : 200)
}
async function partnerRoutes(request: Request, env: Env, url: URL) {
  const { partner, api: tokenAuth } = await principal(request, env)
  const db = env.INTEREST_DB, suffix = url.pathname.slice('/api/wholesale'.length)
  if (request.method === 'POST') await partnerLimit(env, 'wholesale-write:' + partner.id, 60, 60000)
  if (suffix === '/account' && request.method === 'GET') {
    const wallet = await db.prepare('SELECT balance_cents FROM wholesale_wallets WHERE partner_id=?').bind(partner.id).first<{ balance_cents: number }>()
    return json({ id: partner.id, name: partner.name, balance_cents: wallet?.balance_cents ?? 0, payment_instructions: env.WHOLESALE_PAYMENT_INSTRUCTIONS?.trim() ?? '', topup_enabled: Boolean(env.WHOLESALE_PAYMENT_INSTRUCTIONS?.trim()) })
  }
  if (suffix === '/products' && request.method === 'GET') return json({ products: (await db.prepare(catalogSql + ' WHERE p.active=1 ORDER BY p.category,p.name,p.id').all()).results })
  if (suffix === '/orders' && request.method === 'POST') return createOrder(request, env, partner, await payload(request, tokenAuth))
  if (suffix === '/orders' && request.method === 'GET') {
    const key = url.searchParams.get('request_key')
    if (key) {
      const found = await db.prepare('SELECT id FROM wholesale_orders WHERE partner_id=? AND request_key=?').bind(partner.id, key).first<{ id: string }>()
      if (!found) throw new ApiError('未找到订单。', 404)
      return json({ order: await orderView(env, found.id, partner.id) })
    }
    const { page, offset } = pagination(url)
    const [orders, count] = await Promise.all([
      db.prepare(`SELECT ${orderColumns} FROM wholesale_orders WHERE partner_id=? ORDER BY created_at DESC,id DESC LIMIT 50 OFFSET ?`).bind(partner.id, offset).all(),
      db.prepare('SELECT COUNT(*) total FROM wholesale_orders WHERE partner_id=?').bind(partner.id).first<{ total: number }>(),
    ])
    return json({ orders: orders.results, ...count, page })
  }
  const orderId = suffix.match(/^\/orders\/([a-zA-Z0-9-]+)$/)?.[1]
  if (orderId && request.method === 'GET') return json({ order: await orderView(env, orderId, partner.id) })
  if (suffix === '/ledger' && request.method === 'GET') {
    const { page, offset } = pagination(url)
    const [ledger, count] = await Promise.all([
      db.prepare('SELECT id,kind,reference_id,amount_cents,balance_cents,created_at FROM wholesale_ledger WHERE partner_id=? ORDER BY id DESC LIMIT 50 OFFSET ?').bind(partner.id, offset).all(),
      db.prepare('SELECT COUNT(*) total FROM wholesale_ledger WHERE partner_id=?').bind(partner.id).first<{ total: number }>(),
    ])
    return json({ ledger: ledger.results, ...count, page })
  }
  // Credential management and top-up declarations are interactive-only.
  if (tokenAuth) throw new ApiError('该操作请登录代理站完成。', 403)
  if (suffix === '/topups' && request.method === 'GET') {
    const { page, offset } = pagination(url)
    const [topups, count] = await Promise.all([
      db.prepare(`SELECT ${topupColumns} FROM wholesale_topups WHERE partner_id=? ORDER BY created_at DESC,id DESC LIMIT 50 OFFSET ?`).bind(partner.id, offset).all(),
      db.prepare('SELECT COUNT(*) total FROM wholesale_topups WHERE partner_id=?').bind(partner.id).first<{ total: number }>(),
    ])
    return json({ topups: topups.results, ...count, page })
  }
  if (suffix === '/topups' && request.method === 'POST') {
    if (!env.WHOLESALE_PAYMENT_INSTRUCTIONS?.trim()) throw new ApiError('充值收款方式尚未配置，请联系供货方。', 409)
    const data = await payload(request), key = requestKey(request, data)
    const amount = integer(data.amount_cents, '充值金额（分）', 10000000)
    const reference = text(data.payment_reference, '付款流水或备注', 160)
    await db.prepare(`INSERT INTO wholesale_topups(id,partner_id,request_key,amount_cents,payment_reference,created_at) VALUES(?,?,?,?,?,?) ON CONFLICT(partner_id,request_key) DO NOTHING`).bind(crypto.randomUUID(), partner.id, key, amount, reference, Date.now()).run()
    const topup = await db.prepare(`SELECT ${topupColumns} FROM wholesale_topups WHERE partner_id=? AND request_key=?`).bind(partner.id, key).first<WholesaleTopup>()
    if (!topup || topup.amount_cents !== amount || topup.payment_reference !== reference) throw new WholesaleError('该请求编号已用于其他充值记录。', 409, 'idempotency_conflict')
    return json({ topup })
  }
  if (suffix === '/keys' && request.method === 'GET') return json({ keys: (await db.prepare('SELECT id,name,prefix,created_at,expires_at,revoked_at FROM wholesale_api_keys WHERE partner_id=? ORDER BY created_at DESC LIMIT 100').bind(partner.id).all()).results })
  if (suffix === '/keys' && request.method === 'POST') {
    const data = await payload(request), name = text(data.name, '密钥名称', 60)
    const token = 'ws_' + randomToken(), id = crypto.randomUUID(), now = Date.now()
    await db.prepare(`INSERT INTO wholesale_api_keys(id,partner_id,name,prefix,token_hash,auth_version,credential_version,created_at,expires_at) SELECT ?,?,?,?,?,?,?,?,? WHERE (SELECT COUNT(*) FROM wholesale_api_keys WHERE partner_id=? AND revoked_at IS NULL AND expires_at>?)<5`).bind(id, partner.id, name, token.slice(0, 11), await hash(token), partner.auth_version, await hash(env.PARTNER_AUTH_SECRET!), now, now + 90 * 86400000, partner.id, now).run()
    if (!await db.prepare('SELECT id FROM wholesale_api_keys WHERE id=?').bind(id).first()) throw new ApiError('最多保留 5 个有效密钥，请先撤销不再使用的密钥。', 409)
    return json({ id, token, expires_at: now + 90 * 86400000 }, 201)
  }
  const keyId = suffix.match(/^\/keys\/([a-f0-9-]+)\/revoke$/)?.[1]
  if (keyId && request.method === 'POST') {
    await payload(request)
    await db.prepare('UPDATE wholesale_api_keys SET revoked_at=COALESCE(revoked_at,?) WHERE id=? AND partner_id=?').bind(Date.now(), keyId, partner.id).run()
    return json({ ok: true })
  }
  throw new ApiError('未找到接口。', 404)
}

async function adminRoutes(request: Request, env: Env, url: URL) {
  await requireAdmin(request, env)
  const db = env.INTEREST_DB, suffix = url.pathname.slice('/api/admin/wholesale'.length)
  if (suffix === '/accounts' && request.method === 'GET') {
    const { page, offset } = pagination(url)
    const [accounts, count] = await Promise.all([
      db.prepare('SELECT p.id,p.name,p.email,p.active,p.version,COALESCE(w.balance_cents,0) balance_cents FROM partners p LEFT JOIN wholesale_wallets w ON w.partner_id=p.id ORDER BY p.created_at DESC,p.id LIMIT 50 OFFSET ?').bind(offset).all(),
      db.prepare('SELECT COUNT(*) total FROM partners').first<{ total: number }>(),
    ])
    return json({ accounts: accounts.results, ...count, page })
  }
  if (suffix === '/accounts' && request.method === 'POST') {
    const data = await body(request), name = text(data.name, '代理名称', 80), email = emailValue(data.email)
    const id = crypto.randomUUID(), now = Date.now()
    await db.batch([
      db.prepare('INSERT INTO partners(id,slug,name,email,created_at,updated_at) VALUES(?,?,?,?,?,?)').bind(id, randomToken().slice(0, 16), name, email, now, now),
      db.prepare("INSERT INTO admin_audit(id,target_id,action,note,created_at) VALUES(?,?,'wholesale-account-create','开通供货代理',?)").bind(crypto.randomUUID(), id, now),
    ])
    return json({ id }, 201)
  }
  const accountId = suffix.match(/^\/accounts\/([a-zA-Z0-9-]+)$/)?.[1]
  if (accountId && request.method === 'POST') {
    const data = await body(request), version = integer(data.version, '版本', 100000000, 0), now = Date.now(), audit = crypto.randomUUID()
    if (typeof data.active !== 'boolean') throw new ApiError('请选择代理状态。')
    await db.batch([
      db.prepare('UPDATE partners SET active=?,version=version+1,auth_version=auth_version+1,updated_at=? WHERE id=? AND version=?').bind(Number(data.active), now, accountId, version),
      db.prepare("INSERT INTO admin_audit(id,target_id,action,note,created_at) SELECT ?,?,'wholesale-account-state',?,? WHERE changes()=1").bind(audit, accountId, data.active ? '重新启用代理，原会话与密钥失效' : '停用代理，原会话与密钥失效', now),
    ])
    if (!await db.prepare('SELECT id FROM admin_audit WHERE id=?').bind(audit).first()) throw new ApiError('代理已更新，请刷新后重试。', 409)
    return json({ ok: true })
  }
  const accountLedger = suffix.match(/^\/accounts\/([a-zA-Z0-9-]+)\/ledger$/)?.[1]
  if (accountLedger && request.method === 'GET') {
    const { page, offset } = pagination(url)
    const [ledger, count] = await Promise.all([
      db.prepare('SELECT id,kind,reference_id,amount_cents,balance_cents,created_at FROM wholesale_ledger WHERE partner_id=? ORDER BY id DESC LIMIT 50 OFFSET ?').bind(accountLedger, offset).all(),
      db.prepare('SELECT COUNT(*) total FROM wholesale_ledger WHERE partner_id=?').bind(accountLedger).first<{ total: number }>(),
    ])
    return json({ ledger: ledger.results, ...count, page })
  }
  if (suffix === '/products' && request.method === 'GET') return json({ products: (await db.prepare(catalogSql + ' ORDER BY p.updated_at DESC,p.id').all()).results })
  if (suffix === '/products' && request.method === 'POST') {
    const data = await body(request, 16384), id = text(data.id, '商品编码', 80)
    if (!/^[a-z0-9][a-z0-9-]{2,79}$/.test(id)) throw new ApiError('商品编码使用 3–80 位小写字母、数字和短横线。')
    const name = text(data.name, '商品名称', 120), description = text(data.description ?? '', '说明', 3000, true), category = text(data.category, '分类', 40)
    const price = integer(data.price_cents, '代理价（分）', 10000000)
    if (!['stock', 'manual'].includes(String(data.fulfillment)) || typeof data.active !== 'boolean') throw new ApiError('请选择有效的交付方式和上架状态。')
    const version = data.version === null ? null : integer(data.version, '版本', 100000000, 0)
    const now = Date.now(), audit = crypto.randomUUID()
    const statement = version === null
      ? db.prepare('INSERT INTO wholesale_products(id,name,description,category,price_cents,fulfillment,active,updated_at) VALUES(?,?,?,?,?,?,?,?)').bind(id, name, description, category, price, String(data.fulfillment), Number(data.active), now)
      : db.prepare('UPDATE wholesale_products SET name=?,description=?,category=?,price_cents=?,fulfillment=?,active=?,version=version+1,updated_at=? WHERE id=? AND version=? AND (fulfillment=? OR NOT EXISTS(SELECT 1 FROM wholesale_stock WHERE product_id=?))').bind(name, description, category, price, String(data.fulfillment), Number(data.active), now, id, version, String(data.fulfillment), id)
    await db.batch([
      statement,
      db.prepare(`INSERT INTO admin_audit(id,target_id,action,note,created_at) SELECT ?,?,'wholesale-product','更新批发商品',? WHERE changes()=1`).bind(audit, id, now),
    ])
    if (!await db.prepare('SELECT id FROM admin_audit WHERE id=?').bind(audit).first()) throw new ApiError('商品已更新，或已有卡密不能更改交付方式，请刷新后重试。', 409)
    return json({ ok: true })
  }
  const stockId = suffix.match(/^\/products\/([a-z0-9-]+)\/stock$/)?.[1]
  if (stockId && request.method === 'POST') {
    const data = await body(request, 128000)
    if (!Array.isArray(data.items) || !data.items.length || data.items.length > 100) throw new ApiError('每次导入 1–100 条卡密，一行一条。')
    const items = data.items.map(item => text(item, '卡密', 4000))
    if (new Set(items).size !== items.length) throw new ApiError('导入内容包含重复卡密。')
    const product = await db.prepare("SELECT id FROM wholesale_products WHERE id=? AND fulfillment='stock'").bind(stockId).first()
    if (!product) throw new ApiError('该商品不是库存卡密商品。', 409)
    const now = Date.now()
    const statements = await Promise.all(items.map(async item => db.prepare(`INSERT INTO wholesale_stock(id,product_id,content_cipher,content_hash,created_at) VALUES(?,?,?,?,?)`).bind(crypto.randomUUID(), stockId, await seal(env, item), await hash(env.PARTNER_AUTH_SECRET + ':wholesale-stock:' + item), now)))
    await db.batch([...statements, db.prepare("INSERT INTO admin_audit(id,target_id,action,note,created_at) VALUES(?,?,'wholesale-stock',?,?)").bind(crypto.randomUUID(), stockId, `导入 ${items.length} 条卡密`, now)])
    return json({ imported: items.length })
  }
  if (['/orders', '/topups'].includes(suffix) && request.method === 'GET') {
    const { page, offset } = pagination(url), table = suffix === '/orders' ? 'wholesale_orders' : 'wholesale_topups'
    const columns = (suffix === '/orders' ? orderColumns : topupColumns).split(',').map(c => 'w.' + c).join(',')
    const status = url.searchParams.get('status') ?? ''
    if (status && !['pending','fulfilled','refunded','approved','rejected'].includes(status)) throw new ApiError('无效状态。')
    const [rows, count] = await Promise.all([
      db.prepare(`SELECT ${columns},p.name partner_name FROM ${table} w JOIN partners p ON p.id=w.partner_id WHERE (?='' OR w.status=?) ORDER BY w.created_at DESC,w.id DESC LIMIT 50 OFFSET ?`).bind(status, status, offset).all(),
      db.prepare(`SELECT COUNT(*) total FROM ${table} WHERE (?='' OR status=?)`).bind(status, status).first<{ total: number }>(),
    ])
    return json({ [suffix.slice(1)]: rows.results, ...count, page })
  }
  const topupId = suffix.match(/^\/topups\/([a-f0-9-]+)$/)?.[1]
  if (topupId && request.method === 'POST') {
    const data = await body(request), note = text(data.note, '核对说明', 500)
    if (!['approved','rejected'].includes(String(data.status))) throw new ApiError('请选择充值处理结果。')
    const current = await db.prepare('SELECT amount_cents,status FROM wholesale_topups WHERE id=?').bind(topupId).first<{ amount_cents: number; status: string }>()
    if (!current) throw new ApiError('未找到充值记录。', 404)
    if (current.status !== 'pending') throw new ApiError('该记录已处理，请刷新列表。', 409)
    let receipt = ''
    if (data.status === 'approved') {
      if (data.confirmed_amount_cents !== current.amount_cents) throw new ApiError('实际到账金额与申请不符，请核对后处理。', 409)
      receipt = text(data.receipt, '实际收款流水号', 160)
      if (receipt.length < 6) throw new ApiError('实际收款流水号至少 6 位。')
    }
    await db.prepare("UPDATE wholesale_topups SET status=?,receipt=?,handling_note=?,handled_at=? WHERE id=? AND status='pending'").bind(String(data.status), receipt, note, Date.now(), topupId).run()
    return json({ ok: true })
  }
  const orderAction = suffix.match(/^\/orders\/([a-zA-Z0-9-]+)\/(fulfill|refund)$/)
  if (orderAction && request.method === 'POST') {
    const [, id, action] = orderAction, data = await body(request, 32000)
    const note = text(data.note, '处理说明', 500), now = Date.now()
    const current = await db.prepare('SELECT status,fulfillment FROM wholesale_orders WHERE id=?').bind(id).first<{ status: string; fulfillment: string }>()
    if (!current) throw new ApiError('未找到订单。', 404)
    if (action === 'refund') {
      await db.prepare("UPDATE wholesale_orders SET status='refunded',handling_note=?,updated_at=? WHERE id=? AND status IN ('pending','fulfilled')").bind(note, now, id).run()
    } else {
      if (current.status !== 'pending' || current.fulfillment !== 'manual') throw new ApiError('该订单无需人工交付。', 409)
      const delivery = await seal(env, text(data.delivery, '交付内容', 16000))
      await db.batch([
        db.prepare("UPDATE wholesale_orders SET status='fulfilled',delivery_cipher=?,handling_note=?,updated_at=? WHERE id=? AND status='pending'").bind(delivery, note, now, id),
        db.prepare("INSERT INTO admin_audit(id,target_id,action,note,created_at) SELECT ?,?,'wholesale-fulfill',?,? WHERE changes()=1").bind(crypto.randomUUID(), id, note, now),
      ])
    }
    return json({ order: await orderView(env, id) })
  }
  throw new ApiError('未找到接口。', 404)
}

export async function wholesaleRoutes(request: Request, env: Env, url: URL) {
  if (env.STOREFRONT_KIND !== 'wholesale') return json({ error: '供货站尚未启用。' }, 404)
  try {
    return await (url.pathname.startsWith('/api/admin/wholesale/') ? adminRoutes(request, env, url) : partnerRoutes(request, env, url))
  } catch (error) {
    if (error instanceof ApiError) return json({ error: error.message, ...(error instanceof WholesaleError ? { code: error.code } : {}) }, error.status)
    const detail = error instanceof Error ? error.message : ''
    const rules: [string, string, string][] = [
      ['wholesale_insufficient_balance', '余额不足，请先充值或减少数量。', 'insufficient_balance'],
      ['wholesale_insufficient_stock', '库存不足，未扣款，请减少数量或稍后重试。', 'insufficient_stock'],
      ['wholesale_product_changed', '商品已更新，请重新确认价格与销售状态。', 'price_changed'],
      ['wholesale_account_unavailable', '代理账号已停用。', 'account_disabled'],
      ['wholesale_topup_receipt', '该收款流水已入账，请勿重复确认。', 'receipt_used'],
      ['wholesale_stock.content_hash', '存在已导入的卡密，本次导入已全部取消。', 'duplicate_stock'],
      ['wholesale_products.id', '商品编码已存在，请编辑原商品。', 'product_exists'],
      ['partners.email', '该邮箱已有代理账号，请在列表中管理。', 'account_exists'],
    ]
    const known = rules.find(([marker]) => detail.includes(marker))
    if (known) return json({ error: known[1], code: known[2] }, 409)
    return json({ error: '供货服务暂时不可用，请使用原请求编号查询后重试。' }, 503)
  }
}
