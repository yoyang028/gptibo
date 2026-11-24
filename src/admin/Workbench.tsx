import { ArrowUpRight, ClipboardList, MessageCircle, RotateCcw } from 'lucide-react'
import { Feedback } from '@/components/workspace-loading'
import { useResource } from '@/lib/use-resource'
import { adminWorkspaceUrl } from '../../shared/admin-workspace'
import type { AdminNotifications } from './TicketAlerts'

type Summary = { pendingOrders: number; today: { orders: number; paid: number; cash_cents: number } }
type LegacySummary = { stats: { active: number } }
const money = new Intl.NumberFormat('zh-CN', { style: 'currency', currency: 'CNY' })

export default function Workbench({ revision, counts, onNavigate, supportsStoreScopes }: {
  revision: number
  counts: AdminNotifications
  onNavigate: (url: string) => void
  supportsStoreScopes: boolean
}) {
  const resource = useResource<Summary | LegacySummary>(supportsStoreScopes ? '/api/admin/workbench' : '/api/admin/overview', revision)
  const data = resource.data
  const today = data && 'today' in data ? data.today : undefined
  const pending = data && ('pendingOrders' in data ? data.pendingOrders : data.stats.active)
  const tasks = [
    { label: '待处理订单', count: pending, icon: ClipboardList, url: adminWorkspaceUrl('orders', { tab: 'list', scope: 'all', status: supportsStoreScopes ? 'active' : undefined }) },
    { label: '待处理退款', count: counts.refunds, icon: RotateCcw, url: adminWorkspaceUrl('orders', { tab: 'refunds' }) },
    { label: '待处理工单', count: counts.tickets, icon: MessageCircle, url: adminWorkspaceUrl('partners', { tab: 'tickets' }) },
  ]
  return <>
    <Feedback {...resource} shape="compact" />
    <section className="admin-panel admin-task-panel" aria-labelledby="admin-tasks">
      <div className="admin-panel-title"><h2 id="admin-tasks">待办事项</h2><span>全平台</span></div>
      <div className="admin-task-grid">
        {tasks.map(task => <button className="admin-task" key={task.label} onClick={() => onNavigate(task.url)}>
          <span className="admin-task-icon"><task.icon size={17} /></span>
          <span className="admin-task-label">{task.label}</span>
          <strong>{task.count ?? '—'}</strong>
          <ArrowUpRight className="admin-task-arrow" size={15} />
        </button>)}
      </div>
    </section>
    {today && <section className="admin-panel admin-today-panel" aria-labelledby="admin-today">
      <div className="admin-panel-title"><h2 id="admin-today">今日自营</h2><span>北京时间 · 按下单时间</span></div>
      <div className="admin-today-grid">
        <div><span>新订单</span><strong>{today.orders}</strong></div>
        <div><span>新单已付款</span><strong>{today.paid}</strong></div>
        <div><span>新单实付（退款前）</span><strong>{money.format(today.cash_cents / 100)}</strong></div>
      </div>
    </section>}
  </>
}
