import type { ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { WHOLESALE_STATUS, wholesaleMoney } from '../../shared/wholesale'
export { wholesaleMoney as money }
export const date = (value: number) => new Date(value).toLocaleString('zh-CN', { hour12: false })
export function cents(value: FormDataEntryValue | string | null) {
  const s = String(value ?? '').trim()
  if (!/^\d{1,8}(\.\d{1,2})?$/.test(s)) throw new Error('金额最多填写两位小数。')
  const [whole, fraction = ''] = s.split('.')
  const amount = Number(whole) * 100 + Number(fraction.padEnd(2, '0'))
  if (!Number.isSafeInteger(amount) || amount <= 0) throw new Error('请输入大于零的金额。')
  return amount
}
export function Message({ error, notice }: { error?: string; notice?: string }) {
  return <>{error && <div className="ws-message ws-error" role="alert">{error}</div>}{notice && <div className="ws-message" role="status">{notice}</div>}</>
}
export function Empty({ children }: { children: ReactNode }) { return <div className="ws-empty">{children}</div> }
export function Field({ label, name, defaultValue, required = true, type = 'text', placeholder, maxLength = 160 }: { label: string; name: string; defaultValue?: string; required?: boolean; type?: string; placeholder?: string; maxLength?: number }) {
  return <label className="ws-field"><span>{label}</span><Input name={name} defaultValue={defaultValue} required={required} type={type} placeholder={placeholder} maxLength={maxLength} step={type === 'number' ? '0.01' : undefined} min={type === 'number' ? '0.01' : undefined} /></label>
}
export function Status({ value }: { value: keyof typeof WHOLESALE_STATUS }) { return <span className="ws-status" data-status={value}>{WHOLESALE_STATUS[value]}</span> }
export function Pages({ page, total, onChange }: { page: number; total: number; onChange: (page: number) => void }) {
  return total > 50 ? <div className="ws-pages"><span>共 {total} 条 · 第 {page} 页</span><Button variant="outline" disabled={page === 1} onClick={() => onChange(page - 1)}>上一页</Button><Button variant="outline" disabled={page * 50 >= total} onClick={() => onChange(page + 1)}>下一页</Button></div> : null
}
export function Balance({ amount }: { amount: number }) { return <span className="ws-balance-number">{wholesaleMoney(amount)}</span> }
