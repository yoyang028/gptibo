import { useEffect, useRef, type ReactNode } from 'react'
import { officialBrand } from './official-brand'
import './official-logo-motion.css'

// The artwork stays intact; these small scene details sit outside the logo.
const accents: Record<string, ReactNode> = {
  grok: <>
    <g className="brand-accent-drift">
      <path d="m72 133 22-22m-10 35 13-13m171-71 17-17" />
      <path d="M284 99v10m-5-5h10M80 63v6m-3-3h6" />
    </g>
    <g className="brand-accent-twinkle">
      <circle cx="102" cy="47" r="2" /><circle cx="269" cy="146" r="2.5" />
      <circle cx="295" cy="72" r="1.5" />
    </g>
  </>,
  gemini: <>
    <g className="brand-accent-drift">
      <path className="brand-accent-secondary" d="M75 105c-15 29 8 45 36 38m138-97c24-4 39 7 32 24" strokeDasharray="3 7" />
      <path d="m84 57 3 8 8 3-8 3-3 8-3-8-8-3 8-3Z" />
    </g>
    <g className="brand-accent-twinkle brand-accent-secondary">
      <path d="m275 117 3 8 8 3-8 3-3 8-3-8-8-3 8-3Z" />
      <circle cx="109" cy="139" r="2" /><circle cx="256" cy="51" r="2" />
    </g>
  </>,
  'adobe-express': <>
    <g className="brand-accent-drift">
      <rect x="74" y="51" width="16" height="16" rx="4" transform="rotate(-18 82 59)" />
      <path className="brand-accent-secondary" d="M270 48h11v11m-16 80h-11v-11" />
      <path d="M77 118c-6 20 10 29 27 21" strokeDasharray="2 6" />
    </g>
    <g className="brand-accent-twinkle brand-accent-secondary">
      <path d="m284 98 4 4-4 4-4-4Z" /><circle cx="111" cy="42" r="2" />
    </g>
  </>,
  'apple-music': <>
    <g className="brand-accent-beat">
      <path d="M45 88v19m7-27v35m7-25v15m242-15v15m7-25v35m7-27v19" />
    </g>
    <g className="brand-accent-drift">
      <path d="M95 58V44l10-3v14m-10-8 10-3" />
      <ellipse cx="92" cy="59" rx="3" ry="2" /><ellipse cx="102" cy="56" rx="3" ry="2" />
      <path className="brand-accent-secondary" d="M267 142v-15l9 3v14" />
      <ellipse className="brand-accent-secondary" cx="264" cy="143" rx="3" ry="2" />
    </g>
  </>,
  'apple-id': <>
    <g className="brand-accent-drift">
      <path d="M93 52c-9 7-14 15-16 25m190 43c-2 12-7 20-16 26" strokeDasharray="3 7" />
      <circle cx="87" cy="135" r="4" /><circle className="brand-accent-secondary" cx="278" cy="60" r="4" />
    </g>
    <g className="brand-accent-twinkle brand-accent-secondary">
      <path d="M111 43v8m-4-4h8m144 104v8m-4-4h8" />
      <circle cx="75" cy="103" r="1.5" /><circle cx="286" cy="103" r="1.5" />
    </g>
  </>,
  'capcut-pro': <>
    <g className="brand-accent-drift">
      <path d="M81 58H70v16m209-16h11v16M81 137H70v-16m209 16h11v-16" />
      <path className="brand-accent-secondary" d="M94 154h62m52 0h58" strokeDasharray="2 6" />
    </g>
    <g className="brand-accent-twinkle brand-accent-secondary">
      <path d="m300 94 7 4-7 4Z" /><path d="M89 94v8m5-8v8" />
      <circle cx="180" cy="154" r="3" />
    </g>
  </>,
}

export function OfficialLogoMotion({ productId, detail = false }: { productId: string; detail?: boolean }) {
  const scene = useRef<HTMLDivElement>(null)
  const brand = officialBrand(productId)
  useEffect(() => {
    const element = scene.current
    if (!element) return
    let visible = false
    const update = () => { element.dataset.active = String(visible && !document.hidden) }
    const observer = new IntersectionObserver(([entry])=>{visible=entry.isIntersecting;update()})
    observer.observe(element)
    document.addEventListener('visibilitychange',update)
    return ()=>{observer.disconnect();document.removeEventListener('visibilitychange',update)}
  }, [productId])
  if (!brand) return null
  const src = '/brands/' + brand.file
  return <div ref={scene} className={'official-logo-motion' + (detail?' official-logo-detail':'')} data-brand={productId} data-motion={brand.motion} data-wide={brand.wide} data-active="false" aria-hidden="true">
    {accents[productId] && <svg className="official-logo-accents" viewBox="0 0 360 195" fill="none" aria-hidden="true" focusable="false">{accents[productId]}</svg>}
    {brand.mono ? <span className="official-logo-glyph official-logo-mask" style={{maskImage:`url(${src})`}}/> : <img className="official-logo-glyph" src={src} width="160" height="160" alt="" draggable="false"/>}
  </div>
}
