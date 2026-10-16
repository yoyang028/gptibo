import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { api, errorMessage } from '@/lib/api'
import type { ServerOrder } from '@/lib/use-store'

export default function ShopOrderActions({
  order,
  onUpdated,
}: {
  order: ServerOrder
  onUpdated: () => void
}) {
  const [note, setNote] = useState(''),
    [content, setContent] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('')
  if (!order.custom) return null
  const custom = order.custom
  async function action(name: string) {
    if (busy) return
    setBusy(true)
    setError('')
    try {
      await api('/api/admin/my-shop/orders/' + order.id, {
        action: name,
        note,
        content,
        version: order.version,
      })
      setNote('')
      setContent('')
      onUpdated()
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }
  return (
    <section className="owner-order-action">
      <h3>自营商品收款与交付</h3>
      <p>
        {custom.productName} · {custom.payment.label}
      </p>
      {Object.entries(custom.fields).map(([key, value]) => (
        <p key={key}>
          {key}：{value}
        </p>
      ))}
      <p>客户付款声明：{custom.paymentClaimed ? '已提交' : '未提交'}</p>
      {custom.paymentReference && (
        <p>付款交易号／备注：{custom.paymentReference}</p>
      )}
      {custom.supplierState && <p>供货状态：{custom.supplierState}</p>}
      {custom.supplierError && <p role="status">{custom.supplierError}</p>}
      <label htmlFor="shop-admin-note">处理说明（必填）</label>
      <Input
        id="shop-admin-note"
        value={note}
        onChange={(e) => setNote(e.target.value)}
        maxLength={500}
        disabled={busy}
      />
      {order.paymentStatus === 'unpaid' && order.status === 'pending' ? (
        <>
          <p>
            请先在自己的收款账户核对金额、交易号与到账情况。客户点击“已付款”不会自动确认收款。
          </p>
          <Button
            disabled={busy || !custom.paymentClaimed || note.trim().length < 3}
            onClick={() => void action('confirm-payment')}
          >
            已核对真实到账，确认收款
          </Button>
          {!custom.paymentClaimed && (
            <Button
              variant="outline"
              disabled={busy || note.trim().length < 3}
              onClick={() => void action('close-unpaid')}
            >
              已核对未到账，关闭未付款订单
            </Button>
          )}
        </>
      ) : order.status !== 'success' && order.paymentStatus === 'paid' ? (
        <>
          <label htmlFor="shop-admin-delivery">
            交付内容／账号资料／卡密／领取链接
          </label>
          <textarea
            id="shop-admin-delivery"
            rows={5}
            value={content}
            maxLength={12000}
            onChange={(e) => setContent(e.target.value)}
            disabled={busy}
          />
          <Button
            disabled={
              busy ||
              note.trim().length < 3 ||
              !content.trim() ||
              ['creating', 'pending', 'unknown', 'review'].includes(
                custom.supplierState ?? '',
              )
            }
            onClick={() => void action('deliver')}
          >
            确认交付给客户
          </Button>
          {custom.delivery === 'api' && (
            <Button
              variant="outline"
              disabled={busy || note.trim().length < 3}
              onClick={() => void action('sync')}
            >
              核对原供货订单
            </Button>
          )}
        </>
      ) : (
        <p>
          {order.status === 'success'
            ? '商品已交付。'
            : '订单已关闭或无需处理。'}
        </p>
      )}
      {error && <p role="alert">{error}</p>}
    </section>
  )
}
