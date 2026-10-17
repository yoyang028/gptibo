import { useRef, useState, type FormEvent } from 'react'
import {
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronRight,
  Clock3,
  Mail,
  ShieldCheck,
} from 'lucide-react'
import { Button } from './ui/button'
import { Input } from './ui/input'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from './ui/dialog'
import { ProductMark } from './brand'
import { SmsFlowPreview } from './sms-flow-preview'
import { api, errorMessage } from '@/lib/api'
import type { ServerOrder } from '@/lib/use-store'
import { storefrontHref } from '@/lib/storefront-routing'
import {
  GRIZZLY_SERVICES,
  GRIZZLY_RETAIL_CENTS,
  SMS_PRODUCT_IDS,
  grizzlyProduct,
  type SmsPublicCatalog,
  type GrizzlyService,
} from '../../shared/grizzly-sms'
import '@/styles/sms.css'

const defaults = Object.keys(GRIZZLY_SERVICES).map((s) => ({
  service: s as GrizzlyService,
  name: GRIZZLY_SERVICES[s as GrizzlyService],
  planId: SMS_PRODUCT_IDS[s as GrizzlyService],
  priceCents: GRIZZLY_RETAIL_CENTS[s as GrizzlyService],
  visible: true,
  enabled: false,
  purchaseNote: grizzlyProduct(s as GrizzlyService).purchaseNote,
}))
const scope = {
  dr: 'codex 对应的 AI 聊天短信验证',
  acz: 'Claude 短信验证',
  go: 'Google / Gmail 短信验证',
}
export function SmsPage({
  catalog,
  ready,
  onHome,
  onCreated,
  hidden = false,
  initialService,
}: {
  catalog?: SmsPublicCatalog
  ready: boolean
  onHome: () => void
  onCreated: (order: ServerOrder) => void
  hidden?: boolean
  initialService?: GrizzlyService
}) {
  const projects = (catalog?.projects ?? defaults).filter((p) => p.visible)
  const [selected, setSelected] = useState(() => {
    const value = new URLSearchParams(location.search).get('project')
    return (
      initialService ??
      (Object.hasOwn(GRIZZLY_SERVICES, value ?? '')
        ? (value as GrizzlyService)
        : 'dr')
    )
  })
  const project = projects.find((p) => p.service === selected) ?? projects[0]
  const [open, setOpen] = useState(false),
    [email, setEmail] = useState(''),
    [accepted, setAccepted] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('')
  const key = useRef<{ identity: string; key: string } | null>(null),
    lock = useRef(false)
  const guide = useRef<HTMLElement>(null)
  if (hidden || !project)
    return (
      <section className="empty-orders page-width">
        <h1>接码服务暂未展示</h1>
        <p>已有订单仍可在“我的订单”中查询。</p>
        <Button onClick={onHome}>返回商店</Button>
      </section>
    )
  const service = project.service,
    enabled = ready && project.enabled
  async function purchase(e: FormEvent) {
    e.preventDefault()
    if (lock.current || !accepted || !enabled) return
    lock.current = true
    setBusy(true)
    setError('')
    const identity = JSON.stringify([project.planId, project.priceCents, email])
    if (key.current?.identity !== identity)
      key.current = { identity, key: crypto.randomUUID() }
    try {
      await api('/api/orders/client', {})
      const { order } = await api<{ order: ServerOrder }>('/api/orders', {
        plan: project!.planId,
        expectedPrice: project!.priceCents,
        email,
        fields: {},
        key: key.current.key,
      })
      setOpen(false)
      onCreated(order)
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      lock.current = false
      setBusy(false)
    }
  }
  return (
    <>
      <section className="detail-intro page-width sms-intro">
        <nav className="product-breadcrumb" aria-label="当前位置">
          <a
            href={storefrontHref('store')}
            onClick={(e) => {
              e.preventDefault()
              onHome()
            }}
          >
            全部商品
          </a>
          <ChevronRight size={13} />
          <span>SMS接码</span>
        </nav>
        <span className="section-kicker">ONE NUMBER. ONE MESSAGE.</span>
        <h1>SMS接码</h1>
        <p>
          选一个项目，获取美国手机号。
          <br className="sms-mobile-break" />
          验证码，就在这笔订单里。
        </p>
        <div className="sms-detail-tags">
          <span>美国号码</span>
          <span>单次短信</span>
          <span>无需 Session 或账号密码</span>
        </div>
      </section>
      <section
        className="page-width sms-workspace"
        aria-label="选择短信接码项目"
      >
        <div className="sms-selection">
          <div className="sms-section-heading">
            <div>
              <span className="section-kicker">01 / 选择项目</span>
              <h2>你要接收哪个项目的短信？</h2>
            </div>
            <span>每次购买仅限所选项目</span>
          </div>
          <div
            className="sms-project-grid"
            role="radiogroup"
            aria-label="接码项目"
          >
            {projects.map((p, i) => (
              <button
                key={p.service}
                type="button"
                role="radio"
                aria-checked={p.service === service}
                tabIndex={p.service === service ? 0 : -1}
                className="sms-project-card"
                data-project={p.service}
                onClick={() => {
                  setSelected(p.service)
                  setAccepted(false)
                }}
                onKeyDown={(e) => {
                  if (
                    ![
                      'ArrowRight',
                      'ArrowDown',
                      'ArrowLeft',
                      'ArrowUp',
                    ].includes(e.key)
                  )
                    return
                  e.preventDefault()
                  const next =
                    projects[
                      (i +
                        (['ArrowRight', 'ArrowDown'].includes(e.key)
                          ? 1
                          : projects.length - 1)) %
                        projects.length
                    ]
                  setSelected(next.service)
                  document
                    .querySelector<HTMLButtonElement>(
                      `[data-project="${next.service}"]`,
                    )
                    ?.focus()
                }}
              >
                <div className="sms-project-top">
                  {p.service === 'go' ? (
                    <span className="sms-google-mark">
                      <Mail size={24} />
                    </span>
                  ) : (
                    <ProductMark
                      productId={p.service === 'dr' ? 'codex-sms' : 'claude'}
                    />
                  )}
                  <span className="sms-radio-indicator">
                    {p.service === service && <Check size={12} />}
                  </span>
                </div>
                <strong>{p.name}</strong>
                <span>
                  {p.service === 'go'
                    ? '短信验证 · 非成品账号'
                    : p.service === 'acz'
                      ? '短信验证 · 非会员订阅'
                      : '短信验证 · 非额度充值'}
                </span>
                <div className="sms-project-price">
                  ¥{(p.priceCents / 100).toFixed(2)}
                  <small> / 次</small>
                </div>
                <span className="sms-project-meta">
                  美国 · 一个号码 · 一次验证码
                </span>
              </button>
            ))}
          </div>
          <SmsFlowPreview />
          <div className="sms-explanation">
            <ShieldCheck size={18} />
            <p>
              手机号与验证码仅在你的原订单展示。付款由本站收款通道确认，号码由系统使用店主预充值余额采购。
            </p>
          </div>
        </div>
        <aside className="order-summary sms-summary" aria-label="接码订单摘要">
          <div className="summary-title">
            <h3>订单摘要</h3>
            <ShieldCheck size={18} />
          </div>
          <div className="sms-summary-project">
            <span>当前项目</span>
            <strong>{project.name}</strong>
          </div>
          <dl className="summary-details">
            <div>
              <dt>国家</dt>
              <dd>美国</dd>
            </div>
            <div>
              <dt>交付内容</dt>
              <dd>手机号 + 一次验证码</dd>
            </div>
            <div>
              <dt>等待时间</dt>
              <dd>取号后最多 20 分钟</dd>
            </div>
            <div>
              <dt>适用范围</dt>
              <dd>{scope[service]}</dd>
            </div>
          </dl>
          <div className="sms-price-total">
            <span>本次合计</span>
            <strong className="total-price">
              ¥{(project.priceCents / 100).toFixed(2)}
              <small> / 次</small>
            </strong>
          </div>
          <Button
            className="summary-cta"
            disabled={!enabled}
            onClick={() => {
              setOpen(true)
              setAccepted(false)
              setError('')
            }}
          >
            {!ready ? '正在读取…' : enabled ? '下单并付款' : '暂未开放购买'}
            {enabled && <ArrowRight size={16} />}
          </Button>
          <p className="sms-sale-note">
            {enabled
              ? '确认到账后自动发号，请在原订单等待验证码。'
              : '可先浏览项目和购买说明，服务准备好后开放购买。'}
          </p>
          <button
            className="text-button"
            onClick={() => guide.current?.scrollIntoView({ behavior: 'auto' })}
          >
            购买前，先看这些 <ArrowRight size={13} />
          </button>
        </aside>
      </section>
      <section
        id="help"
        ref={guide}
        className="page-width sms-purchase-guide"
        aria-label="接码购买说明"
      >
        <div>
          <span className="section-kicker">BEFORE YOU START</span>
          <h2>一个项目，一次验证。</h2>
          <p>
            这里提供短信接收服务，不包含 codex 额度、Claude 订阅或 Gmail
            成品账号。
          </p>
        </div>
        <div className="sms-guide-grid">
          <article>
            <Clock3 size={20} />
            <h3>留在原订单等待</h3>
            <p>
              取号后到所选服务发送验证码，订单每 5
              秒查询。离开页面后可重新打开原订单继续查看。
            </p>
          </article>
          <article>
            <ShieldCheck size={20} />
            <h3>异常时，先核对原单</h3>
            <p>
              缺货、超时或付款结果不明时保留原订单。不要重复付款，系统不会在发号结果未知时再买一个号码。
            </p>
          </article>
          <article>
            <ArrowLeft size={20} />
            <h3>停止接码与退款分别处理</h3>
            <p>
              未收到短信可停止接码并申请售后。号码取消以供货确认结果为准，买家退款以审核和实际到账为准。
            </p>
          </article>
        </div>
        <div className="sms-scope-note">
          <strong>{project.name} 购买说明</strong>
          <p>{project.purchaseNote}</p>
          <p>
            可在美国 187 与美国（虚拟）12
            号码池中分配，按实时价格与库存选择。号码仅供本次项目使用，目标网站是否接受以实际结果为准。
          </p>
        </div>
      </section>
      <Dialog
        open={open}
        onOpenChange={(value) => {
          if (!busy) setOpen(value)
        }}
      >
        <DialogContent className="motion-dialog">
          <DialogHeader>
            <DialogTitle>{project.name} · 美国单次接码</DialogTitle>
            <DialogDescription>
              确认项目与金额，付款后在原订单接收验证码。
            </DialogDescription>
          </DialogHeader>
          <form className="shop-product-form" onSubmit={purchase}>
            <label htmlFor="sms-purchase-email">下单邮箱</label>
            <Input
              id="sms-purchase-email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              maxLength={254}
              disabled={busy}
            />
            <p>项目：{project.name} · 美国 · 一次短信</p>
            <strong>应付 ¥{(project.priceCents / 100).toFixed(2)}</strong>
            <p>{project.purchaseNote}</p>
            <label className="shop-product-check">
              <input
                type="checkbox"
                checked={accepted}
                onChange={(e) => setAccepted(e.target.checked)}
                disabled={busy}
              />
              我已阅读并同意项目范围、购买及售后说明
            </label>
            {error && <p role="alert">{error}</p>}
            <Button type="submit" disabled={busy || !accepted}>
              {busy ? '正在创建订单…' : '确认下单，继续付款'}
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}
