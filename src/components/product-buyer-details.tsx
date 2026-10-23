import { ArrowUpRight } from 'lucide-react'
import { customerProductName } from '@/lib/shop-presentation'
import { storefrontHref } from '@/lib/storefront-routing'
import {
  productCopyLinks,
  type ProductCopyBlock,
} from '../../shared/product-copy'

export function ProductCopyText({ text }: { text: string }) {
  return <>{productCopyLinks(customerProductName(text)).map((part, i) => part.href
    ? part.href.startsWith('/')
      ? <a key={i} href={storefrontHref(part.href.slice(1))}>{part.text}<ArrowUpRight size={11} aria-hidden="true" /></a>
      : <a key={i} href={part.href} target="_blank" rel="noopener noreferrer" aria-label={part.text + '（在新窗口打开）'}>{part.text}<ArrowUpRight size={11} aria-hidden="true" /></a>
    : <span key={i}>{part.text}</span>)}</>
}

export function ProductDescription({ blocks }: { blocks: ProductCopyBlock[] }) {
  return <div className="shop-product-description">
    {blocks.map((block, i) => block.title
      ? <section className="shop-description-section" key={i}>
          <h4>{block.title}</h4>
          <p className="shop-product-copy"><ProductCopyText text={block.text} /></p>
        </section>
      : <p className="shop-product-copy" key={i}><ProductCopyText text={block.text} /></p>)}
  </div>
}
