import { safeHttps } from './shop-products.ts'

export const DELIVERY_COPY_HEADING = '卡密交付与站外兑换'
export const PENDING_COPY_HEADING = '待核实信息'

export type ProductCopyBlock = { title: string; text: string }

export function productCopyBlocks(text: string): ProductCopyBlock[] {
  return text.trim().split(/\r?\n\s*\r?\n/).map(block => {
    const [firstLine, ...lines] = block.split(/\r?\n/)
    return firstLine.startsWith('### ') && lines.some(line => line.trim())
      ? { title: firstLine.slice(4).trim(), text: lines.join('\n') }
      : { title: '', text: block }
  })
}

// This is a small text format, not an HTML/Markdown interpreter. Links are
// explicit author-entered HTTPS URLs; no images, embeds or active HTML exist.
export function productCopyLinks(text: string): { text: string; href?: string }[] {
  const parts: { text: string; href?: string }[] = []
  const links = /\[([^\]\n]{1,120})\]\((https?:\/\/[^\s)]+)\)/g
  let offset = 0
  for (const match of text.matchAll(links)) {
    if (match.index > 0 && text[match.index - 1] === '!') continue
    parts.push({ text: text.slice(offset, match.index) })
    parts.push(safeHttps(match[2])
      ? { text: match[1], href: match[2] }
      : { text: match[0] })
    offset = match.index + match[0].length
  }
  parts.push({ text: text.slice(offset) })
  return parts
}
