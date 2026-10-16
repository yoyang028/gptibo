const poses = [[-13, 17, -7], [0, 5, 0], [12, -5, 7], [24, -15, 14]]
function deckPoses(count: number) {
  if (count === 1) return [[0, 0, 0]]
  return Array.from({ length: count }, (_, i) => poses[i] ?? [24 + (i - 3) * 7, -15 - (i - 3) * 7, 14 + (i - 3) * 3])
}
const ease = (value: number) => { const t = Math.max(0, Math.min(1, value)); return t*t*t*(t*(t*6-15)+10) }
export const mixPose = (a: number[], b: number[], t: number) => a.map((v, i) => v + (b[i] - v) * t)

export const DECK_CYCLE_MS = 5770
type DeckPhase = 'hold' | 'prepare' | 'extract' | 'lower' | 'return' | 'settle' | 'hide'
export function deckTimeline(elapsed: number): { progress: number; phase: DeckPhase } {
  if (elapsed < 3000) return { progress: 0, phase: 'hold' }
  if (elapsed < 3180) return { progress: 0, phase: 'prepare' }
  if (elapsed < 5430) {
    const progress = (elapsed - 3180) / 2250
    return { progress, phase: progress < .4 ? 'extract' : progress < .62 ? 'lower' : 'return' }
  }
  return { progress: 1, phase: elapsed < 5590 ? 'settle' : 'hide' }
}

export function deckFrame(index: number, progress: number, width: number, phase: DeckPhase = 'hold', count = 4) {
  const positions = deckPoses(count)
  const half = (angle: number) => (width * Math.abs(Math.cos(angle*Math.PI/180)) + 110 * Math.abs(Math.sin(angle*Math.PI/180))) / 2
  const exit = Math.min(...positions.map(p => p[0] - half(p[2]))) - half(-7) - 18
  return positions.map((_, i) => {
    const slot = (i - index + count) % count, a = positions[slot], b = positions[(slot+count-1)%count]
    const outside = [exit, 17, -7], below = [exit, 26, -7]
    const position = slot ? mixPose(a, b, ease((progress-.4)/.22)) : progress < .4 ? mixPose(a, outside, ease(progress/.4)) : progress < .62 ? mixPose(outside, below, ease((progress-.4)/.22)) : mixPose(below, b, ease((progress-.62)/.38))
    // Text has its own lead-in and tail: reveal before motion, hide only after docking.
    return { position, scale: 1, z: progress < .4 ? count-slot : slot === 0 ? 1 : count+1-slot, visible: slot === 0 ? phase !== 'hide' : slot === 1 && phase !== 'hold' }
  })
}

export function fanFrame(deckWidth: number, cardWidth: number, deckHeight = 185, count = 4) {
  const angle = 4 * Math.PI / 180
  const width = cardWidth * Math.cos(angle) + 110 * Math.sin(angle)
  const height = 110 * Math.cos(angle) + cardWidth * Math.sin(angle)
  const gap = 12
  // Fit the rotated cards into the existing deck without moving its footer or neighbours.
  const columns = Math.min(count, 2), rows = Math.ceil(count / columns)
  const scale = Math.min(.7, (deckWidth - 24 - gap * (columns - 1)) / (columns * width), (deckHeight - 8 - gap * (rows - 1)) / (rows * height))
  const spread = (width * scale + gap) / 2
  const row = (height * scale + gap) / 2
  return deckPoses(count).map((_, i) => ({
    position: [8 + (count % 2 && i === count - 1 ? 0 : i % 2 ? spread : -spread), (Math.floor(i / columns) - (rows - 1) / 2) * row * 2, i % 2 ? 4 : -4],
    scale,
    z: count - i,
    visible: true,
  }))
}
