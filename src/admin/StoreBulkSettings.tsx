import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { WorkspaceSelect } from '@/partner/workspace-ui'
import { api, errorMessage } from '@/lib/api'

type Store = { id: string; name: string; version: number }
const groups = [
  { label: '店铺名称与品牌', fields: ['name','brandName','logo','pageTitle'] },
  { label: '首页标题与简介', fields: ['headline','description'] },
  { label: '联系方式', fields: ['wechat','qq','email'] },
  { label: '店铺公告', fields: ['announcement','announcementTitle','announcementPlacement'] },
  { label: '商品展示与排序', fields: ['productIds','hiddenProductIds'] },
  { label: '营业状态', fields: ['active'] },
  { label: '订单通知', fields: ['orderCompletedEmail'] },
]
export function StoreBulkSettings({ stores, onSaved }: { stores: Store[]; onSaved: () => void }) {
  const [open, setOpen] = useState(false)
  return <><Button variant="outline" onClick={() => setOpen(true)}>统一修改参数</Button>{open && <BulkForm stores={stores} onClose={() => setOpen(false)} onSaved={onSaved} />}</>
}
function BulkForm({ stores, onClose, onSaved }: { stores: Store[]; onClose: () => void; onSaved: () => void }) {
  const [sourceId, setSourceId] = useState(stores[0].id)
  const [targets, setTargets] = useState<string[]>(stores.slice(1).map(s => s.id))
  const [selected, setSelected] = useState<number[]>([])
  const [prices, setPrices] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const source = stores.find(s => s.id === sourceId)!
  const toggle = <T,>(items: T[], item: T) => items.includes(item) ? items.filter(v => v !== item) : [...items, item]
  async function save() {
    if (busy || !targets.length || (!selected.length && !prices)) return
    setBusy(true); setError('')
    try {
      await api('/api/admin/my-shop/stores/bulk', { sourceId, sourceVersion: source.version, targets: stores.filter(s => targets.includes(s.id)).map(s => ({ id: s.id, version: s.version })), fields: selected.flatMap(i => groups[i].fields), prices })
      onSaved(); onClose()
    } catch (e) { setError(errorMessage(e)) } finally { setBusy(false) }
  }
  return <Dialog open onOpenChange={v => { if (!v && !busy) onClose() }}><DialogContent className="store-editor motion-dialog"><DialogHeader><DialogTitle>统一修改店铺参数</DialogTitle><DialogDescription>先在一间店保存需要的参数，再选择同步字段和目标店铺。未勾选的参数保留各店原值。</DialogDescription></DialogHeader>
    <form onSubmit={e => { e.preventDefault(); void save() }}><fieldset className="store-editor-fieldset" disabled={busy}>
      <WorkspaceSelect label="复制参数的店铺" value={sourceId} options={stores.map(s => ({ value: s.id, label: s.name }))} onValueChange={id => { setSourceId(id); setTargets(stores.filter(s => s.id !== id).map(s => s.id)) }} />
      <h3>目标店铺</h3><div className="store-editor-fields">{stores.filter(s => s.id !== sourceId).map(s => <label className="store-check" key={s.id}><input type="checkbox" checked={targets.includes(s.id)} onChange={() => setTargets(toggle(targets, s.id))} />{s.name}</label>)}</div>
      <h3>同步哪些参数</h3><div className="store-editor-fields">{groups.map((g, i) => <label className="store-check" key={g.label}><input type="checkbox" checked={selected.includes(i)} onChange={() => setSelected(toggle(selected, i))} />{g.label}</label>)}<label className="store-check"><input type="checkbox" checked={prices} onChange={e => setPrices(e.target.checked)} />商品售价与销售状态</label></div>
      <p className="stores-help">将「{source.name}」中选定的参数同步到 {targets.length} 家店。{prices ? '目标店铺现有的差异价格会被源店铺售价覆盖。' : '各店价格保持当前设置。'}</p>
      {error && <p role="alert" className="stores-error">{error}</p>}
      <div className="store-actions"><Button type="button" variant="outline" onClick={onClose}>取消</Button><Button type="submit" disabled={busy || !targets.length || (!selected.length && !prices)}>{busy ? '正在同步…' : '同步到所选店铺'}</Button></div>
    </fieldset></form>
  </DialogContent></Dialog>
}
