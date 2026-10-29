import { useEffect, useMemo, useRef, useState, type Ref } from 'react'
import { ArrowRight, Check, CheckCircle2, ChevronLeft, ChevronRight, Clipboard, Clock3, FileText, LockKeyhole, Mail, MousePointer2, Pause, Play, RotateCcw, ShieldCheck, UserRound } from 'lucide-react'
import { toString as qrToString } from 'qrcode'
import { Button } from './ui/button'
import { ProductMark } from './brand'
import { RechargeSceneCanvas } from './recharge-scene-canvas'
import { customerProductName, variantLabel } from '@/lib/shop-presentation'
import type { ShopProduct } from '../../shared/shop-products'
import { SERVICE_GUIDE_NOTICE, SERVICE_RECHARGE_NAMES, serviceRechargeSteps, type ServiceRechargeFamily, type ServiceGuideScene } from '../../shared/service-recharge-guide'
import '@/styles/recharge-guide.css'
import './service-recharge-guide.css'

const price = (product: ShopProduct) => product.pricePending ? '待定价' : '¥' + (product.priceCents / 100).toFixed(2)

function DemoScene({ family, product, variants, scene, phase, qr }: { family: ServiceRechargeFamily; product: ShopProduct; variants: ShopProduct[]; scene: ServiceGuideScene; phase: number; qr: string }) {
  const name = SERVICE_RECHARGE_NAMES[family], label = variantLabel(product, name, variants)
  const code = `${family === 'codex-credits' ? 'CODEX' : family.toUpperCase()}-DEMO-ONLY`
  const stage = useRef<HTMLDivElement>(null), [pointer, setPointer] = useState({ x: 0, y: 0 })
  useEffect(() => {
    if (scene !== 'selection' || phase === 0) return
    const update = () => {
      const body = stage.current?.querySelector<HTMLElement>('.sg-site-body'), target = stage.current?.querySelector<HTMLElement>('.sg-plan[data-selected=true]')
      if (!body || !target) return
      const surface = body.getBoundingClientRect(), rect = target.getBoundingClientRect(), scale = surface.width / body.offsetWidth
      setPointer({ x: (rect.left - surface.left + rect.width * .72) / scale, y: (rect.top - surface.top + rect.height * .55) / scale })
    }
    const frame = requestAnimationFrame(update), observer = new ResizeObserver(update)
    if (stage.current) observer.observe(stage.current)
    return () => { cancelAnimationFrame(frame); observer.disconnect() }
  }, [scene, phase, product.id])
  return <div ref={stage} className="sg-demo" data-scene={scene} data-phase={phase} aria-hidden="true" inert>
    <header className="sg-site-header"><span className="sg-site-brand"><ProductMark small productId={family} /><strong>{name}</strong></span><span>全部商品 <ChevronRight size={12} /> {name}</span><span className="sg-sample">操作示意</span></header>
    <div className="sg-site-body">
      {scene === 'selection' ? <div className="sg-shop-layout">
        <section className="sg-product-panel"><div className="sg-product-heading"><ProductMark productId={family} /><div><h3>{name}</h3><p>{family === 'codex-credits' ? '选择适合你的编程额度' : '为自己的账号，选择适合的订阅'}</p></div></div>
          <h4>选择适合你的规格</h4><div className="sg-plan-list">{variants.map(item => <div key={item.id} className="sg-plan" data-selected={phase > 0 && item.id === product.id}><span className="sg-radio">{phase > 0 && item.id === product.id && <i />}</span><span><strong>{variantLabel(item, name, variants)}</strong><small>{item.duration}</small></span><b>{price(item)}</b></div>)}</div>
          <p className="sg-detail-note"><ShieldCheck size={14} />先核对账号条件，再确认规格。</p>
        </section>
        <aside className="sg-order-panel"><h4>订单摘要</h4><div className="sg-order-product"><ProductMark small productId={family} /><strong>{customerProductName(product.name)}</strong></div><dl><div><dt>所选规格</dt><dd>{label}</dd></div><div><dt>交付内容</dt><dd>兑换码 + 随单指引</dd></div></dl><div className="sg-total"><span>商品价格</span><b>{price(product)}</b></div><span className="sg-demo-action">核对规格与订单 <ArrowRight size={15} /></span><small>购买状态与支付方式以商品页面为准。</small></aside>
        {phase > 0 && <MousePointer2 className="sg-pointer sg-select-pointer" size={24} style={{ left: pointer.x, top: pointer.y }} />}
      </div> : scene === 'payment' ? <div className="sg-center"><section className="sg-flow-card sg-payment-card"><div className="sg-flow-title"><span className="sg-step-icon"><Mail size={22} /></span><div><h3>{phase === 0 ? '填写订单通知邮箱' : phase === 1 ? '核对订单并付款' : '付款确认'}</h3><p>通知邮箱用于接收订单消息</p></div></div><div className="sg-order-product"><ProductMark small productId={family} /><strong>{customerProductName(product.name)}</strong><b>{price(product)}</b></div><div className="sg-field"><span>订单通知邮箱</span><strong>{phase === 0 ? 'demo@…' : 'demo@example.invalid'}</strong></div>{phase === 0 ? <span className="sg-demo-action">核对订单信息 <ArrowRight size={15} /></span> : phase === 1 ? <><div className="sg-demo-qr">{qr && <img src={qr} width={142} height={142} alt="" />}<span>付款示意</span></div><p className="sg-centered-copy">按订单页面实际提供的方式完成付款</p></> : <div className="sg-confirmed"><CheckCircle2 size={23} /><span>付款已确认，等待交付兑换资料</span></div>}</section></div>
      : scene === 'delivery' ? <div className="sg-center"><section className="sg-flow-card"><div className="sg-flow-title"><span className="sg-step-icon"><FileText size={22} /></span><div><h3>在原订单领取交付内容</h3><p>{customerProductName(product.name)}</p></div></div><div className="sg-order-state"><CheckCircle2 size={16} />付款确认并完成交付</div><div className="sg-code"><span>本单兑换码</span><strong>{phase === 0 ? '•••• •••• ••••' : code}</strong><small>演示内容</small></div><div className="sg-demo-action" data-pulse={phase === 1}><Clipboard size={15} />复制兑换码</div><div className="sg-order-guide"><FileText size={21} /><div><strong>对应兑换入口与操作指引</strong><small>从原订单打开，按本单资料操作。</small></div><ArrowRight size={16} /></div>{phase > 1 && <MousePointer2 className="sg-pointer sg-guide-pointer" size={24} />}</section></div>
      : scene === 'account' ? <div className="sg-center"><section className="sg-flow-card"><div className="sg-flow-title"><ProductMark productId={family} /><div><h3>核对准备充值的账号</h3><p>从本单指引打开对应入口</p></div></div><div className="sg-field"><span>所购规格</span><strong>{label}</strong></div><div className="sg-field"><span>本单兑换码</span><strong>{phase > 0 ? code : '等待填入兑换码'}</strong></div><div className="sg-account"><UserRound size={22} /><div><strong>我的 {name} 账号</strong><small>演示账号 · 请核对本人目标账号</small></div>{phase > 1 && <CheckCircle2 size={20} />}</div><p className="sg-detail-note">{family === 'grok' ? '确认美区账号、半价优惠资格和现有订阅。' : '按商品条件和随单指引检查目标账号。'}</p><span className="sg-demo-action">核对账号与规格 <ArrowRight size={15} /></span></section></div>
      : scene === 'submission' ? <div className="sg-center"><section className="sg-flow-card"><div className="sg-flow-title"><ProductMark productId={family} /><div><h3>{phase < 2 ? '确认并提交兑换' : '正在处理兑换'}</h3><p>{customerProductName(product.name)}</p></div></div><dl className="sg-review"><div><dt>所选规格</dt><dd>{label}</dd></div><div><dt>目标账号</dt><dd>我的 {name} 账号</dd></div><div><dt>交付来源</dt><dd>本站原订单</dd></div></dl><div className="sg-check-line"><span data-checked={phase > 0}>{phase > 0 && <Check size={13} />}</span>已核对目标账号、规格和适用条件</div>{phase < 2 ? <span className="sg-demo-action" data-pulse={phase === 1}>按随单指引提交兑换 <ArrowRight size={15} /></span> : <><div className="sg-processing"><i /><i /><i /></div><p className="sg-centered-copy">等待处理结果，保留原订单核对进度</p></>}</section></div>
      : <div className="sg-center"><section className="sg-flow-card sg-result-card"><div className="sg-result-check"><Check size={32} /></div><h3>{family === 'codex-credits' ? '核对新增额度' : '核对订阅与权益'}</h3><p>兑换完成后，回到对应账号验收。</p><div className="sg-order-product"><ProductMark productId={family} /><div><strong>{customerProductName(product.name)}</strong><small>我的 {name} 账号</small></div></div><ul>{product.features.slice(0, 3).map(feature => <li key={feature}><Check size={14} />{feature}</li>)}</ul><div className="sg-result-note"><Clock3 size={15} />记录所选规格、到账结果及原订单号。</div></section></div>}
    </div>
  </div>
}

export function ServiceRechargeGuide({ family, product, variants, sectionRef }: { family: ServiceRechargeFamily; product: ShopProduct; variants: ShopProduct[]; sectionRef?: Ref<HTMLElement> }) {
  const steps = useMemo(() => serviceRechargeSteps(family), [family]), name = SERVICE_RECHARGE_NAMES[family]
  const player = useRef<HTMLDivElement>(null)
  const [index, setIndex] = useState(0), [elapsed, setElapsed] = useState(0), [playing, setPlaying] = useState(true)
  const [visible, setVisible] = useState(false), [foreground, setForeground] = useState(!document.hidden)
  const [reduced, setReduced] = useState(() => matchMedia('(prefers-reduced-motion: reduce)').matches), [qr, setQr] = useState('')
  const running = playing && visible && foreground && !reduced
  const current = steps[index], phase = reduced ? 2 : elapsed < 1400 ? 0 : elapsed < 3800 ? 1 : 2
  function select(next: number) { setIndex(next); setElapsed(0) }
  useEffect(() => {
    const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), { threshold: .2 })
    if (player.current) observer.observe(player.current)
    const visibility = () => setForeground(!document.hidden), media = matchMedia('(prefers-reduced-motion: reduce)'), preference = () => setReduced(media.matches)
    document.addEventListener('visibilitychange', visibility); media.addEventListener('change', preference)
    return () => { observer.disconnect(); document.removeEventListener('visibilitychange', visibility); media.removeEventListener('change', preference) }
  }, [])
  useEffect(() => {
    if (!running) return
    let last = performance.now()
    const timer = window.setInterval(() => { const now = performance.now(), delta = now - last; last = now; setElapsed(value => Math.min(value + delta, current.duration)) }, 100)
    return () => clearInterval(timer)
  }, [running, current.duration, index])
  useEffect(() => {
    if (elapsed < current.duration) return
    const frame = requestAnimationFrame(() => { if (index === steps.length - 1) setPlaying(false); else { setIndex(value => value + 1); setElapsed(0) } })
    return () => cancelAnimationFrame(frame)
  }, [elapsed, current.duration, index, steps.length])
  useEffect(() => {
    let active = true
    void qrToString(`DEMO-ONLY-${family}-WALKTHROUGH`, { type: 'svg', margin: 3, width: 142, color: { dark: '#171719', light: '#ffffff' } }).then(svg => { if (active) setQr(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`) })
    return () => { active = false }
  }, [family])
  function replay() { select(0); setPlaying(true) }
  return <section ref={sectionRef} id={'service-recharge-' + family} className="recharge-guide service-recharge-guide page-width" data-family={family} data-running={running} data-reduced={reduced} aria-labelledby={'service-recharge-title-' + family}>
    <header className="rg-heading"><div><span className="section-kicker">从选购，到兑换</span><h2 id={'service-recharge-title-' + family}>{name} 充值流程演示</h2><p>领取兑换码，按随单指引为自己的账号充值。</p></div><div className="rg-controls">{!reduced && <Button variant="outline" size="icon" className="rg-play-toggle" aria-label={playing ? '暂停流程动画' : '播放流程动画'} onClick={() => { if (index === steps.length - 1 && elapsed >= current.duration) replay(); else setPlaying(value => !value) }}>{playing ? <Pause size={16} /> : <Play size={16} />}</Button>}<Button variant="ghost" className="rg-replay-button" onClick={replay} aria-label={reduced ? '回到第一步' : '重播'}><RotateCcw size={14} /><span>{reduced ? '回到开始' : '重播'}</span></Button></div></header>
    <div className="rg-layout"><ol className="rg-step-list" aria-label={name + '充值步骤'}>{steps.map((step, i) => <li key={step.scene}><button type="button" onClick={() => select(i)} aria-current={index === i ? 'step' : undefined} className={index === i ? 'rg-active' : ''}><span className="rg-step-number">{i < index ? <Check size={15} /> : `0${i + 1}`}</span><span className="rg-step-label"><strong>{step.title}</strong><small>第 {i + 1} 步</small></span><span className="rg-step-short">{step.short}</span><ChevronRight size={14} className="rg-step-chevron" /></button></li>)}</ol>
      <div className="rg-player"><div className="rg-browser" ref={player}><div className="rg-browser-bar"><div className="rg-window-dots"><i /><i /><i /></div><div className="rg-address"><LockKeyhole size={11} /><span>{current.address}</span></div></div><div className="sg-scene" key={family + ':' + index} data-step={index}><RechargeSceneCanvas>{() => <DemoScene family={family} product={product} variants={variants} scene={current.scene} phase={phase} qr={qr} />}</RechargeSceneCanvas></div><div className="rg-progress"><span style={{ width: `${elapsed / current.duration * 100}%` }} /></div></div>
        <div className="rg-caption"><div key={index} className="rg-caption-copy" aria-live={playing && !reduced ? 'off' : 'polite'}><span>0{index + 1} / 06</span><h3>{current.title}</h3><p>{current.description}</p></div><div className="rg-navigation"><Button variant="ghost" size="icon" disabled={index === 0} onClick={() => select(index - 1)} aria-label="上一步"><ChevronLeft size={18} /></Button><Button variant="ghost" size="icon" disabled={index === steps.length - 1} onClick={() => select(index + 1)} aria-label="下一步"><ChevronRight size={18} /></Button></div></div>
      </div></div><p className="rg-scope">{SERVICE_GUIDE_NOTICE}</p>
  </section>
}
