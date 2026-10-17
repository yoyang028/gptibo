import { ArrowUpRight, KeyRound } from 'lucide-react'
import {
  DELIVERY_COPY_HEADING,
  PENDING_COPY_HEADING,
  productCopyLinks,
  type ProductCopyBlock,
} from '../../shared/product-copy'
import type { ShopProduct } from '../../shared/shop-products'

export function ProductCopyText({ text }: { text: string }) {
  return <>{productCopyLinks(text).map((part, i) => part.href
    ? <a key={i} href={part.href} target="_blank" rel="noopener noreferrer" aria-label={part.text + '（在新窗口打开）'}>{part.text}<ArrowUpRight size={11} aria-hidden="true" /></a>
    : <span key={i}>{part.text}</span>)}</>
}

export function ProductDeliveryNotice({ block }: { block: ProductCopyBlock }) {
  return <section className="product-delivery-notice" aria-label="购买前了解交付与兑换">
    <div className="buyer-notice-heading"><KeyRound size={16} aria-hidden="true" /><h3>交付卡密 · 需到上游网站自行兑换</h3></div>
    <p className="shop-product-copy"><ProductCopyText text={block.text} /></p>
  </section>
}

export function ProductDescription({ blocks }: { blocks: ProductCopyBlock[] }) {
  return <div className="shop-product-description">
    {blocks.filter(block => block.title !== DELIVERY_COPY_HEADING).map((block, i) => block.title
      ? <section className={'shop-description-section' + (block.title === PENDING_COPY_HEADING ? ' product-copy-pending' : '')} key={i}>
          <h4>{block.title}</h4>
          <p className="shop-product-copy"><ProductCopyText text={block.text} /></p>
        </section>
      : <p className="shop-product-copy" key={i}><ProductCopyText text={block.text || '在后台填写商品的详细介绍。'} /></p>)}
  </div>
}

export function ProductSpecComparison({ products, selected }: { products: ShopProduct[]; selected: string }) {
  return <section className="product-spec-comparison" aria-label="规格权益对比">
    <h3>规格与权益对比</h3>
    <p>先看用量与适用条件，再选择下方规格。实际功能受对应平台规则限制。</p>
    <div className="buyer-comparison-scroll">
      <table>
        <caption className="sr-only">各规格的权益、周期和本站售价</caption>
        <thead><tr><th scope="col">规格</th><th scope="col">用量 / 权益</th><th scope="col">周期 / 有效期</th><th scope="col">本站售价</th></tr></thead>
        <tbody>{products.map(product => <tr key={product.id} data-selected={product.id === selected}>
          <th scope="row">{product.name}{product.id === selected && <span className="buyer-selected-label">当前</span>}</th>
          <td data-label="用量 / 权益">{product.features[0]}</td>
          <td data-label="周期 / 有效期">{product.duration}</td>
          <td data-label="本站售价">{product.pricePending ? '待定价' : '¥' + (product.priceCents / 100).toFixed(2)}</td>
        </tr>)}</tbody>
      </table>
    </div>
  </section>
}
