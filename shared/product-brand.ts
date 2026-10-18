export type ClearProductBrand = 'chatgpt' | 'codex' | 'claude' | 'muse'

/** Stable product identities only; never infer a brand from buyer text. */
export function clearProductBrand(id: string): ClearProductBrand | undefined {
  if (['chatgpt', 'openai'].includes(id)) return 'chatgpt'
  if (id === 'claude') return 'claude'
  if (['codex', 'codex-credits', 'codex-sms', 'codex-sms-once'].includes(id))
    return 'codex'
  if (id === 'muse') return 'muse'
}
