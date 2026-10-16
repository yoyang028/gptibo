import { useEffect, useRef, useState } from 'react'
import { ArrowLeft, ArrowRight, Check, ChevronRight, ClipboardPaste, ExternalLink, FileJson2, LoaderCircle, LockKeyhole, RefreshCw, ScanLine, ShieldCheck, Trash2, UserRound, X } from 'lucide-react'
import { Button } from './ui/button'
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from './ui/accordion'
import { ProductMark } from './brand'
import { api, errorMessage, RequestError } from '@/lib/api'
import { storefrontHref } from '@/lib/storefront-routing'
import { accountPlanLabel, readAccountSession, type AccountCheckReport } from '../../shared/chatgpt-account'
import '@/styles/account-check.css'

const sessionUrl = 'https://chatgpt.com/api/auth/session'
const date = (value: string | null) => value && Number.isFinite(Date.parse(value)) ? new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Shanghai', hour12: false }).format(new Date(value)) : '未返回'
const resultCopy: Record<AccountCheckReport['state'], [string, string]> = {
  checked: ['已读取账号信息', '下面是本次实时查询返回的订阅信息。'],
  expired: ['这份 Session 已失效', '请重新登录 ChatGPT，再获取一份完整的 Session。'],
  limited: ['查询暂时受限', 'ChatGPT 限制了查询频率，请稍后再试。'],
  unavailable: ['这次暂时没有查到', '未能读取 ChatGPT 的订阅信息，请稍后重试，或前往 ChatGPT 设置核对。'],
  unknown: ['订阅信息仍待确认', '返回的信息不完整，本次无法判断套餐或开通条件。'],
}

export function AccountCheckPage({ onNavigate }: { onNavigate: (page: string) => void }) {
  const [raw, setRaw] = useState('')
  const [consent, setConsent] = useState(false)
  const [busy, setBusy] = useState(false)
  const [report, setReport] = useState<AccountCheckReport | null>(null)
  const [identity, setIdentity] = useState<{ email: string; expiresAt: string | null } | null>(null)
  const [error, setError] = useState('')
  const [pasteHint, setPasteHint] = useState('')
  const [cooldown, setCooldown] = useState(0)
  const input = useRef<HTMLTextAreaElement>(null)
  const pending = useRef<AbortController | null>(null)
  const parsed = readAccountSession(raw)
  useEffect(() => () => pending.current?.abort(), [])
  useEffect(() => {
    if (!raw) return
    const timer = window.setTimeout(() => { pending.current?.abort(); pending.current = null; setRaw(''); setConsent(false); setBusy(false); setPasteHint('Session 已从当前页面清除。再次检测时请重新粘贴。') }, 180000)
    return () => window.clearTimeout(timer)
  }, [raw])
  useEffect(() => {
    if (cooldown <= 0) return
    const timer = window.setTimeout(() => setCooldown(value => Math.max(0, value - 1)), 1000)
    return () => window.clearTimeout(timer)
  }, [cooldown])
  function reset() {
    pending.current?.abort(); pending.current = null
    setRaw(''); setConsent(false); setBusy(false); setReport(null); setIdentity(null); setError(''); setPasteHint('')
    requestAnimationFrame(() => input.current?.focus())
  }
  async function paste() {
    try {
      const value = await navigator.clipboard.readText()
      if (!value.trim()) throw new Error('empty clipboard')
      setRaw(value); setConsent(false); setReport(null); setIdentity(null); setError(''); setPasteHint('')
    } catch { setPasteHint('请点击输入框，按 Ctrl+V（Mac 为 ⌘V），或长按选择粘贴。'); input.current?.focus() }
  }
  async function run() {
    const current = readAccountSession(raw)
    if (!current.ok || !consent || busy || cooldown > 0) return
    const controller = new AbortController(); pending.current = controller
    setBusy(true); setError(''); setReport(null)
    setIdentity({ email: current.session.email, expiresAt: current.session.expiresAt })
    try {
      const value = await api<{ report: AccountCheckReport }>('/api/tools/account-check', { session: raw, consent: true }, controller.signal)
      if (pending.current !== controller || controller.signal.aborted) return
      setReport(value.report)
      setCooldown(value.report.state === 'limited' ? 60 : 10)
      if (value.report.state === 'expired') { setRaw(''); setConsent(false) }
    } catch (e) {
      if (pending.current !== controller || controller.signal.aborted) return
      setError(errorMessage(e))
      if (e instanceof RequestError && e.status === 429) setCooldown(60)
    } finally { if (pending.current === controller) { pending.current = null; setBusy(false) } }
  }
  const [title, description] = report ? resultCopy[report.state] : ['', '']
  return <div className="account-check-page page-width reveal-in">
    <nav className="product-breadcrumb" aria-label="当前位置"><a href={storefrontHref('product/chatgpt')} onClick={e => { if (e.button || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return; e.preventDefault(); onNavigate('product/chatgpt') }}>ChatGPT</a><ChevronRight size={13} /><span aria-current="page">账号检测</span></nav>
    <div className="account-check-intro"><span className="section-kicker">CHATGPT / ACCOUNT CHECK</span><h1>先了解账号，<br /><span>再选择套餐。</span></h1><p>粘贴 Session，查看当前账号与订阅信息。<br className="check-mobile-break" />不用下单，也不会触发充值。</p></div>
    <div className="account-check-layout">
      <section className="account-check-panel" aria-label="账号检测">
        <div className="check-panel-heading"><div><ScanLine size={20} /><h2>账号检测</h2></div><span><LockKeyhole size={12} />只读查询</span></div>
        <form onSubmit={e => { e.preventDefault(); void run() }}>
          <label htmlFor="account-check-session" className="check-field-label">ChatGPT Session<span>完整 JSON</span></label>
          {parsed.ok ? <div className="check-identity" role="status"><span className="check-identity-avatar"><UserRound size={20} /></span><div><small>待检测账号 · 本地识别</small><strong>{parsed.session.email}</strong></div><button type="button" aria-label="清除并重新粘贴 Session" onClick={reset} disabled={busy}><X size={16} /></button></div> : <textarea ref={input} id="account-check-session" value={raw} onChange={e => { setRaw(e.target.value); setConsent(false); setReport(null); setIdentity(null); setError(''); setPasteHint('') }} maxLength={32000} autoComplete="off" autoCapitalize="none" spellCheck={false} disabled={busy} placeholder={'{"user": {"email": "…"}, "accessToken": "…", "expires": "…"}'} aria-describedby="account-check-input-hint" aria-invalid={Boolean(raw && !parsed.ok)} />}
          <div className="check-input-tools"><span id="account-check-input-hint">{parsed.ok ? '只识别了输入内容，尚不代表账号验证通过。' : raw ? parsed.message : '登录 ChatGPT 后，复制 Session 页的完整内容。'}</span><button type="button" onClick={() => void paste()} disabled={busy}><ClipboardPaste size={13} />粘贴</button></div>
          {pasteHint && <p className="check-paste-hint" role="status">{pasteHint}</p>}
          <label className="check-consent"><input type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)} disabled={busy || !parsed.ok} /><span>我同意本站使用这份 Session 向 ChatGPT 发起本次只读查询。</span></label>
          <Button className="check-submit" type="submit" disabled={busy || !parsed.ok || !consent || cooldown > 0}>{busy ? <><LoaderCircle size={16} className="processing-spinner" />正在读取订阅…</> : cooldown > 0 ? `${cooldown} 秒后可重新检测` : <>{report ? <RefreshCw size={16} /> : <ScanLine size={16} />}{report ? '重新检测' : '开始检测'}<ArrowRight size={16} /></>}</Button>
          <p className="check-privacy"><ShieldCheck size={14} /><span>本站不保存 Session 原文，不读取聊天记录。仅向 ChatGPT 查询账号信息；输入内容会在 3 分钟后从本页清除。</span></p>
        </form>
        {error && <p className="check-error" role="alert">{error}</p>}
        <div className="check-result" aria-live="polite" aria-atomic="true" aria-busy={busy}>
          {busy ? <div className="check-loading"><span className="check-radar"><ScanLine size={30} /></span><h3>正在读取账号信息</h3><p>查询期间请留在当前页面。</p><div><span><Check size={12} />本地识别</span><span><LoaderCircle size={12} className="processing-spinner" />实时查询</span><span>返回结果</span></div></div> : report ? <section className={`check-report check-report-${report.state}`} aria-label="检测结果">
            <div className="check-report-heading"><span className="check-report-symbol">{report.state === 'checked' ? <Check size={22} /> : <FileJson2 size={22} />}</span><div><h3>{title}</h3><p>{description}</p></div></div>
            <div className="check-report-account"><UserRound size={14} /><strong>{identity?.email}</strong><span>检测输入账号</span></div>
            {report.state === 'checked' && <><dl className="check-report-facts"><div><dt>当前套餐</dt><dd>{accountPlanLabel(report.plan)}</dd></div><div><dt>订阅状态</dt><dd>{report.subscriptionActive === true ? '有效订阅' : report.subscriptionActive === false ? '无有效订阅' : '未返回'}</dd></div><div><dt>订阅渠道</dt><dd>{report.source ? ({ web: '网页订阅', ios: 'iOS 内购', android: '安卓内购' })[report.source] : '未返回'}</dd></div><div><dt>账单地区</dt><dd>{report.region || '未返回'}</dd></div><div><dt>订阅到期时间</dt><dd>{date(report.subscriptionExpiresAt)}</dd></div><div><dt>自动续费</dt><dd>{report.autoRenew === true ? '已开启' : report.autoRenew === false ? '已关闭' : '未返回'}</dd></div></dl><div className="check-eligibility"><ShieldCheck size={16} /><div><strong>{report.plan === 'workspace' ? '请切换到个人账号后核对套餐' : '开通与升级资格，仍需在充值时核验'}</strong><p>{report.plan === 'workspace' ? '工作区订阅与个人订阅不同，请确认提交的是需要充值的个人账号。' : '本次查询展示当前订阅；不能据此保证可新开、续费或升级。已有订阅请先核对渠道与到期时间。'}</p></div></div></>}
            <div className="check-report-bottom"><span>查询时间 · {date(report.checkedAt)}（北京时间）</span><button type="button" onClick={reset}><Trash2 size={13} />清除检测内容</button></div>
          </section> : <div className="check-empty"><span><ScanLine size={26} strokeWidth={1.3} /></span><div><strong>检测结果会显示在这里</strong><p>不会创建订单、付款或改变你的订阅。</p></div></div>}
        </div>
      </section>
      <aside className="check-guide" aria-label="获取 Session 的步骤"><div className="check-guide-brand"><ProductMark small productId="chatgpt" /><span>第一次检测？</span></div><h2>只需三步。</h2><ol><li><span>01</span><div><strong>登录自己的 ChatGPT</strong><p>在同一个浏览器中，确认登录的是需要检测的账号。</p><a href="https://chatgpt.com/" target="_blank" rel="noreferrer">打开 ChatGPT <ExternalLink size={12} /></a></div></li><li><span>02</span><div><strong>打开 Session 页</strong><p>页面显示一整段 JSON 是正常的。全选并复制完整内容。</p><a href={sessionUrl} target="_blank" rel="noreferrer">获取 Session <ExternalLink size={12} /></a></div></li><li><span>03</span><div><strong>粘贴，开始检测</strong><p>核对识别到的邮箱，同意本次查询后，查看订阅结果。</p></div></li></ol><div className="check-guide-note"><LockKeyhole size={15} /><p>Session 是登录凭据。请只提交你有权使用的账号；检测完成可随时清除输入。</p></div></aside>
    </div>
    <div className="check-back"><a href={storefrontHref('product/chatgpt')} onClick={e => { if (e.button || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return; e.preventDefault(); onNavigate('product/chatgpt') }}><ArrowLeft size={14} />返回 ChatGPT 选择套餐</a><a href="https://chatgpt.com/#settings" target="_blank" rel="noreferrer">在 ChatGPT 核对订阅 <ExternalLink size={12} /></a></div>
    <section className="check-faq"><h2>检测前，你可能想知道。</h2><Accordion><AccordionItem value="privacy"><AccordionTrigger>会保存 Session 或修改账号吗？</AccordionTrigger><AccordionContent>不会将 Session 原文写入数据库或日志，也不读取聊天记录。本次查询只向 ChatGPT 发出读取账号信息的请求，不会创建订单、付款、充值或取消订阅。输入仅短暂保留在本页内存，3 分钟后自动清除；离开检测页也会清除。</AccordionContent></AccordionItem><AccordionItem value="eligibility"><AccordionTrigger>检测出套餐，就代表一定可以充值吗？</AccordionTrigger><AccordionContent>当前订阅和充值资格是两件事。检测页只展示本次读到的账号、套餐、渠道等信息；没有返回的字段会标注“未返回”。最终能否新开、续费或升级，需要在实际订单的充值步骤核验。</AccordionContent></AccordionItem><AccordionItem value="unavailable"><AccordionTrigger>为什么会提示没有查到？</AccordionTrigger><AccordionContent>可能是 Session 失效、ChatGPT 限流、网络或查询权限限制。没有查到不代表免费账号或可充值账号。你可以重新获取 Session 后重试，也可以前往 ChatGPT 的设置查看订阅与账单。</AccordionContent></AccordionItem></Accordion></section>
  </div>
}
