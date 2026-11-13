export const INVITATION_REWARD_CENTS = 1000
export const NEWCOMER_DISCOUNT_CENTS = 500
export const REWARD_OBSERVATION_MS = 24 * 60 * 60 * 1000
export const INVITATION_PLANS = ['plus', 'pro-5x', 'pro-20x', 'pro-25x'] as const
export type PromotionSelection = { inviteCode: string; newcomer: boolean; rewardCents: number }
export type PromotionView = {
  originalCents: number; newcomerCents: number; rewardCents: number; cashCents: number; otherCents: number
  reviewStatus: 'none' | 'required' | 'approved' | 'rejected'
  procurementStatus: 'ready' | 'awaiting_supplier'; allocationStatus: string; message: string
}
export type PromotionQuote = PromotionView & {
  availableCents: number; newcomerEligible: boolean; inviteValid: boolean; selection: PromotionSelection
}
export function twoCalendarMonths(value: number) {
  // Business time is Asia/Shanghai. Preserve local clock time, clamp month ends.
  const d = new Date(value + 8 * 3600000), day = d.getUTCDate()
  d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() + 2)
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate()
  d.setUTCDate(Math.min(day, last))
  return d.getTime() - 8 * 3600000
}
