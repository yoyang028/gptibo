export const ARTWORK_TEMPLATES = [
  { id: 'original', label: '沿用原展示' },
  { id: 'static', label: '静态' },
  { id: 'float', label: '漂浮' },
  { id: 'zoom', label: '缩放' },
  { id: 'shine', label: '扫光' },
  { id: 'membership', label: '会员卡片' },
] as const
export type ArtworkTemplate = (typeof ARTWORK_TEMPLATES)[number]['id']
export type ArtworkProcessing = {
  removeBackground: boolean
  tolerance: number
  trim: boolean
  cleanEdges: boolean
}
export type ArtworkLayout = {
  scale: number
  x: number
  y: number
  background: 'auto' | 'none' | 'solid' | 'halo'
  backgroundColor: string
  pedestal: 'none' | 'shadow' | 'disc'
  pedestalColor: string
}
// Only numeric path geometry is accepted. Uploaded SVG/HTML is never stored or rendered.
export type ArtworkVector = {
  width: number
  height: number
  paths: { fill: string; d: string }[]
}
export type ProductArtworkConfig = {
  template: ArtworkTemplate
  image: string
  source?: string
  processing?: ArtworkProcessing
  layout?: ArtworkLayout
  vector?: ArtworkVector
}
export const MAX_ARTWORK_IMAGE_LENGTH = 600000
export const defaultProcessing = (): ArtworkProcessing => ({
  removeBackground: true,
  tolerance: 24,
  trim: true,
  cleanEdges: true,
})
export const defaultLayout = (): ArtworkLayout => ({
  scale: 100,
  x: 0,
  y: 0,
  background: 'auto',
  backgroundColor: '#e8e5ff',
  pedestal: 'none',
  pedestalColor: '#d8d2f0',
})
export type ProductArtworkMap = Record<string, ProductArtworkConfig>
export type ArtworkProduct = {
  id: string
  name: string
  image: string
  duration: string
  config: ProductArtworkConfig
  version: number
}
export const originalArtwork = (): ProductArtworkConfig => ({
  template: 'original',
  image: '',
})
export function artworkProblem(value: unknown): string | null {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    return '展示配置无效。'
  const config = value as Record<string, unknown>
  if (!ARTWORK_TEMPLATES.some((t) => t.id === config.template))
    return '请选择有效的展示模板。'
  if (typeof config.image !== 'string') return '商品展示图片无效。'
  if (!config.image && config.template !== 'original')
    return '请先上传 PNG 或 JPG 图片。'
  for (const key of ['image', 'source']) {
    if (config[key] === undefined && key === 'source') continue
    if (key === 'image' && config.image === '') continue
    const problem = imageProblem(config[key])
    if (problem) return problem
  }
  if (config.processing !== undefined) {
    const p = config.processing as ArtworkProcessing
    if (
      !p ||
      typeof p !== 'object' ||
      Array.isArray(p) ||
      !(['removeBackground', 'trim', 'cleanEdges'] as const).every(
        (k) => typeof p[k] === 'boolean',
      ) ||
      !Number.isInteger(p.tolerance) ||
      p.tolerance < 8 ||
      p.tolerance > 64
    )
      return '素材处理参数无效。'
  }
  if (config.layout !== undefined) {
    const l = config.layout as ArtworkLayout
    if (
      !l ||
      typeof l !== 'object' ||
      Array.isArray(l) ||
      !bounded(l.scale, 50, 150) ||
      !bounded(l.x, -40, 40) ||
      !bounded(l.y, -30, 30) ||
      !['auto', 'none', 'solid', 'halo'].includes(l.background) ||
      !['none', 'shadow', 'disc'].includes(l.pedestal) ||
      !color(l.backgroundColor) ||
      !color(l.pedestalColor)
    )
      return '大小、位置或背景配置无效。'
  }
  if (config.vector !== undefined) {
    const v = config.vector as ArtworkVector
    if (
      !v ||
      typeof v !== 'object' ||
      Array.isArray(v) ||
      !Number.isInteger(v.width) ||
      !Number.isInteger(v.height) ||
      v.width < 1 ||
      v.height < 1 ||
      v.width > 1024 ||
      v.height > 1024 ||
      !Array.isArray(v.paths) ||
      v.paths.length < 1 ||
      v.paths.length > 8 ||
      v.paths.some(
        (p) =>
          !p ||
          !color(p.fill) ||
          typeof p.d !== 'string' ||
          p.d.length > 80000 ||
          !/^M[MLHVZ0-9, .-]+Z$/.test(p.d) ||
          (p.d.match(/-?\d+(?:\.\d+)?/g) ?? []).some(
            (n) => Number(n) < 0 || Number(n) > 1024,
          ),
      ) ||
      v.paths.reduce((n, p) => n + p.d.length, 0) > 80000
    )
      return '矢量图形无效，请使用位图或重新生成。'
  }
  return null
}
const color = (value: unknown) =>
  typeof value === 'string' && /^#[a-fA-F0-9]{6}$/.test(value)
const bounded = (value: unknown, min: number, max: number) =>
  typeof value === 'number' &&
  Number.isFinite(value) &&
  value >= min &&
  value <= max
function imageProblem(image: unknown): string | null {
  if (
    typeof image !== 'string' ||
    image.length > MAX_ARTWORK_IMAGE_LENGTH ||
    !/^data:image\/(png|jpeg);base64,[A-Za-z0-9+/]+={0,2}$/.test(image)
  )
    return '请选择处理后 600 KB 以内的 PNG 或 JPG 图片。'
  try {
    const data = atob(image.split(',')[1])
    const png = image.startsWith('data:image/png;')
    if (
      png
        ? !data.startsWith('\x89PNG\r\n\x1a\n')
        : !(data.startsWith('\xff\xd8\xff') && data.endsWith('\xff\xd9'))
    )
      return '图片内容与 PNG／JPG 格式不一致。'
  } catch {
    return '图片编码无效。'
  }
  return null
}
// Keep admin-only originals out of the public catalogue and strip unknown properties.
export function cleanArtwork(
  config: ProductArtworkConfig,
  publicOnly = false,
): ProductArtworkConfig {
  const result: ProductArtworkConfig = {
    template: config.template,
    image: config.image,
  }
  if (config.layout) {
    const {
      scale,
      x,
      y,
      background,
      backgroundColor,
      pedestal,
      pedestalColor,
    } = config.layout
    result.layout = {
      scale,
      x,
      y,
      background,
      backgroundColor,
      pedestal,
      pedestalColor,
    }
  }
  if (config.vector)
    result.vector = {
      width: config.vector.width,
      height: config.vector.height,
      paths: config.vector.paths.map(({ fill, d }) => ({ fill, d })),
    }
  if (!publicOnly) {
    if (config.source) result.source = config.source
    if (config.processing) {
      const { removeBackground, tolerance, trim, cleanEdges } =
        config.processing
      result.processing = { removeBackground, tolerance, trim, cleanEdges }
    }
  }
  return result
}
