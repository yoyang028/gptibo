export async function prepareLogo(
  file: File,
  maxDimension = 256,
  output: 'png' | 'source' = 'png',
) {
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
      image.width > 8192 ||
      image.height > 8192
    )
      throw new Error('图片尺寸过大，请选择较小的图片。')
    let size = Math.min(1, maxDimension / Math.max(image.width, image.height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(image.width * size))
    canvas.height = Math.max(1, Math.round(image.height * size))
    const context = canvas.getContext('2d')
    if (!context) throw new Error('当前浏览器无法处理图片，请更换浏览器重试。')
    const mime =
      output === 'source' && file.type === 'image/jpeg'
        ? 'image/jpeg'
        : 'image/png'
    const render = () => {
      canvas.width = Math.max(1, Math.round(image.width * size))
      canvas.height = Math.max(1, Math.round(image.height * size))
      context.drawImage(image, 0, 0, canvas.width, canvas.height)
      return canvas.toDataURL(mime, 0.86)
    }
    let logo = render()
    while (
      output === 'source' &&
      logo.length > 350000 &&
      Math.max(canvas.width, canvas.height) > 192
    ) {
      size *= 0.75
      logo = render()
    }
    if (logo.length > 350000)
      throw new Error('图片处理后仍然过大，请使用较小的图片。')
    return logo
  } finally {
    image.close()
  }
}
