export const HANFOLK_ORIGIN = 'https://ai.hanfolk.xyz'
export const HANFOLK_API_PATH = '/content/plugins/seller_api/api.php'
export const HANFOLK_FAMILIES = {
  grok: 'Grok',
  gemini: 'Google Gemini',
  muse: 'Muse',
  duolingo: '多邻国',
  'adobe-express': 'Adobe Express',
  'apple-music': 'Apple Music',
  'apple-id': 'Apple ID',
  gmail: 'Google Gmail',
  'capcut-pro': 'CapCut Pro',
} as const
export type HanfolkFamily = keyof typeof HANFOLK_FAMILIES
export type HanfolkProduct = {
  id: number
  title: string
  price: number
  stock: number
  sales: number
  is_auto: boolean
  cover: string
  sort_id: number
}
export type HanfolkDetail = HanfolkProduct & {
  is_sku: boolean
  description: string
  min_qty: number
  max_qty: number
  specs: { title: string; values: { id: string; name: string }[] }[]
  sku_variants: { sku: string; price: number; stock: number }[]
  required_inputs: { key: string; name: string; required: boolean }[]
}
export function hanfolkFamily(title: string): HanfolkFamily | undefined {
  const value = title.toLowerCase()
  if (/grok|gork/.test(value)) return 'grok'
  if (/gemini|谷歌\s*ai|google\s*ai|sheerid.*(?:google|谷歌).*学生认证/.test(value)) return 'gemini'
  if (/muse/.test(value)) return 'muse'
  if (/duolingo|duoingo|多[邻鄰]国/.test(value)) return 'duolingo'
  if (/adobe\s*express/.test(value)) return 'adobe-express'
  if (/apple\s*music|苹果音乐/.test(value)) return 'apple-music'
  if (/apple\s*id|苹果\s*(id|账号|帳號)/.test(value)) return 'apple-id'
  if (/gmail|谷歌邮箱|google\s*mail/.test(value)) return 'gmail'
  if (/capcut(?:\s*pro)?|剪映国际/.test(value)) return 'capcut-pro'
}
export function hanfolkMoney(value: unknown): number {
  const text = String(value)
  if (!/^\d{1,6}(?:\.\d{1,2})?$/.test(text))
    throw new Error('Invalid supplier amount')
  const [whole, fraction = ''] = text.split('.')
  return Number(whole) * 100 + Number(fraction.padEnd(2, '0'))
}

// Imported content remains plain React text. Never execute supplier markup.
export function supplierText(html: string): string {
  return html
    .replace(/<(script|style|iframe|form)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '')
    .replace(/<h[1-6]\b[^>]*>/gi, '\n\n### ')
    .replace(/<\/h[1-6]\s*>/gi, '\n')
    .replace(/<li\b[^>]*>/gi, '\n• ')
    .replace(/<br\s*\/?\s*>/gi, '\n')
    .replace(/<\/(p|div|section|article|ul|ol|table|tr)\s*>/gi, '\n\n')
    .replace(/<[^>]*>/g, '')
    .replace(
      /&(#x[\da-f]+|#\d+|nbsp|amp|lt|gt|quot|apos);/gi,
      (_all, code: string) => {
        const named: Record<string, string> = {
          nbsp: ' ',
          amp: '&',
          lt: '<',
          gt: '>',
          quot: '"',
          apos: "'",
        }
        if (code[0] !== '#') return named[code.toLowerCase()] ?? ''
        const point =
          code[1].toLowerCase() === 'x'
            ? parseInt(code.slice(2), 16)
            : Number(code.slice(1))
        return point >= 32 &&
          point <= 0x10ffff &&
          !(point >= 0xd800 && point <= 0xdfff)
          ? String.fromCodePoint(point)
          : ''
      },
    )
    .replace(/./gs, (c) => {
      const n = c.charCodeAt(0)
      return (n < 32 && ![9, 10, 13].includes(n)) || n === 127 ? '' : c
    })
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}
export function skuName(detail: HanfolkDetail, sku: string) {
  if (!detail.is_sku || sku === '0' || !sku) return detail.title
  const parts = sku.split('-')
  if (parts.length !== detail.specs.length)
    throw new Error('Unmatched supplier SKU')
  const names = detail.specs.map(
    (g, i) => g.values.find((v) => v.id === parts[i])?.name,
  )
  if (names.some((v) => !v)) throw new Error('Unmatched supplier SKU')
  return names.join(' · ')
}
