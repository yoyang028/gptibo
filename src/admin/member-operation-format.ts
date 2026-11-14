export const money = (n: number | null | undefined) => n == null ? '—' : `¥${(n / 100).toFixed(2)}`
export const at = (n: number) => n ? new Date(n).toLocaleString('zh-CN') : '尚未核对'
