import { Button } from '@/components/ui/button'
import { ArtworkImage } from '@/components/product-artwork'
import {
  defaultProcessing,
  type ProductArtworkConfig,
  type ArtworkProcessing,
  type ArtworkLayout,
} from '../../shared/product-artwork'

export function ArtworkMaterialControls({
  config,
  id,
  onProcess,
  onVectorize,
  onRaster,
  onRestore,
}: {
  config: ProductArtworkConfig
  id: string
  onProcess: (value: ArtworkProcessing) => void
  onVectorize: () => void
  onRaster: () => void
  onRestore: () => void
}) {
  const processing = config.processing ?? defaultProcessing()
  return (
    <fieldset className="artwork-control-section">
      <legend>素材处理</legend>
      <p className="artwork-settings-help">
        仅清理与外围连通的简单背景。复杂背景保留原色；若主体有缺失，可降低强度、关闭清理或还原原图。
      </p>
      <div className="artwork-checks">
        {(
          [
            ['removeBackground', '清理外围背景'],
            ['trim', '裁剪多余留白'],
            ['cleanEdges', '清理边缘杂点'],
          ] as const
        ).map(([key, label]) => (
          <label key={key}>
            <input
              type="checkbox"
              checked={processing[key]}
              onChange={(e) =>
                onProcess({ ...processing, [key]: e.target.checked })
              }
            />
            {label}
          </label>
        ))}
      </div>
      <label htmlFor={id + '-tolerance'}>背景清理强度</label>
      <select
        id={id + '-tolerance'}
        value={processing.tolerance}
        onChange={(e) =>
          onProcess({ ...processing, tolerance: Number(e.target.value) })
        }
      >
        {[12, 24, 40, 64].includes(processing.tolerance) ? null : (
          <option value={processing.tolerance}>{processing.tolerance}</option>
        )}
        <option value={12}>轻度 · 保护浅色边缘</option>
        <option value={24}>标准 · 简单纯色背景</option>
        <option value={40}>较强 · 轻微压缩杂边</option>
        <option value={64}>强 · 请核对主体细节</option>
      </select>
      <div className="artwork-material-actions">
        <Button
          type="button"
          variant="outline"
          onClick={() => onProcess(processing)}
        >
          重新处理素材
        </Button>
        <Button type="button" variant="outline" onClick={onRestore}>
          还原上传原图
        </Button>
      </div>
      <div className="artwork-comparison" aria-label="素材处理前后对比">
        <figure>
          <div className="artwork-checker">
            <img src={config.source || config.image} alt="处理前原图" />
          </div>
          <figcaption>处理前</figcaption>
        </figure>
        <figure>
          <div className="artwork-checker">
            <ArtworkImage config={config} />
          </div>
          <figcaption>处理后 · {config.vector ? '矢量' : '位图'}</figcaption>
        </figure>
      </div>
      <div className="artwork-material-actions">
        <Button
          type="button"
          variant="outline"
          disabled={Boolean(config.vector)}
          onClick={onVectorize}
        >
          尝试矢量化
        </Button>
        {config.vector && (
          <Button type="button" variant="outline" onClick={onRaster}>
            使用位图
          </Button>
        )}
      </div>
      <p className="artwork-settings-help">
        矢量化适合最多 8 种纯色的简单
        Logo；渐变、照片和复杂图片保留位图。原图用于再次编辑与还原，不展示给顾客。
      </p>
    </fieldset>
  )
}

export function ArtworkLayoutControls({
  layout,
  id,
  onChange,
  onEnd,
}: {
  layout: ArtworkLayout
  id: string
  onChange: (value: ArtworkLayout, coalesce?: string) => void
  onEnd: () => void
}) {
  return (
    <fieldset className="artwork-control-section">
      <legend>大小、位置与卡片背景</legend>
      {(
        [
          ['scale', '主体大小', 50, 150, '%'],
          ['x', '水平位置', -40, 40, '%'],
          ['y', '垂直位置', -30, 30, '%'],
        ] as const
      ).map(([key, label, min, max, unit]) => (
        <label className="artwork-range" key={key} htmlFor={id + '-' + key}>
          <span>
            {label}
            <output aria-hidden="true">
              {layout[key]}
              {unit}
            </output>
          </span>
          <input
            id={id + '-' + key}
            type="range"
            min={min}
            max={max}
            step={1}
            value={layout[key]}
            onChange={(e) =>
              onChange({ ...layout, [key]: Number(e.target.value) }, key)
            }
            onPointerUp={onEnd}
            onKeyUp={onEnd}
            onBlur={onEnd}
          />
        </label>
      ))}
      <label htmlFor={id + '-background'}>卡片背景</label>
      <select
        id={id + '-background'}
        value={layout.background}
        onChange={(e) =>
          onChange({
            ...layout,
            background: e.target.value as ArtworkLayout['background'],
          })
        }
      >
        <option value="auto">商城默认柔光</option>
        <option value="none">融入卡片 · 透明</option>
        <option value="halo">自定义柔光</option>
        <option value="solid">自定义纯色</option>
      </select>
      {['halo', 'solid'].includes(layout.background) && (
        <label className="artwork-color">
          背景颜色
          <input
            type="color"
            value={layout.backgroundColor}
            onChange={(e) =>
              onChange(
                { ...layout, backgroundColor: e.target.value },
                'backgroundColor',
              )
            }
            onBlur={onEnd}
          />
        </label>
      )}
      <label htmlFor={id + '-pedestal'}>主体底托</label>
      <select
        id={id + '-pedestal'}
        value={layout.pedestal}
        onChange={(e) =>
          onChange({
            ...layout,
            pedestal: e.target.value as ArtworkLayout['pedestal'],
          })
        }
      >
        <option value="none">无底托</option>
        <option value="shadow">柔和投影</option>
        <option value="disc">悬浮圆台</option>
      </select>
      {layout.pedestal !== 'none' && (
        <label className="artwork-color">
          底托颜色
          <input
            type="color"
            value={layout.pedestalColor}
            onChange={(e) =>
              onChange(
                { ...layout, pedestalColor: e.target.value },
                'pedestalColor',
              )
            }
            onBlur={onEnd}
          />
        </label>
      )}
      <Button
        type="button"
        variant="outline"
        onClick={() => onChange({ ...layout, scale: 100, x: 0, y: 0 })}
      >
        主体大小与位置复位
      </Button>
    </fieldset>
  )
}
