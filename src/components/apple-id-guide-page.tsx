import { useEffect, useState } from 'react'
import { ArrowLeft, ChevronRight, Expand, LifeBuoy } from 'lucide-react'
import { Button } from './ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from './ui/dialog'
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from './ui/accordion'
import { storefrontHref } from '@/lib/storefront-routing'
import { APPLE_ID_GUIDE_IMAGES, APPLE_ID_LOGIN_STEPS, APPLE_ID_GUIDE_FAQ, appleIdGuideImage } from '../../shared/apple-id-guide'
import './apple-id.css'

const directory = [
  ['guide', '开始前与资料格式'], ['password', '核对与修改密码'], ['store-login', '登录 App Store'],
  ['download', '下载与更新应用'], ['apple-account-recovery', '账号受限与恢复'], ['change-email', '可选：更改邮箱'], ['faq', '常见问题'],
] as const

function GuideIllustration({ index, onOpen }: { index: number; onOpen: (index: number) => void }) {
  const illustration = APPLE_ID_GUIDE_IMAGES[index]
  return <figure className={'apple-guide-figure' + (illustration.phone ? ' apple-guide-phone' : '')}>
    <button className="apple-guide-image" type="button" onClick={() => onOpen(index)} aria-label={'放大示意图：' + illustration.title}>
      <img src={appleIdGuideImage(index)} width={illustration.width} height={illustration.height} alt={'操作示意 · ' + illustration.title} loading="lazy" decoding="async" />
      <span><Expand size={14} />查看大图</span>
    </button>
    <figcaption>{illustration.title} · 界面示意，以实际页面为准</figcaption>
  </figure>
}

export function AppleIdGuidePage({ onSupport }: { onSupport: () => void }) {
  const [zoom, setZoom] = useState<number | null>(null)
  useEffect(() => {
    const anchor = location.hash.slice(1)
    if (!directory.some(([id]) => id === anchor)) return
    const frame = requestAnimationFrame(() => document.getElementById(anchor)?.scrollIntoView({ behavior: 'instant' }))
    return () => cancelAnimationFrame(frame)
  }, [])
  return <article className="apple-id-guide page-width">
    <nav className="product-breadcrumb" aria-label="当前位置"><a href={storefrontHref('store')}>全部商品</a><ChevronRight size={13}/><a href={storefrontHref('product/apple-id')}>Apple ID</a><ChevronRight size={13}/><span aria-current="page">使用图文教程</span></nav>
    <header className="apple-guide-hero"><span className="section-kicker">APPLE ID / 使用指南</span><h1>Apple ID 使用图文教程</h1><p>看懂交付资料，核对并改密，只切换 App Store 的商店账号。</p><span>11 张操作示意图 · 核对日期 2026.10.24</span></header>
    <div className="apple-guide-layout">
      <aside className="apple-guide-directory"><nav aria-label="Apple ID 教程目录"><strong>按需要找到这一步</strong>{directory.map(([id, label]) => <a key={id} href={'#' + id}>{label}</a>)}</nav></aside>
      <div className="apple-guide-body">
        <section id="guide" className="apple-guide-section">
          <h2>先分清：设备主账户和商店账号。</h2>
          <p>本店当前 Apple ID 商品用于对应地区 App Store 下载。保留你自己的 iCloud 主账户，只在“媒体与购买项目”中切换商店账号；不把购买的账号用于 iCloud 或“查找”。</p>
          <div className="apple-guide-callout"><strong>先改密码，质保期内保留登录邮箱</strong><p>保存原订单交付原文，按随单安全资料核对账号并修改密码。3 天质保期内请勿更换登录邮箱；通用安全操作与本单售后条件分开核对。下方改邮箱章节是可选操作，不是登录前的必做步骤。</p></div>
          <h3>交付原文怎么读</h3>
          <p>标准顺序是账号、密码、朋友类答案、工作类答案、父母类答案、生日；末尾可能另有地区或已购备注。带标签时，复制标签后的实际内容；没有标签时按顺序辨认，不复制分隔符和首尾空格。</p>
          <div className="apple-guide-format"><code>账号 ---- 密码 ---- 朋友类答案 ---- 工作类答案 ---- 父母类答案 ---- 生日</code></div>
          <p>密保答案要对应页面实际提问的类别，不能混用。Apple 账号密码与邮箱密码也不一定相同；本单采用其他安全方式时，以实际交付内容为准。</p>
          <GuideIllustration index={0} onOpen={setZoom}/>
          <p className="apple-guide-caption">图中邮箱、姓名、密码及生日均为操作示例，不是可登录账号或实时商品资料。不要将自己的完整账号、密码、密保或验证码公开发给他人。</p>
        </section>
        <section id="password" className="apple-guide-section">
          <h2>先在官方页面核对账号、修改密码。</h2>
          <ol className="apple-guide-list"><li>打开 <a href="https://account.apple.com/" target="_blank" rel="noopener noreferrer">Apple 账户管理</a>，登录原订单交付的账号，不是设备里原有的 iCloud 主账户。</li><li>按页面要求使用本单密保、生日或受信任号码验证；已有双重认证必须正常完成。</li><li>进入“登录与安全性”或对应的“密码”入口修改密码，妥善保存新密码与安全资料。可修改项目随账号状态而异，保留质保期内的原登录邮箱。</li></ol>
          <GuideIllustration index={1} onOpen={setZoom}/><GuideIllustration index={2} onOpen={setZoom}/><GuideIllustration index={3} onOpen={setZoom}/>
        </section>
        <section id="store-login" className="apple-guide-section">
          <h2>通过“媒体与购买项目”登录 App Store。</h2>
          <ol className="apple-guide-login-steps">{APPLE_ID_LOGIN_STEPS.map((step, i) => <li key={step.title}><div className="apple-guide-step-heading"><span>{String(i + 1).padStart(2, '0')}</span><h3>{step.title}</h3></div><p>{step.text}</p><div className={step.images.length === 2 ? 'apple-guide-image-pair' : undefined}>{step.images.map(index => <GuideIllustration key={index} index={index} onOpen={setZoom}/>)}</div></li>)}</ol>
        </section>
        <section id="download" className="apple-guide-section">
          <h2>下载与更新，核对账号和付费权益。</h2>
          <p>登录后在 App Store 搜索目标应用。免费、付费和订阅是不同情况；购买一个账号不代表该地区所有 App 都免费。只有明确标注的已购规格，才包含对应应用的已购记录。</p>
          <p>更新旧 App 时仍要求原账号，通常需使用原下载/购买账号处理。考虑重装前，先备份应用内数据、确认仍在上架且新账号拥有相应下载权限；不要直接删除含重要本地资料的 App。重装应用也不能解除 Apple 账户停用。</p>
        </section>
        <section id="apple-account-recovery" className="apple-guide-section">
          <h2>先看错误提示，再选恢复入口。</h2>
          <div className="apple-guide-table"><table><thead><tr><th>看到的提示</th><th>建议先做什么</th></tr></thead><tbody>
            <tr><td>因安全原因锁定或停用</td><td>到 <a href="https://iforgot.apple.com/" target="_blank" rel="noopener noreferrer">Apple 密码恢复</a> 验证身份并重设密码。</td></tr>
            <tr><td>账户被锁定或非活跃</td><td>按提示“请求访问”，或使用 <a href="https://iforgot.apple.com/unlock" target="_blank" rel="noopener noreferrer">官方解锁申请</a>。</td></tr>
            <tr><td>媒体与购买项目 / App Store 账户停用</td><td>按提醒中的“继续”申请，或查看 <a href="https://support.apple.com/zh-cn/102640" target="_blank" rel="noopener noreferrer">Apple 重新激活说明</a>。</td></tr>
          </tbody></table></div>
          <p>是否能恢复由 Apple 根据账号状态审核，不能保证一定通过或固定时效。账号质量问题仍从本站原订单联系售后；恢复申请不等于售后已完成。</p>
        </section>
        <section id="change-email" className="apple-guide-section">
          <h2>可选：确认售后影响后，再更换登录邮箱。</h2>
          <div className="apple-guide-callout"><strong>3 天质保期内，不要更换原登录邮箱</strong><p>这一节用于你确认不影响本单售后、且确实要接管邮箱的情况。先核对质保状态，保留原登录会话和原订单资料。</p></div>
          <p>在 <a href="https://account.apple.com/" target="_blank" rel="noopener noreferrer">Apple 账户管理</a> 的登录邮箱入口，填写自己能长期收信、未被其他 Apple 账户占用的邮箱，并按实际提示验证。完成后检查页面显示的新邮箱；另开窗口验证新邮箱和新密码能登录同一账号，再结束原会话。</p>
          <GuideIllustration index={10} onOpen={setZoom}/>
        </section>
        <section id="faq" className="apple-guide-section"><h2>常见问题</h2><Accordion className="apple-guide-faq">{APPLE_ID_GUIDE_FAQ.map((item, i) => <AccordionItem key={item.question} value={String(i)}><AccordionTrigger>{item.question}</AccordionTrigger><AccordionContent>{item.answer}</AccordionContent></AccordionItem>)}</Accordion></section>
        <section className="apple-guide-section"><h2>遇到问题，从原订单联系。</h2><p>说明卡在登录、改密、下载还是账户恢复，并保留原订单号与脱敏错误截图。不要发送完整密码、密保答案或验证码。我们按本单商品说明核对，不把应用内服务问题当作账号问题。</p><Button variant="outline" onClick={onSupport}><LifeBuoy size={15}/>联系本站支持</Button></section>
        <nav className="apple-guide-back"><a href={storefrontHref('product/apple-id')}><ArrowLeft size={15}/>返回 Apple ID 商品</a></nav>
      </div>
    </div>
    <Dialog open={zoom !== null} onOpenChange={open => { if (!open) setZoom(null) }}><DialogContent className="apple-guide-lightbox"><DialogHeader><DialogTitle>{zoom === null ? '操作示意图' : `${zoom + 1} / 11 · ${APPLE_ID_GUIDE_IMAGES[zoom].title}`}</DialogTitle><DialogDescription>界面示意，图片中的邮箱、密码和姓名为示例。</DialogDescription></DialogHeader>{zoom !== null && <><div className="apple-guide-zoom"><img src={appleIdGuideImage(zoom)} alt={APPLE_ID_GUIDE_IMAGES[zoom].title}/></div><div className="apple-guide-zoom-actions"><Button variant="outline" disabled={zoom === 0} onClick={() => setZoom(zoom - 1)}>上一张</Button><a href={appleIdGuideImage(zoom)} target="_blank" rel="noopener noreferrer">查看原尺寸图片</a><Button variant="outline" disabled={zoom === APPLE_ID_GUIDE_IMAGES.length - 1} onClick={() => setZoom(zoom + 1)}>下一张</Button></div></>}</DialogContent></Dialog>
  </article>
}
