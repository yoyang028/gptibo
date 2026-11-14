export function promotionAmounts(originalCents: number, availableCents: number, requestedCents: number, newcomerCents: number, otherCents: number, hasCoupon: boolean) {
  if (![originalCents, availableCents, requestedCents, newcomerCents, otherCents].every(n => Number.isSafeInteger(n) && n >= 0) || originalCents === 0) throw new Error('优惠金额无效。')
  if ((newcomerCents && (requestedCents || hasCoupon)) || (requestedCents && hasCoupon)) throw new Error('请在新人优惠、奖励抵扣和普通优惠码中选择一种；多张邀请奖励可以完全叠加。')
  const rewardCents = Math.min(requestedCents, originalCents), cashCents = originalCents - newcomerCents - rewardCents - otherCents
  if (rewardCents > availableCents) throw new Error('可用奖励余额不足或已变化，请刷新后重试。')
  if (cashCents < 0) throw new Error('优惠金额超过当前商品价格。')
  return { rewardCents, cashCents, remainingCents: availableCents - rewardCents }
}
export function promotionPath(originalCents: number, cashCents: number, supplyCents: number, flags: readonly string[]) {
  const discount = originalCents - cashCents
  const reviewStatus = discount >= 10000 || cashCents === 0 || flags.length ? 'required' as const : 'none' as const
  return { reviewStatus, reviewTier: reviewStatus === 'required' ? 'manual' as const : discount > 3000 ? 'enhanced' as const : 'automatic' as const,
    procurementStatus: cashCents === 0 || cashCents < supplyCents ? 'awaiting_supplier' as const : 'ready' as const }
}
