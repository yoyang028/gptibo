import { useEffect, useRef } from 'react'
import './muse-logo-motion.css'

export function MuseLogoMotion({ detail = false }: { detail?: boolean }) {
  const scene = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const element = scene.current
    if (!element) return
    let visible = false
    const update = () => {
      element.dataset.active = String(visible && !document.hidden)
    }
    const observer = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting
      update()
    })
    observer.observe(element)
    document.addEventListener('visibilitychange', update)
    return () => {
      observer.disconnect()
      document.removeEventListener('visibilitychange', update)
    }
  }, [])
  return (
    <div
      ref={scene}
      className={`muse-logo-motion${detail ? ' muse-logo-detail' : ''}`}
      data-active="false"
      aria-hidden="true"
    >
      <img
        src="/brands/muse.svg"
        width="100"
        height="100"
        alt=""
        draggable={false}
      />
    </div>
  )
}
