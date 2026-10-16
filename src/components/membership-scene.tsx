import { useStorefrontI18n } from '@/lib/storefront-i18n'
import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { DuoAnimation } from './duo-animation'
import '@/styles/membership-products.css'

export function DuoMark() {
  return <img src="/brands/duolingo-duo-home.svg" alt="" aria-hidden="true" className="duo-art" />
}
export function GeminiMark() {
  const id = useId().replaceAll(':', '')
  return <svg viewBox="0 0 160 160" aria-hidden="true" className="gemini-art"><defs><linearGradient id={id} x1="0" y1="1" x2="1" y2="0"><stop stopColor="#4888ee" /><stop offset=".5" stopColor="#7e78ee" /><stop offset="1" stopColor="#dd85aa" /></linearGradient></defs><path fill={`url(#${id})`} d="M80 5C91 48 112 69 155 80C112 91 91 112 80 155C69 112 48 91 5 80C48 69 69 48 80 5Z" /></svg>
}
export function ProductSceneFrame({ className, children, label, template }: { className: string; children: ReactNode | ((visible: boolean) => ReactNode); label?: string; template?: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const [visible, setVisible] = useState(true)
  useEffect(() => {
    let intersecting = true
    const update = () => setVisible(intersecting && !document.hidden)
    const observer = new IntersectionObserver(([entry]) => { intersecting = entry.isIntersecting; update() }, { threshold: .1 })
    if (ref.current) observer.observe(ref.current)
    document.addEventListener('visibilitychange', update)
    return () => { observer.disconnect(); document.removeEventListener('visibilitychange', update) }
  }, [])
  return <div ref={ref} className={`membership-scene ${className}`} data-paused={!visible} data-artwork-template={template} role={label ? 'img' : undefined} aria-label={label}>{typeof children === 'function' ? children(visible) : children}</div>
}
export function MembershipScene({ productId }: { productId: 'gemini' | 'duolingo' }) {
  const { t } = useStorefrontI18n()
  const duo = productId === 'duolingo'
  return <ProductSceneFrame className={`scene-${productId}`}>{visible =>
    <div className="membership-visual" aria-hidden="true">
      {duo ? <><span className="duo-word word-hello">Hello!</span><span className="duo-word word-bonjour">Bonjour</span><DuoAnimation visible={visible} /><span className="membership-duration">365<span>{t('天，继续学习')}</span></span></> : <><div className="gemini-orbit orbit-outer" /><div className="gemini-orbit orbit-inner" /><div className="gemini-star"><GeminiMark /></div><span className="gemini-spark spark-one">✦</span><span className="gemini-spark spark-two">✦</span><span className="membership-duration">18<span>{t('个月，探索更多')}</span></span></>}
    </div>}
  </ProductSceneFrame>
}
