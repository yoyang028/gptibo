import { useId, useRef, useState } from 'react'
import { ImagePlus, Save, Upload } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { ProductArtwork } from '@/components/product-artwork'
import { ProductMark } from '@/components/brand'
import { api, errorMessage } from '@/lib/api'
import { useResource } from '@/lib/use-resource'
import { prepareLogo } from '@/lib/prepare-logo'
import {
  ARTWORK_TEMPLATES,
  artworkProblem,
  type ArtworkProduct,
  type ProductArtworkConfig,
} from '../../shared/product-artwork'
import './product-artwork-settings.css'
import '@/styles/storefront-home.css'

export function ProductArtworkSettingsButton({
  productId,
  onSaved,
}: {
  productId?: string
  onSaved?: () => void
}) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        <ImagePlus size={15} />
        展示样式
      </Button>
      {open && (
        <ArtworkSettings
          productId={productId}
          onSaved={onSaved}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  )
}
function ArtworkSettings({
  productId,
  onSaved,
  onClose,
}: {
  productId?: string
  onSaved?: () => void
  onClose: () => void
}) {
  const resource = useResource<{ products: ArtworkProduct[] }>(
    '/api/admin/product-artwork',
  )
  if (resource.data?.products.length)
    return (
      <ArtworkEditor
        rows={resource.data.products}
        initialId={productId}
        onSaved={onSaved}
        onClose={onClose}
      />
    )
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>商品展示样式</DialogTitle>
          <DialogDescription>上传图片，选择模板并预览。</DialogDescription>
        </DialogHeader>
        {resource.error ? (
          <p role="alert">{resource.error}</p>
        ) : (
          <p role="status">
            {resource.loading
              ? '正在读取展示配置…'
              : '请先创建商品，再设置展示样式。'}
          </p>
        )}
      </DialogContent>
    </Dialog>
  )
}
function ArtworkEditor({
  rows,
  initialId,
  onClose,
  onSaved,
}: {
  rows: ArtworkProduct[]
  initialId?: string
  onClose: () => void
  onSaved?: () => void
}) {
  const [products, setProducts] = useState(rows)
  const [selected, setSelected] = useState(
    rows.find((p) => p.id === initialId) ?? rows[0],
  )
  const [draft, setDraft] = useState<ProductArtworkConfig>({
    ...(rows.find((p) => p.id === initialId) ?? rows[0]).config,
  })
  const [mobile, setMobile] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [message, setMessage] = useState(''),
    [discard, setDiscard] = useState<string | null>(null)
  const input = useRef<HTMLInputElement>(null),
    saving = useRef(false)
  const id = useId(),
    dirty = JSON.stringify(draft) !== JSON.stringify(selected.config)
  const problem = artworkProblem(draft)
  const update = (value: Partial<ProductArtworkConfig>) => {
    setDraft((previous) => ({ ...previous, ...value }))
    setError('')
    setMessage('')
  }
  const choose = (next: string) => {
    if (next === 'close') {
      onClose()
      return
    }
    const row = products.find((p) => p.id === next)
    if (row) {
      setSelected(row)
      setDraft({ ...row.config })
      setError('')
      setMessage('')
    }
  }
  const navigate = (next: string) => {
    if (!busy) {
      if (dirty) setDiscard(next)
      else choose(next)
    }
  }
  async function upload(file: File) {
    setBusy(true)
    setError('')
    setMessage('')
    try {
      const image = await prepareLogo(file, 512, 'source')
      update({
        image,
        template: draft.template === 'original' ? 'static' : draft.template,
      })
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }
  async function save() {
    if (busy || saving.current || problem) return
    saving.current = true
    setBusy(true)
    setError('')
    setMessage('')
    try {
      const result = await api<{ product: ArtworkProduct }>(
        '/api/admin/product-artwork',
        { productId: selected.id, version: selected.version, config: draft },
      )
      setProducts((previous) =>
        previous.map((p) => (p.id === result.product.id ? result.product : p)),
      )
      setSelected(result.product)
      setDraft({ ...result.product.config })
      setMessage('展示样式已保存，前台商品列表和详情页已更新。')
      onSaved?.()
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      saving.current = false
      setBusy(false)
    }
  }
  const caption =
    selected.duration || (selected.id === 'chatgpt' ? 'Plus / Pro' : '')
  return (
    <>
      <Dialog
        open
        onOpenChange={(open) => {
          if (!open) navigate('close')
        }}
      >
        <DialogContent
          className="artwork-settings-dialog motion-dialog"
          showCloseButton={!busy}
        >
          <DialogHeader>
            <DialogTitle>商品展示样式</DialogTitle>
            <DialogDescription>
              上传 PNG／JPG 图片并选择展示模板，保存后同步到商品列表和详情页。
            </DialogDescription>
          </DialogHeader>
          <form
            className="artwork-settings-form"
            onSubmit={(e) => {
              e.preventDefault()
              void save()
            }}
          >
            <div className="artwork-settings-grid">
              <fieldset disabled={busy} className="artwork-settings-controls">
                <label htmlFor={id + '-product'}>选择商品</label>
                <select
                  id={id + '-product'}
                  value={selected.id}
                  onChange={(e) => navigate(e.target.value)}
                >
                  {products.map((p) => (
                    <option value={p.id} key={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
                <label htmlFor={id + '-image'}>展示图片</label>
                <input
                  ref={input}
                  id={id + '-image'}
                  type="file"
                  accept="image/png,image/jpeg"
                  className="sr-only"
                  onChange={(e) => {
                    const file = e.target.files?.[0]
                    e.target.value = ''
                    if (file) void upload(file)
                  }}
                />
                <div className="artwork-upload-row">
                  {draft.image ? (
                    <img src={draft.image} alt="当前展示图片" />
                  ) : (
                    <span className="artwork-upload-placeholder">
                      <ImagePlus size={24} />
                    </span>
                  )}
                  <div>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => input.current?.click()}
                    >
                      <Upload size={14} />
                      {draft.image ? '更换图片' : '上传图片'}
                    </Button>
                    <p>PNG／JPG，最大 5 MB；保留 PNG 透明背景。</p>
                  </div>
                </div>
                <fieldset className="artwork-template-fieldset">
                  <legend>展示模板</legend>
                  <div className="artwork-template-options">
                    {ARTWORK_TEMPLATES.map((t) => (
                      <label
                        key={t.id}
                        className={draft.template === t.id ? 'is-selected' : ''}
                      >
                        <input
                          type="radio"
                          name={id + '-template'}
                          value={t.id}
                          checked={draft.template === t.id}
                          onChange={() => update({ template: t.id })}
                        />
                        {t.label}
                      </label>
                    ))}
                  </div>
                </fieldset>
                <p className="artwork-settings-help">
                  “沿用原展示”保留商品现有图片和动画。其他模板使用上方上传的图片；静态模板不播放动效。
                </p>
              </fieldset>
              <section
                className="artwork-preview-panel"
                aria-label="展示样式实时预览"
              >
                <div className="artwork-preview-heading">
                  <strong>实时预览</strong>
                  <div role="group" aria-label="预览尺寸">
                    <Button
                      type="button"
                      variant="ghost"
                      aria-pressed={!mobile}
                      onClick={() => setMobile(false)}
                    >
                      电脑
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      aria-pressed={mobile}
                      onClick={() => setMobile(true)}
                    >
                      手机
                    </Button>
                  </div>
                </div>
                <div
                  className={
                    'artwork-preview-canvas' + (mobile ? ' is-mobile' : '')
                  }
                >
                  <article className="store-product">
                    <div className="store-product-heading">
                      <h3>{selected.name}</h3>
                    </div>
                    <p className="store-spec">{caption || '商品展示'}</p>
                    <ProductArtwork
                      config={draft}
                      name={selected.name}
                      caption={caption}
                      fallback={
                        <div className="artwork-preview-original">
                          {selected.image ? (
                            <img src={selected.image} alt="" />
                          ) : (
                            <ProductMark productId={selected.id} />
                          )}
                          <p>
                            {draft.template === 'original'
                              ? '前台沿用原有商品展示'
                              : '上传图片后即可预览'}
                          </p>
                        </div>
                      }
                    />
                  </article>
                </div>
                <p className="artwork-settings-help">
                  切换模板即时更新预览。离开可见区域或系统开启“减少动态效果”时，会停止动画。
                </p>
              </section>
            </div>
            {error && (
              <p role="alert" className="artwork-settings-error">
                {error}
              </p>
            )}
            {message && (
              <p role="status" className="artwork-settings-success">
                {message}
              </p>
            )}
            {problem && draft.template !== 'original' && (
              <p className="artwork-settings-help">{problem}</p>
            )}
            <footer className="artwork-settings-actions">
              <Button
                type="submit"
                disabled={busy || Boolean(problem) || !dirty}
              >
                <Save size={15} />
                {busy ? '处理中…' : '保存展示样式'}
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={busy}
                onClick={() => navigate('close')}
              >
                关闭
              </Button>
            </footer>
          </form>
        </DialogContent>
      </Dialog>
      <Dialog
        open={discard !== null}
        onOpenChange={(open) => {
          if (!open) setDiscard(null)
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>放弃尚未保存的展示配置？</DialogTitle>
            <DialogDescription>已保存的前台展示不会改变。</DialogDescription>
          </DialogHeader>
          <Button variant="outline" onClick={() => setDiscard(null)}>
            继续编辑
          </Button>
          <Button
            onClick={() => {
              if (discard) choose(discard)
              setDiscard(null)
            }}
          >
            放弃修改
          </Button>
        </DialogContent>
      </Dialog>
    </>
  )
}
