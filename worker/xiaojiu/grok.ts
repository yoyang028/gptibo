import { hash } from '../platform.ts'
import { purchaseMoney } from './purchase.ts'
import { grokProductCopy, GROK_TIER_NAMES, type GrokTier } from '../../shared/grok-product-copy.ts'
import type { ShopProduct } from '../../shared/shop-products.ts'

/** Exact, independently read supplier product/SKU pairs, checked 2026-10-24. */
export const XIAOJIU_GROK_SPECS: Record<GrokTier, { productId: number; skuId: number }> = {
  plus: { productId: 19, skuId: 28 },
  premium: { productId: 18, skuId: 27 },
  super: { productId: 20, skuId: 29 },
  ultra: { productId: 21, skuId: 30 },
}

/** Prepare data only. Credentials and verification still use shop-product APIs. */
export async function xiaojiuGrokDraft(tier: GrokTier, source: Record<string, unknown>, retailCents: number, image: string): Promise<ShopProduct> {
  const spec = XIAOJIU_GROK_SPECS[tier]
  const title = typeof source.title === 'string' ? source.title : (source.title as Record<string, unknown> | undefined)?.['zh-CN']
  const skus = Array.isArray(source.skus) ? source.skus : []
  const sku = skus.find(s => s?.id === spec.skuId)
  if (source.id !== spec.productId || source.is_active !== true || source.fulfillment_type !== 'auto' || sku?.is_active !== true || typeof title !== 'string' || !new RegExp('Grok\\s+' + GROK_TIER_NAMES[tier] + '\\b', 'i').test(title))
    throw new Error('Grok source product or exact SKU changed; review before importing')
  const cost = purchaseMoney(sku.price_amount)
  if (cost < 1 || !Number.isSafeInteger(retailCents) || retailCents < cost || !Number.isSafeInteger(sku.stock_quantity) || sku.stock_quantity < -1 || sku.stock_quantity > 1_000_000)
    throw new Error('Grok retail price, cost or stock requires review')
  return {
    ...grokProductCopy(tier),
    id: 'custom-' + (await hash('xiaojiu:grok:' + spec.productId + ':' + spec.skuId)).slice(0, 32),
    groupId: 'grok', name: 'Grok ' + GROK_TIER_NAMES[tier], category: 'AI 订阅',
    image, badge: '组合订阅', unit: '份', priceCents: retailCents,
    stock: sku.stock_quantity, requiresRedemption: true,
    fields: [], delivery: 'api', payment: { label: '', instructions: '', url: '', qr: '' },
    status: 'listed', version: 0,
    api: { provider: 'xiaojiu', baseUrl: 'https://98-xj.com', supplierProductId: spec.productId, productCode: String(spec.skuId), maxCostCents: cost, configured: false, verified: false },
  }
}

/** Private order data, never included in public catalog copy. */
export function grokRedemptionGuide() {
  return [
    '[打开本单兑换入口](https://982xj.xyz/)',
    '### 1. 验证兑换码\n复制原订单中的完整兑换码，打开本单入口输入卡密，点击“兑换卡密”，核对自动识别的 Grok 档位与所购规格一致。',
    '### 2. 核对账号条件\n按识别出的 Grok 专属指引操作，确认目标为本人美区账号，具备充值半价优惠资格，且没有需要覆盖的现有会员。不要将其他商品的账号教程套用到本单。',
    '### 3. 按页面指引完成充值\n仅在对应兑换表单中按教程自行完成账号验证，核对目标账号、套餐及页面提示后提交。本站订单或客服聊天无需提供账号密码及登录凭据。',
    '### 4. 查询原单并验收\n使用兑换页面的“查充值状态”跟进原单。成功后检查 Grok、X Premium 与 Cursor 对应权益；在账号头像、设置中的账单入口核对记录，并检查套餐到期时间。',
    '### 遇到异常\n仍在处理、充值被拒绝或结果不明时，不要连续重试、换账号重复充值或重新购买。先保留本站订单号与脱敏错误截图联系售后，核实原单状态后继续。30 天订阅异常保障不包含账号封禁。',
  ].join('\n\n')
}
