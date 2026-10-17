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
    [reference, setReference] = useState(''),
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
        reference,
        version: order.version,
      })
      setNote('')
      setContent('')
      setReference('')
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
      {!custom.sms && (
        <p>客户付款声明：{custom.paymentClaimed ? '已提交' : '未提交'}</p>
      )}
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
      {custom.sms ? (
        <>
          <p>支付渠道确认到账后自动发号。{custom.sms.message}</p>
          {custom.sms.phone && <p>本次手机号：{custom.sms.phone}</p>}
          {custom.sms.code && <p>验证码：{custom.sms.code}</p>}
          {custom.sms.activationId && (
            <p>灰熊接码编号：{custom.sms.activationId}</p>
          )}
          {custom.sms.costUsd && <p>实际采购价：US$ {custom.sms.costUsd}</p>}
          {['unknown', 'review'].includes(custom.sms.state) && (
            <>
              <p>
                先到灰熊核对账单、活动号码及退款记录。填写核对记录后关闭此接码任务，客户才可进入原订单退款审核；这里不会重新采购或自动退款。
              </p>
              <label htmlFor="sms-admin-reference">
                上游账单／客服核对记录
              </label>
              <Input
                id="sms-admin-reference"
                value={reference}
                onChange={(e) => setReference(e.target.value)}
                maxLength={200}
                disabled={busy}
              />
              <Button
                variant="outline"
                disabled={
                  busy || note.trim().length < 3 || reference.trim().length < 3
                }
                onClick={() => void action('confirm-sms-closed')}
              >
                已核对上游记录，关闭接码任务
              </Button>
            </>
          )}
          {order.paymentStatus === 'paid' && (
            <Button
              variant="outline"
              disabled={busy || note.trim().length < 3}
              onClick={() => void action('sync')}
            >
              同步原接码订单
            </Button>
          )}
          {custom.sms.state === 'waiting' && (
            <Button
              variant="outline"
              disabled={busy || note.trim().length < 3}
              onClick={() => void action('stop-sms')}
            >
              停止本次接码
            </Button>
          )}
        </>
      ) : order.paymentStatus === 'unpaid' && order.status === 'pending' ? (
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
