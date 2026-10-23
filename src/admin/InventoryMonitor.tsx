import { useEffect, useRef, useState } from 'react'
import { Activity, RefreshCw, Save } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Feedback } from '@/components/workspace-loading'
import { api, errorMessage } from '@/lib/api'
import { useResource } from '@/lib/use-resource'
import type { InventoryMonitor as Monitor, RemovalReview, SyncOptions } from '../../shared/inventory-sync'

const time = (value: number) => value ? new Date(value).toLocaleString('zh-CN') : '尚无记录'
const outcomes = { running: '同步中', success: '成功', failed: '失败', superseded: '配置变化 · 未应用' }
const kinds = { new: '新增规格 · 待确认', stock: '库存变化', removed: '上游移除 · 待确认下架', restocked: '补货恢复', price: '上游成本变化' }
const quantity = (value: number | null) => value === null ? '未知' : String(value)

function SyncSettings({ options, busy, onSave }: { options: SyncOptions; busy: boolean; onSave: (enabled: boolean, minutes: number) => void }) {
  const [enabled, setEnabled] = useState(options.enabled)
  const [minutes, setMinutes] = useState<number>(options.intervalMinutes)
  return <form className="inventory-sync-settings" onSubmit={event => { event.preventDefault(); onSave(enabled, minutes) }}>
    <label className="admin-checkbox"><input type="checkbox" checked={enabled} onChange={event => setEnabled(event.target.checked)} disabled={busy} />自动同步 Daju 库存</label>
    <label>同步间隔<select aria-label="库存同步间隔" value={minutes} onChange={event => setMinutes(Number(event.target.value))} disabled={busy}>{[5, 10, 30].map(value => <option key={value} value={value}>每 {value} 分钟</option>)}</select></label>
    <Button type="submit" variant="outline" disabled={busy || enabled === options.enabled && minutes === options.intervalMinutes}><Save size={15} />保存同步设置</Button>
  </form>
}

export function InventoryMonitor({ revision, configured, onSaved, onSource }: { revision: number; configured: boolean; onSaved: () => void; onSource: () => void }) {
  const [page, setPage] = useState(1), [historyPage, setHistoryPage] = useState(1), [tick, setTick] = useState(0)
  const [busy, setBusy] = useState(''), [error, setError] = useState(''), [message, setMessage] = useState('')
  const [removal, setRemoval] = useState<RemovalReview | null>(null), [confirmed, setConfirmed] = useState(false)
  const running = useRef(false)
  const { data, error: readError, loading } = useResource<Monitor>(`/api/admin/hanfolk/monitor?page=${page}&historyPage=${historyPage}`, revision + tick, { retainOnError: true })
  useEffect(() => {
    const refresh = () => { if (!document.hidden) setTick(value => value + 1) }
    const timer = window.setInterval(refresh, 30_000)
    document.addEventListener('visibilitychange', refresh)
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', refresh) }
  }, [])
  async function action(name: string, extra: Record<string, unknown>) {
    if (!data || running.current) return
    running.current = true; setBusy(name); setError(''); setMessage('')
    try {
      await api('/api/admin/hanfolk', { action: name, ...extra })
      setMessage(name === 'sync-settings' ? '同步设置已保存。' : name === 'refresh' ? '库存已同步；原有商品配置和展示状态已保留。' : '已按你的确认下架该规格，价格与内容已保留。')
      if (name === 'confirm-remove') { setRemoval(null); setConfirmed(false) }
      setTick(value => value + 1); onSaved()
    } catch (caught) { setError(errorMessage(caught)); setTick(value => value + 1); onSaved() }
    finally { running.current = false; setBusy('') }
  }
  return <section className="inventory-monitor" aria-label="上游库存监测">
    <div className="supplier-card">
      <div className="supplier-card-heading"><div><h2><Activity size={18} />库存同步设置</h2><p>缺货保留卡片和规格，显示补货中；补货恢复原状态。新增展示和正式下架由你确认。</p></div><Button variant="outline" disabled={Boolean(busy) || !configured || data?.options.running} onClick={() => void action('refresh', {})}><RefreshCw size={15} />{busy === 'refresh' || data?.options.running ? '同步中…' : '立即同步库存'}</Button></div>
      <Feedback error={error || readError} loading={loading} data={data} />
      {message && <p role="status" className="hanfolk-message">{message}</p>}
      {data && <>
        <SyncSettings key={data.options.version} options={data.options} busy={Boolean(busy)} onSave={(enabled, intervalMinutes) => void action('sync-settings', { enabled, intervalMinutes, syncVersion: data.options.version })} />
        <div className="hanfolk-status"><span>上次尝试：{time(data.options.lastAttemptAt)}</span><span>上次成功：{time(data.options.lastSuccessAt)}</span><span>连续失败：{data.options.consecutiveFailures} 次</span></div>
        {data.options.consecutiveFailures > 0 && <p className="inventory-sync-alert" role="status">{data.options.consecutiveFailures >= 3 ? '同步持续异常，请检查上游连接。' : '最近一次同步未成功。'} {data.options.lastError}。保留上次有效库存；超过 15 分钟未确认的规格暂停下单。</p>}
        <p className="supplier-help">人工下架保持下架；待定价和仅展示商品保持原设置。同步失败不会清零库存。运行记录保留 30 天，商品变更保留 90 天。</p>
      </>}
    </div>
    {data && <>
      <div className="inventory-review-grid">
        <section className="supplier-card"><div className="supplier-card-heading"><div><h2>新增商品与规格 <span className="admin-pill">{data.pendingNew.length}</span></h2><p>导入为草稿，定价并确认后展示。</p></div><Button variant="outline" onClick={onSource}>前往选品与定价</Button></div>
          {data.pendingNew.length ? <ul className="inventory-new-list">{data.pendingNew.slice(0, 10).map(item => <li key={item.productId + ':' + item.sku}><strong>{item.name}</strong><span>#{item.productId} · SKU {item.sku} · 库存 {item.stock}</span></li>)}</ul> : <p className="supplier-help">没有待确认的新规格。</p>}
          {data.pendingNew.length > 10 && <p className="supplier-help">此处显示前 10 项，进入上游目录查看全部。</p>}
        </section>
        <section className="supplier-card"><div className="supplier-card-heading"><div><h2>待确认下架 <span className="admin-pill">{data.pendingRemoval.length}</span></h2><p>上游已移除的规格继续保留展示，由你决定是否下架。</p></div></div>
          {data.pendingRemoval.length ? <ul className="inventory-new-list">{data.pendingRemoval.map(item => <li key={item.id}><strong>{item.name}</strong><span>#{item.productId} · SKU {item.sku}</span><Button variant="outline" disabled={Boolean(busy)} onClick={() => { setRemoval(item); setConfirmed(false) }}>确认下架此规格</Button></li>)}</ul> : <p className="supplier-help">没有待确认下架的规格。</p>}
        </section>
      </div>
      <section className="supplier-card"><div className="supplier-card-heading"><div><h2>同步记录</h2><p>查看每次执行结果，展开查看商品库存和上游目录变化。</p></div><Button variant="outline" onClick={() => setTick(value => value + 1)} disabled={loading}><RefreshCw size={15} />刷新记录</Button></div>
        {!data.runs.length ? <p className="supplier-help">尚无同步记录。点击立即同步开始监测。</p> : <div className="inventory-sync-runs">{data.runs.map(run => <details key={run.id} className="inventory-sync-run"><summary><span className={'admin-pill ' + (run.status === 'success' ? 'available' : '')}>{outcomes[run.status]}</span><span>{time(run.started_at)}<small>{run.trigger === 'manual' ? '手动同步' : '自动同步'} · {run.finished_at ? `${Math.max(0, Math.round((run.finished_at - run.started_at) / 1000))} 秒` : '执行中'}</small></span><span>{run.product_count} 个商品 · {run.variant_count} 个规格<small>{run.change_count} 项变化</small></span></summary><div className="inventory-sync-detail">
          {run.error && <p className="inventory-sync-alert">{run.error}</p>}
          {data.changes.filter(change => change.run_id === run.id).map(change => <p key={change.id}><strong>{change.name}</strong><span>{kinds[change.kind]} · SKU {change.sku}</span><small>{change.kind === 'price' ? `采购成本：¥${((change.before_cost ?? 0) / 100).toFixed(2)} → ¥${((change.after_cost ?? 0) / 100).toFixed(2)}；本站售价保持原值` : `库存：${quantity(change.before_stock)} → ${quantity(change.after_stock)}`}</small></p>)}
          {run.status === 'success' && run.change_count === 0 && <p className="supplier-help">同步成功，商品与库存没有变化。</p>}
          {run.change_count > data.changes.filter(change => change.run_id === run.id).length && <p className="supplier-help">更多变化请在下方商品变更记录中查看。</p>}
        </div></details>)}</div>}
        <div className="inventory-sync-pagination"><span>共 {data.total} 次 · 第 {page} 页</span><Button variant="outline" disabled={page <= 1 || loading} onClick={() => setPage(value => value - 1)}>上一页</Button><Button variant="outline" disabled={page * 20 >= data.total || loading} onClick={() => setPage(value => value + 1)}>下一页</Button></div>
      </section>
      <section className="supplier-card"><div className="supplier-card-heading"><div><h2>商品变更记录</h2><p>保留最近 90 天的库存、补货、新规格、移除及采购成本变化。</p></div></div>
        {!data.history.length ? <p className="supplier-help">尚无商品变化。</p> : <div className="inventory-sync-detail">{data.history.map(change => <p key={change.id}><strong>{change.name}</strong><span>{kinds[change.kind]} · #{change.product_id} · SKU {change.sku}</span><small>{time(change.created_at)} · {change.kind === 'price' ? `采购成本：¥${((change.before_cost ?? 0) / 100).toFixed(2)} → ¥${((change.after_cost ?? 0) / 100).toFixed(2)}；本站售价保持原值` : `库存：${quantity(change.before_stock)} → ${quantity(change.after_stock)}`}</small></p>)}</div>}
        <div className="inventory-sync-pagination"><span>共 {data.historyTotal} 项 · 第 {historyPage} 页</span><Button variant="outline" disabled={historyPage <= 1 || loading} onClick={() => setHistoryPage(value => value - 1)}>上一页变更</Button><Button variant="outline" disabled={historyPage * 30 >= data.historyTotal || loading} onClick={() => setHistoryPage(value => value + 1)}>下一页变更</Button></div>
      </section>
    </>}
    <Dialog open={Boolean(removal)} onOpenChange={open => { if (!open && !busy) { setRemoval(null); setConfirmed(false) } }}><DialogContent className="motion-dialog"><DialogHeader><DialogTitle>确认下架此规格</DialogTitle><DialogDescription>{removal?.name}。确认后该规格移出前台，价格、详情和上游关联保留；以后补货也保持人工下架状态。</DialogDescription></DialogHeader><label className="admin-checkbox"><input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} disabled={Boolean(busy)} />我确认下架这个规格</label>{error && <p role="alert">{error}</p>}<Button disabled={!confirmed || Boolean(busy)} onClick={() => removal && void action('confirm-remove', { confirmed, productId: removal.id, productVersion: removal.version, checkedAt: removal.checkedAt })}>{busy === 'confirm-remove' ? '正在保存…' : '确认下架'}</Button></DialogContent></Dialog>
  </section>
}
