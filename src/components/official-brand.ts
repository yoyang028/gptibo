export const OFFICIAL_BRANDS = {
  gmail: { file: 'gmail-official.svg', mono: false, wide: false, motion: 'drift' },
  grok: { file: 'grok-color.svg', mono: false, wide: false, motion: 'turn' },
  gemini: { file: 'gemini-official.svg', mono: false, wide: false, motion: 'breathe' },
  'adobe-express': { file: 'adobe-express-official.svg', mono: false, wide: false, motion: 'rise' },
  'apple-music': { file: 'apple-music-official.svg', mono: true, wide: true, motion: 'rhythm' },
  'apple-id': { file: 'apple-account-official.svg', mono: false, wide: false, motion: 'drift' },
  'capcut-pro': { file: 'capcut-official.svg', mono: true, wide: false, motion: 'glide' },
} as const
export type OfficialBrandId = keyof typeof OFFICIAL_BRANDS
export function officialBrand(id: string) {
  return OFFICIAL_BRANDS[id as OfficialBrandId]
}
