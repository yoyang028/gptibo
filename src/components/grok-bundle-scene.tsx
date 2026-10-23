import { useEffect, useId, useRef } from 'react'
import './grok-bundle-scene.css'

const tiers = ['Plus', 'Premium', 'Super', 'Ultra']

/** Transparent vector artwork shared by the catalog card and product page. */
export function GrokBundleScene({ detail = false, selectedTier }: { detail?: boolean; selectedTier?: string }) {
  const scene = useRef<HTMLDivElement>(null)
  const id = useId().replace(/:/g, '')
  useEffect(() => {
    const element = scene.current
    if (!element) return
    let visible = false
    const update = () => { element.dataset.active = String(visible && !document.hidden) }
    const observer = new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; update() })
    observer.observe(element)
    document.addEventListener('visibilitychange', update)
    return () => { observer.disconnect(); document.removeEventListener('visibilitychange', update) }
  }, [])
  return <div ref={scene} className={'grok-bundle-scene' + (detail ? ' grok-bundle-detail' : '')} data-active="false" aria-hidden="true">
    <svg viewBox="0 0 440 196" fill="none" focusable="false">
      <defs>
        <linearGradient id={id + '-x'} x1="0" y1="0" x2="24" y2="24" gradientUnits="userSpaceOnUse"><stop stopColor="#fb9c56"/><stop offset="1" stopColor="#e95789"/></linearGradient>
        <linearGradient id={id + '-bot'} x1="0" y1="0" x2="75" y2="80" gradientUnits="userSpaceOnUse"><stop stopColor="#23b6c4"/><stop offset="1" stopColor="#37ba88"/></linearGradient>
        <linearGradient id={id + '-line'} x1="50" y1="100" x2="390" y2="100" gradientUnits="userSpaceOnUse"><stop stopColor="#57b9f5"/><stop offset=".5" stopColor="#b5a1f5"/><stop offset="1" stopColor="#4dc8ad"/></linearGradient>
      </defs>
      <path className="grok-bundle-thread" d="M61 126c37 36 57-65 108-24s59 42 104-1 62 48 104 10" stroke={'url(#' + id + '-line)'} strokeWidth="1.4" strokeDasharray="3 8"/>
      <g transform="translate(25 46)"><g className="grok-bundle-symbol grok-bundle-grok" data-symbol="grok">
        <image href="/brands/grok-color.svg" width="86" height="86"/>
      </g></g>
      <g transform="translate(139 59)"><g className="grok-bundle-symbol grok-bundle-x" data-symbol="x">
        <path transform="scale(2.9)" fill={'url(#' + id + '-x)'} d="M18.9 2H22l-6.77 7.74L23.2 22h-6.24l-4.89-7.4L5.6 22H2.47l7.15-8.17L1.2 2h6.4l4.43 6.77L18.9 2ZM17.8 20h1.73L6.65 3.9H4.8L17.8 20Z"/>
      </g></g>
      <g transform="translate(237 51)"><g className="grok-bundle-symbol grok-bundle-cursor" data-symbol="cursor" strokeLinejoin="round">
        <path d="m37 2 34 19v41L37 82 3 62V21Z" fill="#8266dc"/>
        <path d="M37 2 71 21 37 42 3 21Z" fill="#b6a5f2"/>
        <path d="m37 42 34-21v41L37 82Z" fill="#7150c2"/>
        <path d="M3 21 37 42v40L3 62Z" fill="#9275df"/>
        <path d="m12 20 48 6-24 40Z" fill="#e3d9ff"/>
        <path d="m36 66 24-40-23 16Z" fill="#c6b5f9"/>
      </g></g>
      <g transform="translate(336 43)"><g className="grok-bundle-symbol grok-bundle-bot" data-symbol="bot" stroke={'url(#' + id + '-bot)'} strokeWidth="4" strokeLinecap="round" strokeLinejoin="round">
        <path d="M39 24V12m-6 0h12"/>
        <rect x="9" y="25" width="61" height="48" rx="17"/>
        <path d="M2 42v14m75-14v14M23 79v6m32-6v6"/>
        <g className="grok-bot-eyes"><path d="M27 44v7m25-7v7" strokeWidth="6"/></g>
        <path d="M29 61c7 4 14 4 21 0" strokeWidth="3"/>
      </g></g>
      <g className="grok-bundle-sparks" stroke={'url(#' + id + '-line)'} strokeWidth="1.8" strokeLinecap="round">
        <path d="M112 38v8m-4-4h8m199 93v8m-4-4h8M214 35v5m-2.5-2.5h5"/>
        <circle cx="25" cy="139" r="2"/><circle cx="414" cy="58" r="2.5"/>
      </g>
    </svg>
    <div className="grok-bundle-tiers" data-selected={Boolean(selectedTier)}>
      {tiers.map((tier, index) => <span key={tier} className="grok-bundle-tier" data-current={selectedTier === tier} style={{ animationDelay: `${index * -3}s` }}>{tier}</span>)}
    </div>
  </div>
}
