import type { ArtworkProcessing, ArtworkVector } from './product-artwork.ts'

export type Pixels = { width: number; height: number; data: Uint8ClampedArray }
export type ProcessedPixels = Pixels & {
  background: 'removed' | 'transparent' | 'kept'
  removedPixels: number
  cropped: boolean
}
const distance = (data: Uint8ClampedArray, i: number, color: number[]) =>
  Math.max(...color.map((c, k) => Math.abs(data[i * 4 + k] - c)))

function checkPixels(input: Pixels) {
  if (
    !Number.isInteger(input.width) ||
    !Number.isInteger(input.height) ||
    input.width < 1 ||
    input.height < 1 ||
    input.width > 1024 ||
    input.height > 1024 ||
    input.data.length !== input.width * input.height * 4
  )
    throw new Error('素材像素尺寸无效。')
}

// Detect one consistent perimeter colour. Varied/photo borders are deliberately left alone.
function borderColor({ width: w, height: h, data }: Pixels, tolerance: number) {
  const border: number[] = []
  for (let x = 0; x < w; x++) border.push(x, (h - 1) * w + x)
  for (let y = 1; y < h - 1; y++) border.push(y * w, y * w + w - 1)
  const buckets = new Map<number, number[]>()
  let transparent = 0
  for (const i of border) {
    if (data[i * 4 + 3] < 16) {
      transparent++
      continue
    }
    const key =
      ((data[i * 4] >> 4) << 8) |
      ((data[i * 4 + 1] >> 4) << 4) |
      (data[i * 4 + 2] >> 4)
    const b = buckets.get(key) ?? [0, 0, 0, 0]
    for (let k = 0; k < 3; k++) b[k] += data[i * 4 + k]
    b[3]++
    buckets.set(key, b)
  }
  if (transparent > border.length * 0.5) return null
  const peak = [...buckets.values()].sort((a, b) => b[3] - a[3])[0]
  if (!peak) return null
  const color = peak.slice(0, 3).map((c) => Math.round(c / peak[3]))
  const matches = (i: number) =>
    data[i * 4 + 3] < 16 || distance(data, i, color) <= tolerance
  const corners = [0, w - 1, (h - 1) * w, w * h - 1]
  if (
    border.filter(matches).length / border.length < 0.85 ||
    corners.filter(matches).length < 3
  )
    return null
  return color
}

function neighbors(i: number, w: number, h: number) {
  const result: number[] = []
  if (i % w) result.push(i - 1)
  if (i % w < w - 1) result.push(i + 1)
  if (i >= w) result.push(i - w)
  if (i < w * (h - 1)) result.push(i + w)
  return result
}

export function processArtworkPixels(
  input: Pixels,
  options: ArtworkProcessing,
): ProcessedPixels {
  checkPixels(input)
  const { width: w, height: h } = input
  const data = new Uint8ClampedArray(input.data),
    total = w * h
  const color = options.removeBackground
    ? borderColor(input, options.tolerance)
    : null
  let removedPixels = 0
  if (color) {
    const removed = new Uint8Array(total),
      queue = new Int32Array(total)
    let head = 0,
      tail = 0
    const add = (i: number) => {
      if (
        !removed[i] &&
        (data[i * 4 + 3] < 16 || distance(data, i, color) <= options.tolerance)
      ) {
        removed[i] = 1
        queue[tail++] = i
      }
    }
    for (let x = 0; x < w; x++) {
      add(x)
      add((h - 1) * w + x)
    }
    for (let y = 0; y < h; y++) {
      add(y * w)
      add(y * w + w - 1)
    }
    while (head < tail) {
      const i = queue[head++]
      for (const next of neighbors(i, w, h)) add(next)
    }
    // Never turn an empty or near-solid image into an invisible product.
    if (tail < total * 0.995) {
      for (let i = 0; i < total; i++)
        if (removed[i]) {
          if (data[i * 4 + 3]) removedPixels++
          data[i * 4 + 3] = 0
        }
      if (options.cleanEdges) {
        // Decontaminate only the immediate fringe, using a nearby interior colour.
        // Fully interior whites/colours and gradient pixels cannot enter this branch.
        for (let i = 0; i < total; i++) {
          if (
            removed[i] ||
            data[i * 4 + 3] < 240 ||
            distance(input.data, i, color) > 120
          )
            continue
          const adjacent = neighbors(i, w, h)
          if (!adjacent.some((n) => removed[n])) continue
          let best = -1,
            far = 0
          for (const n of adjacent) {
            if (removed[n] || neighbors(n, w, h).some((k) => removed[k]))
              continue
            const d = distance(input.data, n, color)
            if (d > far) {
              best = n
              far = d
            }
          }
          if (best < 0 || far - distance(input.data, i, color) < 20) continue
          let dot = 0,
            magnitude = 0
          for (let k = 0; k < 3; k++) {
            const v = input.data[best * 4 + k] - color[k]
            dot += (input.data[i * 4 + k] - color[k]) * v
            magnitude += v * v
          }
          const alpha = dot / magnitude
          if (alpha < 0.08 || alpha > 0.96 || !Number.isFinite(alpha)) continue
          const residual = Math.max(
            ...color.map((c, k) =>
              Math.abs(
                input.data[i * 4 + k] -
                  (c + alpha * (input.data[best * 4 + k] - c)),
              ),
            ),
          )
          if (residual > 10) continue
          for (let k = 0; k < 3; k++) data[i * 4 + k] = input.data[best * 4 + k]
          data[i * 4 + 3] = Math.round(255 * alpha)
        }
        removeOuterSpecks(data, w, h)
      }
    }
  }
  let left = w,
    right = -1,
    top = h,
    bottom = -1
  for (let i = 0; i < total; i++)
    if (data[i * 4 + 3] > 4) {
      const x = i % w,
        y = Math.floor(i / w)
      left = Math.min(left, x)
      right = Math.max(right, x)
      top = Math.min(top, y)
      bottom = Math.max(bottom, y)
    }
  const pad = Math.max(
    2,
    Math.ceil(Math.max(right - left + 1, bottom - top + 1) * 0.025),
  )
  if (!options.trim || right < left) {
    left = 0
    right = w - 1
    top = 0
    bottom = h - 1
  } else {
    left = Math.max(0, left - pad)
    right = Math.min(w - 1, right + pad)
    top = Math.max(0, top - pad)
    bottom = Math.min(h - 1, bottom + pad)
  }
  const width = right - left + 1,
    height = bottom - top + 1
  const cropped = width !== w || height !== h
  const output = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < height; y++)
    output.set(
      data.subarray(
        ((top + y) * w + left) * 4,
        ((top + y) * w + right + 1) * 4,
      ),
      y * width * 4,
    )
  return {
    width,
    height,
    data: output,
    removedPixels,
    cropped,
    background: removedPixels
      ? 'removed'
      : data.some((a, i) => i % 4 === 3 && a < 255)
        ? 'transparent'
        : 'kept',
  }
}

// Remove at most four-pixel islands well outside the main subject. Do not delete small
// internal symbols, dots near the subject, or components of a multi-part logo.
function removeOuterSpecks(data: Uint8ClampedArray, w: number, h: number) {
  const seen = new Uint8Array(w * h),
    queue = new Int32Array(w * h)
  const tiny: number[][] = []
  let largest:
    { size: number; x1: number; x2: number; y1: number; y2: number } | undefined
  for (let i = 0; i < w * h; i++) {
    if (seen[i] || data[i * 4 + 3] <= 20) continue
    let head = 0,
      tail = 1,
      x1 = w,
      x2 = 0,
      y1 = h,
      y2 = 0
    queue[0] = i
    seen[i] = 1
    while (head < tail) {
      const n = queue[head++],
        x = n % w,
        y = Math.floor(n / w)
      x1 = Math.min(x1, x)
      x2 = Math.max(x2, x)
      y1 = Math.min(y1, y)
      y2 = Math.max(y2, y)
      for (const k of neighbors(n, w, h))
        if (!seen[k] && data[k * 4 + 3] > 20) {
          seen[k] = 1
          queue[tail++] = k
        }
    }
    if (!largest || tail > largest.size)
      largest = { size: tail, x1, x2, y1, y2 }
    if (tail <= 4) tiny.push(Array.from(queue.subarray(0, tail)))
  }
  if (!largest || largest.size < w * h * 0.02) return
  const margin = Math.max(6, Math.round(Math.max(w, h) * 0.03)),
    box = largest
  for (const island of tiny)
    if (
      island.every((i) => {
        const x = i % w,
          y = Math.floor(i / w)
        return (
          x < box.x1 - margin ||
          x > box.x2 + margin ||
          y < box.y1 - margin ||
          y > box.y2 + margin
        )
      })
    )
      for (const i of island) data[i * 4 + 3] = 0
}

// Deterministic colour-region tracing, never an AI call. Gradients/photos are rejected.
// Boundaries remain numeric SVG paths; no uploaded SVG markup or external URLs.
export function vectorizeArtwork(input: Pixels): ArtworkVector | null {
  checkPixels(input)
  const { width: w, height: h, data } = input,
    histogram = new Map<string, number>()
  let opaque = 0,
    partial = 0
  for (let i = 0; i < w * h; i++) {
    const a = data[i * 4 + 3]
    if (a < 16) continue
    if (a < 240) {
      partial++
      continue
    }
    const key = Array.from(data.subarray(i * 4, i * 4 + 3)).join(',')
    histogram.set(key, (histogram.get(key) ?? 0) + 1)
    opaque++
  }
  if (!opaque || partial > (opaque + partial) * 0.12) return null
  const palette: number[][] = []
  let represented = 0
  for (const [key, count] of [...histogram].sort((a, b) => b[1] - a[1])) {
    const c = key.split(',').map(Number)
    if (
      palette.some(
        (p) => Math.max(...p.map((v, k) => Math.abs(v - c[k]))) <= 18,
      )
    ) {
      represented += count
      continue
    }
    if (palette.length < 8) {
      palette.push(c)
      represented += count
    }
  }
  if (represented / opaque < 0.985) return null
  const flat = [...histogram].reduce((count, [key, n]) => {
    const c = key.split(',').map(Number)
    return (
      count +
      (palette.some((p) => p.every((v, k) => Math.abs(v - c[k]) <= 3)) ? n : 0)
    )
  }, 0)
  if (flat / opaque < 0.95) return null
  const labels = new Int8Array(w * h).fill(-1)
  for (let i = 0; i < w * h; i++)
    if (data[i * 4 + 3] >= 128) {
      let nearest = -1,
        delta = Infinity
      palette.forEach((p, k) => {
        const d = distance(data, i, p)
        if (d < delta) {
          delta = d
          nearest = k
        }
      })
      labels[i] = nearest
    }
  const paths: ArtworkVector['paths'] = []
  let length = 0
  for (let k = 0; k < palette.length; k++) {
    const edges = new Map<number, number[]>(),
      stride = w + 1
    let edgeCount = 0
    const edge = (a: number, b: number) => {
      edges.set(a, [...(edges.get(a) ?? []), b])
      edgeCount++
    }
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const i = y * w + x,
          v = y * stride + x
        if (labels[i] !== k) continue
        if (!y || labels[i - w] !== k) edge(v, v + 1)
        if (x === w - 1 || labels[i + 1] !== k) edge(v + 1, v + stride + 1)
        if (y === h - 1 || labels[i + w] !== k) edge(v + stride + 1, v + stride)
        if (!x || labels[i - 1] !== k) edge(v + stride, v)
        if (edgeCount > 20000) return null
      }
    let d = ''
    while (edges.size) {
      const start = edges.keys().next().value!,
        points = [start]
      let v = start
      do {
        const next = edges.get(v)
        if (!next?.length) return null
        v = next.pop()!
        if (!next.length) edges.delete(points[points.length - 1])
        points.push(v)
        if (points.length > 20001) return null
      } while (v !== start)
      const vertices = points.slice(0, -1).filter((p, i, all) => {
        const before = all[(i + all.length - 1) % all.length],
          after = all[(i + 1) % all.length]
        return (
          ((p % stride) - (before % stride)) *
            (Math.floor(after / stride) - Math.floor(p / stride)) !==
          ((after % stride) - (p % stride)) *
            (Math.floor(p / stride) - Math.floor(before / stride))
        )
      })
      if (vertices.length < 3) continue
      d +=
        vertices
          .map(
            (p, i) => `${i ? 'L' : 'M'}${p % stride},${Math.floor(p / stride)}`,
          )
          .join('') + 'Z'
      if (d.length + length > 80000) return null
    }
    if (d) {
      paths.push({
        fill:
          '#' + palette[k].map((c) => c.toString(16).padStart(2, '0')).join(''),
        d,
      })
      length += d.length
    }
  }
  return paths.length ? { width: w, height: h, paths } : null
}
