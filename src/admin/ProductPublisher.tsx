import { freshProduct } from './product-draft'
import { ProductArtworkSettingsButton } from './ProductArtworkSettings'
import { useEffect, useRef, useState } from 'react'
import {
  Eye,
  ImagePlus,
  Package,
  Plus,
  RefreshCw,
  Save,
  Upload,
  X,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { api, errorMessage } from '@/lib/api'
import { useResource } from '@/lib/use-resource'
import { prepareLogo } from '@/lib/prepare-logo'
import { ShopProductPage } from '@/components/shop-product-page'
import {
  productProblems,
  SHOP_PRODUCT_GROUPS,
  type ShopProduct,
  type ShopProductInput,
  type ShopProductGroupId,
} from '../../shared/shop-products'
import '@/components/shop-products.css'
import { GrizzlyProductFields } from './GrizzlyProductFields'
import { ProductMark } from '@/components/brand'
import { clearProductBrand } from '../../shared/product-brand'
import {
  SMS_PRODUCT_IDS,
  GRIZZLY_ORIGIN,
  GRIZZLY_USA,
} from '../../shared/grizzly-sms'

const statuses = {
  draft: '草稿',
  listed: '展示中 · 未开售',
  published: '已发布',
  archived: '已下架',
}
type XiaojiuCatalog = {
  items: {
    productId: number
    skuId: number
    name: string
    skuCode: string
    specification: string
    priceCents: number
    stock: number
    available: boolean
  }[]
  balanceCents: number
  page: number
  pageSize: number
  total: number
}
export function ProductEditor({
  initial,
  onClose,
  onSaved,
  listingOnly = false,
}: {
  initial: ShopProductInput
  onClose: () => void
  onSaved: () => void
  listingOnly?: boolean
}) {
  const [product, setProduct] = useState(initial),
    [apiToken, setApiToken] = useState(''),
    [apiKey, setApiKey] = useState(''),
    [features, setFeatures] = useState(initial.features.join('\n')),
    [buyerHighlights, setBuyerHighlights] = useState((initial.buyerHighlights ?? []).join('\n')),
    [buyerWarnings, setBuyerWarnings] = useState((initial.buyerWarnings ?? []).join('\n')),
    [redemptionGuide, setRedemptionGuide] = useState(initial.redemptionGuide ?? ''),
    [price, setPrice] = useState(
      initial.pricePending ? '' : (initial.priceCents / 100).toFixed(2),
    ),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [message, setMessage] = useState(''),
    [preview, setPreview] = useState(false),
    [discard, setDiscard] = useState(false)
  const [baseline, setBaseline] = useState(JSON.stringify(initial))
  const [supplierCatalog, setSupplierCatalog] = useState<XiaojiuCatalog | null>(
    null,
  )
  const imageInput = useRef<HTMLInputElement>(null),
    qrInput = useRef<HTMLInputElement>(null),
    submitting = useRef(false)
  const value = {
    ...product,
    ...(product.redemptionGuide !== undefined || redemptionGuide.trim() ? { redemptionGuide } : {}),
    priceCents:
      product.pricePending && !price.trim()
        ? product.priceCents
        : Math.round(Number(price) * 100),
    ...(product.pricePending !== undefined
      ? { pricePending: product.pricePending && !price.trim() }
      : {}),
    badge:
      product.pricePending && price.trim() && product.badge === '待定价草稿'
        ? '规格可选'
        : product.badge,
    features: features
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean),
    ...(product.buyerHighlights !== undefined || buyerHighlights.trim() ? {
      buyerHighlights: buyerHighlights.split('\n').map(s=>s.trim()).filter(Boolean),
    } : {}),
    ...(product.buyerWarnings !== undefined || buyerWarnings.trim() ? {
      buyerWarnings: buyerWarnings.split('\n').map(s=>s.trim()).filter(Boolean),
    } : {}),
  }
  const dirty =
    JSON.stringify(value) !== baseline || Boolean(apiToken) || Boolean(apiKey)
  useEffect(() => {
    if (!dirty) return
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])
  function update<K extends keyof ShopProduct>(key: K, next: ShopProduct[K]) {
    setProduct((p) => ({ ...p, [key]: next }))
    setError('')
    setMessage('')
  }
  async function image(file: File, kind: 'image' | 'qr') {
    setBusy(true)
    setError('')
    try {
      const result = await prepareLogo(file, kind === 'qr' ? 1024 : 512)
      if (kind === 'image') update('image', result)
      else update('payment', { ...product.payment, qr: result })
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }
  async function save(
    action: 'draft' | 'listed' | 'published' | 'archived' | 'verify',
  ) {
    if (busy || submitting.current) return
    if (
      !(
        product.pricePending &&
        !price.trim() &&
        ['draft', 'archived', 'listed'].includes(action)
      ) &&
      !/^\d+(\.\d{1,2})?$/.test(price)
    ) {
      setError('售价最多保留两位小数。')
      return
    }
    const outgoing = {
      ...value,
      status: action === 'verify' ? ('draft' as const) : action,
      ...(action === 'listed' && value.pricePending
        ? { catalogPreview: true }
        : {}),
    }
    const problems = productProblems({
      ...outgoing,
      ...(action === 'published' && product.delivery === 'api'
        ? { api: { ...product.api!, verified: product.api?.verified ?? false } }
        : {}),
    })
    if (action !== 'verify' && problems.length) {
      setError('请补全：' + problems.join('、'))
      return
    }
    submitting.current = true
    setBusy(true)
    setError('')
    setMessage('')
    try {
      const result = await api<{
        product: ShopProduct
        supplierQuote?: { balanceUsd: string; priceUsd: string; count: number }
      }>(
        '/api/admin/my-shop/products' +
          (action === 'verify' ? '/verify-api' : ''),
        {
          ...outgoing,
          credentialSource: apiToken || apiKey ? undefined : product.credentialSource,
          ...(apiToken ? { apiToken } : {}),
          ...(apiKey ? { apiKey } : {}),
        },
      )
      setProduct(result.product)
      setRedemptionGuide((result.product as ShopProductInput).redemptionGuide ?? '')
      setFeatures(result.product.features.join('\n'))
      setPrice(
        result.product.pricePending
          ? ''
          : (result.product.priceCents / 100).toFixed(2),
      )
      setApiToken('')
      setApiKey('')
      setBaseline(JSON.stringify(result.product))
      setMessage(
        action === 'verify'
          ? result.supplierQuote
            ? `只读检查通过并已保存：供货报价 US$ ${result.supplierQuote.priceUsd}，可用 ${result.supplierQuote.count} 个，账户余额 US$ ${result.supplierQuote.balanceUsd}。`
            : '供货目录只读检查通过，配置已保存。'
          : action === 'published'
            ? '商品已发布，前台目录与详情已更新。'
            : '商品已保存。',
      )
      onSaved()
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      submitting.current = false
      setBusy(false)
    }
  }
  async function loadSupplierCatalog(page = 1) {
    if (busy || submitting.current) return
    submitting.current = true
    setBusy(true)
    setError('')
    try {
      const result = await api<XiaojiuCatalog>(
        '/api/admin/my-shop/products/xiaojiu-catalog',
        {
          id: product.id,
          version: product.version,
          page,
          ...(apiKey ? { apiKey } : {}),
          ...(apiToken ? { apiToken } : {}),
        },
      )
      setSupplierCatalog(result)
      setMessage('已读取小久余额与商品目录，未创建采购订单。')
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      submitting.current = false
      setBusy(false)
    }
  }
  const close = () => {
    if (!busy) {
      if (dirty) setDiscard(true)
      else onClose()
    }
  }
  return (
    <>
      <Dialog
        open
        onOpenChange={(open) => {
          if (!open) close()
        }}
      >
        <DialogContent
          className="owner-product-editor motion-dialog"
          showCloseButton={!busy}
        >
          <DialogHeader>
            <DialogTitle>{product.id ? '编辑商品' : '发布新商品'}</DialogTitle>
            <DialogDescription>
              {listingOnly
                ? '先确认零售价并核对源商品条件、使用步骤与售后规则，再选择仅展示；代理采购和收款暂未开放。'
                : '保存草稿后可继续编辑；发布前必须补全商品展示、购买须知、收款和交付信息。'}
            </DialogDescription>
          </DialogHeader>
          <form
            className="shop-product-form"
            onSubmit={(e) => {
              e.preventDefault()
              void save('draft')
            }}
          >
            <fieldset disabled={busy} className="owner-editor-section">
              <legend>商品展示</legend>
              <div className="owner-editor-grid">
                <label>
                  重点信息（每行一项，最多6项）
                  <textarea
                    rows={3}
                    value={buyerHighlights}
                    onChange={(e) => setBuyerHighlights(e.target.value)}
                    maxLength={1400}
                  />
                </label>
                <label>
                  购买提醒（每行一项，最多6项）
                  <textarea
                    rows={3}
                    value={buyerWarnings}
                    onChange={(e) => setBuyerWarnings(e.target.value)}
                    maxLength={1400}
                  />
                </label>
              </div>
              <div className="owner-editor-grid">
                <label>
                  商品名称
                  <Input
                    value={product.name}
                    onChange={(e) => update('name', e.target.value)}
                    maxLength={80}
                    required
                  />
                </label>
                <label>
                  分类
                  <Input
                    value={product.category}
                    onChange={(e) => update('category', e.target.value)}
                    maxLength={40}
                  />
                </label>
                <label>
                  前台商品分组
                  <select
                    value={product.groupId ?? ''}
                    onChange={(e) =>
                      update(
                        'groupId',
                        e.target.value
                          ? (e.target.value as ShopProductGroupId)
                          : undefined,
                      )
                    }
                  >
                    <option value="">独立商品卡片</option>
                    {Object.entries(SHOP_PRODUCT_GROUPS).map(([id, name]) => (
                      <option key={id} value={id}>
                        {name}
                      </option>
                    ))}
                  </select>
                  <small>同组规格合并为一张首页卡片，进入详情后选择。</small>
                </label>
                <label>
                  规格／服务周期
                  <Input
                    value={product.duration}
                    onChange={(e) => update('duration', e.target.value)}
                    placeholder="例如：Claude Pro · 1 个月"
                    maxLength={80}
                  />
                </label>
                <label>
                  计价单位
                  <Input
                    value={product.unit}
                    onChange={(e) => update('unit', e.target.value)}
                    placeholder="份、月、次"
                    maxLength={40}
                  />
                </label>
                <label>
                  售价（元）
                  <Input
                    value={price}
                    onChange={(e) => setPrice(e.target.value)}
                    inputMode="decimal"
                    required={!product.pricePending}
                    placeholder={
                      product.pricePending
                        ? '待定价，留空可保存草稿'
                        : undefined
                    }
                    pattern="[0-9]+(\.[0-9]{1,2})?"
                  />
                </label>
                <label>
                  可售库存（-1 不限量）
                  <Input
                    type="number"
                    min={-1}
                    max={1000000}
                    value={product.stock}
                    onChange={(e) => update('stock', Number(e.target.value))}
                  />
                </label>
              </div>
              <label>
                短介绍
                <Input
                  value={product.tagline}
                  onChange={(e) => update('tagline', e.target.value)}
                  maxLength={160}
                />
              </label>
              <label>
                详细说明
                <textarea
                  rows={5}
                  value={product.description}
                  onChange={(e) => update('description', e.target.value)}
                  maxLength={4000}
                />
              </label>
              <label>
                商品标签
                <Input
                  value={product.badge}
                  onChange={(e) => update('badge', e.target.value)}
                  maxLength={40}
                />
              </label>
              <label>
                商品特点（每行一项，最多 12 项）
                <textarea
                  rows={4}
                  value={features}
                  onChange={(e) => setFeatures(e.target.value)}
                  maxLength={2000}
                />
              </label>
              <div>
                {clearProductBrand(product.groupId ?? product.id) ? (
                  <ProductMark productId={product.groupId ?? product.id} />
                ) : product.image ? (
                  <img
                    className="shop-product-icon"
                    src={product.image}
                    alt="商品图片预览"
                  />
                ) : (
                  <ImagePlus size={28} />
                )}
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => imageInput.current?.click()}
                >
                  <Upload size={14} />
                  上传商品图片
                </Button>
                <input
                  ref={imageInput}
                  type="file"
                  hidden
                  accept="image/png,image/jpeg"
                  onChange={(e) => {
                    const f = e.target.files?.[0]
                    e.target.value = ''
                    if (f) void image(f, 'image')
                  }}
                />
              </div>
            </fieldset>
            <fieldset disabled={busy} className="owner-editor-section">
              <legend>购买与交付</legend>
              <label>
                购买须知与售后范围
                <textarea
                  rows={5}
                  value={product.purchaseNote}
                  onChange={(e) => update('purchaseNote', e.target.value)}
                  maxLength={4000}
                  placeholder="购买条件、适用范围、预计时间、退款及售后规则"
                />
              </label>
              <label>
                交付说明
                <textarea
                  rows={4}
                  value={product.deliveryInstructions}
                  onChange={(e) =>
                    update('deliveryInstructions', e.target.value)
                  }
                  maxLength={4000}
                />
              </label>
              <label>
                付款后兑换入口与完整指引（私有）
                <textarea rows={8} maxLength={12000} value={redemptionGuide} onChange={e=>setRedemptionGuide(e.target.value)} />
                <small>仅在服务端确认到账且订单已交付兑换码后提供给该买家；不会出现在公开商品资料或未付款订单中。</small>
              </label>
              <label>
                交付方式
                <select
                  value={product.delivery}
                  onChange={(e) => {
                    const delivery = e.target.value as ShopProduct['delivery']
                    setProduct((p) => ({
                      ...p,
                      delivery,
                      ...(delivery === 'manual'
                        ? {
                            api: undefined,
                            payment: { ...p.payment, provider: undefined },
                          }
                        : {}),
                    }))
                  }}
                >
                  <option value="manual">
                    自有商品 · 人工交付账号／卡密／链接／服务
                  </option>
                  <option value="api">其他供应商 · JSON v1 API 自动供货</option>
                </select>
              </label>
              <p className="owner-editor-notice">
                {product.api?.provider === 'grizzly'
                  ? '灰熊接码使用订单专属支付宝付款码，服务端确认到账后自动分配号码。'
                  : '已接入的 ChatGPT 使用原有平台代收与直充流程。其他新增商品使用下方配置的收款方式，店主确认到账后进入交付。'}
              </p>
              {product.delivery === 'api' && (
                <>
                  <label>
                    供货来源
                    <select
                      value={product.api?.provider ?? 'json-v1'}
                      onChange={(e) => {
                        const provider = e.target.value as
                          'json-v1' | 'xiaojiu' | 'grizzly'
                        setApiToken('')
                        setApiKey('')
                        setSupplierCatalog(null)
                        const nextApi: NonNullable<ShopProduct['api']> = {
                          provider,
                          baseUrl:
                            provider === 'xiaojiu'
                              ? 'https://98-xj.com'
                              : provider === 'grizzly'
                                ? GRIZZLY_ORIGIN
                                : '',
                          productCode: '',
                          configured: false,
                          verified: false,
                          ...(provider === 'grizzly'
                            ? {
                                sms: {
                                  country: GRIZZLY_USA,
                                  maxPriceUsd: '',
                                  cnyPerUsd: '',
                                },
                              }
                            : {}),
                        }
                        setProduct((p) => ({
                          ...p,
                          api: nextApi,
                          payment: {
                            ...p.payment,
                            provider:
                              provider === 'grizzly' ? 'alipay' : undefined,
                          },
                        }))
                      }}
                    >
                      <option value="json-v1">通用 JSON v1 供货</option>
                      <option value="xiaojiu">小久 · 钱包余额采购</option>
                      <option value="grizzly">灰熊 SMS · 美国单次接码</option>
                    </select>
                  </label>
                  <label>
                    供货 API 基础地址
                    <Input
                      type="url"
                      readOnly={['xiaojiu', 'grizzly'].includes(
                        product.api?.provider ?? '',
                      )}
                      placeholder="https://supplier.example.com/v1"
                      value={product.api?.baseUrl ?? ''}
                      onChange={(e) =>
                        update('api', {
                          ...product.api,
                          baseUrl: e.target.value,
                          productCode: product.api?.productCode ?? '',
                          configured: product.api?.configured ?? false,
                          verified: false,
                        })
                      }
                    />
                  </label>
                  {product.api?.provider === 'xiaojiu' && (
                    <label>
                      小久商品 ID
                      <Input
                        type="number"
                        min="1"
                        step="1"
                        value={product.api.supplierProductId ?? ''}
                        onChange={(e) =>
                          update('api', {
                            ...product.api!,
                            supplierProductId: Number(e.target.value),
                            verified: false,
                          })
                        }
                      />
                    </label>
                  )}
                  {product.api?.provider === 'grizzly' ? (
                    <GrizzlyProductFields
                      api={product.api}
                      onChange={(value) => update('api', value)}
                    />
                  ) : (
                    <label>
                      {product.api?.provider === 'xiaojiu'
                        ? '小久 SKU ID（规格编号）'
                        : '上游商品编码'}
                      <Input
                        value={product.api?.productCode ?? ''}
                        maxLength={100}
                        onChange={(e) =>
                          update('api', {
                            ...product.api,
                            baseUrl: product.api?.baseUrl ?? '',
                            productCode: e.target.value,
                            configured: product.api?.configured ?? false,
                            verified: false,
                          })
                        }
                      />
                    </label>
                  )}
                  <label>
                    {product.api?.provider === 'xiaojiu'
                      ? '采购参考上限（元）'
                      : '最高采购成本（元）'}
                    <Input
                      type="number"
                      readOnly={product.api?.provider === 'grizzly'}
                      step="0.01"
                      min="0.01"
                      max="100000"
                      value={
                        product.api?.maxCostCents != null
                          ? product.api.maxCostCents / 100
                          : ''
                      }
                      onChange={(e) =>
                        update('api', {
                          ...product.api,
                          baseUrl: product.api?.baseUrl ?? '',
                          productCode: product.api?.productCode ?? '',
                          configured: product.api?.configured ?? false,
                          verified: false,
                          maxCostCents: Math.round(
                            Number(e.target.value) * 100,
                          ),
                        })
                      }
                    />
                  </label>
                  {product.api?.provider === 'xiaojiu' && (
                    <>
                      <p className="owner-editor-notice">
                        使用小久钱包余额按单购买，每单采购一份。上游不提供锁价参数；系统采购前核价，实际扣款超限时保留原单并暂停自动处理。只读检查不会购买或扣款。
                      </p>
                      <label>
                        小久 API Key
                        <Input
                          type="password"
                          autoComplete="new-password"
                          value={apiKey}
                          maxLength={64}
                          placeholder={
                            product.api.configured
                              ? '已加密保存；更换时同时填写 Key 与 Secret'
                              : '个人中心上方采购 API 的 64 位 Key'
                          }
                          onChange={(e) => {
                            setApiKey(e.target.value)
                            update('api', { ...product.api!, verified: false })
                          }}
                        />
                      </label>
                    </>
                  )}
                  <label>
                    {product.api?.provider === 'xiaojiu'
                      ? '小久 API Secret（完整原文）'
                      : '服务端 API 密钥'}
                    <Input
                      type="password"
                      autoComplete="new-password"
                      value={apiToken}
                      onChange={(e) => {
                        setApiToken(e.target.value)
                        if (product.api)
                          update('api', {
                            ...product.api,
                            verified: false,
                            configured:
                              Boolean(e.target.value) || product.api.configured,
                          })
                      }}
                      placeholder={
                        product.api?.configured
                          ? '已加密保存，留空保留原值'
                          : '仅在服务端保存，不会发送到前台'
                      }
                      maxLength={4000}
                    />
                  </label>
                  {product.api?.provider === 'xiaojiu' && (
                    <>
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => void loadSupplierCatalog()}
                      >
                        读取小久余额与商品目录
                      </Button>
                      {supplierCatalog && (
                        <>
                          <p role="status">
                            小久钱包可用余额：¥
                            {(supplierCatalog.balanceCents / 100).toFixed(2)} ·
                            当前第 {supplierCatalog.page} 页
                          </p>
                          <label>
                            从小久目录选择商品规格
                            <select
                              aria-label="从小久目录选择商品规格"
                              value={
                                supplierCatalog.items.some(
                                  (item) =>
                                    item.productId ===
                                      product.api?.supplierProductId &&
                                    String(item.skuId) ===
                                      product.api?.productCode,
                                )
                                  ? `${product.api.supplierProductId}:${product.api.productCode}`
                                  : ''
                              }
                              onChange={(e) => {
                                const selected = supplierCatalog.items.find(
                                  (item) =>
                                    `${item.productId}:${item.skuId}` ===
                                    e.target.value,
                                )
                                if (selected)
                                  update('api', {
                                    ...product.api!,
                                    supplierProductId: selected.productId,
                                    productCode: String(selected.skuId),
                                    maxCostCents: selected.priceCents,
                                    verified: false,
                                  })
                              }}
                            >
                              <option value="" disabled>
                                选择商品与规格（自动填入编号和当前供货价）
                              </option>
                              {supplierCatalog.items.map((item) => (
                                <option
                                  key={`${item.productId}:${item.skuId}`}
                                  value={`${item.productId}:${item.skuId}`}
                                  disabled={!item.available}
                                >
                                  {item.name} ·{' '}
                                  {item.specification ||
                                    item.skuCode ||
                                    item.skuId}{' '}
                                  · ¥{(item.priceCents / 100).toFixed(2)} ·{' '}
                                  {item.available
                                    ? item.stock === -1
                                      ? '不限库存'
                                      : `库存 ${item.stock}`
                                    : '缺货'}
                                </option>
                              ))}
                            </select>
                          </label>
                          <div className="owner-editor-grid">
                            <Button
                              type="button"
                              variant="outline"
                              disabled={supplierCatalog.page <= 1}
                              onClick={() =>
                                void loadSupplierCatalog(
                                  supplierCatalog.page - 1,
                                )
                              }
                            >
                              上一页
                            </Button>
                            <Button
                              type="button"
                              variant="outline"
                              disabled={
                                supplierCatalog.page *
                                  supplierCatalog.pageSize >=
                                supplierCatalog.total
                              }
                              onClick={() =>
                                void loadSupplierCatalog(
                                  supplierCatalog.page + 1,
                                )
                              }
                            >
                              下一页
                            </Button>
                          </div>
                        </>
                      )}
                    </>
                  )}
                  {!['xiaojiu', 'grizzly'].includes(
                    product.api?.provider ?? '',
                  ) && (
                    <details className="owner-editor-notice">
                      <summary>JSON v1 供货接口格式</summary>
                      <p>
                        需支持 GET /products 返回 products 列表，包含
                        product_code 与 available；POST /orders 接收
                        merchant_order_no、product_code、email、fields 和
                        Idempotency-Key；GET /orders/订单编号
                        查询同一订单。订单响应必须包含
                        merchant_order_no、order_id、status（pending／success／failed）；成功时提供
                        delivery_content。超时只查询原单，不重新采购。不同协议的供应商需先适配此契约。
                      </p>
                    </details>
                  )}
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => void save('verify')}
                  >
                    只读检查供货目录并保存配置
                  </Button>
                  <p role="status">
                    {product.api?.verified
                      ? '供货配置已验证'
                      : '发布前需完成供货目录验证'}
                  </p>
                </>
              )}
              <strong>客户下单时补充的信息</strong>
              {product.fields.map((field, i) => (
                <div className="owner-editor-grid" key={i}>
                  {product.delivery === 'api' && (
                    <label>
                      接口字段名
                      <Input
                        value={field.key}
                        onChange={(e) =>
                          update(
                            'fields',
                            product.fields.map((v, j) =>
                              j === i ? { ...v, key: e.target.value } : v,
                            ),
                          )
                        }
                        maxLength={32}
                      />
                    </label>
                  )}
                  <label>
                    字段名称
                    <Input
                      value={field.label}
                      maxLength={60}
                      onChange={(e) =>
                        update(
                          'fields',
                          product.fields.map((v, j) =>
                            j === i ? { ...v, label: e.target.value } : v,
                          ),
                        )
                      }
                    />
                  </label>
                  <div>
                    <label className="shop-product-check">
                      <input
                        type="checkbox"
                        checked={field.required}
                        onChange={(e) =>
                          update(
                            'fields',
                            product.fields.map((v, j) =>
                              j === i
                                ? { ...v, required: e.target.checked }
                                : v,
                            ),
                          )
                        }
                      />
                      必填
                    </label>
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={() =>
                        update(
                          'fields',
                          product.fields.filter((_, j) => j !== i),
                        )
                      }
                    >
                      <X size={14} />
                      移除
                    </Button>
                  </div>
                </div>
              ))}
              <Button
                type="button"
                variant="outline"
                disabled={product.fields.length >= 8}
                onClick={() =>
                  update('fields', [
                    ...product.fields,
                    {
                      key:
                        'field_' +
                        crypto.randomUUID().slice(0, 8).replaceAll('-', ''),
                      label: '',
                      required: true,
                    },
                  ])
                }
              >
                <Plus size={14} />
                添加下单信息
              </Button>
              <p className="owner-editor-notice">
                仅收集必要的账号标识或需求；不要在商品表单中索取密码、Session 或
                API 密钥。
              </p>
            </fieldset>
            <fieldset disabled={busy} className="owner-editor-section">
              <legend>收款方式</legend>
              {product.api?.provider === 'grizzly' && (
                <p className="owner-editor-notice">
                  支付宝自动收款：付款码按订单生成，无需上传个人收款码。正式开放前须在服务端配置商户、验签公钥、回调域名与收款开关。
                </p>
              )}
              <label>
                收款名称
                <Input
                  value={product.payment.label}
                  onChange={(e) =>
                    update('payment', {
                      ...product.payment,
                      label: e.target.value,
                    })
                  }
                  placeholder="例如：支付宝 · 店主核对到账"
                  maxLength={80}
                />
              </label>
              <label>
                付款说明
                <textarea
                  rows={3}
                  value={product.payment.instructions}
                  onChange={(e) =>
                    update('payment', {
                      ...product.payment,
                      instructions: e.target.value,
                    })
                  }
                  maxLength={2000}
                  placeholder="填写收款方、金额核对要求和付款备注规则"
                />
              </label>
              {product.api?.provider !== 'grizzly' && (
                <>
                  <label>
                    收款链接（与二维码至少填一项）
                    <Input
                      type="url"
                      value={product.payment.url}
                      onChange={(e) =>
                        update('payment', {
                          ...product.payment,
                          url: e.target.value,
                        })
                      }
                      placeholder="https://…"
                    />
                  </label>
                  <div>
                    {product.payment.qr && (
                      <img
                        className="shop-product-icon"
                        src={product.payment.qr}
                        alt="收款码预览"
                      />
                    )}
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => qrInput.current?.click()}
                    >
                      <Upload size={14} />
                      上传收款二维码
                    </Button>
                    <input
                      ref={qrInput}
                      type="file"
                      hidden
                      accept="image/png,image/jpeg"
                      onChange={(e) => {
                        const f = e.target.files?.[0]
                        e.target.value = ''
                        if (f) void image(f, 'qr')
                      }}
                    />
                  </div>
                </>
              )}
            </fieldset>
            <fieldset disabled={busy} className="owner-editor-section">
              <legend>交付流程与常见问题</legend>
              {product.steps.map((step, i) => (
                <div key={i}>
                  <label>
                    步骤 {i + 1} 标题
                    <Input
                      value={step.title}
                      maxLength={80}
                      onChange={(e) =>
                        update(
                          'steps',
                          product.steps.map((v, j) =>
                            j === i ? { ...v, title: e.target.value } : v,
                          ),
                        )
                      }
                    />
                  </label>
                  <label>
                    步骤说明
                    <textarea
                      rows={2}
                      value={step.description}
                      maxLength={500}
                      onChange={(e) =>
                        update(
                          'steps',
                          product.steps.map((v, j) =>
                            j === i ? { ...v, description: e.target.value } : v,
                          ),
                        )
                      }
                    />
                  </label>
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() =>
                      update(
                        'steps',
                        product.steps.filter((_, j) => j !== i),
                      )
                    }
                  >
                    移除此步骤
                  </Button>
                </div>
              ))}
              <Button
                type="button"
                variant="outline"
                disabled={product.steps.length >= 8}
                onClick={() =>
                  update('steps', [
                    ...product.steps,
                    { title: '', description: '' },
                  ])
                }
              >
                <Plus size={14} />
                添加交付步骤
              </Button>
              {product.faq.map((item, i) => (
                <div key={i}>
                  <label>
                    问题
                    <Input
                      value={item.question}
                      maxLength={160}
                      onChange={(e) =>
                        update(
                          'faq',
                          product.faq.map((v, j) =>
                            j === i ? { ...v, question: e.target.value } : v,
                          ),
                        )
                      }
                    />
                  </label>
                  <label>
                    回答
                    <textarea
                      rows={3}
                      value={item.answer}
                      maxLength={2000}
                      onChange={(e) =>
                        update(
                          'faq',
                          product.faq.map((v, j) =>
                            j === i ? { ...v, answer: e.target.value } : v,
                          ),
                        )
                      }
                    />
                  </label>
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() =>
                      update(
                        'faq',
                        product.faq.filter((_, j) => j !== i),
                      )
                    }
                  >
                    移除此问题
                  </Button>
                </div>
              ))}
              <Button
                type="button"
                variant="outline"
                disabled={product.faq.length >= 12}
                onClick={() =>
                  update('faq', [...product.faq, { question: '', answer: '' }])
                }
              >
                <Plus size={14} />
                添加常见问题
              </Button>
            </fieldset>
            {error && <p role="alert">{error}</p>}
            {message && <p role="status">{message}</p>}
            <div className="owner-editor-actions">
              <Button
                type="button"
                variant="outline"
                disabled={busy}
                onClick={() => setPreview(true)}
              >
                <Eye size={15} />
                前台预览
              </Button>
              <Button type="submit" variant="outline" disabled={busy}>
                <Save size={15} />
                保存草稿
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={busy}
                onClick={() => void save('listed')}
              >
                {value.pricePending ? '公开资料，待定价' : '仅展示，暂不开售'}
              </Button>
              <Button
                type="button"
                disabled={busy || listingOnly}
                onClick={() => void save('published')}
                title={
                  listingOnly
                    ? '代理采购和收款暂未开放，请先选择仅展示'
                    : undefined
                }
              >
                {busy ? '正在保存…' : '发布商品'}
              </Button>
              {product.id && (
                <Button
                  type="button"
                  variant="ghost"
                  disabled={busy}
                  onClick={() => void save('archived')}
                >
                  下架商品
                </Button>
              )}
              <span>{dirty ? '有未保存修改' : statuses[product.status]}</span>
            </div>
          </form>
        </DialogContent>
      </Dialog>
      <Dialog open={preview} onOpenChange={setPreview}>
        <DialogContent className="owner-product-editor">
          <DialogHeader>
            <DialogTitle>前台商品预览</DialogTitle>
            <DialogDescription>
              使用现有商城的商品详情样式，预览不创建订单。
            </DialogDescription>
          </DialogHeader>
          <div style={{ overflow: 'auto', maxHeight: '75vh' }}>
            <ShopProductPage product={value} preview />
          </div>
        </DialogContent>
      </Dialog>
      <Dialog open={discard} onOpenChange={setDiscard}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>放弃未保存修改？</DialogTitle>
            <DialogDescription>当前商品还有未保存内容。</DialogDescription>
          </DialogHeader>
          <Button variant="outline" onClick={() => setDiscard(false)}>
            继续编辑
          </Button>
          <Button variant="destructive" onClick={onClose}>
            放弃修改并关闭
          </Button>
        </DialogContent>
      </Dialog>
    </>
  )
}
export default function ProductPublisher({
  revision = 0,
  onSaved,
}: {
  revision?: number
  onSaved?: () => void
}) {
  const [local, setLocal] = useState(0),
    [edit, setEdit] = useState<ShopProduct | null>(null)
  const { data, error, loading } = useResource<{ products: ShopProduct[] }>(
    '/api/admin/my-shop/products',
    revision + local,
  )
  const reload = () => {
    setLocal((v) => v + 1)
    onSaved?.()
  }
  return (
    <section>
      <div className="owner-publisher-toolbar">
        <div>
          <h2>商品发布</h2>
          <p>创建自己的商品，选择人工交付或接入供货 API。</p>
        </div>
        <Button onClick={() => setEdit(freshProduct())}>
          <Plus size={15} />
          发布新商品
        </Button>
      </div>
      <p>
        美国单次短信项目请在 <a href="/admin?view=products&supplier=grizzly">商品管理 → 灰熊</a>{' '}
        集中配置与发布。
      </p>
      {error && <p role="alert">{error}</p>}
      {loading && !data && <p>正在读取商品…</p>}
      <div className="owner-product-list">
        {data?.products
          .filter(
            (p) => !(Object.values(SMS_PRODUCT_IDS) as string[]).includes(p.id),
          )
          .map((p) => (
            <article
              className="owner-product-row"
              data-product-id={p.id}
              key={p.id}
            >
              {clearProductBrand(p.groupId ?? p.id) ? (
                <ProductMark productId={p.groupId ?? p.id} />
              ) : p.image ? (
                <img src={p.image} alt="" />
              ) : (
                <Package size={26} />
              )}
              <div className="owner-product-info">
                <strong>{p.name}</strong>
                <small>
                  {statuses[p.status]} ·{' '}
                  {p.groupId && <>{SHOP_PRODUCT_GROUPS[p.groupId]} 分组 · </>}
                  {p.delivery === 'api' ? 'API 自动供货' : '人工交付'} ·{' '}
                  {p.pricePending
                    ? '待定价'
                    : '¥' + (p.priceCents / 100).toFixed(2)}{' '}
                  · {p.stock < 0 ? '不限量' : `剩余 ${p.stock}`}
                </small>
              </div>
              <ProductArtworkSettingsButton productId={p.id} onSaved={reload} />
              <Button variant="outline" onClick={() => setEdit(p)}>
                编辑商品
              </Button>
              {['listed', 'published'].includes(p.status) && (
                <a
                  href={'/product/' + (p.groupId ?? p.id)}
                  target="_blank"
                  rel="noreferrer"
                >
                  查看前台 ↗
                </a>
              )}
            </article>
          ))}
      </div>
      {data && !data.products.length && (
        <p className="stores-help">
          暂无自行发布的商品。ChatGPT 等原有套餐继续在「商品售价」中管理。
        </p>
      )}
      <Button variant="ghost" disabled={loading} onClick={reload}>
        <RefreshCw size={14} />
        重新读取
      </Button>
      {edit && (
        <ProductEditor
          key={edit.id || 'new'}
          initial={edit}
          onClose={() => setEdit(null)}
          onSaved={reload}
        />
      )}
    </section>
  )
}
