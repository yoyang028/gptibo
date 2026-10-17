import { useEffect, useRef } from 'react'
import { officialBrand } from './official-brand'
import './official-logo-motion.css'

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
  }, [])
  if (!brand) return null
  const src = '/brands/' + brand.file
  return <div ref={scene} className={'official-logo-motion' + (detail?' official-logo-detail':'')} data-brand={productId} data-motion={brand.motion} data-wide={brand.wide} data-active="false" aria-hidden="true">
    {brand.mono ? <span className="official-logo-glyph official-logo-mask" style={{maskImage:`url(${src})`}}/> : <img className="official-logo-glyph" src={src} width="160" height="160" alt="" draggable="false"/>}
  </div>
}
