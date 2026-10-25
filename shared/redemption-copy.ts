import type { ShopProduct, ShopProductInput } from './shop-products.ts'
import { geminiKind } from './gemini-products.ts'

export const REDEMPTION_FLOW = '付款确认并完成交付后，在原订单领取兑换码、兑换入口和操作指引，按指引自行完成兑换。'
export const STUDENT_VERIFICATION_FLOW = '付款确认并完成交付后，在原订单查看本次认证的办理信息与操作指引，按指引提交本人验证链接并回查结果；不包含 Google 侧会员订阅费用。'

export function needsRedemption(product: Pick<ShopProduct, 'name' | 'groupId'> & { requiresRedemption?: boolean }) {
  return product.requiresRedemption === true ||
    geminiKind(product) === 'student' ||
    ['claude', 'codex-credits', 'duolingo', 'adobe-express', 'apple-music'].includes(product.groupId ?? '') ||
    (!/成品|账户|账号/.test(product.name) && /CDK|兑换码|激活链接/i.test(product.name))
}

/** Public editorial text never contains an external redemption address. */
export function concealRedemptionLinks(text: string) {
  return text
    .replace(/\[([^\]\n]+)\]\(https?:\/\/[^\s)]+\)/g, '$1（入口于付款并交付后在原订单提供）')
    .replace(/https?:\/\/[^\s<>"')，。；]+/gi, '（入口于付款并交付后提供）')
    .replace(/(?:www\.)?(?:vip\.dajuai\.us|owlduo\.com|982xj\.xyz)(?:\/[^\s<>"')，。；]*)?/gi, '订单内兑换入口')
    .replace(/OwlDuo|大桔兑换站|大橘兑换站|小久自助兑换站|小久兑换站/gi, '随单兑换入口')
}

export function publicBuyerProduct<T extends ShopProduct>(product: T): T {
  product = { ...product }
  delete (product as ShopProductInput).redemptionGuide
  if (!needsRedemption(product)) return product
  const student = geminiKind(product) === 'student'
  const description = product.description.replace(/(### (?:卡密交付与站外兑换|交付内容与使用方式|交付与使用)\n)[\s\S]*?(?=\n\n### |$)/g, '$1' + REDEMPTION_FLOW)
  return {
    ...product,
    requiresRedemption: true,
    description: concealRedemptionLinks(description),
    tagline: concealRedemptionLinks(product.tagline),
    features: product.features.map(concealRedemptionLinks),
    purchaseNote: concealRedemptionLinks(product.purchaseNote),
    deliveryInstructions: student ? STUDENT_VERIFICATION_FLOW : REDEMPTION_FLOW,
    buyerHighlights: product.buyerHighlights?.map(concealRedemptionLinks),
    buyerWarnings: product.buyerWarnings?.map(concealRedemptionLinks),
    steps: student ? [
      { title: '先确认本人资格', description: '使用自己的 Google 账号和真实在读信息，准备完整、未过期且未重复提交的验证链接。' },
      { title: '付款后按原单办理', description: '付款确认并交付后，原订单提供办理信息与操作指引；结果不明时先回查，不重复付款或提交。' },
      { title: '回到 Google 开通', description: '资格通过后仍需在 Google 按提示绑卡、选择方案，核对费用和续费日期；本服务不直接交付会员。' },
    ] : [
      { title: '选择规格', description: '根据使用需求选择档位，先阅读账号条件与购买须知，再核对订单信息。' },
      { title: '付款后领取', description: '付款确认后处理交付，兑换码、兑换入口和完整操作指引统一保存在原订单中。' },
      { title: '兑换并使用', description: '按随单指引核对目标账号，完成兑换后检查权益到账情况；遇到异常可凭原订单联系售后。' },
    ],
    faq: product.faq.map(item => ({ ...item, answer: concealRedemptionLinks(item.answer) })),
  }
}

/** Used only by server import/edit paths, before sanitizing public copy. */
export function redemptionGuideFromProduct(product: ShopProduct) {
  if (!needsRedemption(product)) return ''
  const instructions = [product.deliveryInstructions, ...product.steps.map(s => s.description)].join('\n')
  if (!/https?:\/\//i.test(instructions)) return ''
  return [
    product.name,
    product.deliveryInstructions,
    ...product.steps.map(s => '### ' + s.title + '\n' + s.description),
    ...product.faq.filter(f => /https?:\/\//i.test(f.answer)).map(f => '### ' + f.question + '\n' + f.answer),
  ].join('\n\n')
}
