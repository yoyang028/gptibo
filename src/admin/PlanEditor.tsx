import { useState } from 'react'
import { Check } from 'lucide-react'
import { Checkbox } from '@base-ui/react/checkbox'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Feedback } from '@/components/workspace-loading'
import { api, errorMessage, type CatalogPlan } from '@/lib/api'
import { isXGiftPlan } from '../../shared/xgift-products'
import { emailProduct } from '../../shared/email-products'

export function PlanEditor({ plan, onClose, onUpdated }: { plan: CatalogPlan; onClose: () => void; onUpdated: () => void }) {
  const [price, setPrice] = useState(String(plan.price_cents / 100)); const [enabled, setEnabled] = useState(Boolean(plan.enabled)); const [note, setNote] = useState(''); const [error, setError] = useState(''); const [busy, setBusy] = useState(false)
  const [partnerEnabled, setPartnerEnabled] = useState(plan.partner_enabled !== 0)
  const [supportsWarranty, setSupportsWarranty] = useState(plan.supports_warranty !== false)
  const [purchaseNote, setPurchaseNote] = useState(plan.purchase_note ?? '')
  const [deliveryInstructions, setDeliveryInstructions] = useState(plan.delivery_instructions ?? '')
  async function save() {
    if (busy) return
    if (!/^\d+(\.\d{1,2})?$/.test(price) || Number(price) <= 0 || Number(price) > 100000) { setError('请输入 0.01–100000 元的价格，最多两位小数。'); return }
    setBusy(true); setError('')
    try { await api(`/api/admin/plans/${plan.id}`, { priceCents: Math.round(Number(price) * 100), enabled, note, purchaseNote, deliveryInstructions, partnerEnabled, supportsWarranty, version: plan.version }); onUpdated(); onClose() }
    catch (e) { setError(errorMessage(e)) } finally { setBusy(false) }
  }
  return <Dialog open onOpenChange={open => { if (!open) onClose() }}><DialogContent className="admin-edit motion-dialog"><DialogHeader><DialogTitle>编辑 {plan.name}</DialogTitle><DialogDescription>售后质保设置对该商品的所有订单立即生效，包含历史订单。</DialogDescription></DialogHeader><form className="admin-edit-form" onSubmit={e => { e.preventDefault(); void save() }}><label htmlFor="admin-plan-price">售价（元）</label><Input id="admin-plan-price" value={price} onChange={e => setPrice(e.target.value)} inputMode="decimal" disabled={busy} /><label className="admin-checkbox"><Checkbox.Root className="admin-check-control" checked={enabled} onCheckedChange={value => setEnabled(Boolean(value))} disabled={busy}><Checkbox.Indicator><Check size={13} /></Checkbox.Indicator></Checkbox.Root>允许创建新订单</label><label className="admin-checkbox"><Checkbox.Root className="admin-check-control" checked={supportsWarranty} onCheckedChange={value => setSupportsWarranty(Boolean(value))} disabled={busy}><Checkbox.Indicator><Check size={13} /></Checkbox.Indicator></Checkbox.Root>支持售后质保</label><p className="admin-subtle">关闭后，购买前会明确提示不支持售后质保，该商品的所有订单均无法提交新的售后申请。重新开启后，所有订单同步恢复售后申请入口。</p>{Boolean(plan.renewal_only) && <p className="admin-subtle">该套餐仅支持已有订阅续费。</p>}{(emailProduct(plan.id) || isXGiftPlan(plan.id)) && <label className="admin-checkbox"><input type="checkbox" checked={partnerEnabled} onChange={e => setPartnerEnabled(e.target.checked)} disabled={busy} />开放代理销售（请先核对代理供货价）</label>}{emailProduct(plan.id) && <><label htmlFor="admin-purchase-note">购买说明（客户下单前可见）</label><textarea id="admin-purchase-note" rows={4} value={purchaseNote} onChange={e => setPurchaseNote(e.target.value)} maxLength={2000} disabled={busy} placeholder="账号要求、适用地区、领取限制及预计人工处理时间" /><label htmlFor="admin-delivery-instructions">默认领取说明（发货时可再修改）</label><textarea id="admin-delivery-instructions" rows={4} value={deliveryInstructions} onChange={e => setDeliveryInstructions(e.target.value)} maxLength={2000} disabled={busy} placeholder="兑换步骤、领取页面与注意事项。不要在此填写客户专属 CDK。" /></>}<label htmlFor="admin-plan-note">修改说明</label><Input id="admin-plan-note" value={note} onChange={e => setNote(e.target.value)} maxLength={500} placeholder="例如：调整售价或暂停销售" disabled={busy} /><Feedback error={error} /><Button type="submit" disabled={busy || !note.trim()}>{busy ? '保存中…' : '保存修改'}</Button></form></DialogContent></Dialog>
}
