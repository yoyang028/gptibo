import { ProductArtwork } from './product-artwork'
import type { ProductArtworkConfig } from '../../shared/product-artwork'
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
import type { ShopProduct } from '../../shared/shop-products'
import { RefundContent } from './order-services'
import './shop-products.css'

export function ShopProductPage({
  product,
  artwork,
  available = true,
  preview = false,
  onCreated,
  onHome,
}: {
  product: ShopProduct
  artwork?: ProductArtworkConfig
  available?: boolean
  preview?: boolean
  onCreated?: (o: ServerOrder) => void
  onHome?: () => void
}) {
  const [open, setOpen] = useState(false),
    [email, setEmail] = useState(''),
    [fields, setFields] = useState<Record<string, string>>({}),
    [accepted, setAccepted] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('')
  const requestKey = useRef<{ identity: string; key: string } | null>(null)
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
    if (busy || !accepted || preview) return
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
      <section className="detail-intro page-width">
        <nav className="product-breadcrumb" aria-label="当前位置">
          <a
            href={storefrontHref('store')}
            onClick={
              onHome
                ? (e) => {
                    e.preventDefault()
                    onHome()
                  }
                : undefined
            }
          >
            全部商品
          </a>
          <ChevronRight size={13} />
          <span>{product.name || '商品名称'}</span>
        </nav>
        <h1>{product.name || '商品名称'}</h1>
        <p>{product.tagline || '商品短介绍'}</p>
      </section>
      <section
        className="purchase-workspace page-width shop-product-workspace"
        aria-label={product.name + '商品详情'}
      >
        <div className="product-area">
          <div className="product-topline">
            <span className="section-kicker">
              {product.category || '商品服务'}
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
            {product.image ? (
              <img className="shop-product-icon" src={product.image} alt="" />
            ) : (
              <Package size={40} />
            )}
            <div>
              <h2>{product.name || '商品名称'}</h2>
              <span className="personal-badge">
                {product.badge || '自营商品'}
              </span>
            </div>
          </div>
          <p className="product-pitch shop-product-copy">
            {product.description || '在后台填写商品的详细介绍。'}
          </p>
          <ProductArtwork config={artwork} name={product.name} caption={product.duration} detail />
          <div className="shop-product-option">
            <div className="plan-option-top">
              <strong>{product.duration || '商品规格'}</strong>
              <span className="plan-price">
                ¥{(product.priceCents / 100).toFixed(2)}
                <small>／{product.unit || '份'}</small>
              </span>
            </div>
            <ul className="plan-features">
              {product.features.map((feature, i) => (
                <li key={i}>
                  <Check size={15} />
                  {feature}
                </li>
              ))}
            </ul>
          </div>
          <div className="membership-purchase-note">
            <strong>购买须知与售后范围</strong>
            <p className="shop-product-copy">
              {product.purchaseNote || '请在后台补全购买须知与售后范围。'}
            </p>
          </div>
        </div>
        <aside className="order-summary">
          <div className="summary-title">
            <h3>订单摘要</h3>
            <ShieldCheck size={18} />
          </div>
          <div className="summary-product">
            <strong>{product.name || '商品名称'}</strong>
            <span>{product.duration || '商品规格'}</span>
          </div>
          <dl className="summary-details">
            <div>
              <dt>购买数量</dt>
              <dd>1 {product.unit || '份'}</dd>
            </div>
            <div>
              <dt>交付方式</dt>
              <dd>{product.delivery === 'api' ? '自动供货' : '人工交付'}</dd>
            </div>
            <div>
              <dt>收款方式</dt>
              <dd>{product.payment.label || '待设置'}</dd>
            </div>
          </dl>
          <div className="summary-total">
            <span>应付金额</span>
            <strong className="total-price">
              ¥{(product.priceCents / 100).toFixed(2)}
            </strong>
          </div>
          <Button
            className="primary-action summary-cta"
            disabled={preview || !available || product.stock === 0}
            onClick={() => setOpen(true)}
          >
            {preview
              ? '商品预览'
              : !available
                ? '暂停售卖'
                : product.stock === 0
                  ? '暂时售罄'
                  : '立即购买'}
            <ArrowRight size={16} />
          </Button>
          <p className="summary-note">
            付款后由店主核对收款，确认后按说明交付。
          </p>
          <p className="summary-footnote shop-product-copy">
            {product.deliveryInstructions}
          </p>
        </aside>
      </section>
      <section
        className="delivery-guide page-width"
        aria-label="购买与交付流程"
      >
        {product.steps.map((step, i) => (
          <article key={i}>
            <small>{String(i + 1).padStart(2, '0')}</small>
            <h3>{step.title}</h3>
            <p>{step.description}</p>
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
              <AccordionContent>{item.answer}</AccordionContent>
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
              {order.status === 'cancelled' ? (
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
                    <pre className="shop-delivery-content">
                      {view.deliveryContent}
                    </pre>
                  )}
                  {order.refundHold && <p>售后处理中，请联系店主。</p>}
                </>
              )}
              {error && <p role="alert">{error}</p>}
              <Button
                variant="outline"
                disabled={busy}
                onClick={() => void refresh()}
              >
                {busy ? '正在查询…' : '刷新原订单进度'}
              </Button>
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
