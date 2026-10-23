import { useEffect, useState } from 'react'
import { ArrowLeft, ArrowRight, ChevronRight, Expand, LifeBuoy } from 'lucide-react'
import { Button } from './ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from './ui/dialog'
import { storefrontHref } from '@/lib/storefront-routing'
import { MUSE_EMAIL_STEPS, MUSE_INVITE_SECTIONS } from '../../shared/muse-guides'
import { MUSE_ACCOUNT_GUIDE, MUSE_INVITE_GUIDE } from '../../shared/muse-products'
import './muse-guides.css'

const emailSections = [
  { id: 'prepare', label: '准备与交付格式' },
  { id: 'login', label: '01–04 登录与设置' },
  { id: 'add-email', label: '05–10 添加与验证' },
  { id: 'verify-login', label: '11–12 默认与测试' },
  { id: 'remove-old', label: '13–15 移除旧邮箱' },
]
const stepImage = (index: number) => '/guides/muse-change-email/' + String(index + 1).padStart(2, '0') + '.jpg'
const imageHeights = [1105, 1190, 1053, 1270, 1053, 1383, 1350, 1288, 1131, 1123, 1302, 1179, 1034, 1066, 1053]

export function MuseGuidePage({ kind, onSupport }: { kind: 'email' | 'invitation'; onSupport: () => void }) {
  const [zoom, setZoom] = useState<number | null>(null)
  const email = kind === 'email'
  const title = email ? 'Muse 邮箱更换完整图解' : 'Muse 邀请码与词元购买教程'
  const sections = email ? emailSections : MUSE_INVITE_SECTIONS.map(s => ({ id: s.id, label: s.title }))
  useEffect(() => {
    const anchor = location.hash.slice(1)
    if (!/^[a-z0-9-]+$/.test(anchor)) return
    const frame = requestAnimationFrame(() => document.getElementById(anchor)?.scrollIntoView({ behavior: 'instant' }))
    return () => cancelAnimationFrame(frame)
  }, [kind])
  return <article className="muse-guide page-width">
    <nav className="product-breadcrumb" aria-label="当前位置">
      <a href={storefrontHref('store')}>全部商品</a><ChevronRight size={13} />
      <a href={storefrontHref('product/muse')}>Muse</a><ChevronRight size={13} />
      <span aria-current="page">{email ? '邮箱更换图解' : '邀请码教程'}</span>
    </nav>
    <header className="muse-guide-hero">
      <span className="section-kicker">MUSE / {email ? 'ACCOUNT GUIDE' : 'INVITATION GUIDE'}</span>
      <h1>{title}</h1>
      <p>{email ? '先验证新邮箱，测试登录成功，再移除旧邮箱。15 张图，按顺序完成。' : '从找到自己的邀请码，到核对任务与奖励。先了解，再选择。'}</p>
      <span className="muse-guide-meta">使用指南 · 核对日期 2026.10.24{email ? ' · 15 张操作示意图，可点开放大' : ''}</span>
    </header>
    <div className="muse-guide-layout">
      <aside className="muse-guide-directory"><nav aria-label="教程目录"><strong>这篇指南</strong>{sections.map(s => <a key={s.id} href={'#' + s.id}>{s.label}</a>)}<a href="#guide-help">遇到问题</a></nav></aside>
      <div className="muse-guide-body">
        {email ? <>
          <section id="prepare" className="muse-guide-section">
            <h2>开始前，保留两个收信入口。</h2>
            <p>准备原账号的收件资料，以及一个你能长期控制的新邮箱。先完成首次登录、核对本单词元，再开始换绑。全程保留原登录窗口，方便出现问题时返回核查。</p>
            <div className="muse-guide-callout"><strong>顺序不能颠倒</strong><p>添加新邮箱 → 收码验证 → 设为默认 → 新窗口测试同一账号 → 删除旧邮箱。新邮箱还不能正常登录，就不要删除原邮箱。</p></div>
            <h3>先看懂账号交付原文</h3>
            <p>订单通知邮箱只接收订单消息。登录 Muse 时使用的是交付原文中的账号邮箱；邮箱密码与 Muse 密码也不能默认混用。</p>
            <div className="muse-guide-format"><span>三横线分隔格式 · 结构示意</span><code>邮箱---邮件密码---收件地址<br/>邮箱---邮件密码---Muse密码---收件地址</code><p>按本单收件地址获取登录验证码。只有单独注明的 Muse 密码才是 Muse 的登录密码。</p></div>
            <div className="muse-guide-format"><span>Outlook 与邮件阅读入口 · 结构示意</span><code>邮箱:Outlook密码:Muse密码:其余邮件识别资料…收件网址</code><p>收件网址之前可能有多段识别资料，其中也可能含冒号。不要拆成固定段数；按随单指引，将网址前的完整内容原样用于邮件阅读入口。</p></div>
            <p className="muse-guide-caption">下方图片为界面操作示意，邮箱与数字均为虚构示例；不是登录资料或实时账号。实际界面变化时，按相同含义的菜单名称操作。</p>
          </section>
          <ol className="muse-email-steps">
            {MUSE_EMAIL_STEPS.map((step, index) => <li key={step.title} id={index === 0 ? 'login' : index === 4 ? 'add-email' : index === 10 ? 'verify-login' : index === 12 ? 'remove-old' : 'email-step-' + (index + 1)} className="muse-guide-section">
              <div className="muse-step-heading"><span>{String(index + 1).padStart(2, '0')}</span><h2>{step.title}</h2></div>
              <p>{step.text}</p>
              {'important' in step && <p className="muse-guide-safety">先确认新邮箱可登录同一个账号，再继续删除旧邮箱。</p>}
              <figure><button type="button" className="muse-guide-image" onClick={() => setZoom(index)} aria-label={'放大第 ' + (index + 1) + ' 张步骤图：' + step.title}><img src={stepImage(index)} alt={'操作示意 · ' + step.cue} loading="lazy" decoding="async" width="1800" height={imageHeights[index]}/><span><Expand size={14} />查看大图</span></button><figcaption>图 {index + 1} / 15 · {step.cue}</figcaption></figure>
            </li>)}
          </ol>
        </> : <>
          <div className="muse-guide-callout"><strong>邀请码与登录验证码不同</strong><p>使用目标账号自己的 6 位邀请码。无需在教程中提交，也不要向他人提供密码或登录验证码。</p></div>
          <div className="muse-invite-flow" aria-label="邀请词元办理流程"><span>自己的邀请码</span><ArrowRight size={16} /><span>核对订单与次数</span><ArrowRight size={16} /><span>Muse 查看奖励</span></div>
          {MUSE_INVITE_SECTIONS.map((section, i) => <section key={section.id} id={section.id} className="muse-guide-section"><div className="muse-step-heading"><span>{String(i + 1).padStart(2, '0')}</span><h2>{section.title}</h2></div>{section.paragraphs.map(p => <p key={p}>{p}</p>)}</section>)}
        </>}
        <section id="guide-help" className="muse-guide-section muse-guide-help"><h2>卡在哪一步，从原订单联系。</h2><p>{email ? '首次无法登录、收不到验证码或首次额度不符，请保留原始交付资料并联系售后。成功首登后的封号、额度变化、再次登录异常与平台限制不在首登保障范围内；网络访问问题也不等于账号故障。' : '付款状态、任务进度和奖励记录需要分别核对。结果不明时保留同一订单，提交时间与脱敏截图，先核查再处理。'}</p><Button variant="outline" onClick={onSupport}><LifeBuoy size={15}/>联系本站支持</Button></section>
        <nav className="muse-guide-related" aria-label="继续了解 Muse"><a href={storefrontHref('product/muse')}><ArrowLeft size={15}/>返回 Muse 商品</a><a href={storefrontHref((email ? MUSE_INVITE_GUIDE : MUSE_ACCOUNT_GUIDE).slice(1))}>{email ? '邀请码与词元教程' : '邮箱更换完整图解'}<ArrowRight size={15}/></a></nav>
      </div>
    </div>
    <Dialog open={zoom !== null} onOpenChange={open => { if (!open) setZoom(null) }}><DialogContent className="muse-guide-lightbox"><DialogHeader><DialogTitle>{zoom !== null ? `${zoom + 1} / 15 · ${MUSE_EMAIL_STEPS[zoom].title}` : '步骤图'}</DialogTitle><DialogDescription>操作示意，图中邮箱及验证码为虚构示例。</DialogDescription></DialogHeader>{zoom !== null && <><div className="muse-guide-zoom-image"><img src={stepImage(zoom)} alt={MUSE_EMAIL_STEPS[zoom].cue}/></div><div className="muse-guide-zoom-actions"><Button variant="outline" disabled={zoom === 0} onClick={() => setZoom(zoom - 1)}>上一张</Button><a href={stepImage(zoom)} target="_blank" rel="noopener noreferrer">查看原尺寸图片</a><Button variant="outline" disabled={zoom === 14} onClick={() => setZoom(zoom + 1)}>下一张</Button></div></>}</DialogContent></Dialog>
  </article>
}
