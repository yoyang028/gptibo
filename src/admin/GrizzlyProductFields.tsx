import { Input } from '@/components/ui/input'
import {
  GRIZZLY_SERVICES,
  GRIZZLY_USA,
  grizzlyCostCents,
} from '../../shared/grizzly-sms'
import type { ShopProduct } from '../../shared/shop-products'

export function GrizzlyProductFields({
  api,
  onChange,
}: {
  api: NonNullable<ShopProduct['api']>
  onChange: (value: NonNullable<ShopProduct['api']>) => void
}) {
  const sms = api.sms ?? {
    country: GRIZZLY_USA,
    maxPriceUsd: '',
    cnyPerUsd: '',
  }
  function update(key: 'maxPriceUsd' | 'cnyPerUsd', value: string) {
    const next = { ...sms, [key]: value }
    let maxCostCents: number | undefined
    try {
      maxCostCents = grizzlyCostCents(next.maxPriceUsd, next.cnyPerUsd)
    } catch {
      /* A partially typed value is not a valid cost limit. */
    }
    onChange({ ...api, sms: next, maxCostCents, verified: false })
  }
  return (
    <>
      <label>
        接码项目
        <select
          value={api.productCode}
          onChange={(e) =>
            onChange({ ...api, productCode: e.target.value, verified: false })
          }
        >
          <option value="" disabled>
            选择项目
          </option>
          {Object.entries(GRIZZLY_SERVICES).map(([code, name]) => (
            <option key={code} value={code}>
              {name}
            </option>
          ))}
        </select>
      </label>
      <label>
        国家
        <Input readOnly value="美国（187，非虚拟地区 12）" />
      </label>
      <div className="owner-editor-grid">
        <label>
          单次最高采购价（美元）
          <Input
            type="number"
            min="0.000001"
            max="1000"
            step="0.000001"
            value={sms.maxPriceUsd}
            onChange={(e) => update('maxPriceUsd', e.target.value)}
          />
        </label>
        <label>
          成本核算汇率（人民币／美元）
          <Input
            type="number"
            min="0.0001"
            max="100"
            step="0.0001"
            value={sms.cnyPerUsd}
            onChange={(e) => update('cnyPerUsd', e.target.value)}
          />
        </label>
      </div>
      <p className="owner-editor-notice">
        美元上限会随取号请求提交。人民币最高采购成本根据你填写的成本汇率向上取整，用于校验售价及优惠码。取号结果不明时暂停原单，不再次购买号码。只读检查仅查询余额与项目报价。
      </p>
    </>
  )
}
