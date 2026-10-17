import { useEffect, useRef, useState } from 'react'
import { toString as qrToString } from 'qrcode'
import { Phone, RefreshCw } from 'lucide-react'
import { Button } from './ui/button'
import { CopyButton } from './copy-button'
import { PaymentCard } from './payment-card'
import { api, errorMessage } from '@/lib/api'
import { visiblePolling } from '@/lib/visible-polling'
import type { ServerOrder } from '@/lib/use-store'
import { publicAlipayQr } from '../../shared/public-payment'

type Payment = { status: string; qr: string | null; expiresAt: number }
export function GrizzlyOrderContent({
  order,
  open,
  onUpdated,
}: {
  order: ServerOrder
  open: boolean
  onUpdated: (order: ServerOrder) => void
}) {
  const [payment, setPayment] = useState<Payment | null>(null)
  const [qrImage, setQrImage] = useState<{
    source: string
    data: string
  } | null>(null)
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('')
  const [clock, setClock] = useState(Date.now)
  const locked = useRef(false),
    current = useRef({ order, onUpdated, payment })
  useEffect(() => {
    current.current = { order, onUpdated, payment }
  }, [order, onUpdated, payment])
  const sms = order.custom!.sms!
  const paused =
    order.refundHold ||
    order.redemptionBlocked ||
    (order.refundedCents ?? 0) > 0
  const qr =
    !paused &&
    order.paymentStatus === 'unpaid' &&
    payment?.status === 'pending' &&
    payment.expiresAt > clock
      ? publicAlipayQr(payment.qr)
      : null
  useEffect(() => {
    let active = true
    if (qr)
      void qrToString(qr, { type: 'svg', width: 156, margin: 4 })
        .then((svg) => {
          if (active)
            setQrImage({
              source: qr,
              data: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`,
            })
        })
        .catch(() => {
          if (active) setError('付款码显示失败，请刷新原订单。')
        })
    return () => {
      active = false
    }
  }, [qr])
  async function sync(action?: 'create' | 'close' | 'stop-sms') {
    if (locked.current) return
    locked.current = true
    setBusy(true)
    try {
      const {
        order: latest,
        onUpdated: update,
        payment: previous,
      } = current.current
      if (action === 'stop-sms') {
        const result = await api<{ order: ServerOrder }>(
          `/api/orders/${latest.id}/custom-action`,
          { action, version: latest.version },
        )
        update(result.order)
      } else {
        if (latest.paymentStatus === 'unpaid' && (action || previous)) {
          const result = await api<{ payment: Payment }>(
            `/api/orders/${latest.id}/payment`,
            { action: action ?? 'query' },
          )
          current.current.payment = result.payment
          setPayment(result.payment)
        }
        const result = await api<{ order: ServerOrder }>(
          `/api/orders/${latest.id}`,
        )
        update(result.order)
      }
      setError('')
      setClock(Date.now())
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      locked.current = false
      setBusy(false)
    }
  }
  useEffect(() => {
    if (
      !open ||
      paused ||
      ['received', 'cancelled', 'failed', 'unknown', 'review'].includes(
        sms.state,
      ) ||
      order.status === 'cancelled'
    )
      return
    return visiblePolling(() => sync(), 5000)
    // Current props and payment live in the ref; stage changes restart polling.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, paused, sms.state, order.id, order.status])
  return (
    <section className="grizzly-order" aria-label="短信接码" aria-busy={busy}>
      {error && (
        <p role="alert" className="copy-error">
          {error}
        </p>
      )}
      {paused ? (
        <p>订单暂停交付，可在下方查看售后进度或联系支持。</p>
      ) : order.status === 'cancelled' ? (
        <p>订单已关闭。如已付款，请联系支持核对。</p>
      ) : order.paymentStatus === 'unpaid' ? (
        <>
          {qr ? (
            <PaymentCard
              qr={qr}
              image={qrImage?.source === qr ? qrImage.data : null}
              remaining={Math.max(
                0,
                Math.ceil(((payment?.expiresAt ?? 0) - clock) / 1000),
              )}
              price={order.price}
              quantity="单次接码"
            />
          ) : (
            <>
              <p>支付 ¥{order.price.toFixed(2)}，到账后自动获取美国手机号。</p>
              <Button
                disabled={
                  busy || Boolean(payment && payment.expiresAt <= clock)
                }
                onClick={() => void sync('create')}
              >
                {busy
                  ? '正在准备…'
                  : payment && payment.expiresAt <= clock
                    ? '付款码已过期，请核对原订单'
                    : '生成支付宝付款二维码'}
              </Button>
            </>
          )}
          {payment && (
            <Button
              variant="ghost"
              disabled={busy}
              onClick={() => void sync('close')}
            >
              关闭未付款订单
            </Button>
          )}
        </>
      ) : (
        <>
          <p role="status">{sms.message}</p>
          {sms.phone && (
            <div className="sms-phone-panel">
              <span>
                <Phone size={14} /> 美国手机号
              </span>
              <div className="sms-phone-value">
                <strong>{sms.phone}</strong>
                <CopyButton iconOnly value={sms.phone} label="复制手机号" />
              </div>
            </div>
          )}
          {sms.code && (
            <div className="grizzly-code">
              <h3>短信验证码</h3>
              <div className="sms-code">{sms.code}</div>
              <CopyButton
                variant="outline"
                value={sms.code}
                label="复制验证码"
              />
            </div>
          )}
          {sms.state === 'waiting' && (
            <>
              <p>
                请在所选项目中填写手机号并发送验证码。
                {sms.expiresAt && (
                  <>
                    本次等待截止{' '}
                    {new Date(sms.expiresAt).toLocaleTimeString('zh-CN', {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                    。
                  </>
                )}
              </p>
              <Button
                variant="ghost"
                disabled={busy}
                onClick={() => void sync('stop-sms')}
              >
                停止接码，保留订单
              </Button>
            </>
          )}
          {['unknown', 'review'].includes(sms.state) && (
            <p>请联系店主核对本次号码，不要重新付款。</p>
          )}
        </>
      )}
      <Button variant="outline" disabled={busy} onClick={() => void sync()}>
        <RefreshCw size={14} />
        {busy ? '正在查询…' : '刷新原订单进度'}
      </Button>
    </section>
  )
}
