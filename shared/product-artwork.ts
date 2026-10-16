export const ARTWORK_TEMPLATES = [
  { id: 'original', label: '沿用原展示' },
  { id: 'static', label: '静态' },
  { id: 'float', label: '漂浮' },
  { id: 'zoom', label: '缩放' },
  { id: 'shine', label: '扫光' },
  { id: 'membership', label: '会员卡片' },
] as const
export type ArtworkTemplate = (typeof ARTWORK_TEMPLATES)[number]['id']
export type ProductArtworkConfig = { template: ArtworkTemplate; image: string }
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
  if (!config.image)
    return config.template === 'original' ? null : '请先上传 PNG 或 JPG 图片。'
  if (
    config.image.length > 350000 ||
    !/^data:image\/(png|jpeg);base64,[A-Za-z0-9+/]+={0,2}$/.test(config.image)
  )
    return '请选择处理后 350 KB 以内的 PNG 或 JPG 图片。'
  try {
    const data = atob(config.image.split(',')[1])
    const png = config.image.startsWith('data:image/png;')
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
