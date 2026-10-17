import { MuseLogoMotion } from './muse-logo-motion'
import { ProductArtwork } from './product-artwork'
import { ProductMark } from './brand'
import { ProductServiceScene } from './product-service-scene'
import { customerProductCopy, shopPresentation, variantLabel } from '@/lib/shop-presentation'
import type {
  ProductArtworkConfig,
  ProductArtworkMap,
} from '../../shared/product-artwork'
import { useRef, useState } from 'react'
import {
  ArrowRight,
  Check,
  ChevronRight,
  Package,
  ShieldCheck,
} from 'lucide-react'
import { Button } from './ui/button'
import { Input } from './ui/input'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from './ui/dialog'
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from './ui/accordion'
import { api, errorMessage } from '@/lib/api'
import { storefrontHref } from '@/lib/storefront-routing'
import type { ServerOrder } from '@/lib/use-store'
import { groupShopProducts, type ShopProduct } from '../../shared/shop-products'
import { RefundContent } from './order-services'
import './shop-products.css'
import { GrizzlyOrderContent } from './grizzly-order-content'
import { ProductKeyFacts } from './product-key-facts'
import { ProductCopyText, ProductDescription } from './product-buyer-details'
import { productCopyBlocks } from '../../shared/product-copy'

export function ShopProductGroupPage({
  group,
  offers,
  checkoutEnabled,
  artwork,
  initialProductId,
  onHome,
  onCreated,
}: {
  group: ReturnType<typeof groupShopProducts>[number]
  offers: { id: string; enabled: number }[]
  checkoutEnabled: boolean
  artwork: ProductArtworkMap
  initialProductId?: string
  onHome: () => void
  onCreated: (order: ServerOrder) => void
}) {
  const [selected, setSelected] = useState(
    initialProductId ?? group.products[0].id,
  )
  const product =
    group.products.find((p) => p.id === selected) ?? group.products[0]
  return (
    <ShopProductPage
      product={product}
      displayName={group.name}
      variants={group.products}
      onVariantChange={setSelected}
      artwork={artwork[group.id] ?? artwork[product.id]}
      available={
        checkoutEnabled &&
        product.status === 'published' &&
        Boolean(offers.find((p) => p.id === product.id)?.enabled)
      }
      onHome={onHome}
      onCreated={onCreated}
    />
  )
}

export function ShopProductPage({
  product,
  artwork,
  available = true,
  preview = false,
  onCreated,
  displayName,
  variants,
  onVariantChange,
  onHome,
}: {
  product: ShopProduct
  artwork?: ProductArtworkConfig
  available?: boolean
  preview?: boolean
  onCreated?: (o: ServerOrder) => void
  displayName?: string
  variants?: ShopProduct[]
  onVariantChange?: (id: string) => void
  onHome?: () => void
}) {
  const [open, setOpen] = useState(false),
    [email, setEmail] = useState(''),
    [fields, setFields] = useState<Record<string, string>>({}),
    [accepted, setAccepted] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('')
  const requestKey = useRef<{ identity: string; key: string } | null>(null)
  const displayOnly = product.status === 'listed'
  const familyId = product.groupId ?? product.id
  const familyName = displayName || product.name || '商品名称'
  const presentation = shopPresentation(familyId, product)
  const descriptionBlocks = productCopyBlocks(customerProductCopy(product.description))
  const [couponCode, setCouponCode] = useState(''),
    [coupon, setCoupon] = useState<{ code: string; priceCents: number } | null>(
      null,
    )
  const payable =
    coupon?.code === couponCode.trim().toUpperCase()
      ? coupon.priceCents
      : product.priceCents
  async function applyCoupon() {
    if (busy) return
    setBusy(true)
    setError('')
    try {
      const result = await api<{ code: string; priceCents: number }>(
        '/api/orders/coupon-quote',
        { plan: product.id, email, code: couponCode },
      )
      setCoupon(result)
    } catch (e) {
      setCoupon(null)
      setError(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }
  async function purchase() {
    if (busy || !accepted || preview || product.pricePending || !available) return
    if (couponCode.trim() && coupon?.code !== couponCode.trim().toUpperCase()) {
      setError('请先应用优惠码，或清空后继续。')
      return
    }
    const identity = JSON.stringify([
      product.id,
      email,
      fields,
      payable,
      coupon?.code,
    ])
    if (requestKey.current?.identity !== identity)
      requestKey.current = { identity, key: crypto.randomUUID() }
    setBusy(true)
    setError('')
    try {
      await api('/api/orders/client', {})
      const result = await api<{ order: ServerOrder }>('/api/orders', {
        plan: product.id,
        email,
        fields,
        key: requestKey.current.key,
        expectedPrice: payable,
        couponCode: couponCode.trim() ? coupon?.code : undefined,
      })
      setOpen(false)
      onCreated?.(result.order)
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }
  return (
    <>
      <section className="detail-intro page-width shop-detail-intro reveal-in">
        <nav className="product-breadcrumb" aria-label="当前位置">
          <a
            href={storefrontHref('store')}
            onClick={
              onHome
                ? (e) => {
                    if (e.button || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
                    e.preventDefault()
                    onHome()
                  }
                : undefined
            }
          >
            全部商品
          </a>
          <ChevronRight size={13} />
          <span aria-current="page">{familyName}</span>
        </nav>
        <h1>{familyName}<span>{presentation.tagline}</span></h1>
        {presentation.intro && presentation.intro !== presentation.tagline && <p>{presentation.intro}</p>}
      </section>
      <section
        className={`purchase-workspace page-width shop-product-workspace family-${familyId}`}
        aria-label={product.name + '商品详情'}
      >
        <div className="product-area">
          <div className="product-topline">
            <span className="section-kicker">
              {presentation.category || '商品服务'}
            </span>
            <span className="availability">
              {product.stock === 0
                ? '暂时售罄'
                : available
                  ? '可购买'
                  : '暂停售卖'}
            </span>
          </div>
          <div className="product-heading">
            {product.groupId ? <ProductMark productId={product.groupId} /> : product.image ? (
              <img className="shop-product-icon" src={product.image} alt="" />
            ) : (
              <Package size={40} />
            )}
            <div>
              <h2>{familyName}</h2>
              <span className="personal-badge">
                {product.badge || '自营商品'}
              </span>
            </div>
          </div>
          <ProductKeyFacts highlights={product.buyerHighlights} warnings={product.buyerWarnings}/>
          {familyId === 'muse' ? <MuseLogoMotion detail /> : <ProductArtwork
            config={artwork}
            name={product.name}
            caption={product.duration}
            detail
            fallback={(!variants || variants.length === 1) ? <ProductServiceScene productId={familyId} name={familyName} duration={product.duration} /> : null}
          />
          }
          <div className="product-pitch">
            <h3>{familyId === 'claude' ? '找到适合你的用量。' : familyId === 'codex-credits' ? '按需补充，继续创造。' : product.name}</h3>
            <p>{product.tagline}</p>
          </div>
          {variants && variants.length > 1 && (
            <fieldset className="shop-product-variants">
              <legend>选择适合你的规格<span>{variants.length} 个规格可选</span></legend>
              {variants.map((variant) => (
                <label
                  key={variant.id}
                  className="shop-variant"
                  data-selected={variant.id === product.id}
                >
                  <input
                    type="radio"
                    aria-label={variant.name}
                    name="product-variant"
                    value={variant.id}
                    checked={variant.id === product.id}
                    onChange={() => {
                      setCoupon(null)
                      onVariantChange?.(variant.id)
                    }}
                  />
                  <span>
                    <strong>{variantLabel(variant, familyName)}</strong>
                    <small>{variant.features[0] || variant.duration}</small>
                  </span>
                  <strong>{variant.pricePending ? '待定价' : <><small>¥</small>{(variant.priceCents / 100).toFixed(2)}</>}</strong>
                </label>
              ))}
            </fieldset>
          )}
          <div className="shop-product-option">
            <span className="section-kicker">商品详情</span>
            <div className="plan-option-top">
              <h3>{product.name || '商品规格'}</h3>
              <span>{product.duration}</span>
            </div>
            <ul className="plan-features">
              {product.features.map((feature, i) => (
                <li key={i}>
                  <Check size={15} />
                  {feature}
                </li>
              ))}
            </ul>
            <a className="shop-details-link" href="#product-details">查看权益、账号条件与购买须知<ArrowRight size={13} aria-hidden="true" /></a>
          </div>
        </div>
        <aside className="order-summary" aria-label="商品价格与交付说明">
          <div className="summary-title">
            <h3>{displayOnly ? '商品信息' : '订单摘要'}</h3>
            <ShieldCheck size={18} />
          </div>
          <div className="summary-product">
            {product.groupId && <ProductMark small productId={product.groupId} />}
            <div><strong>{product.name || '商品名称'}</strong><p>{product.duration || '商品规格'}</p></div>
          </div>
          <dl className="summary-details">
            <div>
              <dt>所选数量</dt>
              <dd>1 {product.unit || '份'}</dd>
            </div>
            <div>
              <dt>交付方式</dt>
              <dd>{product.requiresRedemption ? '兑换码 + 使用指引' : product.delivery === 'api' ? '卡密 / 兑换信息' : '按商品说明交付'}</dd>
            </div>
            {!displayOnly && available && (
              <div>
                <dt>收款方式</dt>
                <dd>{product.payment.label || '待设置'}</dd>
              </div>
            )}
          </dl>
          <div className="summary-total">
            <span>{displayOnly ? '商品价格' : '应付金额'}</span>
            <strong className="total-price">
              {product.pricePending ? '待定价' : '¥'+(product.priceCents / 100).toFixed(2)}
            </strong>
          </div>
          <Button
            className="primary-action summary-cta"
            disabled={preview || product.pricePending || !available || product.stock === 0}
            onClick={() => setOpen(true)}
          >
            {preview
              ? '商品预览'
              : product.pricePending ? '待定价，暂不可购买'
              : !available
                ? '暂停售卖'
                : product.stock === 0
                  ? '暂时售罄'
                  : '立即购买'}
            <ArrowRight size={16} />
          </Button>
          <p className="summary-note">
            {product.pricePending ? '资料已公开，售价尚未确认，当前不能下单。' : displayOnly || !available
              ? '当前可查看商品与规格，恢复售卖后可在此下单。'
              : '付款确认后，交付内容可在原订单中查看。'}
          </p>
          <p className="summary-footnote shop-product-copy">
            <strong>交付说明</strong>
            <ProductCopyText text={customerProductCopy(product.deliveryInstructions)} />
          </p>
        </aside>
      </section>
      <section className="shop-buyer-details page-width" id="product-details" aria-label="商品介绍与购买须知">
        <div className="shop-buyer-heading">
          <span className="section-kicker">PRODUCT DETAILS</span>
          <h2>了解你的选择。</h2>
          <p>{product.name}</p>
        </div>
        <div className="shop-buyer-body">
          <ProductDescription blocks={descriptionBlocks} />
          <div className="membership-purchase-note">
            <strong>购买须知与售后范围</strong>
            <p className="shop-product-copy"><ProductCopyText text={product.purchaseNote} /></p>
          </div>
        </div>
      </section>
      <div className="shop-flow-heading page-width"><span className="section-kicker">HOW IT WORKS</span><h2>从选购，到使用。</h2><p>交付内容与操作指引在原订单中查看。</p></div>
      <section
        className={'delivery-guide page-width shop-delivery-guide' + (product.steps.length === 4 ? ' four-step-guide' : '')}
        aria-label="购买与交付流程"
      >
        {product.steps.map((step, i) => (
          <article key={i}>
            <small>{String(i + 1).padStart(2, '0')}</small>
            <h3>{step.title}</h3>
            <p><ProductCopyText text={step.description} /></p>
          </article>
        ))}
      </section>
      <section className="faq-section page-width" id="help">
        <div className="faq-heading">
          <span className="section-kicker">购买帮助</span>
          <h2>常见问题</h2>
        </div>
        <Accordion className="faq-list">
          {product.faq.map((item, i) => (
            <AccordionItem key={i} value={String(i)}>
              <AccordionTrigger>{item.question}</AccordionTrigger>
              <AccordionContent><ProductCopyText text={item.answer} /></AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      </section>
      <Dialog
        open={open}
        onOpenChange={(value) => {
          if (!busy) setOpen(value)
        }}
      >
        <DialogContent className="motion-dialog">
          <DialogHeader>
            <DialogTitle>购买 {product.name}</DialogTitle>
            <DialogDescription>
              核对商品、收款与交付说明后填写下单信息。
            </DialogDescription>
          </DialogHeader>
          <form
            className="shop-product-form"
            onSubmit={(e) => {
              e.preventDefault()
              void purchase()
            }}
          >
            <label htmlFor="shop-purchase-email">下单邮箱</label>
            <Input
              id="shop-purchase-email"
              type="email"
              required
              value={email}
              onChange={(e) => {
                setEmail(e.target.value)
                setCoupon(null)
              }}
              maxLength={254}
              disabled={busy}
            />
            {product.fields.map((field) => (
              <label key={field.key}>
                {field.label}
                {field.required ? '（必填）' : '（选填）'}
                <Input
                  value={fields[field.key] ?? ''}
                  onChange={(e) =>
                    setFields({ ...fields, [field.key]: e.target.value })
                  }
                  maxLength={1000}
                  required={field.required}
                  disabled={busy}
                />
              </label>
            ))}
            <label>
              优惠码（选填）
              <Input
                value={couponCode}
                onChange={(e) => {
                  setCouponCode(e.target.value)
                  setCoupon(null)
                }}
                maxLength={32}
                disabled={busy}
              />
            </label>
            {couponCode.trim() && (
              <Button
                type="button"
                variant="outline"
                disabled={busy || !email}
                onClick={() => void applyCoupon()}
              >
                应用优惠码
              </Button>
            )}
            <p>应付金额：¥{(payable / 100).toFixed(2)}</p>
            <div className="shop-product-copy">
              <strong>购买须知</strong>
              <p>{product.purchaseNote}</p>
              <strong>交付说明</strong>
              <p>{product.deliveryInstructions}</p>
              <strong>收款说明</strong>
              <p>{product.payment.instructions}</p>
            </div>
            <label className="shop-product-check">
              <input
                type="checkbox"
                checked={accepted}
                onChange={(e) => setAccepted(e.target.checked)}
                required
                disabled={busy}
              />
              我已阅读并同意购买、收款和售后说明
            </label>
            {error && <p role="alert">{error}</p>}
            <Button type="submit" disabled={busy || !accepted}>
              {busy ? '正在创建订单…' : '确认下单，继续付款'}
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}

export function ShopOrderDialog({
  order,
  open,
  onOpenChange,
  onUpdated,
}: {
  order: ServerOrder
  open: boolean
  onOpenChange: (o: boolean) => void
  onUpdated: (o: ServerOrder) => void
}) {
  const [reference, setReference] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [refund, setRefund] = useState(false)
  const view = order.custom!
  async function action(name: string) {
    if (busy) return
    setBusy(true)
    setError('')
    try {
      const result = await api<{ order: ServerOrder }>(
        `/api/orders/${order.id}/custom-action`,
        { action: name, reference, version: order.version },
      )
      onUpdated(result.order)
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }
  async function refresh(force = false) {
    if (busy && !force) return
    setBusy(true)
    setError('')
    try {
      const result = await api<{ order: ServerOrder }>(
        '/api/orders/' + order.id,
      )
      onUpdated(result.order)
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="motion-dialog">
        <DialogHeader>
          <DialogTitle>{view.productName}</DialogTitle>
          <DialogDescription>
            {order.id} · ¥{order.price.toFixed(2)}
          </DialogDescription>
        </DialogHeader>
        <div className="shop-product-form">
          {refund ? (
            <RefundContent
              order={order}
              onUpdated={() => void refresh(true)}
              onBusyChange={setBusy}
              onBack={() => setRefund(false)}
            />
          ) : (
            <>
              {view.sms ? <GrizzlyOrderContent key={order.id} order={order} open={open} onUpdated={onUpdated} /> : order.status === 'cancelled' ? (
                <p>订单已关闭。</p>
              ) : order.paymentStatus === 'unpaid' ? (
                <>
                  <h3>{view.payment.label}</h3>
                  <p className="shop-product-copy">
                    {view.payment.instructions}
                  </p>
                  {view.payment.qr && (
                    <img
                      className="shop-payment-qr"
                      src={view.payment.qr}
                      alt="商品收款码"
                    />
                  )}
                  {view.payment.url && (
                    <a
                      className="shop-payment-link"
                      href={view.payment.url}
                      target="_blank"
                      rel="noreferrer"
                    >
                      打开付款页面 ↗
                    </a>
                  )}
                  <p>
                    请核对收款方及金额 ¥{order.price.toFixed(2)}
                    ，付款后提交交易号，由店主核验。
                  </p>
                  {view.paymentClaimed ? (
                    <p role="status">
                      已提交付款信息，等待店主核对。请勿重复付款。
                    </p>
                  ) : (
                    <>
                      <label htmlFor="shop-payment-reference">
                        付款交易号／付款备注
                      </label>
                      <Input
                        id="shop-payment-reference"
                        value={reference}
                        maxLength={200}
                        onChange={(e) => setReference(e.target.value)}
                        disabled={busy}
                      />
                      <Button
                        disabled={busy || reference.trim().length < 3}
                        onClick={() => void action('claim-payment')}
                      >
                        我已付款，提交核对
                      </Button>
                      <Button
                        variant="ghost"
                        disabled={busy}
                        onClick={() => void action('cancel')}
                      >
                        关闭未付款订单
                      </Button>
                    </>
                  )}
                </>
              ) : (
                <>
                  <h3>
                    {order.status === 'success'
                      ? '已交付'
                      : order.status === 'failed'
                        ? '交付待核对'
                        : '已确认收款，等待交付'}
                  </h3>
                  <p className="shop-product-copy">
                    {view.deliveryInstructions}
                  </p>
                  {view.deliveryContent && (
                    <DeliveredCode key={order.id} value={view.deliveryContent} />
                  )}
                  {order.paymentStatus === 'paid' && order.status === 'success' && !order.refundHold && view.deliveryContent && view.redemptionGuide && (
                    <section className="paid-redemption-guide" aria-label="本单兑换入口与指引">
                      <h3>兑换入口与操作指引</h3>
                      <ProductDescription blocks={productCopyBlocks(view.redemptionGuide)} />
                    </section>
                  )}
                  {order.refundHold && <p>售后处理中，请联系店主。</p>}
                  {view.supplierError && (
                    <p role="status">
                      供货正在核对，请联系店主并保留原订单，无需重复下单或付款。
                    </p>
                  )}
                </>
              )}
              {error && <p role="alert">{error}</p>}
              {!view.sms && <Button
                variant="outline"
                disabled={busy}
                onClick={() => void refresh()}
              >
                {busy ? '正在查询…' : '刷新原订单进度'}
              </Button>}
              {order.paymentStatus === 'paid' && (
                <Button
                  variant="ghost"
                  disabled={busy}
                  onClick={() => setRefund(true)}
                >
                  申请售后／查看售后进度
                </Button>
              )}
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

function DeliveredCode({ value }: { value: string }) {
  const [copiedValue, setCopiedValue] = useState('')
  const [copyError, setCopyError] = useState(false)
  async function copy() {
    try {
      await navigator.clipboard.writeText(value)
      setCopiedValue(value)
      setCopyError(false)
    } catch {
      setCopyError(true)
    }
  }
  return <div className="delivered-code">
    <pre className="shop-delivery-content">{value}</pre>
    <Button variant="outline" onClick={() => void copy()}>{copiedValue === value ? '已复制交付内容' : '复制交付内容'}</Button>
    {copyError && <p role="status">复制未成功，请选中上方内容手动复制。</p>}
  </div>
}
