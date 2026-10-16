import {
  processArtworkPixels,
  vectorizeArtwork,
  type Pixels,
} from '../../shared/artwork-pixels'
import {
  MAX_ARTWORK_IMAGE_LENGTH,
  type ArtworkProcessing,
} from '../../shared/product-artwork'

function canvas(width: number, height: number) {
  const element = document.createElement('canvas')
  element.width = width
  element.height = height
  const context = element.getContext('2d', { willReadFrequently: true })
  if (!context) throw new Error('当前浏览器无法处理图片，请更换浏览器重试。')
  context.imageSmoothingEnabled = true
  context.imageSmoothingQuality = 'high'
  return { element, context }
}
function encode(element: HTMLCanvasElement, mime = 'image/png') {
  let target = element
  let image = target.toDataURL(mime, 0.94)
  while (
    image.length > MAX_ARTWORK_IMAGE_LENGTH &&
    Math.max(target.width, target.height) > 256
  ) {
    const next = canvas(
      Math.max(1, Math.round(target.width * 0.85)),
      Math.max(1, Math.round(target.height * 0.85)),
    )
    next.context.drawImage(
      target,
      0,
      0,
      next.element.width,
      next.element.height,
    )
    target = next.element
    image = target.toDataURL(mime, 0.94)
  }
  if (image.length > MAX_ARTWORK_IMAGE_LENGTH)
    throw new Error('图片处理后仍过大，请选择较小的素材。')
  return image
}
async function decode(source: string): Promise<Pixels> {
  // Image.decode works under the existing CSP without fetching a data: URL.
  const image = new Image()
  image.src = source
  await image.decode()
  if (
    !image.width ||
    !image.height ||
    Math.max(image.width, image.height) > 8192
  )
    throw new Error('图片尺寸无效。')
  const scale = Math.min(1, 1024 / Math.max(image.width, image.height))
  const { element, context } = canvas(
    Math.max(1, Math.round(image.width * scale)),
    Math.max(1, Math.round(image.height * scale)),
  )
  context.drawImage(image, 0, 0, element.width, element.height)
  return context.getImageData(0, 0, element.width, element.height)
}
export async function prepareArtworkSource(file: File) {
  if (
    !['image/png', 'image/jpeg'].includes(file.type) ||
    file.size > 5 * 1024 * 1024
  )
    throw new Error('请选择 5 MB 以内的 PNG 或 JPG 图片。')
  const image = await createImageBitmap(file)
  try {
    if (
      !image.width ||
      !image.height ||
      Math.max(image.width, image.height) > 8192
    )
      throw new Error('图片尺寸过大，请选择较小的图片。')
    const scale = Math.min(1, 1024 / Math.max(image.width, image.height))
    const { element, context } = canvas(
      Math.max(1, Math.round(image.width * scale)),
      Math.max(1, Math.round(image.height * scale)),
    )
    context.drawImage(image, 0, 0, element.width, element.height)
    return encode(element, file.type)
  } finally {
    image.close()
  }
}
export async function processArtwork(
  source: string,
  options: ArtworkProcessing,
) {
  const input = await decode(source)
  const result = processArtworkPixels(input, options)
  const { element, context } = canvas(result.width, result.height)
  context.putImageData(
    new ImageData(
      new Uint8ClampedArray(result.data),
      result.width,
      result.height,
    ),
    0,
    0,
  )
  const image = encode(
    element,
    result.background === 'kept' && source.startsWith('data:image/jpeg;')
      ? 'image/jpeg'
      : 'image/png',
  )
  const notes = [
    result.background === 'removed'
      ? '已清理外围背景，内部颜色保留'
      : result.background === 'transparent'
        ? '已保留透明背景'
        : options.removeBackground
          ? '外围背景不明确，已保留原图颜色'
          : '已保留原图背景（外围清理已关闭）',
    result.cropped ? '已裁剪留白' : '未裁剪',
  ]
  return {
    image,
    note: notes.join('；') + `（${result.width} × ${result.height}）。`,
  }
}
export async function vectorizeArtworkImage(image: string) {
  return vectorizeArtwork(await decode(image))
}
