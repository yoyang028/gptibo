import { useRef, useState } from 'react'
import { ArrowRight, CheckCircle2, KeyRound, Package, Plus, RefreshCw, Search, Wallet } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Feedback } from '@/components/workspace-loading'
import { api, errorMessage, type CatalogPlan } from '@/lib/api'
import { useResource } from '@/lib/use-resource'
import { WorkspaceTabs } from '@/partner/workspace-ui'
import { productNameForId } from '../../shared/email-products'
import { ADMIN_SUPPLIERS, productSupplier, type AdminSupplier, type ProductSection } from '../../shared/admin-suppliers'
import type { ShopProduct, ShopProductInput } from '../../shared/shop-products'
import { ProductEditor } from './ProductPublisher'
import { freshProduct } from './product-draft'
import { ProductArtworkSettingsButton } from './ProductArtworkSettings'
import { PlanEditor } from './PlanEditor'
import { GmailSupplierPanel } from './GmailSupplierPanel'
import HanfolkCatalog from './HanfolkCatalog'
import SmsManagement from './SmsManagement'
import './product-catalog.css'

type Inventory = {
  products: ShopProduct[]
  plans: CatalogPlan[]
  linkedSuppliers: Record<string, AdminSupplier>
  bugan: { configured: boolean; salesEnabled: boolean; origin: string; productMap: Record<string, string> }
  xiaojiuEnabled: boolean
}
type InventoryRow = { id: string; name: string; detail: string; supplier: ProductSection; priceCents: number; pricePending?: boolean; status: string; stock?: number; unlinkedPreview?: boolean; product?: ShopProduct; plan?: CatalogPlan }
const money = (cents: number) => '¥' + (cents / 100).toFixed(2)
const statusNames: Record<string, string> = { draft: '草稿', listed: '仅展示', published: '已发布', archived: '已下架', paused: '已暂停' }
const supplierName = (id: ProductSection) => ADMIN_SUPPLIERS.find(s => s.id === id)?.name ?? '自营及其他'

function rowsFor(data: Inventory): InventoryRow[] {
  return [
    ...data.products.map(p => ({ id: p.id, name: p.name, detail: p.api?.productCode ? '上游规格 ' + p.api.productCode : p.category, supplier: productSupplier(p, data.linkedSuppliers), priceCents: p.priceCents, pricePending: p.pricePending, status: p.status, stock: p.stock, unlinkedPreview: p.groupId === 'muse' && p.museKind === 'invitation' && p.catalogPreview && !data.linkedSuppliers[p.id], product: p })),
    ...data.plans.map(p => ({ id: p.id, name: productNameForId(p.product_id), detail: p.name, supplier: p.id in data.bugan.productMap ? 'bugan' as const : 'other' as const, priceCents: p.price_cents, status: p.enabled ? 'published' : 'paused', plan: p })),
  ]
}

function InventoryTable({ rows, onEdit, busy }: { rows: InventoryRow[]; onEdit: (row: InventoryRow) => void; busy: boolean }) {
  const [query, setQuery] = useState(''), [status, setStatus] = useState('all'), [page, setPage] = useState(1)
  const filtered = rows.filter(r => (!query.trim() || [r.name, r.detail, supplierName(r.supplier)].join(' ').toLowerCase().includes(query.trim().toLowerCase())) && (status === 'all' || (status === 'pending' ? r.pricePending : r.status === status)))
  const currentPage = Math.min(page, Math.max(1, Math.ceil(filtered.length / 15)))
  return <section className="admin-panel supplier-inventory">
    <div className="admin-panel-title"><h2>商品与规格</h2><span>共 {filtered.length} 项</span></div>
    <div className="admin-filters">
      <label className="admin-search"><Search size={16} /><Input aria-label="搜索商品或规格" placeholder="搜索商品、规格或服务商" value={query} onChange={e => { setQuery(e.target.value); setPage(1) }} /></label>
      <select aria-label="商品展示状态" value={status} onChange={e => { setStatus(e.target.value); setPage(1) }}><option value="all">全部状态</option><option value="pending">待定价</option>{Object.entries(statusNames).map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select>
    </div>
    {!filtered.length ? <div className="admin-empty"><Package size={26} /><h3>{rows.length ? '没有匹配的商品' : '暂无已整理商品'}</h3><p>{rows.length ? '调整搜索词或展示状态后重试。' : '从上游目录选品，或创建该服务商的商品草稿。'}</p></div> : <div className="admin-table-scroll"><table className="admin-table"><thead><tr><th>商品 / 规格</th><th>服务商</th><th>零售价</th><th>库存</th><th>展示状态</th><th>操作</th></tr></thead><tbody>{filtered.slice((currentPage - 1) * 15, currentPage * 15).map(r => <tr key={r.id} data-product-id={r.id}><td><strong>{r.name}</strong><small>{r.detail}</small></td><td>{supplierName(r.supplier)}</td><td>{r.pricePending ? '待定价' : money(r.priceCents)}</td><td>{r.unlinkedPreview ? '未关联货源' : r.stock === undefined ? '按上游实时核对' : r.stock < 0 ? '不限量' : r.stock}</td><td><span className={'admin-pill ' + (r.status === 'published' ? 'available' : '')}>{statusNames[r.status] ?? r.status}</span></td><td><Button variant="outline" disabled={busy} onClick={() => onEdit(r)}>{r.supplier === 'grizzly' ? '管理接码项目' : '编辑与定价'}</Button></td></tr>)}</tbody></table></div>}
    {filtered.length > 15 && <div className="admin-pagination"><span>第 {currentPage} / {Math.ceil(filtered.length / 15)} 页</span><div><Button variant="outline" disabled={currentPage === 1} onClick={() => setPage(currentPage - 1)}>上一页</Button><Button variant="outline" disabled={currentPage * 15 >= filtered.length} onClick={() => setPage(currentPage + 1)}>下一页</Button></div></div>}
  </section>
}

function BuganConnection({ data }: { data: Inventory['bugan'] }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [check, setCheck] = useState<{ checkedAt: number; products: { plan: string; code: string; costCents: number; available: boolean }[] }>()
  const running = useRef(false)
  async function inspect() {
    if (running.current) return
    running.current = true; setBusy(true); setError('')
    try { setCheck(await api('/api/admin/suppliers/bugan/check', {})) }
    catch (e) { setError(errorMessage(e)) }
    finally { running.current = false; setBusy(false) }
  }
  async function reconcile() {
    if (running.current) return
    running.current = true; setBusy(true); setError(''); setMessage('')
    try {
      const result = await api<{ checked: number; failed: number }>('/api/admin/recharge/reconcile', {})
      setMessage(`已核对 ${result.checked} 笔订单，${result.failed} 笔等待重试。`)
    } catch (e) { setError(errorMessage(e)) }
    finally { running.current = false; setBusy(false) }
  }
  return <section className="supplier-card">
    <div className="supplier-card-heading"><div><h2><KeyRound size={18} /> API 连接</h2><p>沿用当前 ChatGPT 供货 API，核对授权商品与供货成本。</p></div><span className="admin-pill">{data.configured ? '已配置' : '待配置'}</span></div>
    <div className="supplier-facts"><div><span>接入地址</span><strong>{data.origin || '尚未配置'}</strong></div><div><span>销售开关</span><strong>{data.salesEnabled ? '已开放' : '未开放'}</strong></div><div><span>商品映射</span><strong>{Object.keys(data.productMap).length} 项</strong></div></div>
    <p className="supplier-help">接入密钥由服务端管理。检查仅查询授权和商品，不创建采购订单。</p>
    <div className="hanfolk-actions"><Button variant="outline" disabled={busy || !data.configured} onClick={() => void inspect()}><RefreshCw size={15} />{busy ? '正在处理…' : '检查连接与供货商品'}</Button><Button variant="ghost" disabled={busy || !data.configured} onClick={() => void reconcile()}>核对充值订单</Button></div>
    <Feedback error={error} />
    {message && <p className="supplier-help" role="status">{message}</p>}
    {check && <><p className="supplier-help" role="status"><CheckCircle2 size={14} /> 已检查 · {new Date(check.checkedAt).toLocaleString('zh-CN')}</p><div className="admin-table-scroll"><table className="admin-table"><thead><tr><th>本站套餐</th><th>上游商品编码</th><th>授权成本</th><th>上游状态</th></tr></thead><tbody>{check.products.map(p => <tr key={p.plan}><td>{p.plan}</td><td>{p.code}</td><td>{money(p.costCents)}</td><td>{p.available ? '可供货' : '暂不可供货'}</td></tr>)}</tbody></table></div></>}
  </section>
}

type XiaojiuItem = { productId: number; skuId: number; name: string; skuCode: string; specification: string; priceCents: number; stock: number; available: boolean }
type XiaojiuDirectory = { items: XiaojiuItem[]; balanceCents: number; page: number; pageSize: number; total: number }
function PlanHistory({ revision, ids }: { revision: number; ids: string[] }) {
  const { data, error, loading } = useResource<{ rows: { id: string; target_id: string; note: string; created_at: number }[] }>('/api/admin/audit', revision)
  const rows = data?.rows.filter(row => ids.includes(row.target_id)) ?? []
  return <section className="admin-panel"><div className="admin-panel-title"><h2>套餐修改记录</h2></div><Feedback error={error} loading={loading} data={data} shape="compact" /><div className="admin-audit-list">{rows.map(row => <div key={row.id}><strong>{row.target_id}</strong><span>{row.note}</span><time>{new Date(row.created_at).toLocaleString('zh-CN')}</time></div>)}{data && !rows.length && <p>暂无修改记录。</p>}</div></section>
}
function XiaojiuSource({ products, onEdit, onCreate }: { products: ShopProduct[]; onEdit: (product: ShopProduct) => void; onCreate: (product: ShopProductInput) => void }) {
  const sources = products.filter(p => p.api?.configured)
  const [sourceId, setSourceId] = useState(''), [catalog, setCatalog] = useState<XiaojiuDirectory>(), [loadedSource, setLoadedSource] = useState<ShopProduct>()
  const [busy, setBusy] = useState(false), [error, setError] = useState('')
  const running = useRef(false)
  const source = sources.find(p => p.id === sourceId) ?? sources[0]
  async function load(page = 1) {
    if (running.current || !source) return
    running.current = true; setBusy(true); setError('')
    try {
      setCatalog(await api<XiaojiuDirectory>('/api/admin/my-shop/products/xiaojiu-catalog', { id: source.id, version: source.version, page }))
      setLoadedSource(source)
    } catch (e) { setError(errorMessage(e)) }
    finally { running.current = false; setBusy(false) }
  }
  function create(item: XiaojiuItem) {
    if (!loadedSource) return
    onCreate({ ...freshProduct(), name: [item.name, item.specification].filter(Boolean).join(' · ').slice(0, 80), pricePending: true, stock: item.stock, delivery: 'api', credentialSource: { id: loadedSource.id, version: loadedSource.version }, api: { provider: 'xiaojiu', baseUrl: 'https://98-xj.com', productCode: String(item.skuId), supplierProductId: item.productId, maxCostCents: item.priceCents, configured: true, verified: false } })
  }
  return <div className="supplier-source">
    <section className="supplier-card"><div className="supplier-card-heading"><div><h2><KeyRound size={18} /> Xiaojiu采购 API</h2><p>使用已保存商品的采购凭据读取余额和上游目录。</p></div><span className="admin-pill">{sources.length ? '已保存采购配置' : '待配置'}</span></div>
      {sources.length ? <div className="supplier-source-controls"><label>采购配置<select aria-label="Xiaojiu采购配置" value={source?.id ?? ''} disabled={busy} onChange={e => { setSourceId(e.target.value); setCatalog(undefined); setLoadedSource(undefined) }}>{sources.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label><Button variant="outline" disabled={busy} onClick={() => void load()}><RefreshCw size={15} />{busy ? '正在读取…' : '读取余额与商品目录'}</Button><Button variant="ghost" disabled={busy} onClick={() => source && onEdit(source)}>编辑采购配置</Button></div> : <p className="supplier-help">先新增一个Xiaojiu商品，在商品的供货配置中保存采购 API Key 和 Secret，再从这里读取目录。</p>}
      <p className="supplier-help">采购凭据保存在服务端，选择规格后可复用。每个新商品仍需核对售价、详情、采购成本和收款方式。</p><Feedback error={error} />
    </section>
    {catalog && <section className="supplier-card"><div className="supplier-card-heading"><div><h2><Wallet size={18} /> 钱包余额 {money(catalog.balanceCents)}</h2><p>目录共 {catalog.total} 个规格 · 本次读取未采购、未扣款。</p></div></div><div className="admin-table-scroll"><table className="admin-table"><thead><tr><th>上游商品 / 规格</th><th>采购成本</th><th>库存</th><th>操作</th></tr></thead><tbody>{catalog.items.map(item => {
      const existing = products.find(p => p.api?.supplierProductId === item.productId && p.api?.productCode === String(item.skuId))
      return <tr key={item.productId + ':' + item.skuId}><td><strong>{item.name}</strong><small>{item.specification || item.skuCode} · #{item.productId} / {item.skuId}</small></td><td>{money(item.priceCents)}</td><td>{item.available ? item.stock < 0 ? '有货' : item.stock : '不可供货'}</td><td><Button variant="outline" disabled={busy || (!existing && !item.available)} onClick={() => existing ? onEdit(existing) : create(item)}>{existing ? '编辑已导入商品' : '创建商品草稿'}</Button></td></tr>
    })}</tbody></table></div>{!catalog.items.length && <p className="supplier-help">此页暂无可读取规格。</p>}<div className="admin-pagination"><span>第 {catalog.page} 页</span><div><Button variant="outline" disabled={busy || catalog.page <= 1} onClick={() => void load(catalog.page - 1)}>上一页</Button><Button variant="outline" disabled={busy || catalog.page * catalog.pageSize >= catalog.total} onClick={() => void load(catalog.page + 1)}>下一页</Button></div></div></section>}
  </div>
}

export default function ProductCatalog({ revision, supplier, onSupplier, onSaved, onOrder }: { revision: number; supplier: ProductSection; onSupplier: (supplier: ProductSection) => void; onSaved: () => void; onOrder: (id: string) => void }) {
  const { data, error, loading } = useResource<Inventory>('/api/admin/suppliers', revision)
  const [edit, setEdit] = useState<ShopProductInput>(), [plan, setPlan] = useState<CatalogPlan>(), [editError, setEditError] = useState(''), [busy, setBusy] = useState(false)
  const editing = useRef(false)
  const rows = data ? rowsFor(data) : []
  async function editProduct(product: ShopProduct) {
    if (editing.current) return
    editing.current = true; setBusy(true); setEditError('')
    try {
      const saved = await api<{ products: ShopProductInput[] }>('/api/admin/my-shop/products')
      const current = saved.products.find(p => p.id === product.id)
      if (!current) throw new Error('商品已变化，请刷新。')
      setEdit(current)
    } catch (e) { setEditError(errorMessage(e)) }
    finally { editing.current = false; setBusy(false) }
  }
  function editRow(row: InventoryRow) {
    if (row.supplier === 'grizzly') onSupplier('grizzly')
    else if (row.plan) setPlan(row.plan)
    else if (row.product) void editProduct(row.product)
  }
  function addXiaojiu() {
    setEdit({ ...freshProduct(), delivery: 'api', api: { provider: 'xiaojiu', baseUrl: 'https://98-xj.com', productCode: '', configured: false, verified: false } })
  }
  return <div className="product-catalog">
    <nav className="supplier-section-nav" aria-label="商品服务商">
      {[{ id: 'all', name: '商品总览' }, ...ADMIN_SUPPLIERS, { id: 'other', name: '自营及其他' }].map(s => <Button key={s.id} variant="ghost" aria-current={supplier === s.id ? 'page' : undefined} onClick={() => onSupplier(s.id as ProductSection)}>{s.name}<span className="supplier-section-count">{data ? rows.filter(r => s.id === 'all' || r.supplier === s.id).length : '—'}</span></Button>)}
    </nav>
    {supplier === 'all' && <div className="supplier-overview">{ADMIN_SUPPLIERS.map(s => <button key={s.id} className="supplier-overview-card" onClick={() => onSupplier(s.id)}><span className="supplier-mark" data-supplier={s.id}>{s.mark}</span><strong>{s.name}</strong><p>{s.description}</p><span>{loading && !data ? '读取中…' : data ? rows.filter(r => r.supplier === s.id).length + ' 项商品 / 规格' : '暂未读取'}<ArrowRight size={15} /></span></button>)}</div>}
    <Feedback error={error || editError} loading={loading} data={data} />
    {supplier === 'grizzly' ? <SmsManagement revision={revision} onOrder={onOrder} /> : supplier === 'daju' ? <HanfolkCatalog revision={revision} onSaved={onSaved} /> : data && <>
      {supplier !== 'all' && <div className="supplier-page-heading"><div><h2>{supplierName(supplier)}</h2><p>{supplier === 'other' ? '管理人工交付、自营商品及其他已接入的供货商品。' : ADMIN_SUPPLIERS.find(s => s.id === supplier)?.description}</p></div>{supplier === 'xiaojiu' ? <Button onClick={addXiaojiu}><Plus size={15} />新增Xiaojiu商品</Button> : supplier === 'other' ? <Button onClick={() => setEdit(freshProduct())}><Plus size={15} />新增自营商品</Button> : null}</div>}
      {supplier === 'xiaojiu' && <p className="supplier-help">采购开关：{data.xiaojiuEnabled ? '已开放' : '未开放'} · 每个规格分别设置本站售价和采购成本上限。</p>}
      {supplier === 'bugan' || supplier === 'xiaojiu' ? <WorkspaceTabs key={supplier} label={supplierName(supplier) + '商品工作台'} items={[
        { value: 'products', label: '已整理商品', content: <InventoryTable rows={rows.filter(r => r.supplier === supplier)} onEdit={editRow} busy={busy} /> },
        { value: 'source', label: supplier === 'bugan' ? 'API 与供货商品' : '上游目录与 API', content: supplier === 'bugan' ? <BuganConnection data={data.bugan} /> : <XiaojiuSource products={data.products.filter(p => productSupplier(p, data.linkedSuppliers) === 'xiaojiu')} onEdit={p => void editProduct(p)} onCreate={setEdit} /> },
        ...(supplier === 'bugan' ? [{ value: 'history', label: '修改记录', content: <PlanHistory revision={revision} ids={Object.keys(data.bugan.productMap)} /> }] : []),
      ]} /> : <><div className="supplier-list-toolbar"><span>{supplier === 'all' ? '全部服务商的商品统一查看，编辑时保留各自供货配置。' : '未归属上述四家服务商的商品。'}</span><ProductArtworkSettingsButton onSaved={onSaved} /></div><InventoryTable key={supplier} rows={rows.filter(r => supplier === 'all' || r.supplier === 'other')} onEdit={editRow} busy={busy} />{supplier === 'other' && <GmailSupplierPanel revision={revision} />}</>}
    </>}
    {edit && <ProductEditor key={edit.id || 'new'} initial={edit} listingOnly={Boolean(data?.linkedSuppliers[edit.id] === 'daju')} onClose={() => setEdit(undefined)} onSaved={onSaved} />}
    {plan && <PlanEditor plan={plan} onClose={() => setPlan(undefined)} onUpdated={onSaved} />}
  </div>
}
