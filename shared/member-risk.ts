export const RISK_WINDOW_MS = 86400000
export type RiskMetrics = { totalOrders: number; unpaidOrders: number; repeatedReservations: number; activeReservations: number; ipOrders: number }
export const RISK_LABELS: Record<string, string> = { many_unpaid_orders: '24小时内大量未付款订单', repeated_reservation: '24小时内反复占券后取消', many_reserved_orders: '同时占用多笔优惠订单', shared_ip_volume: '同一网络近期订单较多（仅辅助）', self_invitation: '疑似自邀', target_repeat: '充值目标重复', frequent_redemption: '短期频繁抵扣', late_payment: '释放后迟到付款', simulated_anomaly: '模拟其他异常' }
export function riskFlags(m: RiskMetrics) {
  const flags: string[] = []
  if (m.unpaidOrders >= 10) flags.push('many_unpaid_orders')
  if (m.repeatedReservations >= 5) flags.push('repeated_reservation')
  if (m.activeReservations >= 5) flags.push('many_reserved_orders')
  if (flags.length && m.ipOrders >= 20) flags.push('shared_ip_volume')
  return flags
}
