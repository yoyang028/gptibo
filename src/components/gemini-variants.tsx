import type { ShopProduct } from '../../shared/shop-products'
import { GEMINI_KINDS, geminiKind, geminiVariants } from '../../shared/gemini-products'
import { inventoryLabel } from '../../shared/product-inventory'
import { variantLabel } from '@/lib/shop-presentation'
import './gemini-guides.css'

export function GeminiVariants({products,selected,onChange}:{products:ShopProduct[];selected:ShopProduct;onChange:(id:string)=>void}) {
  const selectedType=GEMINI_KINDS.find(k=>k.id===geminiKind(selected))
  return <fieldset className="shop-product-variants gemini-specifications"><legend>选择购买类型<span>{products.length} 个规格</span></legend>{geminiVariants(products).map(p=>{
    const kind=geminiKind(p),type=GEMINI_KINDS.find(k=>k.id===kind)!,stock=inventoryLabel(p)
    return <label className="shop-variant" key={p.id} data-selected={p.id===selected.id}>
      <input type="radio" name="product-variant" value={p.id} aria-label={p.name} checked={p.id===selected.id} onChange={()=>onChange(p.id)}/>
      <span><strong>{variantLabel(p,'Gemini',products)}{stock&&<em className="gemini-stock">（{stock}）</em>}</strong><small>{type.note}</small></span>
      <strong>{p.pricePending?'待定价':<><small>¥</small>{(p.priceCents/100).toFixed(2)}</>}</strong>
    </label>
  })}<div className="gemini-choice-note" aria-live="polite"><strong>适合谁 · 稳定性与风险</strong><p>{selectedType?.risk}</p></div></fieldset>
}
