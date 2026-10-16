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
import { productProblems, type ShopProduct } from '../../shared/shop-products'
import '@/components/shop-products.css'

const freshProduct = (): ShopProduct => ({
  id: '',
  name: '',
  category: 'AI 订阅',
  tagline: '',
  description: '',
  image: '',
  badge: '自营商品',
  unit: '份',
  duration: '',
  priceCents: 100,
  stock: -1,
  features: [],
  purchaseNote: '',
  deliveryInstructions: '',
  steps: [],
  faq: [],
  fields: [],
  delivery: 'manual',
  payment: { label: '', instructions: '', url: '', qr: '' },
  status: 'draft',
  version: 0,
})
const statuses = { draft: '草稿', published: '已发布', archived: '已下架' }
function ProductEditor({
  initial,
  onClose,
  onSaved,
}: {
  initial: ShopProduct
  onClose: () => void
  onSaved: () => void
}) {
  const [product, setProduct] = useState(initial),
    [apiToken, setApiToken] = useState(''),
    [features, setFeatures] = useState(initial.features.join('\n')),
    [price, setPrice] = useState((initial.priceCents / 100).toFixed(2)),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [message, setMessage] = useState(''),
    [preview, setPreview] = useState(false),
    [discard, setDiscard] = useState(false)
  const [baseline, setBaseline] = useState(JSON.stringify(initial))
  const imageInput = useRef<HTMLInputElement>(null),
    qrInput = useRef<HTMLInputElement>(null),
    submitting = useRef(false)
  const value = {
    ...product,
    priceCents: Math.round(Number(price) * 100),
    features: features
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean),
  }
  const dirty = JSON.stringify(value) !== baseline || Boolean(apiToken)
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
  async function save(action: 'draft' | 'published' | 'archived' | 'verify') {
    if (busy || submitting.current) return
    if (!/^\d+(\.\d{1,2})?$/.test(price)) {
      setError('售价最多保留两位小数。')
      return
    }
    const outgoing = {
      ...value,
      status: action === 'verify' ? ('draft' as const) : action,
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
      const result = await api<{ product: ShopProduct }>(
        '/api/admin/my-shop/products' +
          (action === 'verify' ? '/verify-api' : ''),
        { ...outgoing, ...(apiToken ? { apiToken } : {}) },
      )
      setProduct(result.product)
      setFeatures(result.product.features.join('\n'))
      setPrice((result.product.priceCents / 100).toFixed(2))
      setApiToken('')
      setBaseline(JSON.stringify(result.product))
      setMessage(
        action === 'verify'
          ? '供货目录只读检查通过，配置已保存。'
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
              保存草稿后可继续编辑；发布前必须补全商品展示、购买须知、收款和交付信息。
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
                    required
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
                {product.image ? (
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
                交付方式
                <select
                  value={product.delivery}
                  onChange={(e) =>
                    update(
                      'delivery',
                      e.target.value as ShopProduct['delivery'],
                    )
                  }
                >
                  <option value="manual">
                    自有商品 · 人工交付账号／卡密／链接／服务
                  </option>
                  <option value="api">其他供应商 · JSON v1 API 自动供货</option>
                </select>
              </label>
              <p className="owner-editor-notice">
                已接入的 ChatGPT
                使用原有平台代收与直充流程。这里新增的商品使用下方自行配置的收款方式，店主确认到账后才进入交付。
              </p>
              {product.delivery === 'api' && (
                <>
                  <label>
                    供货 API 基础地址
                    <Input
                      type="url"
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
                  <label>
                    上游商品编码
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
                  <label>
                    最高采购成本（元）
                    <Input
                      type="number"
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
                  <label>
                    服务端 API 密钥
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
                  <details className="owner-editor-notice">
                    <summary>JSON v1 供货接口格式</summary>
                    <p>
                      需支持 GET /products 返回 products 列表，包含 product_code
                      与 available；POST /orders 接收
                      merchant_order_no、product_code、email、fields 和
                      Idempotency-Key；GET /orders/订单编号
                      查询同一订单。订单响应必须包含
                      merchant_order_no、order_id、status（pending／success／failed）；成功时提供
                      delivery_content。超时只查询原单，不重新采购。不同协议的供应商需先适配此契约。
                    </p>
                  </details>
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
                disabled={busy}
                onClick={() => void save('published')}
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
      {error && <p role="alert">{error}</p>}
      {loading && !data && <p>正在读取商品…</p>}
      <div className="owner-product-list">
        {data?.products.map((p) => (
          <article className="owner-product-row" key={p.id}>
            {p.image ? <img src={p.image} alt="" /> : <Package size={26} />}
            <div className="owner-product-info">
              <strong>{p.name}</strong>
              <small>
                {statuses[p.status]} ·{' '}
                {p.delivery === 'api' ? 'API 自动供货' : '人工交付'} · ¥
                {(p.priceCents / 100).toFixed(2)} ·{' '}
                {p.stock < 0 ? '不限量' : `剩余 ${p.stock}`}
              </small>
            </div>
            <Button variant="outline" onClick={() => setEdit(p)}>
              编辑商品
            </Button>
            {p.status === 'published' && (
              <a href={'/product/' + p.id} target="_blank" rel="noreferrer">
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
