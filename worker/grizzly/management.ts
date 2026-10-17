import {
  GRIZZLY_SERVICES,
  SMS_PRODUCT_IDS,
  decimalUnits,
  grizzlyCostCents,
  grizzlyProduct,
  type GrizzlyService,
  type SmsProjectSettings,
  type SmsPoolQuote,
  type SmsPublicCatalog,
} from '../../shared/grizzly-sms.ts'
import { ApiError, body, hash, json, type Env } from '../platform.ts'
import { seal, unseal } from '../product-secrets.ts'
import { GrizzlyClient, GrizzlyError, grizzlyKey } from './client.ts'
import { affordablePools, poolQuotes } from './pools.ts'
import { grizzlyCheckoutEnabled } from './service.ts'
import { alipayConfigured } from '../payments/providers.ts'

type Settings = {
  api_secret: string
  key_hash: string
  checked_key_hash: string
  cny_per_usd: string
  projects: string
  balance_usd: string | null
  quotes: string
  checked_at: number
  version: number
  change_id: string
}
const settings = (env: Env) =>
  env.INTEREST_DB.prepare(
    "SELECT * FROM sms_settings WHERE id='grizzly'",
  ).first<Settings>()
const services = Object.keys(GRIZZLY_SERVICES) as GrizzlyService[]
const readProjects = (s: Settings) =>
  JSON.parse(s.projects) as SmsProjectSettings[]
function problems(env: Env, s: Settings, p: SmsProjectSettings) {
  const result: string[] = []
  if (!s.api_secret) result.push('灰熊 API Key 未配置')
  if (!s.key_hash || s.key_hash !== s.checked_key_hash || !s.checked_at)
    result.push('请执行灰熊只读检查')
  if (s.checked_at < Date.now() - 5 * 60000)
    result.push('余额与报价检查已过期，请重新检查')
  if (!alipayConfigured(env)) result.push('支付宝商户自动收款未配置')
  if (env.PAYMENT_CHECKOUT_ENABLED !== 'true') result.push('自动收款开关未启用')
  if (env.GRIZZLY_SMS_ENABLED !== 'true') result.push('接码采购开关未启用')
  if (env.ORDER_TESTING_ENABLED === 'true')
    result.push('非交易测试模式尚未关闭')
  if (!env.PAYMENT_NOTIFY_ORIGIN) result.push('支付回调域名未配置')
  try {
    grizzlyCostCents(p.maxPriceUsd, s.cny_per_usd)
  } catch {
    result.push('美元采购上限或成本汇率未配置')
  }
  let candidates: ReturnType<typeof affordablePools> = []
  try {
    candidates = affordablePools(
      JSON.parse(s.quotes)[p.service] ?? [],
      p.maxPriceUsd,
    )
  } catch {
    /* Report limits above. */
  }
  if (!candidates.length) result.push('两种号码池暂无已确认且在上限内的库存')
  try {
    if (
      !s.balance_usd ||
      !candidates[0] ||
      decimalUnits(s.balance_usd) < decimalUnits(candidates[0].priceUsd)
    )
      result.push('灰熊预充值余额不足或未确认')
  } catch {
    result.push('灰熊预充值余额未确认')
  }
  if (
    !grizzlyCheckoutEnabled(env) &&
    !result.some((v) => /收款|开关|回调|测试/.test(v))
  )
    result.push('收款配置尚未就绪')
  return [...new Set(result)]
}
async function view(env: Env, s: Settings) {
  const quotes = JSON.parse(s.quotes) as Record<string, SmsPoolQuote[]>
  return {
    version: s.version,
    configured: Boolean(s.api_secret),
    credentialVerified: Boolean(
      s.key_hash && s.checked_key_hash === s.key_hash,
    ),
    cnyPerUsd: s.cny_per_usd,
    balanceUsd: s.balance_usd,
    checkedAt: s.checked_at,
    projects: readProjects(s).map((p) => ({
      ...p,
      name: GRIZZLY_SERVICES[p.service],
      planId: SMS_PRODUCT_IDS[p.service],
      pools: quotes[p.service] ?? [],
      missing: problems(env, s, p),
    })),
    paymentConfigured: alipayConfigured(env),
    paymentEnabled: env.PAYMENT_CHECKOUT_ENABLED === 'true',
    procurementEnabled: env.GRIZZLY_SMS_ENABLED === 'true',
  }
}
export async function smsPublicCatalog(env: Env): Promise<SmsPublicCatalog> {
  const s = await settings(env)
  if (!s) return { projects: [] }
  const plans = (
    await env.INTEREST_DB.prepare(
      'SELECT id,enabled,price_cents FROM catalog_plans WHERE id IN (?,?,?)',
    )
      .bind(...Object.values(SMS_PRODUCT_IDS))
      .all<{ id: string; enabled: number; price_cents: number }>()
  ).results
  return {
    projects: readProjects(s).map((p) => {
      const plan = plans.find((v) => v.id === SMS_PRODUCT_IDS[p.service])
      return {
        service: p.service,
        name: GRIZZLY_SERVICES[p.service],
        planId: SMS_PRODUCT_IDS[p.service],
        priceCents: plan?.price_cents ?? p.priceCents,
        visible: p.visible,
        enabled: Boolean(
          plan?.enabled &&
          p.selling &&
          grizzlyCheckoutEnabled(env) &&
          s.api_secret &&
          s.key_hash === s.checked_key_hash,
        ),
        purchaseNote: grizzlyProduct(p.service).purchaseNote,
      }
    }),
  }
}
async function persist(env: Env, s: Settings) {
  const event = crypto.randomUUID(),
    now = Date.now(),
    db = env.INTEREST_DB
  const statements = [
    db
      .prepare(
        "UPDATE sms_settings SET api_secret=?,key_hash=?,checked_key_hash=?,cny_per_usd=?,projects=?,balance_usd=?,quotes=?,checked_at=?,version=version+1,change_id=? WHERE id='grizzly' AND version=?",
      )
      .bind(
        s.api_secret,
        s.key_hash,
        s.checked_key_hash,
        s.cny_per_usd,
        s.projects,
        s.balance_usd,
        s.quotes,
        s.checked_at,
        event,
        s.version,
      ),
  ]
  for (const project of readProjects(s)) {
    const p = grizzlyProduct(project.service)
    p.id = SMS_PRODUCT_IDS[project.service]
    p.priceCents = project.priceCents
    p.status = project.visible
      ? project.selling
        ? 'published'
        : 'listed'
      : 'archived'
    p.api!.sms = {
      country: 'auto-us',
      maxPriceUsd: project.maxPriceUsd,
      cnyPerUsd: s.cny_per_usd,
    }
    p.api!.configured = Boolean(s.api_secret)
    p.api!.verified = Boolean(s.key_hash && s.key_hash === s.checked_key_hash)
    try {
      p.api!.maxCostCents = grizzlyCostCents(project.maxPriceUsd, s.cny_per_usd)
    } catch {
      p.api!.maxCostCents = undefined
    }
    statements.push(
      db
        .prepare(
          'UPDATE catalog_plans SET name=?,price_cents=?,enabled=?,purchase_note=?,delivery_instructions=?,version=version+1,updated_at=? WHERE id=? AND EXISTS(SELECT 1 FROM sms_settings WHERE change_id=?)',
        )
        .bind(
          p.name,
          p.priceCents,
          Number(p.status === 'published'),
          p.purchaseNote,
          p.deliveryInstructions,
          now,
          p.id,
          event,
        ),
      db
        .prepare(
          "UPDATE shop_products SET public_json=?,api_secret=?,version=version+1,updated_at=?,change_id=?,api_verified_fingerprint='' WHERE id=? AND EXISTS(SELECT 1 FROM sms_settings WHERE change_id=?)",
        )
        .bind(JSON.stringify(p), s.api_secret, now, event, p.id, event),
    )
  }
  statements.push(
    db
      .prepare(
        "INSERT INTO admin_audit(id,target_id,action,note,created_at) SELECT ?,'sms','sms-settings','保存接码管理配置（不含密钥）',? FROM sms_settings WHERE change_id=?",
      )
      .bind(event, now, event),
  )
  await db.batch(statements)
  if (
    !(await db
      .prepare('SELECT id FROM admin_audit WHERE id=?')
      .bind(event)
      .first())
  )
    throw new ApiError('接码设置已更新，请重新读取后保存。', 409)
  return (await settings(env))!
}
export async function smsManagement(request: Request, env: Env, url: URL) {
  let s = await settings(env)
  if (!s) throw new ApiError('接码数据库尚未迁移。', 503)
  if (request.method === 'GET') {
    if (url.searchParams.get('orders') === '1') {
      const page = Number(url.searchParams.get('page') ?? 1)
      if (!Number.isInteger(page) || page < 1 || page > 10000)
        throw new ApiError('页码无效。')
      const rows = (
        await env.INTEREST_DB.prepare(
          'SELECT o.id,o.plan_name,o.price_cents,o.payment_status,o.refunded_cents,o.refund_hold,o.created_at,g.state,g.country,g.cost_usd,g.supplier_cancelled_at,g.supplier_refund_usd,g.supplier_refund_reference,g.supplier_refund_confirmed_at,g.error,p.trade_no,(SELECT status FROM refund_cases r WHERE r.order_id=o.id ORDER BY created_at DESC LIMIT 1) refund_state FROM grizzly_activations g JOIN orders o ON o.id=g.order_id LEFT JOIN payments p ON p.order_id=o.id ORDER BY o.created_at DESC LIMIT 30 OFFSET ?',
        )
          .bind((page - 1) * 30)
          .all()
      ).results
      return json({
        orders: rows,
        page,
        total:
          (
            await env.INTEREST_DB.prepare(
              'SELECT COUNT(*) n FROM grizzly_activations',
            ).first<{ n: number }>()
          )?.n ?? 0,
      })
    }
    return json(await view(env, s))
  }
  if (request.method !== 'POST') throw new ApiError('请求方式不支持。', 405)
  const data = await body(request, 20000)
  if (data.version !== s.version)
    throw new ApiError('接码设置已更新，请重新读取。', 409)
  if (data.action === 'save') {
    if (typeof data.cnyPerUsd !== 'string' || data.cnyPerUsd.length > 12)
      throw new ApiError('成本汇率无效。')
    if (data.cnyPerUsd)
      try {
        grizzlyCostCents('1', data.cnyPerUsd)
      } catch {
        throw new ApiError(
          '成本汇率须为大于 0 且不超过 100 的数字，最多四位小数。',
        )
      }
    const input = data.projects as SmsProjectSettings[]
    if (
      !Array.isArray(input) ||
      input.length !== 3 ||
      input.some((p) => !p || typeof p !== 'object') ||
      new Set(input.map((p) => p.service)).size !== 3
    )
      throw new ApiError('请完整配置三个接码项目。')
    for (const p of input) {
      if (
        !services.includes(p.service) ||
        !Number.isSafeInteger(p.priceCents) ||
        p.priceCents < 1 ||
        p.priceCents > 10000000 ||
        typeof p.visible !== 'boolean' ||
        typeof p.selling !== 'boolean' ||
        typeof p.maxPriceUsd !== 'string'
      )
        throw new ApiError('项目售价或发布设置无效。')
      if (p.maxPriceUsd)
        try {
          if (grizzlyCostCents(p.maxPriceUsd, data.cnyPerUsd) > p.priceCents)
            throw new Error()
        } catch {
          throw new ApiError(
            '采购上限与汇率必须有效，售价不能低于核算成本上限。',
          )
        }
      if (p.selling && !p.visible) throw new ApiError('请先展示商品再开售。')
    }
    if (data.apiKey) {
      try {
        const key = grizzlyKey(data.apiKey)
        s.api_secret = await seal(env, key)
        s.key_hash = await hash(key)
        s.checked_key_hash = ''
        s.checked_at = 0
        s.balance_usd = null
        s.quotes = '{}'
      } catch {
        throw new ApiError('灰熊 API Key 格式无效。')
      }
    }
    s.cny_per_usd = data.cnyPerUsd
    s.projects = JSON.stringify(
      input.map((p) => ({
        service: p.service,
        priceCents: p.priceCents,
        maxPriceUsd: p.maxPriceUsd,
        visible: p.visible,
        selling: p.selling,
      })),
    )
    for (const p of input)
      if (p.selling) {
        const missing = problems(env, s, p)
        if (missing.length)
          throw new ApiError('暂不能开售：' + missing.join('；'), 409)
      }
    s = await persist(env, s)
  } else if (data.action === 'check') {
    if (!s.api_secret) throw new ApiError('请先保存灰熊 API Key。', 409)
    const client = new GrizzlyClient(env, await unseal(env, s.api_secret))
    const [balance, ...quotes] = await Promise.allSettled([
      client.balance(),
      ...services.map((service) => poolQuotes(client, service)),
    ])
    s.checked_at = Date.now()
    s.balance_usd =
      balance.status === 'fulfilled' ? String(balance.value) : null
    s.checked_key_hash = balance.status === 'fulfilled' ? s.key_hash : ''
    s.quotes = JSON.stringify(
      Object.fromEntries(
        services.map((service, i) => [
          service,
          quotes[i].status === 'fulfilled' ? quotes[i].value : [],
        ]),
      ),
    )
    const checked = s
    s.projects = JSON.stringify(
      readProjects(checked).map((p) => ({
        ...p,
        selling: p.selling && problems(env, checked, p).length === 0,
      })),
    )
    s = await persist(env, s)
    if (balance.status === 'rejected' && balance.reason instanceof GrizzlyError)
      return json({
        ...(await view(env, s)),
        checkError: balance.reason.message,
      })
  } else throw new ApiError('接码管理操作无效。')
  return json(await view(env, s))
}

export async function recordSupplierRefund(
  env: Env,
  orderId: string,
  data: Record<string, unknown>,
) {
  if (
    typeof data.reference !== 'string' ||
    data.reference.trim().length < 3 ||
    data.reference.length > 200 ||
    typeof data.note !== 'string' ||
    data.note.trim().length < 3
  )
    throw new ApiError('请填写实际余额退款记录编号及核对说明。')
  const row = await env.INTEREST_DB.prepare(
    'SELECT cost_usd,state,supplier_refund_confirmed_at FROM grizzly_activations WHERE order_id=?',
  )
    .bind(orderId)
    .first<{
      cost_usd: string | null
      state: string
      supplier_refund_confirmed_at: number | null
    }>()
  if (
    !row ||
    row.state !== 'cancelled' ||
    row.supplier_refund_confirmed_at ||
    !row.cost_usd
  )
    throw new ApiError(
      '请先确认上游取消，并核对本次实际扣款及是否已经登记。',
      409,
    )
  try {
    if (
      decimalUnits(data.amountUsd) <= 0 ||
      decimalUnits(data.amountUsd) > decimalUnits(row.cost_usd)
    )
      throw new Error()
  } catch {
    throw new ApiError('上游余额退款金额须大于 0 且不超过实际采购价。')
  }
  const now = Date.now(),
    event = crypto.randomUUID(),
    amount = String(data.amountUsd)
  await env.INTEREST_DB.batch([
    env.INTEREST_DB.prepare(
      "UPDATE grizzly_activations SET supplier_refund_usd=?,supplier_refund_reference=?,supplier_refund_confirmed_at=? WHERE order_id=? AND state='cancelled' AND supplier_refund_confirmed_at IS NULL",
    ).bind(amount, data.reference.trim(), now, orderId),
    env.INTEREST_DB.prepare(
      "INSERT INTO sms_supplier_events(id,order_id,kind,amount_usd,reference,note,created_at) SELECT ?,order_id,'refund-confirmed',?,?,?,? FROM grizzly_activations WHERE order_id=? AND supplier_refund_confirmed_at=? AND supplier_refund_reference=? AND NOT EXISTS(SELECT 1 FROM sms_supplier_events WHERE order_id=? AND kind='refund-confirmed')",
    ).bind(
      event,
      amount,
      data.reference.trim(),
      data.note.trim(),
      now,
      orderId,
      now,
      data.reference.trim(),
      orderId,
    ),
  ])
  if (
    !(await env.INTEREST_DB.prepare(
      'SELECT id FROM sms_supplier_events WHERE id=?',
    )
      .bind(event)
      .first())
  )
    throw new ApiError('上游余额退款已由另一操作核对，请刷新订单。', 409)
}
