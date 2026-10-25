import {useEffect,useState} from 'react'
import {ArrowLeft,ArrowRight,ChevronRight,Expand,LifeBuoy} from 'lucide-react'
import {Button} from './ui/button'
import {Dialog,DialogContent,DialogHeader,DialogTitle,DialogDescription} from './ui/dialog'
import {storefrontHref} from '@/lib/storefront-routing'
import {GEMINI_ACTIVATION_GUIDE,GEMINI_STUDENT_GUIDE,GEMINI_REGION_GUIDE,GEMINI_EXTENSION_GUIDE} from '../../shared/gemini-products'
import {GEMINI_GUIDE_TITLES,GEMINI_GUIDE_IMAGES,geminiGuideImage,type GeminiGuideKind} from '../../shared/gemini-guides'
import './gemini-guides.css'

const directories:Record<GeminiGuideKind,readonly(readonly[string,string])[]>={
 student:[['before','购买的是认证服务'],['verification-link','准备本人验证链接'],['after-verification','通过后绑卡与选择方案'],['result','确认会员真的生效'],['issues','失败、延迟和退款']],
 activation:[['before','准备目标账号'],['exchange','卡密 → 链接 → 激活'],['expiry','有效期与售后界限'],['result','确认权益'],['issues','回查与异常处理']],
 region:[['before','先核对账号和错误'],['region','核对真实地区'],['payments','付款资料与验证'],['result','回原入口核对权益'],['plan','通过认证却套餐不一致']],
 extension:[['before','先区分免费与付费'],['free-offer','核对可领取学生优惠'],['paid-upgrade','可选的付费升级'],['result','逐项核对实际订阅'],['renewal','管理续费与付款方式']],
}
function FlowFigure({items,label}:{items:readonly string[];label:string}){
 return <figure className="gemini-flow-figure" aria-label={label}><ol>{items.map((item,i)=><li key={item}><span>{String(i+1).padStart(2,'0')}</span><strong>{item}</strong>{i<items.length-1&&<ArrowRight size={16} aria-hidden="true"/>}</li>)}</ol><figcaption>流程示意 · 不代表真实订单或已获得权益</figcaption></figure>
}
function Illustration({index,onOpen}:{index:number;onOpen:(i:number)=>void}){
 const item=GEMINI_GUIDE_IMAGES[index]
 return <figure className="gemini-guide-figure"><button type="button" onClick={()=>onOpen(index)} aria-label={'放大示意图：'+item.title}><img src={geminiGuideImage(index)} width={item.width} height={item.height} alt={'操作示意 · '+item.title} loading="lazy" decoding="async"/><span><Expand size={14}/>查看大图</span></button><figcaption>{item.title} · 示例界面与价格，不代表本人实时权益；图中原编号以本文步骤为准</figcaption></figure>
}
function ExtensionGuide({onOpen}:{onOpen:(i:number)=>void}){
 return <>
  <section id="before"><h2>先分清学生免费优惠与付费组合。</h2><p>本篇适用于已经有学生优惠、准备查看新优惠或升级方案的本人账号。它不是学生资格认证的必做步骤，也不是购买本店 18 个月激活链接的教程。</p><div className="gemini-guide-callout"><strong>升级付费组合会产生 Google 侧费用</strong><p>下图左侧为参考账号当时显示的学生免费领取方案，右侧为包含 YouTube Premium 的付费组合。美元金额、5TB、12 个月和其他期限均是参考截图；你能领取什么，以自己账号当前确认页为准。</p></div><Illustration index={7} onOpen={onOpen}/><FlowFigure label="学生优惠领取与升级判断" items={['查看已有方案','核对可领取优惠','按需选择付费升级','分别检查订阅日期']}/></section>
  <section id="free-offer"><h2>若账号能重新领取，先看清领取确认页。</h2><ol><li>在 <a href="https://one.google.com/" target="_blank" rel="noopener noreferrer">Google One</a> 记录现有方案、结束日期和目标账号。</li><li>从 <a href="https://gemini.google/students/" target="_blank" rel="noopener noreferrer">Google 学生优惠官方入口</a> 查看该账号是否仍可领取。并非所有旧用户都有新的免费期。</li><li>若出现免费试用，核对今天是否收费、试用结束日期、下一次扣款金额和续订规则；确认符合自己需求后再领取。</li><li>返回会员方案页，确认新优惠确实已生效，再考虑是否升级其他方案。</li></ol><p>如果没有新的优惠，不能按参考教程推定一定能延期；不要重复认证或重复支付来强行刷新资格。</p></section>
  <section id="paid-upgrade"><h2>需要组合权益时，再考虑付费升级。</h2><p>包含 YouTube Premium 的 Google AI Pro 组合属于另一次订阅选择，不包含在本店认证费中。升级确认页可能折算现有方案剩余价值，也可能立即扣款；先检查“今天收取”“折算天数”“下次续订”及税费，再决定是否订阅。</p><div className="gemini-checklist"><strong>在确认按钮前逐项核对</strong><ul><li>方案名称与实际存储容量</li><li>是否包含自己需要的 YouTube 权益</li><li>今天的实际扣款、税费与币种</li><li>原方案剩余期怎样折算</li><li>下一次续费日期与金额</li></ul></div><p>没有先获得新的学生优惠时，升级可能只折算原来剩余期，不会自动增加一年；不保证参考截图中的延期结果适用于所有账号。若只想继续免费方案，无需为了完成本店认证而购买组合。</p></section>
  <section id="result"><h2>Google One 和 YouTube 分别查看。</h2><p>升级完成后，在 <a href="https://myaccount.google.com/payments-and-subscriptions" target="_blank" rel="noopener noreferrer">Google 付款和订阅</a> 中分别查看 Google One 与 YouTube Premium 的方案和续订日期。两项权益的日期可能不同，不能仅凭支付成功就认定都延长到某一天。</p><Illustration index={5} onOpen={onOpen}/><p>实际方案、日期或费用不符合预期时保留 Google 订单与脱敏记录，先查询原订阅；不要再次订阅试错。</p></section>
  <section id="renewal"><h2>取消续订与移除卡片分别处理。</h2><p>不希望将来自动扣款时，在对应 Google 订阅的管理入口查看并取消续订，再确认页面显示的状态与权益结束日期。移除付款方式不等于取消订阅，也不等于已经退款；先处理相关订阅，再根据 Google 实际规则管理付款方式。</p><p>银行卡、账单资料及验证码只在 Google 官方页面由本人操作，本站不需要这些信息。</p></section>
 </>
}
export function GeminiGuidePage({kind,onSupport}:{kind:GeminiGuideKind;onSupport:()=>void}){
 const[zoom,setZoom]=useState<number|null>(null),directory=directories[kind],title=GEMINI_GUIDE_TITLES[kind]
 useEffect(()=>{const id=location.hash.slice(1);if(!directory.some(([key])=>key===id))return;const f=requestAnimationFrame(()=>document.getElementById(id)?.scrollIntoView({behavior:'instant'}));return()=>cancelAnimationFrame(f)},[directory])
 return <article className="gemini-guide page-width">
  <nav className="product-breadcrumb" aria-label="当前位置"><a href={storefrontHref('store')}>全部商品</a><ChevronRight size={13}/><a href={storefrontHref('product/gemini')}>Gemini</a><ChevronRight size={13}/><span aria-current="page">使用教程</span></nav>
  <header className="gemini-guide-hero"><span className="section-kicker">GEMINI / 使用指南</span><h1>{title}</h1><p>{kind==='student'?'资格验证、付款方式、方案选择，分清每一步。':kind==='activation'?'先准备自己的账号，再领取并及时使用本单激活链接。':kind==='extension'?'免费领取、可选付费升级与续费管理，分别核对。':'先看账号、真实地区和实际方案，再决定下一步。'}</p><span>核对日期 2026.10.25 · 图片均为操作示意</span></header>
  <nav className="gemini-guide-siblings" aria-label="Gemini 教程类型">{([[GEMINI_STUDENT_GUIDE,'student'],[GEMINI_ACTIVATION_GUIDE,'activation'],[GEMINI_REGION_GUIDE,'region'],[GEMINI_EXTENSION_GUIDE,'extension']] as const).map(([url,key])=><a href={storefrontHref(url.slice(1))} key={key} aria-current={key===kind?'page':undefined}>{key==='student'?'学生认证':key==='activation'?'18 个月激活':key==='extension'?'学生优惠与续费':'地区与套餐核对'}</a>)}</nav>
  <div className="gemini-guide-layout"><aside><nav aria-label="Gemini 教程目录"><strong>按需要找到这一步</strong>{directory.map(([id,label])=><a key={id} href={'#'+id}>{label}</a>)}</nav></aside><div className="gemini-guide-body">
   {kind==='student'?<>
    <section id="before"><h2>12 个月学生优惠，对应一次资格认证。</h2><p>12 个月指 Google 学生优惠周期，本站提供一次本人资格验证处理，不是已开通会员，也不是 12 个月质保。推荐给有真实学生资格、希望保留自己账号且能自行绑卡的人；实际套餐、可领期限、地区和院校资格以 Google 对当前账号的确认为准。自己完成官方验证不需要购买本店服务。</p><div className="gemini-guide-callout"><strong>通过验证后，还需要绑卡与领取优惠</strong><p>这档不包含另购 Google 付费方案的费用。验证成功后仍需在 Google 按提示绑定信用卡、选择方案并确认领取；资格复核、活动或账号状态变化仍可能影响后续权益，不保证永不掉订阅。不要按另一档“18 个月、无需绑卡”的权益购买认证服务。</p></div><FlowFigure label="学生认证流程" items={['本人资格与链接','按原单办理认证','Google 绑卡选方案','Google One 核对']}/></section>
    <section id="verification-link"><h2>从官方入口获取本人验证链接。</h2><ol><li>登录自己的 Google 账号，打开 <a href="https://gemini.google/students/" target="_blank" rel="noopener noreferrer">Google 学生优惠</a>，先查看当前账号是否可参加活动。</li><li>按页面要求填写真实学校与在读信息，进入 SheerID 身份核验页。</li><li>复制地址栏完整链接，核对官方域名、路径与 verificationId 参数，保留后面的全部参数。</li><li>按原订单提供的办理指引提交。不要用他人的链接，不公开发送链接，也不要为了重试同一申请重复付款。</li></ol><div className="gemini-link-anatomy" aria-label="验证链接格式示意"><strong>链接格式检查</strong><dl><div><dt>官方域名</dt><dd>services.sheerid.com</dd></div><div><dt>核验路径</dt><dd>/verify/…</dd></div><div><dt>申请参数</dt><dd>verificationId=…</dd></div></dl><span>格式示意，没有真实申请编号，不能用于提交</span></div><p>过期、已使用、缺参数与正在审核是不同情况。前两类先核对本单是否已处理，缺参数重新复制完整地址；正在审核时回查原订单。</p></section>
    <section id="after-verification"><h2>认证通过后，回 Google 核对方案再开通。</h2><p>回到认证时使用的同一 Google 账号。按 Google 的实际要求添加本人可用的信用卡与真实账单资料，卡号、验证码与证件只在对应官方页面处理，不交给商家。</p><p>若看到多个方案，分别检查方案名称、存储、优惠期限、优惠结束后的价格和下一次扣款日期。AI Plus 与 AI Pro 不相同；选择自己需要且当前账号能领取的方案，再确认订阅。活动会调整，本教程不把某个旧版本的免费期或容量当作所有账号的承诺。</p><Illustration index={4} onOpen={setZoom}/><a className="gemini-related-link" href={storefrontHref(GEMINI_REGION_GUIDE.slice(1))}>地区不可用或方案不符合预期？查看图解<ArrowRight size={14}/></a></section>
    <section id="result"><h2>以会员方案页确认完成。</h2><p>打开 <a href="https://one.google.com/" target="_blank" rel="noopener noreferrer">Google One</a>，核对同一账号、实际方案、存储和到期/续费日期。只看到“学生认证已通过”或“付款资料已添加”，都不能说明会员已经开通。</p><Illustration index={5} onOpen={setZoom}/></section>
    <section id="issues"><h2>保留原单，先核对处理结果。</h2><p>付款未更新、一直排队、明确失败或结果不明时，保留订单号和脱敏提示，从本站原订单联系支持；不要重新付款来催进度。认证失败、售后受理与退款到账是不同状态，退款以实际支付结果为准。</p><p>如官方页面要求补充本人的在读证明，应按官方要求处理；本店不提供身份材料，也不承诺审核必过或固定完成时间。</p></section>
   </>:kind==='activation'?<>
    <section id="before"><h2>先准备好真正要开通的账号。</h2><p>本规格为 Jio 渠道 18 个月 AI Pro / 5TB 激活链接，无需绑卡，使用自己的 18 岁及以上 Google 账号。先检查地区、原订阅和家庭状态。Jio 官方活动要求持续保持有效 5G 套餐等资格，渠道或资格变化可能导致中途掉订阅；18 个月不是相同期限的稳定性或售后保证。</p><div className="gemini-guide-callout"><strong>已有月度 AI Pro 会覆盖期限，不是叠加</strong><p>用无痕窗口只登录目标账号，确认邮箱后再领取。打开链接时登录哪个账号，权益就可能落在哪个账号；错号领取不能默认换绑。</p></div><FlowFigure label="卡密激活流程" items={['准备目标账号','原订单领取 CDK','换出并打开链接','核对 AI Pro 与日期']}/></section>
    <section id="exchange"><h2>兑换与激活，是两个连续步骤。</h2><ol><li>付款确认并完成交付后，在本站原订单领取本单 CDK、专用兑换入口和完整指引。</li><li>准备好 Google 账号后再兑换。按随单页面核对卡密和目标账号确认项，提交会直接验证并领取绑定链接，不能把它当作只检查、不兑换的按钮。</li><li>保存返回的原链接，立即在目标账号打开，按 Google 提示完成领取。</li><li>不要转发卡密或激活链接。关闭页面后可用同一原码回查原链接，不会另给一条新链接。</li></ol><p>商品详情和本教程说明流程；专用兑换地址统一在付款并交付后的原订单提供，无需再购买一份同样的服务。</p></section>
    <section id="expiry"><h2>卡密与链接，有不同的使用边界。</h2><div className="gemini-guide-table"><table><thead><tr><th>状态</th><th>需要知道什么</th></tr></thead><tbody><tr><td>尚未兑出链接</td><td>卡密本身无到期限制，可从原订单申请退款核对。</td></tr><tr><td>已兑出激活链接</td><td>发放时保证有效，但链接会过期且只能领取一次；请立即激活。</td></tr><tr><td>链接放置过期、错号或已激活</td><td>按本规格约定不支持退款、售后或换绑，兑换前先做好账号准备。</td></tr></tbody></table></div><p>刚领取即显示无效、已使用或要求新链接时，保存原结果及时联系本站核对；不要自行再买一单。</p></section>
    <section id="result"><h2>在 Google One 单独核对权益。</h2><p>回到 <a href="https://one.google.com/" target="_blank" rel="noopener noreferrer">Google One</a> 查看实际账号、AI Pro 方案、5TB 存储与激活后 18 个月的到期日期。若 Gemini 尚未更新，先重新登录或稍后在无痕窗口回查。</p><p>5TB 是存储容量，各 AI 功能仍有使用限制。Antigravity 可用性取决于账号，不能保证购买链接就能解锁。家庭共享的资格和范围以 Google 实际页面为准。</p><Illustration index={5} onOpen={setZoom}/><a className="gemini-related-link" href={storefrontHref(GEMINI_REGION_GUIDE.slice(1))}>地区或方案异常？查看核对图解<ArrowRight size={14}/></a></section>
    <section id="issues"><h2>区分“缺链接库存”和“卡密无效”。</h2><p>有效卡密遇到链接库存不足时，不会被消耗，补货后继续用原码处理。卡密无效或领取结果不明确时，保留原单联系本站；同一码再次提交是找回原链接，不会换出第二条。</p></section>
   </>:kind==='extension'?<ExtensionGuide onOpen={setZoom}/>:<>
    <section id="before"><h2>先确认错误原文与登录账号。</h2><p>记录是“地区不可用”“付款资料需要验证”，还是“套餐不符合预期”。右上角邮箱必须与认证或领取时使用的账号一致；多个 Google 账号同时登录时，可在无痕窗口只登录目标账号检查。</p><Illustration index={0} onOpen={setZoom}/></section>
    <section id="region"><h2>地区设置要符合本人真实情况。</h2><p>打开 <a href="https://play.google.com/settings" target="_blank" rel="noopener noreferrer">Google Play 网页设置</a> 查看当前国家/地区，再核对 Google 活动对账号的资格要求。地区显示正常，也不代表一定符合某次优惠。</p><Illustration index={1} onOpen={setZoom}/><p>需要变更时先读 <a href="https://support.google.com/googleplay/answer/7431675?hl=zh-Hans" target="_blank" rel="noopener noreferrer">Google Play 地区变更规则</a>：必须实际位于对应地区并有可用付款方式，变更还可能影响现有服务。不要用随机地址或他人付款资料，也不要为了领取优惠直接关闭现有付款资料。</p></section>
    <section id="payments"><h2>查看付款资料，按官方提示验证。</h2><p>在 <a href="https://payments.google.com/" target="_blank" rel="noopener noreferrer">Google 付款中心</a> 查看当前选中的资料、国家/地区及关联订阅。没有资料、已有资料以及待验证是不同情况。已有服务时先核对影响，不将删除资料作为常规排错步骤。</p><Illustration index={2} onOpen={setZoom}/><p>若 Google 要求验证，打开官方提醒详情，按本人真实资料处理，等待结果。不要把完整卡号、验证码或证件发送给商家。</p><Illustration index={3} onOpen={setZoom}/></section>
    <section id="result"><h2>回到原入口，再确认会员生效。</h2><p>重新打开本次原活动或原激活链接，核对同一账号、实际方案、期限和续费价格。没有达到预期时先不要确认一个收费或权益不同的订阅。</p><Illustration index={4} onOpen={setZoom}/><p>完成后在 <a href="https://one.google.com/" target="_blank" rel="noopener noreferrer">Google One 会员方案</a> 中核对实际生效状态，保存脱敏记录。</p><Illustration index={5} onOpen={setZoom}/></section>
    <section id="plan"><h2>学生认证通过，不代表一定是 AI Pro。</h2><p>如果显示 AI Plus，先核对 Google 当前活动对这个账号实际提供的方案、地区及历史订阅条件；不要把认证成功等同于固定 Pro 权益。图中的 Plus / Pro 是识别不同方案的示例，不保证变更地区后就能切换方案。</p><Illustration index={6} onOpen={setZoom}/></section>
   </>}
   <section><h2>需要帮助，从本站原订单联系。</h2><p>说明卡在哪一步，提供订单号和脱敏提示。密码、验证码、完整卡密与申请链接不要公开发送；结果不明确时保留原单。</p><Button variant="outline" onClick={onSupport}><LifeBuoy size={15}/>联系本站支持</Button></section>
   <a className="gemini-guide-back" href={storefrontHref('product/gemini')}><ArrowLeft size={15}/>返回 Gemini 商品</a>
  </div></div>
  <Dialog open={zoom!==null} onOpenChange={open=>{if(!open)setZoom(null)}}><DialogContent className="gemini-guide-lightbox"><DialogHeader><DialogTitle>{zoom===null?'操作示意图':`${zoom+1} / ${GEMINI_GUIDE_IMAGES.length} · ${GEMINI_GUIDE_IMAGES[zoom].title}`}</DialogTitle><DialogDescription>图片中的账号与界面为示意，以本人实际页面为准。</DialogDescription></DialogHeader>{zoom!==null&&<><div className="gemini-guide-zoom"><img src={geminiGuideImage(zoom)} alt={GEMINI_GUIDE_IMAGES[zoom].title}/></div><div className="gemini-guide-image-actions"><Button variant="outline" disabled={zoom===0} onClick={()=>setZoom(zoom-1)}>上一张</Button><a href={geminiGuideImage(zoom)} target="_blank" rel="noopener noreferrer">查看原尺寸</a><Button variant="outline" disabled={zoom===GEMINI_GUIDE_IMAGES.length-1} onClick={()=>setZoom(zoom+1)}>下一张</Button></div></>}</DialogContent></Dialog>
 </article>
}
