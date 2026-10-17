import { useState } from 'react'
import { Download, KeyRound, RefreshCw, Save } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { api, errorMessage } from '@/lib/api'
import { useResource } from '@/lib/use-resource'
import { ProductEditor } from './ProductPublisher'
import {
  HANFOLK_FAMILIES,
  skuName,
  type HanfolkFamily,
  type HanfolkProduct,
  type HanfolkDetail,
} from '../../shared/hanfolk-catalog'
import type { ShopProduct } from '../../shared/shop-products'
import './hanfolk-catalog.css'

type SourceProduct = HanfolkProduct & {
  family: HanfolkFamily
  detail: HanfolkDetail | null
  checkedAt: number
}
type Draft = {
  id: string
  productId: number
  sku: string
  costCents: number
  name: string
  family: HanfolkFamily
  status: string
  pricePending: boolean
  priceCents: number
}
type State = {
  version: number
  configured: boolean
  verified: boolean
  balanceCents: number | null
  checkedAt: number
  products: SourceProduct[]
  drafts: Draft[]
  procurementEnabled: false
  result?: { imported: string[]; existing: string[] }
}
export default function HanfolkCatalog({ revision }: { revision: number }) {
  const [local, setLocal] = useState(0),
    [apiKey, setKey] = useState(''),
    [family, setFamily] = useState('all'),
    [selection, setSelection] = useState<string[]>([]),
    [busy, setBusy] = useState(''),
    [error, setError] = useState(''),
    [message, setMessage] = useState(''),
    [edit, setEdit] = useState<ShopProduct | null>(null)
  const {
    data,
    error: readError,
    loading,
  } = useResource<State>('/api/admin/hanfolk', revision + local)
  const products = (data?.products ?? []).filter(
    (p) => family === 'all' || p.family === family,
  )
  function toggle(value: string) {
    setSelection((values) =>
      values.includes(value)
        ? values.filter((v) => v !== value)
        : [...values, value],
    )
  }
  async function action(name: string, extra: Record<string, unknown> = {}) {
    if (!data || busy) return
    setBusy(name)
    setError('')
    setMessage('')
    try {
      const result = await api<State>('/api/admin/hanfolk', {
        action: name,
        version: data.version,
        ...extra,
      })
      if (name === 'save-key') setKey('')
      if (result.result) {
        setMessage(
          '新增 ' +
            result.result.imported.length +
            ' 个待定价草稿；已有 ' +
            result.result.existing.length +
            ' 个规格保留原售价与内容。',
        )
        setSelection([])
      } else
        setMessage(
          name === 'refresh'
            ? '已读取指定九类商品，未采购、未扣款。'
            : name === 'detail'
              ? '已读取实际规格和原商品说明。'
              : '密钥已在服务端加密保存。',
        )
      setLocal((v) => v + 1)
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setBusy('')
    }
  }
  async function editor(id: string) {
    setBusy('editor')
    setError('')
    try {
      const all = await api<{ products: ShopProduct[] }>(
        '/api/admin/my-shop/products',
      )
      const p = all.products.find((p) => p.id === id)
      if (!p) throw new Error('商品已变化，请刷新。')
      setEdit(p)
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setBusy('')
    }
  }
  return (
    <div className="hanfolk-admin">
      <section className="admin-card hanfolk-connection">
        <div className="hanfolk-heading">
          <div>
            <h2>
              <KeyRound size={18} />
              大橘 AI · 卖家 API
            </h2>
            <p>
              商品资料只读同步，新增规格先保存待定价草稿，不改变原有商品售价。
            </p>
          </div>
          <span>
            {data?.configured
              ? data.verified
                ? '连接已检查'
                : '已保存密钥 · 待检查'
              : '尚未配置'}
          </span>
        </div>
        <label>
          API Key
          <Input
            aria-label="大橘 API Key"
            type="password"
            autoComplete="new-password"
            value={apiKey}
            onChange={(e) => setKey(e.target.value)}
            placeholder={
              data?.configured ? '留空保留现有密钥' : 'daju_ 开头的卖家 Key'
            }
            disabled={Boolean(busy)}
            maxLength={100}
          />
        </label>
        <div className="hanfolk-actions">
          <Button
            disabled={Boolean(busy) || !apiKey || !data}
            onClick={() => void action('save-key', { apiKey })}
          >
            <Save size={15} />
            加密保存密钥
          </Button>
          <Button
            variant="outline"
            disabled={Boolean(busy) || !data?.configured || Boolean(apiKey)}
            onClick={() => void action('refresh')}
          >
            <RefreshCw size={15} />
            {busy === 'refresh' ? '正在读取…' : '只读读取九类商品'}
          </Button>
        </div>
        <div className="hanfolk-status">
          <span>采购与收款：未开放</span>
          <span>
            供货余额：
            {data?.balanceCents === null || data?.balanceCents === undefined
              ? '待检查'
              : '¥' + (data.balanceCents / 100).toFixed(2)}
          </span>
          <span>
            上次检查：
            {data?.checkedAt
              ? new Date(data.checkedAt).toLocaleString('zh-CN')
              : '尚未检查'}
          </span>
        </div>
        <p className="hanfolk-help">
          密钥仅在服务端加密保存，不回显。读取仅调用商品与余额 GET
          接口；代理成本仅在后台显示，不直接作为店铺零售价。
        </p>
        <a
          href="https://ai.hanfolk.xyz/content/plugins/seller_api/docs.php"
          target="_blank"
          rel="noreferrer"
        >
          查看接口文档 ↗
        </a>
      </section>
      {(error || readError) && <p role="alert">{error || readError}</p>}
      {message && (
        <p role="status" className="hanfolk-message">
          {message}
        </p>
      )}
      {loading && !data && <p>正在读取代理商品…</p>}
      <section className="admin-card">
        <div className="hanfolk-heading">
          <div>
            <h2>挑选商品与实际规格</h2>
            <p>
              先读取详情，核对适用条件、步骤和售后，再选择规格导入。源商品说明保留为可编辑纯文字。
            </p>
          </div>
          <label className="hanfolk-filter">
            商品类别
            <select
              aria-label="代理商品类别"
              value={family}
              onChange={(e) => setFamily(e.target.value)}
            >
              <option value="all">全部九类</option>
              {Object.entries(HANFOLK_FAMILIES).map(([id, name]) => (
                <option key={id} value={id}>
                  {name}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="hanfolk-actions">
          <span>已选择 {selection.length} 个规格</span>
          <Button
            variant="outline"
            disabled={Boolean(busy) || !products.some((p) => p.detail)}
            onClick={() =>
              setSelection([
                ...new Set([
                  ...selection,
                  ...products.flatMap(
                    (p) =>
                      p.detail?.sku_variants.map((s) => p.id + ':' + s.sku) ??
                      [],
                  ),
                ]),
              ])
            }
          >
            选择本类已读取的规格
          </Button>
          <Button
            variant="ghost"
            disabled={Boolean(busy) || !selection.length}
            onClick={() => setSelection([])}
          >
            清空选择
          </Button>
          <Button
            disabled={
              Boolean(busy) || !selection.length || selection.length > 100
            }
            onClick={() =>
              void action('import', {
                selection: selection.map((s) => {
                  const [id, ...sku] = s.split(':')
                  return { productId: Number(id), sku: sku.join(':') }
                }),
              })
            }
          >
            <Download size={15} />
            {busy === 'import' ? '正在导入…' : '导入待定价草稿'}
          </Button>
        </div>
        {!products.length && (
          <p className="hanfolk-empty">
            {data?.products.length
              ? '此类别暂未读到源商品。'
              : '保存密钥并读取后，这里显示指定九类商品。'}
          </p>
        )}
        <div className="hanfolk-products">
          {products.map((p) => (
            <article key={p.id} className="hanfolk-source">
              <div className="hanfolk-heading">
                <div>
                  <span className="hanfolk-family">
                    {HANFOLK_FAMILIES[p.family]}
                  </span>
                  <h3>{p.title}</h3>
                  <p>
                    源商品 #{p.id} ·{' '}
                    {p.is_auto ? '源平台自动发货' : '源平台人工处理'} · 上次库存{' '}
                    {p.stock}
                  </p>
                </div>
                <Button
                  variant="outline"
                  disabled={Boolean(busy)}
                  onClick={() => void action('detail', { productId: p.id })}
                >
                  {p.detail ? '重新读取详情' : '读取详情与规格'}
                </Button>
              </div>
              {p.detail && (
                <>
                  <div className="hanfolk-skus">
                    {p.detail.sku_variants.map((s) => (
                      <label key={s.sku}>
                        <input
                          type="checkbox"
                          checked={selection.includes(p.id + ':' + s.sku)}
                          onChange={() => toggle(p.id + ':' + s.sku)}
                          disabled={Boolean(busy)}
                        />
                        <span>
                          <strong>{skuName(p.detail!, s.sku)}</strong>
                          <small>
                            SKU {s.sku} · 上次库存 {s.stock}
                          </small>
                        </span>
                        <span>
                          代理成本 ¥{s.price.toFixed(2)}
                          <small>仅后台可见</small>
                        </span>
                      </label>
                    ))}
                  </div>
                  <details className="hanfolk-source-copy">
                    <summary>查看完整源商品说明与输入要求</summary>
                    <pre>
                      {p.detail.description ||
                        '源商品没有提供文字介绍，导入后需补全。'}
                    </pre>
                    {p.detail.required_inputs.length > 0 && (
                      <p>
                        源平台要求：
                        {p.detail.required_inputs.map((v) => v.name).join('、')}
                        。本次仅保存资料，尚未向买家收集这些字段。
                      </p>
                    )}
                  </details>
                </>
              )}
            </article>
          ))}
        </div>
      </section>
      <section className="admin-card">
        <div className="hanfolk-heading">
          <div>
            <h2>已整理的商品草稿</h2>
            <p>
              待定价草稿不会出现在前台，也不能下单。编辑确认售价和资料后，先选择「展示中
              · 未开售」。
            </p>
          </div>
          <Button variant="outline" onClick={() => setLocal((v) => v + 1)}>
            <RefreshCw size={14} />
            刷新
          </Button>
        </div>
        {!data?.drafts.length ? (
          <p className="hanfolk-empty">暂无导入记录。</p>
        ) : (
          <div className="admin-table-scroll">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>项目 / 商品</th>
                  <th>源规格</th>
                  <th>代理成本（私有）</th>
                  <th>零售价与展示状态</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {data.drafts
                  .filter((p) => family === 'all' || p.family === family)
                  .map((p) => (
                    <tr key={p.id}>
                      <td>
                        {HANFOLK_FAMILIES[p.family]}
                        <small>{p.name}</small>
                      </td>
                      <td>
                        #{p.productId}
                        <small>SKU {p.sku}</small>
                      </td>
                      <td>¥{(p.costCents / 100).toFixed(2)}</td>
                      <td>
                        {p.pricePending
                          ? '待定价'
                          : '¥' + (p.priceCents / 100).toFixed(2)}
                        <small>
                          {{
                            draft: '草稿 · 不展示',
                            listed: '展示中 · 未开售',
                            published: '已发布',
                            archived: '已下架',
                          }[p.status] ?? p.status}
                        </small>
                      </td>
                      <td>
                        <Button
                          variant="outline"
                          disabled={Boolean(busy)}
                          onClick={() => void editor(p.id)}
                        >
                          编辑与定价
                        </Button>
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      {edit && (
        <ProductEditor
          listingOnly
          key={edit.id}
          initial={edit}
          onClose={() => setEdit(null)}
          onSaved={() => setLocal((v) => v + 1)}
        />
      )}
    </div>
  )
}
