import ProductCatalog from './ProductCatalog'
import { ADMIN_WORKSPACES, adminScopeKind, adminWorkspaceRoute, adminWorkspaceUrl, ownerStoreId, type AdminStore, type AdminStoreScope, type AdminView } from '../../shared/admin-workspace'
import MyShop, { StoreDisplay } from './MyShop'
import ShopOrderActions from './ShopOrderActions'
import { ShopBrand } from '@/components/shop-brand'
import TicketWorkspace from '@/components/ticket-workspace'
import { TicketAlerts, type AdminNotifications } from './TicketAlerts'
import Workbench from './Workbench'
import { RechargeRecoveryPanel, type RechargeCredential } from './RechargeRecoveryPanel'
import SecurityPage from './SecurityPage'
import { restartAdminAccess } from '@/lib/admin-access'
import { useAuthVerification } from '@/components/use-auth-verification'
import { PaymentChannelsPanel } from './PaymentChannelsPanel'
import { EmailDeliveryPanel } from './EmailDeliveryPanel'
import { GmailOrderPanel } from './GmailSupplierPanel'
import { productNameForPlan, productNameForId, emailProduct } from '../../shared/email-products'
import { activityCopy } from '@/lib/activity-copy'
import { platformPaymentLabel, type PlatformOrderStatus } from '../../shared/platform-order-status'
import { applyAppearance } from '@/lib/appearance'
import { useResource } from '@/lib/use-resource'
import { Feedback, WorkspaceBoot } from '@/components/workspace-loading'
import { useSession } from '@/lib/use-session'
import { useEffect, useRef, useState, type MouseEvent } from 'react'
import { ArrowLeft, ArrowUpRight, ChartNoAxesCombined, ClipboardList, LayoutDashboard, LogOut, Mail, Moon, Package, RefreshCw, Search, Settings2, ShieldCheck, Store, Sun, Users, type LucideIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { CopyButton } from '@/components/copy-button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import RefundsPage from './RefundsPage'
import PartnersPage, { PartnerPayouts } from './PartnersPage'
import PartnerDefaultPrices from './PartnerDefaultPrices'
import AdminVisitorsPage from './VisitorsPage'
import AccountingPage from './AccountingPage'
import AccountingReport from './AccountingReport'
import InvoiceWorkspace from '@/components/invoice-workspace'
import CustomerManagement from '@/components/customer-management'
import MembersPage from './MembersPage'
import { OrderActionForm } from './OrderActionForm'
import { SupportContactsPanel } from '@/components/support-contacts'
import { api, errorMessage } from '@/lib/api'
import { orderLabel, ORDER_LABELS } from '@/lib/demo-orders'
import { WorkspaceSelect } from '@/partner/workspace-ui'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import type { ServerOrder } from '@/lib/use-store'
import '../App.css'
import '../styles/motion.css'
import './admin.css'

const money = (cents: number) => new Intl.NumberFormat('zh-CN', { style: 'currency', currency: 'CNY' }).format(cents / 100)
const time = (value: number | string) => new Date(typeof value === 'string' && !value.includes('T') ? value.replace(' ', 'T') + 'Z' : value).toLocaleString('zh-CN', { hour12: false })
const productName = (plan: string) => emailProduct(plan) ? productNameForId(emailProduct(plan)!.productId) : productNameForPlan(plan)
const viewIcons: Record<AdminView, LucideIcon> = {
  overview: LayoutDashboard,
  'my-shop': Store,
  products: Package,
  orders: ClipboardList,
  customers: Users,
  reports: ChartNoAxesCombined,
  partners: Users,
  settings: Settings2,
}
type Session = { ownerStoreScopes?: boolean; membershipEnabled?: boolean; membershipStores?: { id: string; name: string }[]; authenticated: boolean; configured: boolean; mailReady: boolean; username?: string }
type Identity = { shop: { id: string; name: string; brandName: string; logo: string }; storefront_url?: string }
type Detail = { order: ServerOrder & { platformStatus: PlatformOrderStatus | null; rechargeCredential?: RechargeCredential }; events: { id: string; actor: string; action: string; note: string; to_status: string; created_at: number }[] }
function SettlementBadge({ status }: { status?: 'pending' | 'paid' | null }) {
  if (!status) return null
  return <Badge variant="outline" className="admin-settlement-badge" data-state={status}>{status === 'paid' ? '已结算' : '结算处理中'}</Badge>
}
function OrderTable({ orders, onSelect }: { orders: (ServerOrder & { ownerStoreName?: string })[]; onSelect: (id: string) => void }) {
  return <div className="admin-table-scroll">
    <table className="admin-table">
      <thead><tr><th>订单 / 创建时间</th><th>商品套餐</th><th>店铺 / 渠道</th><th>订单金额</th><th>状态</th><th>类型</th><th><span className="sr-only">操作</span></th></tr></thead>
      <tbody>{orders.map(order => <tr key={order.id}>
        <td><button className="admin-order-id" onClick={() => onSelect(order.id)} title={order.id}>{order.id}</button><small>{time(order.createdAt)}</small></td>
        <td>{order.isTest ? '支付联调测试' : order.custom?.productName ?? productName(order.plan)}<small>{order.planName}</small></td>
        <td>{order.partnerName || order.ownerStoreName || '—'}</td>
        <td className="admin-numeric">{money(order.paymentSummary?.amountCents ?? Math.round(order.price * 100))}
          <small>{order.paymentStatus === 'simulated' ? '无实际收款' : order.paymentStatus === 'paid' ? '已到账' : '未付款'}</small>
        </td>
        <td><span className={'status-pill status-' + order.status}><span />{orderLabel(order)}</span><SettlementBadge status={order.settlementStatus} /></td>
        <td><span className="admin-mode">{order.isTest ? '实付测试' : order.mode === 'demo' ? '历史测试记录' : '正式'}</span></td>
        <td><Button variant="ghost" onClick={() => onSelect(order.id)}>查看 <ArrowUpRight size={14} /></Button></td>
      </tr>)}</tbody>
    </table>
  </div>
}
function Pagination({ page, total, onChange }: { page: number; total: number; onChange: (p: number) => void }) {
  return <div className="admin-pagination"><span>共 {total} 条 · 第 {page} / {Math.max(1, Math.ceil(total / 20))} 页</span><div><Button variant="outline" disabled={page <= 1} onClick={() => onChange(page - 1)}>上一页</Button><Button variant="outline" disabled={page * 20 >= total} onClick={() => onChange(page + 1)}>下一页</Button></div></div>
}
function OrdersPage({ revision, onSelect, scope, initialStatus, showActiveStatus }: {
  revision: number
  onSelect: (id: string) => void
  scope: AdminStoreScope
  initialStatus?: 'active'
  showActiveStatus: boolean
}) {
  const [search, setSearch] = useState('')
  const [q, setQ] = useState('')
  const [status, setStatus] = useState<string>(initialStatus ?? '')
  const [plan, setPlan] = useState('')
  const [page, setPage] = useState(1)
  const params = new URLSearchParams({ q, status, plan, page: String(page) })
  if (scope !== 'all') {
    params.set('scope', 'owner')
    if (scope !== 'owner') params.set('store', scope)
  }
  const { data, error, loading } = useResource<{ orders: (ServerOrder & { ownerStoreName?: string })[]; total: number }>('/api/admin/orders?' + params, revision)
  return <section className="admin-panel">
    <form className="admin-filters" onSubmit={event => { event.preventDefault(); setQ(search); setPage(1) }}>
      <div className="admin-search"><Search size={16} /><Input value={search} onChange={event => setSearch(event.target.value)} placeholder="搜索本站 / 上游单号或客户邮箱" aria-label="搜索本站 / 上游单号或客户邮箱" /></div>
      <select aria-label="订单状态" value={status} onChange={event => { setStatus(event.target.value); setPage(1) }}>
        <option value="">全部状态</option>{showActiveStatus && <option value="active">待处理</option>}
        {Object.entries(ORDER_LABELS).map(([value, label]) => <option key={value} value={value}>{value === 'session' ? '待交付 / 待提交资料' : value === 'processing' ? '处理中' : label}</option>)}
      </select>
      <select aria-label="商品套餐" value={plan} onChange={event => { setPlan(event.target.value); setPage(1) }}>
        <option value="">全部套餐</option><option value="plus">Plus</option><option value="pro-5x">Pro 5×</option><option value="pro-20x">Pro 10×</option>
        <option value="pro-25x">Pro 25×</option><option value="gemini-pro-18m">Gemini Pro 18 个月</option><option value="duolingo-12m">多邻国 1 年</option><option value="codex-sms-once">Codex 接码</option>
      </select>
      <Button type="submit" variant="outline">查询</Button>
    </form>
    <Feedback error={error} loading={loading} data={data} />
    {data && <>{data.orders.length ? <OrderTable orders={data.orders} onSelect={onSelect} /> : <div className="admin-empty"><Search size={25} /><h3>没有符合条件的订单</h3><p>试试其他订单号或筛选条件。</p></div>}
      <Pagination page={page} total={data.total} onChange={setPage} />
    </>}
  </section>
}
function OrderDetail({ id, onClose, onUpdated }: { id: string; onClose: () => void; onUpdated: () => void }) {
  const [revision, setRevision] = useState(0)
  const { data, error, loading } = useResource<Detail>(`/api/admin/orders/${id}`, revision)
  const [message, setMessage] = useState('')
  const [querying, setQuerying] = useState(false)
  const [queryError, setQueryError] = useState('')
  async function queryPlatform() {
    if (querying) return
    setQuerying(true); setQueryError(''); setMessage('')
    try {
      await api(`/api/admin/orders/${id}/platform-status`, {})
      setMessage('平台付款、充值与退款状态已同步，代理端刷新即可查看。'); setRevision(v => v + 1); onUpdated()
    } catch (e) { setQueryError(errorMessage(e)) }
    finally { setQuerying(false) }
  }
  const title = useRef<HTMLHeadingElement>(null)
  return <Dialog open onOpenChange={open => { if (!open) onClose() }}>
    <DialogContent className="admin-detail motion-dialog" initialFocus={title}>
      <DialogHeader><DialogTitle ref={title} tabIndex={-1}>订单详情</DialogTitle><DialogDescription className="admin-full-id">{id}</DialogDescription></DialogHeader>
      <Feedback error={error} loading={loading} data={data} shape="detail" />
      {data && <>
        {Boolean(data.order.paymentSummary?.feeCents) && <p className="admin-subtle">商品金额 {money(Math.round(data.order.price * 100))} + 平台手续费 {money(data.order.paymentSummary!.feeCents)}（{data.order.paymentSummary!.feeBps / 100}%）</p>}
        <div className="admin-detail-summary"><div><strong>{data.order.custom?.productName ?? productName(data.order.plan)} · {data.order.planName}</strong><span>{time(data.order.createdAt)}</span></div><strong>{money(data.order.paymentSummary?.amountCents ?? Math.round(data.order.price * 100))}</strong></div>
        <div className="admin-detail-flags"><span className={`status-pill status-${data.order.status}`}>{orderLabel(data.order)}</span><span className="admin-mode">{data.order.mode === 'demo' ? '历史测试记录 · 不计入收入' : '正式订单'}</span><SettlementBadge status={data.order.settlementStatus} /></div>
          <div className="admin-order-source" aria-label="订单来源"><div><span>代理名称</span><strong>{data.order.partnerSource?.name ?? '平台订单'}</strong></div>{data.order.partnerSource ? <><div><span>专属链接标识</span><strong>{data.order.partnerSource.slug}</strong></div><div><span>代理邮箱</span><strong><a href={`mailto:${data.order.partnerSource.email}`}>{data.order.partnerSource.email}</a></strong></div>{data.order.partnerSource.wechat && <div><span>微信</span><strong>{data.order.partnerSource.wechat}</strong></div>}{data.order.partnerSource.qq && <div><span>QQ</span><strong>{data.order.partnerSource.qq}</strong></div>}</> : <div><span>来源类型</span><strong>平台直营</strong></div>}</div>
        <p className="admin-subtle">客户下单邮箱：{data.order.customerEmail || '旧订单未留邮箱'} · 本站已记账退款 {money(data.order.refundedCents ?? 0)}{data.order.refundHold && ' · 售后处理中，请前往退款与售后处理'}</p>
        {data.order.platformStatus && <section className="admin-platform-status" aria-label="平台付款、充值与退款状态">
          <div className="admin-platform-status-heading"><h3>平台订单状态</h3><Button variant="outline" size="sm" disabled={querying || loading} onClick={() => void queryPlatform()}><RefreshCw size={14} />{querying ? '同步中…' : '同步平台状态'}</Button></div>
          {data.order.platformStatus.remoteId && <div className="admin-upstream-order"><span>上游单号</span><code>{data.order.platformStatus.remoteId}</code><CopyButton value={data.order.platformStatus.remoteId} label="复制上游单号" variant="outline" size="sm" /></div>}
          <dl><div><dt>付款状态</dt><dd>{platformPaymentLabel(data.order.platformStatus.paymentStatus)}</dd></div><div><dt>平台已退金额</dt><dd>{money(data.order.platformStatus.refundedCents)}</dd></div><div><dt>最近核验</dt><dd>{data.order.platformStatus.checkedAt ? time(data.order.platformStatus.checkedAt) : '尚未核验'}</dd></div></dl>
          {data.order.platformStatus.financialHold && <p className="admin-subtle">平台退款与本站账务待核对，充值和代理收益已冻结。</p>}
          <Feedback error={queryError} />
        </section>}
        {data.order.platformStatus && <RechargeRecoveryPanel order={data.order} upstreamOrderId={data.order.platformStatus.remoteId} credential={data.order.rechargeCredential} onUpdated={() => { setRevision(v => v + 1); onUpdated() }} />}
        {data.order.plan === 'gmail-account' && <GmailOrderPanel id={data.order.id} revision={revision} orderVersion={data.order.version} onSaved={() => { setRevision(v => v + 1); onUpdated() }} />}
        <ShopOrderActions order={data.order} onUpdated={() => { setRevision(v => v + 1); onUpdated() }} />
        {emailProduct(data.order.plan) && <EmailDeliveryPanel key={`delivery-${data.order.version}`} order={data.order} onSaved={() => { setRevision(v => v + 1); onUpdated() }} />}
        <h3>处理记录</h3>
        <ol className="admin-timeline">{data.events.map(event => <li key={event.id}><div><strong>{activityCopy(event.note || event.action)}</strong><time>{time(event.created_at)}</time></div><span>{event.actor === 'customer' ? '用户' : event.actor === 'system' ? '系统' : '管理员'} · {orderLabel({ ...data.order, status: event.to_status as keyof typeof ORDER_LABELS, fulfillment: undefined, refundedCents: 0, platformStatus: null, refundHold: false, redemptionBlocked: false })}</span></li>)}</ol>
        {message && <p className="admin-success" role="status">{message}</p>}
        <OrderActionForm key={`actions-${data.order.version}`} order={data.order} loading={loading} onRefresh={() => { setMessage(''); setRevision(v => v + 1) }} onSaved={result => { setMessage(result); setRevision(v => v + 1); onUpdated() }} />
      </>}
    </DialogContent>
  </Dialog>
}
function InterestPage({ revision }: { revision: number }) {
  const [page, setPage] = useState(1)
  const { data, error, loading } = useResource<{ rows: { id: string; product: string; email: string; consent_version: string; created_at: string }[]; total: number }>(`/api/admin/interest?page=${page}`, revision)
  return <section className="admin-panel"><div className="admin-panel-title"><h2>上线提醒登记</h2><span>上线通知尚未启用 · 仅保存登记</span></div><Feedback error={error} loading={loading} data={data} />{data && <><div className="admin-table-scroll"><table className="admin-table"><thead><tr><th>邮箱</th><th>关注商品</th><th>登记时间</th><th>邮箱状态</th></tr></thead><tbody>{data.rows.map(row => <tr key={row.id}><td>{row.email}</td><td>{row.product === 'claude' ? 'Claude' : 'Grok'}</td><td>{time(row.created_at)}</td><td><span className="admin-pill">未验证</span></td></tr>)}</tbody></table>{!data.rows.length && <div className="admin-empty"><Mail size={25} /><h3>暂无登记</h3><p>用户提交的上线提醒会保存在这里。</p></div>}</div><Pagination page={page} total={data.total} onChange={setPage} /></>}<p className="admin-panel-footnote">邮箱仅用于用户同意的商品上线通知。用户取消后，登记会从此处移除。</p></section>
}
function IntegrationsPage({ revision, mailReady }: { revision: number; mailReady: boolean }) {
  return <div className="integration-workspace">
    <PaymentChannelsPanel revision={revision} />
    <section className="integration-service-section">
      <div className="integration-section-title"><div><h2>邮件服务</h2><p>登录验证码与订单邮件</p></div></div>
      <div className="integration-service-rows"><div>
        <div className="integration-service-icon"><Mail size={19} /></div>
        <strong>Resend 邮件</strong>
        <span className={'connection-state' + (mailReady ? ' is-ready' : '')}>{mailReady ? '已配置' : '待配置'}</span>
      </div></div>
    </section>
  </div>
}

function AdminWorkspace({ session, sessionError, hostStore, dark, onTheme, onRefresh, onLogout, busy }: {
  session: Session
  sessionError: string
  hostStore?: AdminStore['id']
  dark: boolean
  onTheme: () => void
  onRefresh: () => void
  onLogout: () => void
  busy: boolean
}) {
  const [route, setRoute] = useState(() => adminWorkspaceRoute(location.search))
  const [revision, setRevision] = useState(0)
  const [detail, setDetail] = useState<string>()
  const [counts, setCounts] = useState<AdminNotifications>({})
  const heading = useRef<HTMLHeadingElement>(null)
  const supportsStoreScopes = session.ownerStoreScopes === true
  const directory = useResource<{ stores: AdminStore[] }>(supportsStoreScopes ? '/api/admin/my-shop/directory' : null, revision)
  const stores = directory.data?.stores ?? []
  const memberStores = session.membershipStores ?? (session.membershipEnabled ? [{ id: 'store-3', name: 'AI星球' }] : [])
  const { view, tab, supplier } = route
  const { label, tabs } = ADMIN_WORKSPACES[view]
  const visibleTabs = tabs.filter(([id]) => {
    if (!supportsStoreScopes && view === 'my-shop') return id === 'stores'
    if (!supportsStoreScopes && view === 'products') return id === 'catalog'
    return id !== 'members' || session.membershipEnabled || tab === 'members'
  })
  const kind = supportsStoreScopes ? adminScopeKind(view, tab) : undefined
  const memberStore = memberStores.find(store => store.id === hostStore) ?? memberStores[0]
  const selectedId = route.store ?? (kind === 'membership' ? ownerStoreId(memberStore?.id) : hostStore) ?? 'platform'
  const selected = stores.find(store => store.id === selectedId)
  const scope = supportsStoreScopes ? route.store ?? route.scope ?? 'owner' : 'all'
  const storeOptions = stores.map(store => ({ value: store.id, label: store.name + (store.active ? '' : '（停用）') }))
  const dataOptions = [{ value: 'owner', label: '全部自营店铺' }, ...storeOptions, { value: 'all', label: '全平台（含代理）' }]
  const scopeOptions = kind === 'data' ? dataOptions : kind === 'membership'
    ? storeOptions.filter(store => store.value === selectedId || memberStores.some(enabled => enabled.id === store.value))
    : storeOptions
  const scopedName = dataOptions.find(option => option.value === scope)?.label ?? '店铺'
  const saved = () => setRevision(value => value + 1)
  const pageUrl = (id: AdminView) => adminWorkspaceUrl(id, { tab: ADMIN_WORKSPACES[id].tabs[0]?.[0] })
  const refundsUrl = adminWorkspaceUrl('orders', { tab: 'refunds' })
  const ticketsUrl = adminWorkspaceUrl('partners', { tab: 'tickets' })

  function navigate(url: string, replace = false) {
    if (location.pathname + location.search !== url) {
      if (replace) history.replaceState(null, '', url)
      else history.pushState(null, '', url)
    }
    setRoute(adminWorkspaceRoute(location.search))
    setDetail(undefined)
  }
  function follow(event: MouseEvent<HTMLAnchorElement>) {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
    event.preventDefault()
    navigate(event.currentTarget.pathname + event.currentTarget.search)
  }
  function changeTab(next: string) {
    const nextKind = adminScopeKind(view, next)
    navigate(adminWorkspaceUrl(view, {
      tab: next,
      store: nextKind || view === 'my-shop' ? route.store : undefined,
      scope: nextKind === 'data' ? route.scope : undefined,
    }))
  }
  function changeScope(value: string) {
    const store = ownerStoreId(value)
    const nextScope = value === 'owner' || value === 'all' ? value : undefined
    if (!store && !nextScope) return
    navigate(adminWorkspaceUrl(view, { ...route, store, scope: nextScope }))
  }

  useEffect(() => {
    const restore = () => { setRoute(adminWorkspaceRoute(location.search)); setDetail(undefined) }
    window.addEventListener('popstate', restore)
    return () => window.removeEventListener('popstate', restore)
  }, [])
  useEffect(() => {
    const canonical = adminWorkspaceUrl(route.view, route)
    if (location.pathname + location.search !== canonical) history.replaceState(null, '', canonical)
  }, [route])
  useEffect(() => { heading.current?.focus({ preventScroll: true }) }, [view])

  function renderPanel() {
    if ((kind === 'store' || kind === 'membership') && !selected) return <Feedback {...directory} />
    switch (view) {
      case 'overview':
        return <Workbench revision={revision} counts={counts} onNavigate={navigate} supportsStoreScopes={supportsStoreScopes} />
      case 'my-shop':
        if (!supportsStoreScopes) return <SupportContactsPanel endpoint="/api/admin/support-contacts" revision={revision} />
        return <MyShop section={tab === 'domains' || tab === 'notifications' ? tab : 'stores'} storeId={selectedId}
          edit={route.edit} revision={revision} onSaved={saved}
          onCloseEditor={route.edit ? () => navigate(adminWorkspaceUrl('my-shop', { tab: 'stores' }), true) : undefined}
          onOpen={(id, section) => {
            const targets = { orders: ['orders', 'list'], customers: ['customers', 'directory'], visitors: ['reports', 'visitors'] } as const
            const [target, targetTab] = targets[section]
            navigate(adminWorkspaceUrl(target, { tab: targetTab, store: ownerStoreId(id) }))
          }}
        />
      case 'products':
        if (tab === 'sorting' && selected) return <StoreDisplay store={selected} revision={revision} onSaved={saved} />
        if (supportsStoreScopes && (tab === 'prices' || tab === 'coupons')) return <MyShop section={tab} storeId={selectedId} revision={revision} onSaved={saved} />
        return <ProductCatalog key={supplier} revision={revision} supplier={supplier ?? 'all'} onSupplier={next => navigate(adminWorkspaceUrl('products', { tab: 'catalog', supplier: next }))} onSaved={saved} onOrder={setDetail} />
      case 'orders':
        if (tab === 'refunds') return <RefundsPage revision={revision} />
        return <OrdersPage key={scope + (route.status ?? '')} scope={scope} initialStatus={supportsStoreScopes ? route.status : undefined} showActiveStatus={supportsStoreScopes} revision={revision} onSelect={setDetail} />
      case 'customers':
        if (tab === 'members') return <MembersPage key={selectedId} revision={revision} store={selectedId} enabled={memberStores.some(store => store.id === selectedId)} />
        if (tab === 'interest') return <InterestPage revision={revision} />
        return <CustomerManagement key={scope} admin orderScope={supportsStoreScopes ? scope : undefined} revision={revision} />
      case 'reports':
        if (tab === 'profit') return <AccountingReport revision={revision} />
        if (tab === 'accounting') return <AccountingPage revision={revision} />
        if (tab === 'invoices') return <InvoiceWorkspace admin revision={revision} />
        return <AdminVisitorsPage scope={scope} scopeLabel={scopedName} onScopeChange={changeScope} revision={revision} />
      case 'partners':
        if (tab === 'tickets') return <TicketWorkspace admin revision={revision} onOrder={setDetail} />
        if (tab === 'payouts') return <PartnerPayouts revision={revision} onSaved={saved} />
        if (tab === 'defaults') return <PartnerDefaultPrices revision={revision} />
        return <PartnersPage revision={revision} />
      case 'settings':
        return tab === 'security' ? <SecurityPage revision={revision} /> : <IntegrationsPage revision={revision} mailReady={session.mailReady} />
    }
  }

  const scopeLabel = view === 'overview' ? undefined
    : view === 'products' && tab === 'catalog' ? '共享商品库'
    : view === 'my-shop' || view === 'products' ? '自营店铺' : '全平台'
  const panel = renderPanel()
  return <div className="admin-shell">
    <aside className="admin-sidebar">
      <a className="admin-brand" href={pageUrl('overview')} onClick={follow}><Package size={24} /><strong>商城管理后台</strong></a>
      <nav aria-label="后台导航">
        {(Object.keys(ADMIN_WORKSPACES) as AdminView[]).map(id => {
          const Icon = viewIcons[id]
          return <a className={id === 'settings' ? 'admin-nav-settings' : undefined} key={id} href={pageUrl(id)} onClick={follow} aria-current={view === id ? 'page' : undefined}>
            <Icon size={17} />{ADMIN_WORKSPACES[id].label}
          </a>
        })}
      </nav>
      <div className="admin-sidebar-bottom"><span><ShieldCheck size={15} />{session.username}</span><Button variant="ghost" onClick={onLogout} disabled={busy}><LogOut size={15} />退出登录</Button></div>
    </aside>
    <div className="admin-workspace">
      <header className="admin-topbar">
        <h1 ref={heading} tabIndex={-1}>{label}</h1>
        <div className="admin-page-tools">
          {kind ? scopeOptions.length > 0 && <div className="admin-scope-control">
            <label htmlFor="admin-scope">{kind === 'membership' ? '活动店铺' : '店铺范围'}</label>
            <WorkspaceSelect id="admin-scope" label={kind === 'membership' ? '邀新活动店铺' : '店铺范围'} value={kind === 'data' ? scope : selectedId} options={scopeOptions} onValueChange={changeScope} />
          </div> : scopeLabel && <span className="admin-pill admin-page-scope">{scopeLabel}</span>}
          <span className="admin-page-tool-divider" aria-hidden="true" />
          <Button variant="ghost" size="icon" aria-label="刷新" title="刷新" onClick={() => { saved(); onRefresh() }}><RefreshCw size={16} /></Button>
          <TicketAlerts onOpen={() => navigate(ticketsUrl)} onRefunds={() => navigate(refundsUrl)} onCounts={setCounts} />
          <Button variant="ghost" size="icon" aria-label={dark ? '切换亮色模式' : '切换暗色模式'} onClick={onTheme}>{dark ? <Sun size={17} /> : <Moon size={17} />}</Button>
        </div>
      </header>
      <main className="admin-main">
        <Feedback error={sessionError || (kind === 'data' ? directory.error : '')} />
        {visibleTabs.length > 1 ? <Tabs key={view} className="admin-section-tabs" value={tab} onValueChange={value => changeTab(String(value))}>
          <div className="admin-section-tab-scroll">
            <TabsList variant="line" aria-label={label}>{visibleTabs.map(([id, name]) => <TabsTrigger key={id} value={id}>{name}</TabsTrigger>)}</TabsList>
          </div>
          <TabsContent key={tab} value={tab}>{panel}</TabsContent>
        </Tabs> : panel}
      </main>
    </div>
    {detail && <OrderDetail key={detail} id={detail} onClose={() => setDetail(undefined)} onUpdated={saved} />}
  </div>
}

export default function Admin() {
  const [accessRequired, setAccessRequired] = useState(false)
  const [restartingAccess, setRestartingAccess] = useState(false)
  const [accessError, setAccessError] = useState('')
  const accessRestartPending = useRef(false)
  async function reauthenticate() {
    if (accessRestartPending.current) return
    accessRestartPending.current = true
    setRestartingAccess(true); setAccessError('')
    try { await restartAdminAccess() }
    catch {
      accessRestartPending.current = false
      setRestartingAccess(false)
      setAccessError('未能重置安全验证，请重试；也可以先手动退出安全验证，再重新打开后台。')
    }
  }
  useEffect(() => {
    const requireAccess = () => setAccessRequired(true)
    window.addEventListener('ymx-admin-access-required', requireAccess)
    return () => window.removeEventListener('ymx-admin-access-required', requireAccess)
  }, [])
  const sendHuman = useAuthVerification('admin_send')
  const loginHuman = useAuthVerification('admin_verify')
  const { session, error: sessionError, setError: setSessionError, check: checkSession, clear: clearSession } = useSession<Session>('/api/admin/session', 'admin', !accessRequired)
  const [username, setUsername] = useState(''); const [code, setCode] = useState(''); const [busy, setBusy] = useState(false)
  const [emailCode, setEmailCode] = useState(''); const [challenge, setChallenge] = useState<{ id: string; username: string }>(); const [sending, setSending] = useState(false); const [cooldown, setCooldown] = useState(0); const [mailNotice, setMailNotice] = useState('')
  const [dark, setDark] = useState(() => document.documentElement.classList.contains('dark'))
  const { data: shopIdentity } = useResource<Identity>('/api/catalog?identity=1')
  const hostStore = ownerStoreId(shopIdentity?.shop?.id)
  const loginStore = ownerStoreId(new URLSearchParams(location.search).get('store')) ?? hostStore ?? 'platform'
  const shopName = shopIdentity?.shop?.brandName || '商店'
  const authenticated = session?.authenticated ?? false
  useEffect(() => {
    document.title = authenticated ? '商城管理后台' : shopName + ' · 管理后台'
    const icon = document.querySelector<HTMLLinkElement>('link[rel=icon]')
    if (icon) icon.href = authenticated ? '/favicon.svg' : shopIdentity?.shop?.logo || '/favicon.svg'
  }, [authenticated, shopName, shopIdentity?.shop?.logo])
  useEffect(() => applyAppearance(dark), [dark])
  useEffect(() => { if (cooldown <= 0) return; const timer = setTimeout(() => setCooldown(v => v - 1), 1000); return () => clearTimeout(timer) }, [cooldown])
  async function sendCode() {
    if (!sendHuman.ready || busy || sending || cooldown || !username.trim()) return
    setSending(true); setSessionError(''); setMailNotice(''); setEmailCode(''); setChallenge(undefined)
    const requestedUsername = username.trim()
    try {
      const result = await api<{ challenge: string; message: string; retryAfter: number }>('/api/admin/login/email-code', { username: requestedUsername, storeId: loginStore, ...sendHuman.consume() })
      setChallenge({ id: result.challenge, username: requestedUsername }); setMailNotice(result.message); setCooldown(result.retryAfter)
    } catch (e) { setSessionError(errorMessage(e)) } finally { setSending(false) }
  }
  async function login() {
    if (!loginHuman.ready || busy || sending || !challenge || challenge.username !== username.trim()) return
    setBusy(true); setSessionError('')
    try { await api('/api/admin/login', { username: username.trim(), code, emailCode, challenge: challenge.id, ...loginHuman.consume() }); setCode(''); setEmailCode(''); setChallenge(undefined); setMailNotice(''); await checkSession() } catch (e) { setSessionError(errorMessage(e)) } finally { setBusy(false) }
  }
  async function logout() { setBusy(true); try { await api('/api/admin/logout', {}); clearSession(); setUsername(''); setCode(''); setEmailCode(''); setChallenge(undefined); setMailNotice('') } catch (e) { setSessionError(errorMessage(e)) } finally { setBusy(false) } }
  if (accessRequired) return <main className="admin-login"><div className="admin-login-box"><div className="admin-brand"><ShopBrand platform name={shopName} logo={shopIdentity?.shop.logo} /><span>管理后台</span></div><ShieldCheck className="admin-login-icon" size={30} /><h1>重新进行安全验证</h1><p>点击下方按钮，先退出旧的 Cloudflare 安全验证会话，再使用授权管理员邮箱重新验证。</p><Button onClick={() => void reauthenticate()} disabled={restartingAccess}>{restartingAccess ? '正在重置安全验证…' : '前往安全验证'}</Button>{accessError && <><p role="alert">{accessError}</p><a href="/cdn-cgi/access/logout">手动退出安全验证</a></>}<small>完成验证前，已暂停后台请求。</small></div></main>
  if (!session && !sessionError) return <WorkspaceBoot />
  if (!session?.authenticated) return <main className="admin-login"><a className="admin-back" href="/"><ArrowLeft size={15} />返回商店</a><div className="admin-login-box"><div className="admin-brand"><ShopBrand platform name={shopName} logo={shopIdentity?.shop.logo} /><span>管理后台</span></div><ShieldCheck className="admin-login-icon" size={30} /><h1>登录工作台</h1><p>管理商品、查看订单，跟进每一次服务。</p><Feedback error={sessionError} />{!session ? sessionError ? <Button variant="outline" onClick={() => void checkSession()}>重新连接</Button> : <Feedback loading /> : !session.configured ? <div className="admin-setup"><h2>等待管理员初始化</h2><p>后台已部署，尚未设置登录身份。请在项目终端运行 <code>npm run admin:setup</code> 配置管理员账号与验证器。</p><Button variant="outline" onClick={() => void checkSession()}>已配置，重新检查</Button></div> : <form onSubmit={e => { e.preventDefault(); void login() }}>
      <label htmlFor="admin-username">用户名</label>
      <Input id="admin-username" autoComplete="username" placeholder="请输入管理员用户名" value={username} onChange={e => { setUsername(e.target.value); setChallenge(undefined); setEmailCode(''); setMailNotice('') }} disabled={busy || sending} required maxLength={80} />
      {sendHuman.widget}
      <label htmlFor="admin-email-code">邮箱验证码</label>
      <div className="admin-email-code-row"><Input id="admin-email-code" inputMode="numeric" autoComplete="one-time-code" placeholder="6 位邮箱验证码" value={emailCode} onChange={e => setEmailCode(e.target.value.replace(/\D/g, '').slice(0, 6))} disabled={busy || sending} required pattern="[0-9]{6}" minLength={6} maxLength={6} aria-describedby="admin-email-help" /><Button type="button" variant="outline" onClick={() => void sendCode()} disabled={!sendHuman.ready || busy || sending || cooldown > 0 || !username.trim() || !session.mailReady}>{sending ? '发送中…' : cooldown > 0 ? cooldown + ' 秒后重发' : '获取验证码'}</Button></div>
      <p id="admin-email-help" className="admin-code-help">验证码发送至预设管理员邮箱，10 分钟内有效。</p>
      {mailNotice && <p role="status" className="admin-code-help">{mailNotice}</p>}
      {!session.mailReady && <p role="alert" className="admin-code-help">邮箱验证服务尚未启用，暂时无法登录。</p>}
      <label htmlFor="admin-code">2FA 验证码</label>
      <Input id="admin-code" inputMode="numeric" autoComplete="off" placeholder="6 位验证器验证码" value={code} onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} disabled={busy || sending} required pattern="[0-9]{6}" minLength={6} maxLength={6} aria-describedby="admin-code-help" />
      <p id="admin-code-help" className="admin-code-help">打开已绑定的验证器，输入当前验证码。</p>
      {challenge && loginHuman.widget}
      <Button type="submit" disabled={!loginHuman.ready || busy || sending || !session.mailReady || !username.trim() || !challenge || challenge.username !== username.trim() || emailCode.length !== 6 || code.length !== 6}>{busy ? '正在登录…' : '登录后台'}</Button>
    </form>}<small>仅授权管理员可访问</small></div></main>
  return <AdminWorkspace session={session} sessionError={sessionError} hostStore={hostStore}
    dark={dark} onTheme={() => setDark(value => !value)} onRefresh={() => void checkSession()}
    onLogout={() => void logout()} busy={busy} />
}
