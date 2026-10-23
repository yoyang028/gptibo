import { useRef, useState } from 'react'
import { Download, KeyRound, Package, RefreshCw, Save, Search, Wallet } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Feedback } from '@/components/workspace-loading'
import { api, errorMessage } from '@/lib/api'
import { useResource } from '@/lib/use-resource'
import { WorkspaceTabs } from '@/partner/workspace-ui'
import { ProductEditor } from './ProductPublisher'
import { ProductArtworkSettingsButton } from './ProductArtworkSettings'
import { InventoryMonitor } from './InventoryMonitor'
import { HANFOLK_FAMILIES, skuName, type HanfolkFamily, type HanfolkProduct, type HanfolkDetail } from '../../shared/hanfolk-catalog'
import type { ShopProductInput } from '../../shared/shop-products'
import './hanfolk-catalog.css'

type SourceProduct = HanfolkProduct & { family: HanfolkFamily; detail: HanfolkDetail | null; checkedAt: number }
type Draft = { id: string; productId: number; sku: string; costCents: number; name: string; family: HanfolkFamily; status: string; pricePending: boolean; priceCents: number; sourceStock: number; inventory?: ShopProductInput['inventory'] }
type State = { version: number; configured: boolean; verified: boolean; balanceCents: number | null; checkedAt: number; products: SourceProduct[]; drafts: Draft[]; result?: { imported: string[]; existing: string[] } }
const money = (cents: number) => '¥' + (cents / 100).toFixed(2)
const statuses: Record<string, string> = { draft: '草稿', listed: '仅展示', published: '已发布', archived: '已下架' }

export default function HanfolkCatalog({ revision, onSaved }: { revision: number; onSaved?: () => void }) {
  const [local, setLocal] = useState(0), [apiKey, setKey] = useState(''), [family, setFamily] = useState('all'), [query, setQuery] = useState(''), [status, setStatus] = useState('all')
  const [selection, setSelection] = useState<string[]>([]), [tab, setTab] = useState('products'), [busy, setBusy] = useState(''), [error, setError] = useState(''), [message, setMessage] = useState(''), [edit, setEdit] = useState<ShopProductInput | null>(null)
  const running = useRef(false)
  const { data, error: readError, loading } = useResource<State>('/api/admin/hanfolk', revision + local)
  const search = query.trim().toLowerCase()
  const products = (data?.products ?? []).filter(p => (family === 'all' || p.family === family) && (!search || [p.title, HANFOLK_FAMILIES[p.family], String(p.id)].join(' ').toLowerCase().includes(search)))
  const drafts = (data?.drafts ?? []).filter(p => (family === 'all' || p.family === family) && (!search || [p.name, HANFOLK_FAMILIES[p.family], p.sku].join(' ').toLowerCase().includes(search)) && (status === 'all' || (status === 'pending' ? p.pricePending : p.status === status)))
  const reload = () => { setLocal(v => v + 1); onSaved?.() }
  function toggle(value: string) { setSelection(values => values.includes(value) ? values.filter(v => v !== value) : [...values, value]) }
  async function action(name: string, extra: Record<string, unknown> = {}) {
    if (!data || running.current) return
    running.current = true; setBusy(name); setError(''); setMessage('')
    try {
      const result = await api<State>('/api/admin/hanfolk', { action: name, version: data.version, ...extra })
      if (name === 'save-key') setKey('')
      if (result.result) {
        setMessage(`已新增 ${result.result.imported.length} 个待定价草稿，${result.result.existing.length} 个已有规格保留原售价与内容。`)
        setSelection([]); setTab('products')
      } else setMessage(name === 'refresh' ? '商品与库存已同步；缺货保留展示，新增和下架由你确认。' : name === 'detail' ? '商品详情与规格已更新。' : 'API 密钥已加密保存。')
      reload()
    } catch (e) { setError(errorMessage(e)); reload() }
    finally { running.current = false; setBusy('') }
  }
  async function editor(id: string) {
    if (running.current) return
    running.current = true; setBusy('editor'); setError('')
    try {
      const all = await api<{ products: ShopProductInput[] }>('/api/admin/my-shop/products')
      const product = all.products.find(p => p.id === id)
      if (!product) throw new Error('商品已变化，请刷新。')
      setEdit(product)
    } catch (e) { setError(errorMessage(e)) }
    finally { running.current = false; setBusy('') }
  }
  return <div className="hanfolk-admin">
    <div className="supplier-page-heading"><div><h2>Daju</h2><p>按商品类别选品，按实际规格管理库存、详情和零售价。</p></div><Button variant="outline" disabled={Boolean(busy) || !data?.configured || Boolean(apiKey)} onClick={() => void action('refresh')}><RefreshCw size={15} />{busy === 'refresh' ? '正在同步…' : '同步商品与库存'}</Button></div>
    <div className="hanfolk-metrics">{[['上游商品', data?.products.length], ['已整理规格', data?.drafts.length], ['待定价', data?.drafts.filter(p => p.pricePending).length], ['有货规格', data?.drafts.filter(p => p.sourceStock > 0).length]].map(([label, value]) => <div key={label}><span>{label}</span><strong>{data ? value : '—'}</strong></div>)}</div>
    <Feedback error={error || readError} loading={loading} data={data} />
    {message && <p role="status" className="hanfolk-message">{message}</p>}
    <WorkspaceTabs label="Daju商品工作台" value={tab} onValueChange={setTab} items={[
      { value: 'inventory', label: '库存同步与记录', content: <InventoryMonitor revision={revision + local} configured={Boolean(data?.configured)} onSaved={reload} onSource={() => setTab('source')} /> },
      { value: 'products', label: '已整理商品', content: <section className="hanfolk-listing">
        <div className="hanfolk-toolbar"><label className="admin-search"><Search size={16} /><Input aria-label="搜索Daju商品" placeholder="搜索商品名称或规格" value={query} onChange={e => setQuery(e.target.value)} /></label><select aria-label="Daju商品状态" value={status} onChange={e => setStatus(e.target.value)}><option value="all">全部状态</option><option value="pending">待定价</option>{Object.entries(statuses).map(([id, label]) => <option value={id} key={id}>{label}</option>)}</select><ProductArtworkSettingsButton onSaved={reload} /></div>
        <FamilyFilter family={family} onChange={setFamily} />
        {!drafts.length && <div className="admin-empty"><Package size={26} /><h3>{data?.drafts.length ? '没有匹配的商品' : '还没有整理商品'}</h3><p>{data?.drafts.length ? '调整类别、搜索词或状态后重试。' : '先同步上游目录，选择需要的规格导入，再编辑详情与零售价。'}</p><Button variant="outline" onClick={() => setTab(data?.configured ? 'source' : 'connection')}>{data?.configured ? '前往上游选品' : '配置Daju API'}</Button></div>}
        {Object.entries(HANFOLK_FAMILIES).map(([id, label]) => {
          const rows = drafts.filter(p => p.family === id)
          if (!rows.length) return null
          return <section key={id} className="admin-panel hanfolk-group"><div className="admin-panel-title"><h3>{label}</h3><span>{rows.length} 个规格</span></div><div className="admin-table-scroll"><table className="admin-table"><thead><tr><th>商品 / 上游规格</th><th>采购成本</th><th>本站零售价</th><th>上游库存</th><th>展示状态</th><th>操作</th></tr></thead><tbody>{rows.map(p => <tr key={p.id} data-product-id={p.id}><td><strong>{p.name}</strong><small>#{p.productId} · SKU {p.sku}</small></td><td>{money(p.costCents)}</td><td>{p.pricePending ? <span className="hanfolk-pending">待定价</span> : money(p.priceCents)}</td><td>{p.sourceStock}<small>{p.inventory?.status === 'checking' ? '库存待确认' : p.sourceStock > 0 ? '有货' : '补货中'}</small></td><td><span className="admin-pill">{statuses[p.status] ?? p.status}</span></td><td><Button variant="outline" disabled={Boolean(busy)} onClick={() => void editor(p.id)}>编辑与定价</Button></td></tr>)}</tbody></table></div></section>
        })}
<p className="supplier-help">缺货规格保留展示并显示补货中。新增商品需定价确认，正式下架由你决定。</p>
      </section> },
      { value: 'source', label: '上游目录与选品', content: <section className="supplier-card">
        <div className="supplier-card-heading"><div><h2>上游商品目录</h2><p>展开商品查看规格和说明，选择后导入为待定价草稿。</p></div><span className="admin-pill">{products.length} 个商品</span></div>
        <FamilyFilter family={family} onChange={setFamily} />
        <div className="hanfolk-actions"><span>已选择 {selection.length} 个规格</span><Button variant="outline" disabled={Boolean(busy) || !products.some(p => p.detail)} onClick={() => setSelection(values => [...new Set([...values, ...products.flatMap(p => p.detail?.sku_variants.map(s => p.id + ':' + s.sku) ?? [])])])}>选择本类规格</Button><Button variant="ghost" disabled={Boolean(busy) || !selection.length} onClick={() => setSelection([])}>清空选择</Button><Button disabled={Boolean(busy) || !selection.length || selection.length > 100} onClick={() => void action('import', { selection: selection.map(s => { const [id, ...sku] = s.split(':'); return { productId: Number(id), sku: sku.join(':') } }) })}><Download size={15} />{busy === 'import' ? '正在导入…' : '导入商品草稿'}</Button></div>
        {selection.length > 100 && <p role="alert" className="supplier-help">每次最多导入 100 个规格，请减少选择。</p>}
        {!products.length && <div className="admin-empty"><Package size={26} /><h3>{data?.products.length ? '此类别暂无匹配商品' : '暂无上游商品'}</h3><p>配置 API 后，点击「同步商品与库存」读取目录。</p></div>}
        <div className="hanfolk-products">{products.map(p => <details key={p.id} className="hanfolk-source"><summary><span className="hanfolk-source-mark">{HANFOLK_FAMILIES[p.family]}</span><span><strong>{p.title}</strong><small>#{p.id} · {p.detail?.sku_variants.length ?? '待读取'} 个规格 · {p.is_auto ? '自动发货' : '人工处理'}</small></span><span className="hanfolk-source-count">库存 {p.stock}</span></summary><div className="hanfolk-source-body"><div className="hanfolk-heading"><p>按实际规格核对供货价与库存。</p><Button variant="outline" disabled={Boolean(busy)} onClick={() => void action('detail', { productId: p.id })}>{p.detail ? '更新详情与规格' : '读取详情与规格'}</Button></div>{p.detail && <><div className="hanfolk-skus">{p.detail.sku_variants.map(s => <label key={s.sku}><input type="checkbox" checked={selection.includes(p.id + ':' + s.sku)} onChange={() => toggle(p.id + ':' + s.sku)} disabled={Boolean(busy)} /><span><strong>{skuName(p.detail!, s.sku)}</strong><small>SKU {s.sku} · 库存 {s.stock}</small></span><span>{money(Math.round(s.price * 100))}<small>采购成本</small></span></label>)}</div><details className="hanfolk-source-copy"><summary>商品说明与下单要求</summary><pre>{p.detail.description || '暂无源商品说明，导入后需补全。'}</pre>{p.detail.required_inputs.length > 0 && <p>下单要求：{p.detail.required_inputs.map(v => v.name).join('、')}</p>}</details></>}</div></details>)}</div>
      </section> },
      { value: 'connection', label: 'API 配置', content: <section className="supplier-card hanfolk-connection"><div className="supplier-card-heading"><div><h2><KeyRound size={18} /> Daju卖家 API</h2><p>保存接入密钥，检查余额并同步商品。</p></div><span className="admin-pill">{data?.configured ? data.verified ? '连接已检查' : '已保存 · 待检查' : '尚未配置'}</span></div><div className="hanfolk-connection-grid"><label>API Key<Input aria-label="Daju API Key" type="password" autoComplete="new-password" value={apiKey} onChange={e => setKey(e.target.value)} placeholder={data?.configured ? '留空保留现有密钥' : '输入卖家 API Key'} disabled={Boolean(busy)} maxLength={100} /></label><div className="hanfolk-wallet"><Wallet size={20} /><span>供货余额</span><strong>{data?.balanceCents == null ? '待检查' : money(data.balanceCents)}</strong></div></div><div className="hanfolk-actions"><Button disabled={Boolean(busy) || !apiKey || !data} onClick={() => void action('save-key', { apiKey })}><Save size={15} />加密保存密钥</Button><Button variant="outline" disabled={Boolean(busy) || !data?.configured || Boolean(apiKey)} onClick={() => void action('refresh')}><RefreshCw size={15} />检查连接并同步</Button></div><div className="hanfolk-status"><span>上次同步：{data?.checkedAt ? new Date(data.checkedAt).toLocaleString('zh-CN') : '尚未同步'}</span><span>采购与收款：未开放</span></div><p className="supplier-help">密钥加密保存，不回显。同步只读取商品和余额，不产生采购扣款。</p><a href="https://ai.hanfolk.xyz/content/plugins/seller_api/docs.php" target="_blank" rel="noreferrer">查看接口文档 ↗</a></section> },
    ]} />
    {edit && <ProductEditor listingOnly key={edit.id} initial={edit} onClose={() => setEdit(null)} onSaved={reload} />}
  </div>
}

function FamilyFilter({ family, onChange }: { family: string; onChange: (family: string) => void }) {
  return <div className="hanfolk-family-filter" role="group" aria-label="Daju商品类别"><button aria-pressed={family === 'all'} onClick={() => onChange('all')}>全部类别</button>{Object.entries(HANFOLK_FAMILIES).map(([id, name]) => <button key={id} aria-pressed={family === id} onClick={() => onChange(id)}>{name}</button>)}</div>
}
