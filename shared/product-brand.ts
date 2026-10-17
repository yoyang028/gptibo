export type ClearProductBrand = 'chatgpt' | 'codex' | 'muse'

/** Stable product identities only; never infer a brand from buyer text. */
export function clearProductBrand(id: string): ClearProductBrand | undefined {
  if (['chatgpt', 'openai'].includes(id)) return 'chatgpt'
  if (['codex', 'codex-credits', 'codex-sms', 'codex-sms-once'].includes(id))
    return 'codex'
  if (id === 'muse') return 'muse'
}
