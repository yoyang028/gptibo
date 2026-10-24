import type { ShopProduct } from '../../shared/shop-products'
import { APPLE_ID_REGION_GROUPS, appleIdRegionGroup, appleIdVariants, appleIdVariantNote } from '../../shared/apple-id-products'
import { inventoryLabel } from '../../shared/product-inventory'
import { customerProductName, variantLabel } from '@/lib/shop-presentation'
import './apple-id.css'

export function AppleIdVariants({ products, selected, onChange }: { products: ShopProduct[]; selected: ShopProduct; onChange: (id: string) => void }) {
  const sorted = appleIdVariants(products)
  const region = appleIdRegionGroup(selected)
  const shown = sorted.filter(p => appleIdRegionGroup(p) === region)
  return <div className="apple-id-choices">
    <span className="section-kicker">选择账号地区</span>
    <div className="apple-id-region-options" role="group" aria-label="Apple ID 账号地区">
      {APPLE_ID_REGION_GROUPS.map(group => {
        const items = sorted.filter(p => appleIdRegionGroup(p) === group.id)
        return items.length > 0 && <button key={group.id} type="button" aria-pressed={region === group.id} onClick={() => onChange(items[0].id)}>{group.name}<small>{items.length}</small></button>
      })}
    </div>
    <fieldset className="shop-product-variants apple-id-specifications">
      <legend>选择账号规格<span>{shown.length} 个规格</span></legend>
      {shown.map(variant => <label className="shop-variant" key={variant.id} data-selected={variant.id === selected.id}>
        <input type="radio" name="product-variant" value={variant.id} aria-label={customerProductName(variant.name)} checked={variant.id === selected.id} onChange={() => onChange(variant.id)} />
        <span><strong>{variantLabel(variant, 'Apple ID')}{inventoryLabel(variant) && <em className="apple-id-stock">（{inventoryLabel(variant)}）</em>}</strong><small>{appleIdVariantNote(variant)}</small></span>
        <strong>{variant.pricePending ? '待定价' : <><small>¥</small>{(variant.priceCents / 100).toFixed(2)}</>}</strong>
      </label>)}
    </fieldset>
  </div>
}
