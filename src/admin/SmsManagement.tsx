import { useState } from 'react'
import {
  ArrowUpRight,
  CheckCircle2,
  CircleAlert,
  KeyRound,
  RefreshCw,
  Save,
  Wallet,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { api, errorMessage } from '@/lib/api'
import { useResource } from '@/lib/use-resource'
import {
  GRIZZLY_POOLS,
  type SmsProjectSettings,
  type SmsPoolQuote,
} from '../../shared/grizzly-sms'
import './sms-management.css'

type Settings = {
  version: number
  configured: boolean
  credentialVerified: boolean
  cnyPerUsd: string
  balanceUsd: string | null
  checkedAt: number
  projects: (SmsProjectSettings & {
    name: string
    pools: SmsPoolQuote[]
    missing: string[]
  })[]
  paymentConfigured: boolean
  paymentEnabled: boolean
  procurementEnabled: boolean
  checkError?: string
}
type SmsOrder = {
  id: string
  plan_name: string
  price_cents: number
  payment_status: string
  refunded_cents: number
  refund_hold: number
  created_at: number
  state: string
  country: string | null
  cost_usd: string | null
  supplier_cancelled_at: number | null
  supplier_refund_usd: string | null
  supplier_refund_reference: string | null
  supplier_refund_confirmed_at: number | null
  error: string
  trade_no: string | null
  refund_state: string | null
}
const states: Record<string, string> = {
  ready: '待付款 / 发号',
  allocating: '正在发号',
  waiting: '等待短信',
  received: '已收码',
  cancelled: '已停止',
  failed: '未发号',
  review: '待核对',
  unknown: '发号结果待核对',
}
const time = (value: number) =>
  value
    ? new Date(value).toLocaleString('zh-CN', { hour12: false })
    : '尚未检查'
const money = (value: number) => '¥' + (value / 100).toFixed(2)

function SettingsForm({
  data,
  onSaved,
}: {
  data: Settings
  onSaved: () => void
}) {
  const [apiKey, setApiKey] = useState(''),
    [cnyPerUsd, setRate] = useState(data.cnyPerUsd)
  const [projects, setProjects] = useState(
    data.projects.map((p) => ({
      ...p,
      price: (p.priceCents / 100).toFixed(2),
    })),
  )
  const [busy, setBusy] = useState(''),
    [error, setError] = useState(''),
    [dirty, setDirty] = useState(false)
  const missing = [...new Set(data.projects.flatMap((p) => p.missing))]
  function update(index: number, value: Partial<(typeof projects)[number]>) {
    setDirty(true)
    setProjects((rows) =>
      rows.map((p, i) => (i === index ? { ...p, ...value } : p)),
    )
  }
  async function action(name: 'save' | 'check') {
    if (busy) return
    setBusy(name)
    setError('')
    try {
      if (
        name === 'save' &&
        projects.some((p) => !/^\d{1,6}(\.\d{1,2})?$/.test(p.price))
      )
        throw new Error('售价请填写最多两位小数的人民币金额。')
      const result = await api<Settings>('/api/admin/sms', {
        action: name,
        version: data.version,
        ...(name === 'save'
          ? {
              apiKey: apiKey || undefined,
              cnyPerUsd,
              projects: projects.map((p) => ({
                service: p.service,
                priceCents: Math.round(Number(p.price) * 100),
                maxPriceUsd: p.maxPriceUsd,
                visible: p.visible,
                selling: p.selling,
              })),
            }
          : {}),
      })
      setApiKey('')
      onSaved()
      if (result.checkError) setError(result.checkError)
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setBusy('')
    }
  }
  return (
    <div className="sms-admin-settings">
      <div className="sms-admin-readiness" role="status">
        <CircleAlert size={21} />
        <div>
          <strong>
            {missing.length
              ? '接码销售尚有待配置项'
              : '配置检查已通过，可按项目开售'}
          </strong>
          <p>
            配置与检查不会采购号码。仅付款确认后的正式订单可使用店主Grizzly余额采购。
          </p>
          {missing.length > 0 && (
            <ul>
              {missing.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          )}
        </div>
      </div>
      <section className="admin-card sms-admin-credentials">
        <div className="sms-admin-heading">
          <h2>
            <KeyRound size={18} />
            Grizzly连接与采购成本
          </h2>
          <span>
            {data.configured
              ? data.credentialVerified
                ? '密钥已校验'
                : '密钥已加密保存 · 待检查'
              : '尚未配置密钥'}
          </span>
        </div>
        <div className="sms-admin-connection-grid">
          <label>
            Grizzly API Key
            <Input
              type="password"
              aria-label="Grizzly API Key"
              autoComplete="new-password"
              value={apiKey}
              onChange={(e) => {
                setApiKey(e.target.value)
                setDirty(true)
              }}
              placeholder={
                data.configured
                  ? '留空保留现有密钥'
                  : '在此填写，保存后仅在服务端使用'
              }
              maxLength={200}
              disabled={Boolean(busy)}
            />
            <small>服务端加密保存，页面不会回显密钥。</small>
          </label>
          <label>
            成本汇率 · 人民币 / 1 美元
            <Input
              value={cnyPerUsd}
              aria-label="成本汇率 · 人民币 / 1 美元"
              onChange={(e) => {
                setRate(e.target.value)
                setDirty(true)
              }}
              inputMode="decimal"
              placeholder="按实际充值成本填写"
              disabled={Boolean(busy)}
            />
            <small>用于计算采购成本与毛利，不改变客户人民币付款金额。</small>
          </label>
          <div className="sms-admin-balance">
            <Wallet size={20} />
            <span>Grizzly预充值余额</span>
            <strong>
              {data.balanceUsd === null ? '待检查' : 'US$ ' + data.balanceUsd}
            </strong>
            <small>上次检查：{time(data.checkedAt)}</small>
          </div>
        </div>
        <div className="sms-admin-actions">
          <Button
            variant="outline"
            disabled={Boolean(busy) || !data.configured || dirty}
            onClick={() => void action('check')}
          >
            <RefreshCw size={15} />
            {busy === 'check' ? '正在检查…' : '只读检查余额与双池报价'}
          </Button>
          <span>
            {dirty
              ? '有未保存修改，请先保存，再执行只读检查。'
              : '检查仅查询余额、价格和库存，不发号、不扣款。'}
          </span>
        </div>
        <div className="sms-admin-flags">
          <span data-ready={data.paymentConfigured && data.paymentEnabled}>
            {data.paymentConfigured && data.paymentEnabled ? (
              <CheckCircle2 size={14} />
            ) : (
              <CircleAlert size={14} />
            )}
            本站自动收款
            {data.paymentConfigured && data.paymentEnabled
              ? '已就绪'
              : '未就绪'}
          </span>
          <span data-ready={data.procurementEnabled}>
            服务端采购开关{data.procurementEnabled ? '已启用' : '未启用'}
          </span>
          <a href="/admin?view=integrations">
            配置收款通道 <ArrowUpRight size={13} />
          </a>
        </div>
      </section>
      <section className="sms-admin-projects" aria-label="接码项目配置">
        {projects.map((p, index) => (
          <article key={p.service} className="admin-card sms-admin-project">
            <div className="sms-admin-heading">
              <h2>{p.name}</h2>
              <span>服务代码 {p.service}</span>
            </div>
            <div className="sms-admin-price-grid">
              <label>
                售价 · 元 / 次
                <Input
                  aria-label={p.name + '售价'}
                  value={p.price}
                  onChange={(e) => update(index, { price: e.target.value })}
                  inputMode="decimal"
                  disabled={Boolean(busy)}
                />
              </label>
              <label>
                单次采购上限 · 美元
                <Input
                  aria-label={p.name + '采购上限'}
                  value={p.maxPriceUsd}
                  onChange={(e) =>
                    update(index, { maxPriceUsd: e.target.value })
                  }
                  inputMode="decimal"
                  placeholder="须先配置"
                  disabled={Boolean(busy)}
                />
              </label>
            </div>
            <p className="sms-admin-cap-note">
              每次采购均携带此上限；结果不明时不会切换号码池再次采购。
            </p>
            <div className="sms-admin-pools">
              {(['187', '12'] as const).map((country) => {
                const quote = p.pools.find((q) => q.country === country)
                return (
                  <div key={country}>
                    <div>
                      <strong>{GRIZZLY_POOLS[country]}</strong>
                      <small>号码池 {country}</small>
                    </div>
                    <div>
                      <span>
                        {quote?.priceUsd ? 'US$ ' + quote.priceUsd : '待检查'}
                      </span>
                      <small>
                        {quote?.error
                          ? '查询失败，请重试'
                          : quote?.count !== null && quote?.count !== undefined
                            ? '上次库存 ' + quote.count
                            : '库存待检查'}
                      </small>
                    </div>
                  </div>
                )
              })}
            </div>
            <div className="sms-admin-toggles">
              <label>
                <input
                  type="checkbox"
                  checked={p.visible}
                  disabled={Boolean(busy)}
                  onChange={(e) =>
                    update(index, {
                      visible: e.target.checked,
                      selling: e.target.checked ? p.selling : false,
                    })
                  }
                />
                前台展示
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={p.selling}
                  disabled={Boolean(busy) || !p.visible}
                  onChange={(e) => update(index, { selling: e.target.checked })}
                />
                开放购买
              </label>
            </div>
            <p className="sms-admin-cap-note">
              {p.missing.length
                ? '开售前请完成：' + p.missing.join('；')
                : '保存时会再次核对密钥、余额、库存、成本及收款条件。'}
            </p>
          </article>
        ))}
      </section>
      <div className="sms-admin-save">
        <Button disabled={Boolean(busy)} onClick={() => void action('save')}>
          <Save size={15} />
          {busy === 'save' ? '正在保存…' : '保存接码配置'}
        </Button>
        <span>调整售价与密钥不改写历史订单。</span>
      </div>
      {error && (
        <p className="sms-admin-error" role="alert">
          {error}
        </p>
      )}
    </div>
  )
}

export default function SmsManagement({
  revision,
  onOrder,
}: {
  revision: number
  onOrder: (id: string) => void
}) {
  const [local, setLocal] = useState(0),
    [page, setPage] = useState(1)
  const { data, error, loading } = useResource<Settings>(
    '/api/admin/sms',
    revision + local,
  )
  const orders = useResource<{
    orders: SmsOrder[]
    page: number
    total: number
  }>('/api/admin/sms?orders=1&page=' + page, revision + local)
  return (
    <div className="sms-admin">
      <p className="sms-admin-intro">
        客户支付进入本站收款通道；采购从店主预充值的Grizzly余额扣款。上游停止接码、上游退回余额、本站退款分别核对与留档。
      </p>
      {loading && !data && <p role="status">正在读取接码管理…</p>}
      {error && <p role="alert">{error}</p>}
      {data && (
        <SettingsForm
          key={data.version}
          data={data}
          onSaved={() => setLocal((v) => v + 1)}
        />
      )}
      <section className="admin-card sms-admin-orders">
        <div className="sms-admin-heading">
          <div>
            <h2>接码订单与资金核对</h2>
            <p>
              查看原订单处理异常、停止接码、登记上游退款，或进入买家售后审核。
            </p>
          </div>
          <Button variant="outline" onClick={() => setLocal((v) => v + 1)}>
            <RefreshCw size={14} />
            刷新订单
          </Button>
        </div>
        {orders.error && <p role="alert">{orders.error}</p>}
        {orders.loading && !orders.data && <p>正在读取订单…</p>}
        {orders.data?.orders.length === 0 && (
          <p className="admin-empty">
            暂无接码订单。正式销售前可先完成上方配置。
          </p>
        )}
        {Boolean(orders.data?.orders.length) && (
          <div className="admin-table-scroll">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>订单 / 项目</th>
                  <th>客户收款 · 人民币</th>
                  <th>Grizzly采购 · 美元</th>
                  <th>上游取消 / 余额退款</th>
                  <th>接码与售后状态</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {orders.data!.orders.map((o) => (
                  <tr key={o.id}>
                    <td>
                      <button
                        className="admin-order-id"
                        onClick={() => onOrder(o.id)}
                      >
                        {o.id}
                      </button>
                      <small>{o.plan_name}</small>
                      <small>{time(o.created_at)}</small>
                    </td>
                    <td>
                      {money(o.price_cents)}
                      <small>
                        {o.payment_status === 'paid'
                          ? '渠道确认已到账'
                          : o.payment_status === 'refunded'
                            ? '已退款'
                            : '尚未确认到账'}
                      </small>
                      <small>买家已退款 {money(o.refunded_cents)}</small>
                    </td>
                    <td>
                      {o.cost_usd ? 'US$ ' + o.cost_usd : '未确认扣款'}
                      <small>
                        {o.country ? '号码池 ' + o.country : '号码池待确认'}
                      </small>
                    </td>
                    <td>
                      {o.supplier_cancelled_at
                        ? '上游已确认取消'
                        : '未确认上游取消'}
                      <small>
                        {o.supplier_refund_confirmed_at
                          ? '余额已核对退回 US$ ' + o.supplier_refund_usd
                          : '余额退款未核对'}
                      </small>
                    </td>
                    <td>
                      {states[o.state] ?? o.state}
                      <small>{o.error}</small>
                      <small>
                        {o.refund_hold
                          ? '退款处理中'
                          : o.refund_state
                            ? '售后：' + o.refund_state
                            : '无退款处理中'}
                      </small>
                    </td>
                    <td>
                      <Button variant="outline" onClick={() => onOrder(o.id)}>
                        查看 / 处理
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {orders.data && orders.data.total > 30 && (
          <div className="admin-pagination">
            <span>
              共 {orders.data.total} 笔 · 第 {page} 页
            </span>
            <div>
              <Button
                variant="outline"
                disabled={page === 1}
                onClick={() => setPage((v) => v - 1)}
              >
                上一页
              </Button>
              <Button
                variant="outline"
                disabled={page * 30 >= orders.data.total}
                onClick={() => setPage((v) => v + 1)}
              >
                下一页
              </Button>
            </div>
          </div>
        )}
      </section>
    </div>
  )
}
