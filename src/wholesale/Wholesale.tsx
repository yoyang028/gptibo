import { useEffect, useRef, useState } from 'react'
import { ArrowDownToLine, ArrowRight, Box, Code2, Layers3, LogOut, Package, RefreshCw, Search, ShieldCheck, Wallet } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { CopyButton } from '@/components/copy-button'
import { api, errorMessage, RequestError } from '@/lib/api'
import { useResource } from '@/lib/use-resource'
import { useSession } from '@/lib/use-session'
import type { WholesaleAccount, WholesaleKey, WholesaleLedger, WholesaleOrder, WholesaleProduct, WholesaleTopup } from '../../shared/wholesale'
import { Balance, Empty, Field, Message, Pages, Status, cents, date, money } from './ui'
import './wholesale.css'

type Session = { authenticated: boolean; mailReady: boolean; name?: string }
type Tab = 'products' | 'orders' | 'wallet' | 'api'
const tabs = [{ id: 'products', label: '商品拿货', icon: Box }, { id: 'orders', label: '采购订单', icon: Package }, { id: 'wallet', label: '账户余额', icon: Wallet }, { id: 'api', label: 'API 对接', icon: Code2 }] as const
function initialTab(): Tab { const selected = new URLSearchParams(location.search).get('tab'); return tabs.find(t => t.id === selected)?.id ?? 'products' }
function Logo() { return <a className="ws-logo" href="/"><span><Layers3 size={22} /></span><div>代理供货中心<small>PARTNER SUPPLY</small></div></a> }

function Login({ session, error, onLogin, retry }: { session: Session | undefined; error: string; onLogin: () => Promise<void>; retry: () => Promise<void> }) {
  const [email, setEmail] = useState(''), [code, setCode] = useState(''), [challenge, setChallenge] = useState('')
  const [busy, setBusy] = useState(false), [failure, setFailure] = useState(''), [notice, setNotice] = useState(''), [cooldown, setCooldown] = useState(0)
  useEffect(() => { if (cooldown <= 0) return; const id = setTimeout(() => setCooldown(v => v - 1), 1000); return () => clearTimeout(id) }, [cooldown])
  async function send() {
    if (busy || cooldown) return
    setBusy(true); setFailure(''); setChallenge(''); setCode('')
    try { const result = await api<{ challenge: string; message: string; retryAfter: number }>('/api/partner/auth/send', { email }); setChallenge(result.challenge); setNotice(result.message); setCooldown(result.retryAfter) }
    catch (e) { setFailure(errorMessage(e)) } finally { setBusy(false) }
  }
  async function login() {
    if (busy) return
    setBusy(true); setFailure('')
    try { await api('/api/partner/auth/verify', { challenge, code }); await onLogin() } catch (e) { setFailure(errorMessage(e)) } finally { setBusy(false) }
  }
  return <main className="ws-login"><section className="ws-login-story"><Logo /><div><span className="ws-eyebrow">为每一次合作，准备好供给</span><h1>你的生意，<br />从这里补给。</h1><p>一处查看代理价格、采购商品与管理余额。<br />从第一笔拿货，到你自己商店的 API 对接。</p></div><div className="ws-login-features"><span><Box />代理专属价格</span><span><Wallet />余额按单扣款</span><span><Code2 />API 自动拿货</span></div><small>专为合作代理开放 · 账号由供货方开通</small></section><section className="ws-login-panel"><div className="ws-login-card"><span className="ws-eyebrow">PARTNER ACCESS</span><h2>欢迎回来</h2><p>使用已开通代理的邮箱登录。</p><Message error={failure || error} notice={notice} />{!session ? <><p role="status">{error ? '连接未成功，请重试。' : '正在连接代理服务…'}</p>{error && <Button onClick={() => void retry()}>重新连接</Button>}</> : <form onSubmit={e => { e.preventDefault(); void login() }}><label className="ws-field"><span>代理邮箱</span><Input type="email" autoComplete="username" required placeholder="you@company.com" maxLength={254} value={email} disabled={busy} onChange={e => { setEmail(e.target.value); setChallenge(''); setNotice(''); setCode('') }} /></label><label className="ws-field"><span>邮箱验证码</span><div className="ws-input-action"><Input required inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} placeholder="6 位验证码" value={code} disabled={busy} onChange={e => setCode(e.target.value.replace(/\D/g, ''))} /><Button type="button" variant="outline" disabled={busy || cooldown > 0 || !session.mailReady || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)} onClick={() => void send()}>{cooldown ? `${cooldown} 秒` : '获取验证码'}</Button></div></label>{!session.mailReady && <Message notice="代理邮箱登录尚未配置，请联系供货方开通。" />}<Button type="submit" className="ws-login-submit" disabled={busy || !challenge || code.length !== 6}>{busy ? '正在处理…' : '进入供货中心'}<ArrowRight size={16} /></Button></form>}<div className="ws-login-note"><ShieldCheck size={16} />代理价与采购记录仅对登录账号可见。</div></div><footer>代理供货中心 <span>·</span> 稳定的合作，从清晰的每一单开始。</footer></section></main>
}

type PurchaseDraft = { request_key: string; product_id: string; quantity: number; max_unit_price_cents: number; buyer_note: string }
function Purchase({ product, draft, saveDraft, onClose, onSuccess }: { product: WholesaleProduct; draft: PurchaseDraft | null; saveDraft: (draft: PurchaseDraft | null) => void; onClose: () => void; onSuccess: (order: WholesaleOrder) => void }) {
  const [quantity, setQuantity] = useState(draft?.quantity ?? 1), [note, setNote] = useState(draft?.buyer_note ?? '')
  const [busy, setBusy] = useState(false), [error, setError] = useState('')
  const pending = useRef(draft)
  async function buy() {
    if (busy) return
    setBusy(true); setError('')
    try {
      const request = pending.current ?? { request_key: crypto.randomUUID(), product_id: product.id, quantity, max_unit_price_cents: product.price_cents, buyer_note: note }
      saveDraft(request); pending.current = request
      const result = await api<{ order: WholesaleOrder }>('/api/wholesale/orders', request)
      saveDraft(null); pending.current = null; onSuccess(result.order)
    } catch (e) {
      if (e instanceof RequestError && [400, 404, 409].includes(e.status)) { saveDraft(null); pending.current = null }
      setError(e instanceof Error && !(e instanceof RequestError) ? e.message : errorMessage(e))
    } finally { setBusy(false) }
  }
  return <Dialog open onOpenChange={open => { if (!open && !busy) onClose() }}><DialogContent className="ws-dialog"><DialogHeader><DialogTitle>{draft ? '核对上次拿货请求' : '确认拿货'}</DialogTitle><DialogDescription>{product.name} · {product.fulfillment === 'stock' ? '库存卡密，扣款后自动交付' : '人工处理，交付后可在订单查看'}</DialogDescription></DialogHeader><Message error={error} />{draft && <Message notice="保留原请求编号重试，已成功的订单会直接返回，不重复扣款。" />}<form onSubmit={e => { e.preventDefault(); void buy() }}><label className="ws-field"><span>数量</span><Input type="number" min={1} max={100} step={1} required value={quantity} disabled={busy || Boolean(pending.current)} onChange={e => setQuantity(Number(e.target.value))} /></label><label className="ws-field"><span>需求备注（选填，不填写密码或密钥）</span><textarea maxLength={1000} value={note} disabled={busy || Boolean(pending.current)} onChange={e => setNote(e.target.value)} /></label><div className="ws-order-total"><span>从余额扣除</span><strong>{money((draft?.max_unit_price_cents ?? product.price_cents) * quantity)}</strong></div><Button type="submit" disabled={busy || !Number.isSafeInteger(quantity) || quantity < 1 || quantity > 100}>{busy ? '正在确认…' : draft ? '使用原编号确认结果' : '确认扣款并拿货'}<ArrowRight size={15} /></Button></form></DialogContent></Dialog>
}

function OrderDetail({ orderId, close }: { orderId: string; close: () => void }) {
  const [revision, setRevision] = useState(0)
  const { data, error, loading } = useResource<{ order: WholesaleOrder }>('/api/wholesale/orders/' + orderId, revision)
  const order = data?.order
  return <Dialog open onOpenChange={open => { if (!open) close() }}><DialogContent className="ws-dialog"><DialogHeader><DialogTitle>采购订单</DialogTitle><DialogDescription>{orderId}</DialogDescription></DialogHeader><Message error={error} />{loading && <p role="status">正在读取订单…</p>}{order && <><div className="ws-detail-title"><h3>{order.product_name}</h3><Status value={order.status} /></div><p>{order.quantity} 件 · 实付 {money(order.amount_cents)} · {date(order.created_at)}</p>{order.buyer_note && <p>需求备注：{order.buyer_note}</p>}{order.handling_note && <p>处理说明：{order.handling_note}</p>}{order.delivery?.length ? <div className="ws-deliveries"><div><strong>交付内容</strong><CopyButton value={order.delivery.join('\n')} label="复制全部" /></div>{order.delivery.map((content, index) => <pre key={index}>{content}</pre>)}</div> : <Empty>{order.status === 'refunded' ? '本单金额已退回账户余额。' : '订单已收到，供货方处理后会在此交付。'}</Empty>}<small>请求编号：{order.request_key}</small></>}<Button variant="outline" onClick={() => setRevision(r => r + 1)} disabled={loading}><RefreshCw size={14} />刷新订单</Button></DialogContent></Dialog>
}

function Orders({ revision, select }: { revision: number; select: (id: string) => void }) {
  const [page, setPage] = useState(1)
  const { data, error, loading } = useResource<{ orders: WholesaleOrder[]; total: number }>('/api/wholesale/orders?page=' + page, revision)
  return <section className="ws-panel"><Message error={error} />{loading && <p role="status">正在读取订单…</p>}{data?.orders.length ? <div className="ws-table-wrap"><table><thead><tr><th>商品 / 订单</th><th>数量</th><th>金额</th><th>状态</th><th>下单时间</th><th><span className="sr-only">操作</span></th></tr></thead><tbody>{data.orders.map(o => <tr key={o.id}><td><strong>{o.product_name}</strong><small>{o.id}</small></td><td>{o.quantity}</td><td>{money(o.amount_cents)}</td><td><Status value={o.status} /></td><td>{date(o.created_at)}</td><td><Button variant="ghost" onClick={() => select(o.id)}>查看<ArrowRight size={14} /></Button></td></tr>)}</tbody></table></div> : !loading && !error ? <Empty>还没有采购记录。完成拿货后，订单与交付内容会显示在这里。</Empty> : null}{data && <Pages page={page} total={data.total} onChange={setPage} />}</section>
}

function WalletPage({ account, revision, onChange }: { account?: WholesaleAccount; revision: number; onChange: () => void }) {
  const [page, setPage] = useState(1), [topupPage, setTopupPage] = useState(1), [error, setError] = useState(''), [notice, setNotice] = useState(''), [busy, setBusy] = useState(false)
  const retry = useRef<{ fingerprint: string; key: string } | null>(null)
  const ledger = useResource<{ ledger: WholesaleLedger[]; total: number }>('/api/wholesale/ledger?page=' + page, revision)
  const topups = useResource<{ topups: WholesaleTopup[]; total: number }>('/api/wholesale/topups?page=' + topupPage, revision)
  async function submit(form: HTMLFormElement) {
    if (busy) return
    setBusy(true); setError(''); setNotice('')
    try {
      const fields = new FormData(form), amount = cents(fields.get('amount')), reference = String(fields.get('reference') ?? '').trim()
      const fingerprint = JSON.stringify([amount, reference])
      if (retry.current?.fingerprint !== fingerprint) retry.current = { fingerprint, key: crypto.randomUUID() }
      await api('/api/wholesale/topups', { amount_cents: amount, payment_reference: reference, request_key: retry.current.key })
      retry.current = null; form.reset(); setNotice('已提交充值核对，实际到账核实后会增加余额。'); onChange()
    } catch (e) { setError(e instanceof RequestError ? e.message : e instanceof Error ? e.message : errorMessage(e)) } finally { setBusy(false) }
  }
  return <><div className="ws-wallet-grid"><section className="ws-wallet-card"><span>可用余额</span><Balance amount={account?.balance_cents ?? 0} /><p>拿货时按订单金额扣款；退款退回本账户余额。</p><ShieldCheck size={28} /></section><section className="ws-panel"><h2>充值余额</h2><p className="ws-preline">{account?.payment_instructions || '供货方尚未设置充值收款方式。'}</p><Message error={error} notice={notice} />{account?.topup_enabled && <form className="ws-topup-form" onSubmit={e => { e.preventDefault(); void submit(e.currentTarget) }}><fieldset disabled={busy}><Field label="实际付款金额（元）" name="amount" type="number" placeholder="例如 500.00" /><Field label="付款流水或备注" name="reference" placeholder="供货方用于核对的付款信息" /><Button type="submit">{busy ? '正在提交…' : '提交到账核对'}</Button></fieldset><small>提交记录后等待店主核对，余额不会立即增加。</small></form>}</section></div><section className="ws-panel"><h2>充值记录</h2><Message error={topups.error} />{topups.loading && <p role="status">读取中…</p>}{topups.data?.topups.length ? <div className="ws-table-wrap"><table><thead><tr><th>申请时间</th><th>金额</th><th>付款备注</th><th>状态</th><th>核对说明</th></tr></thead><tbody>{topups.data.topups.map(t => <tr key={t.id}><td>{date(t.created_at)}</td><td>{money(t.amount_cents)}</td><td>{t.payment_reference}</td><td><Status value={t.status} /></td><td>{t.handling_note || '—'}</td></tr>)}</tbody></table></div> : !topups.loading && <Empty>暂无充值记录</Empty>}{topups.data && <Pages page={topupPage} total={topups.data.total} onChange={setTopupPage} />}</section><section className="ws-panel"><h2>资金流水</h2><Message error={ledger.error} />{ledger.loading && <p role="status">读取中…</p>}{ledger.data?.ledger.length ? <div className="ws-table-wrap"><table><thead><tr><th>时间 / 关联编号</th><th>类型</th><th>变动</th><th>变动后余额</th></tr></thead><tbody>{ledger.data.ledger.map(l => <tr key={l.id}><td>{date(l.created_at)}<small>{l.reference_id}</small></td><td>{{ topup: '充值入账', purchase: '采购扣款', refund: '订单退款' }[l.kind]}</td><td>{l.amount_cents > 0 ? '+' : ''}{money(l.amount_cents)}</td><td>{money(l.balance_cents)}</td></tr>)}</tbody></table></div> : !ledger.loading && <Empty>暂无资金流水</Empty>}{ledger.data && <Pages page={page} total={ledger.data.total} onChange={setPage} />}</section></>
}

function ApiPage({ revision, onChange }: { revision: number; onChange: () => void }) {
  const keys = useResource<{ keys: WholesaleKey[] }>('/api/wholesale/keys', revision)
  const [token, setToken] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState('')
  async function create(form: HTMLFormElement) {
    if (busy) return
    setBusy(true); setError(''); setToken('')
    try { const result = await api<{ token: string }>('/api/wholesale/keys', { name: new FormData(form).get('name') }); setToken(result.token); form.reset(); onChange() } catch (e) { setError(errorMessage(e)) } finally { setBusy(false) }
  }
  async function revoke(id: string) { setBusy(true); setError(''); try { await api('/api/wholesale/keys/' + id + '/revoke', {}); setToken(''); onChange() } catch (e) { setError(errorMessage(e)) } finally { setBusy(false) } }
  const example = `curl '${location.origin}/api/wholesale/orders' \\\n  -H 'Authorization: Bearer YOUR_API_KEY' \\\n  -H 'Content-Type: application/json' \\\n  -H 'Idempotency-Key: your-order-00001' \\\n  -d '{"product_id":"your-product","quantity":1,"max_unit_price_cents":500}'`
  return <><section className="ws-panel"><div className="ws-section-title"><div><h2>连接你的商店</h2><p>网页与 API 使用同一个代理账户、同一份余额。密钥仅放在你的服务器。</p></div><Code2 size={28} /></div><Message error={error || keys.error} /><form className="ws-key-form" onSubmit={e => { e.preventDefault(); void create(e.currentTarget) }}><Field label="密钥名称" name="name" placeholder="例如：我的商店正式环境" maxLength={60} /><Button type="submit" disabled={busy}>创建 API 密钥</Button></form>{token && <div className="ws-secret"><strong>请现在保存，关闭后无法再次查看完整密钥。</strong><code>{token}</code><CopyButton value={token} label="复制密钥" /><Button variant="ghost" onClick={() => setToken('')}>已保存，隐藏</Button></div>}<div className="ws-key-list">{keys.data?.keys.map(k => <div key={k.id}><div><strong>{k.name}</strong><small>{k.prefix}… · {k.revoked_at ? '已撤销' : k.expires_at <= Date.now() ? '已过期' : `有效至 ${date(k.expires_at)}`}</small></div><Button variant="outline" disabled={busy || Boolean(k.revoked_at) || k.expires_at <= Date.now()} onClick={() => void revoke(k.id)}>撤销密钥</Button></div>)}</div><small>每个密钥有效期 90 天，最多 5 个有效密钥。账号停用或身份更新后密钥失效。</small></section><section className="ws-panel ws-api-docs"><h2>接入说明</h2><div className="ws-api-steps"><span><b>01</b>查询商品与代理价</span><span><b>02</b>携带唯一单号下单</span><span><b>03</b>查询订单与交付内容</span></div><div className="ws-table-wrap"><table><thead><tr><th>请求</th><th>用途</th></tr></thead><tbody>{[['GET /account','余额与账户信息'],['GET /products','已上架商品、代理价、库存'],['POST /orders','从余额扣款并创建采购订单'],['GET /orders?request_key=你的单号','按原请求编号找回结果'],['GET /orders/{id}','查询订单状态与 delivery 交付数组'],['GET /ledger?page=1','查看资金流水，每页 50 条']].map(([path, use]) => <tr key={path}><td><code>/api/wholesale{path.slice(path.indexOf(' ')+1)}</code><small>{path.split(' ')[0]}</small></td><td>{use}</td></tr>)}</tbody></table></div><h3>下单示例</h3><p>金额单位为人民币分。将商品编号和最高单价替换成目录中确认的值。</p><div className="ws-code"><pre>{example}</pre><CopyButton value={example} label="复制示例" /></div><p>重复使用相同 Idempotency-Key 和相同内容会返回原订单。超时后先用原编号查询或重试，不要换编号重新购买。库存商品立即交付；人工商品返回 pending，请间隔至少 10 秒查询原单。</p><p>状态：pending 待处理、fulfilled 已交付、refunded 已退回余额。余额不足或库存不足返回 409，不扣款；401 表示身份失效；429 时至少等待 60 秒。</p></section></>
}

function Portal({ logout }: { logout: () => Promise<void> }) {
  const [tab, setTab] = useState<Tab>(initialTab), [revision, setRevision] = useState(0), [query, setQuery] = useState(''), [category, setCategory] = useState('all')
  const [selected, setSelected] = useState<WholesaleProduct | null>(null), [detail, setDetail] = useState(''), [error, setError] = useState('')
  const account = useResource<WholesaleAccount>('/api/wholesale/account', revision)
  const catalog = useResource<{ products: WholesaleProduct[] }>('/api/wholesale/products', revision)
  const storageKey = account.data ? 'gptibo-wholesale-pending-v1:' + account.data.id : null
  const [draft, setDraft] = useState<PurchaseDraft | null>(null)
  useEffect(() => {
    if (!storageKey) return
    try {
      const saved = JSON.parse(sessionStorage.getItem(storageKey) || 'null')
      setDraft(saved && typeof saved.request_key === 'string' && typeof saved.product_id === 'string' && Number.isSafeInteger(saved.quantity) && saved.quantity > 0 && saved.quantity <= 100 && Number.isSafeInteger(saved.max_unit_price_cents) && saved.max_unit_price_cents > 0 ? saved : null)
    } catch { setDraft(null) }
  }, [storageKey])
  function saveDraft(next: PurchaseDraft | null) { if (!storageKey) throw new Error('账户仍在读取，请稍后重试。'); try { if (next) sessionStorage.setItem(storageKey, JSON.stringify(next)); else sessionStorage.removeItem(storageKey) } catch { if (next) throw new Error('当前浏览器无法保留订单编号，请启用站点存储后重试。') } setDraft(next) }
  function navigate(next: Tab) { const url = new URL(location.href); url.searchParams.set('tab', next); history.pushState(null, '', url); setTab(next) }
  useEffect(() => { const restore = () => setTab(initialTab()); window.addEventListener('popstate', restore); return () => window.removeEventListener('popstate', restore) }, [])
  const products = catalog.data?.products ?? [], categories = [...new Set(products.map(p => p.category))]
  const filtered = products.filter(p => (category === 'all' || p.category === category) && [p.name, p.id, p.description].some(v => v.toLowerCase().includes(query.toLowerCase())))
  const refresh = () => setRevision(r => r + 1)
  return <><header className="ws-header"><Logo /><nav aria-label="代理站导航">{tabs.map(t => <button key={t.id} aria-current={tab === t.id ? 'page' : undefined} onClick={() => navigate(t.id)}><t.icon size={16} />{t.label}</button>)}</nav><div className="ws-header-account"><span>{account.data?.name ?? '代理账户'}</span><Button variant="ghost" size="icon" aria-label="退出登录" onClick={() => { setError(''); void logout().catch(e => setError(errorMessage(e))) }}><LogOut size={16} /></Button></div></header><main className="ws-main"><div className="ws-page-heading"><div><span className="ws-eyebrow">YOUR SUPPLY WORKSPACE</span><h1>{tabs.find(t => t.id === tab)?.label}</h1><p>{{ products: '挑选商品，按代理价拿货。每一单，都清楚。', orders: '查看采购进度，领取你的交付内容。', wallet: '充值、扣款与退款，每一笔都有记录。', api: '让你的商店，直接连接供货。' }[tab]}</p></div><div className="ws-heading-actions"><button className="ws-wallet-shortcut" onClick={() => navigate('wallet')}><Wallet size={17} /><span>可用余额<strong>{account.data ? money(account.data.balance_cents) : '读取中'}</strong></span><ArrowRight size={16} /></button><Button variant="outline" size="icon" aria-label="刷新数据" onClick={refresh}><RefreshCw size={16} /></Button></div></div><Message error={error || account.error || catalog.error} />{draft && <div className="ws-pending"><span>有一笔拿货请求的结果待确认，请先查询原单。</span><Button variant="outline" onClick={() => { setError(''); void api<{ order: WholesaleOrder }>('/api/wholesale/orders?request_key=' + encodeURIComponent(draft.request_key)).then(r => { saveDraft(null); setDetail(r.order.id); refresh() }).catch(e => { if (e instanceof RequestError && e.status === 404) { const p = products.find(p => p.id === draft.product_id); if (p) setSelected(p); else { saveDraft(null); setError('未创建订单，商品已下架。') } } else setError(errorMessage(e)) }) }}>核对原单</Button></div>}{tab === 'products' && <><div className="ws-catalog-tools"><div className="ws-categories"><button aria-pressed={category === 'all'} onClick={() => setCategory('all')}>全部商品</button>{categories.map(c => <button key={c} aria-pressed={category === c} onClick={() => setCategory(c)}>{c}</button>)}</div><label className="ws-search"><Search size={16} /><Input aria-label="搜索供货商品" placeholder="搜索商品或 SKU" value={query} onChange={e => setQuery(e.target.value)} /></label></div>{catalog.loading && <p role="status">正在读取代理价与库存…</p>}{filtered.length ? <div className="ws-product-grid">{filtered.map((p, index) => <article className="ws-product" key={p.id}><div className="ws-product-top"><span className="ws-product-icon" data-tone={index % 3}><Package size={25} strokeWidth={1.4} /></span><span className="ws-stock">{p.fulfillment === 'stock' ? `${p.stock} 件可用` : '人工交付'}</span></div><span className="ws-product-category">{p.category}</span><h2>{p.name}</h2><p>{p.description || '具体交付内容请在购买前向供货方确认。'}</p><small>SKU · {p.id}</small><div className="ws-product-bottom"><div><span>代理价</span><strong>{money(p.price_cents)}<small>/ 件</small></strong></div><Button disabled={Boolean(draft) || (p.fulfillment === 'stock' && p.stock === 0)} onClick={() => setSelected(p)}>{p.fulfillment === 'stock' && p.stock === 0 ? '暂时缺货' : '立即拿货'}<ArrowRight size={14} /></Button></div></article>)}</div> : !catalog.loading && <Empty>{products.length ? '没有匹配的商品，试试其他关键词。' : '供货商品正在准备中，上架后将在这里显示代理价。'}</Empty>}<div className="ws-catalog-note"><ArrowDownToLine size={16} />库存商品自动交付，人工商品按订单处理。拿货后可随时查看采购记录。</div></>}{tab === 'orders' && <Orders revision={revision} select={setDetail} />}{tab === 'wallet' && <WalletPage account={account.data ?? undefined} revision={revision} onChange={refresh} />}{tab === 'api' && <ApiPage revision={revision} onChange={refresh} />}</main><footer className="ws-footer"><span>代理供货中心</span><span>商品 · 余额 · 订单 · API</span></footer>{selected && <Purchase key={selected.id} product={selected} draft={draft} saveDraft={saveDraft} onClose={() => setSelected(null)} onSuccess={o => { setSelected(null); setDetail(o.id); refresh() }} />}{detail && <OrderDetail orderId={detail} close={() => setDetail('')} />}</>
}

export default function Wholesale() {
  const { session, error, check, clear } = useSession<Session>('/api/partner/auth/session', 'partner')
  useEffect(() => { document.title = '代理供货中心 · 代理价、余额拿货与 API'; document.querySelector('meta[name="description"]')?.setAttribute('content', '合作代理专属供货中心。查看代理价、余额采购与 API 对接。') }, [])
  async function logout() { await api('/api/partner/auth/logout', {}); clear() }
  return <div className="ws-app">{session?.authenticated ? <Portal logout={logout} /> : <Login session={session} error={error} onLogin={check} retry={check} />}</div>
}
