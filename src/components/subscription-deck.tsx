import { useStorefrontI18n } from '@/lib/storefront-i18n'
import { useEffect, useRef } from 'react'
import { formatCatalogPrice } from '@/lib/catalog-display'
import { DECK_CYCLE_MS, deckFrame, deckTimeline, fanFrame, mixPose } from '@/lib/subscription-motion'

export type DeckPlan = { id: string; name: string; price: number | null; unit?: string }

export function SubscriptionDeck({ plans, brand = 'ChatGPT', productId = 'chatgpt' }: { plans: DeckPlan[]; brand?: string; productId?: string }) {
  const { t } = useStorefrontI18n()
  const deck = useRef<HTMLDivElement>(null)
  const hovered = useRef(false)
  const focused = useRef(false)
  useEffect(() => {
    const element = deck.current
    if (!element) return
    const cards = Array.from(element.querySelectorAll<HTMLDivElement>('[data-tier]'))
    if (!cards.length) return
    const reduced = matchMedia('(prefers-reduced-motion: reduce)')
    let inView = true
    const observer = new IntersectionObserver(([entry]) => { inView = entry.isIntersecting; last = null })
    observer.observe(element)
    let index = 0, elapsed = 0, last: number | null = null, frame = 0
    let expanded = false, settling = 0
    let current = deckFrame(0, 0, cards[0].offsetWidth, 'hold', cards.length)
    const tick = (now: number) => {
      const delta = last === null ? 0 : now - last
      last = now
      if (!document.hidden && inView) {
        const open = hovered.current || focused.current
        if (open !== expanded) {
          if (!open) elapsed = 0
          expanded = open
          settling = 600
        }
        const cycle = reduced.matches ? 3000 : DECK_CYCLE_MS
        if (!open && settling === 0 && !reduced.matches && cards.length > 1) elapsed += delta
        if (elapsed >= cycle) { index = (index + Math.floor(elapsed / cycle)) % cards.length; elapsed %= cycle }
        const { progress, phase } = deckTimeline(reduced.matches ? 0 : elapsed)
        const target = open ? fanFrame(element.clientWidth, cards[0].offsetWidth, element.clientHeight, cards.length) : deckFrame(index, progress, cards[0].offsetWidth, phase, cards.length)
        const blend = reduced.matches || settling === 0 ? 1 : 1 - Math.exp(-delta / 80)
        current = target.map((pose, i) => ({ ...pose, position: mixPose(current[i].position, pose.position, blend), scale: current[i].scale + (pose.scale - current[i].scale) * blend }))
        settling = Math.max(0, settling - delta)
        element.dataset.phase = open ? 'inspect' : phase
        cards.forEach((card, i) => {
          const { position: p, scale, z, visible } = current[i]
          card.style.transform = `translate(calc(-50% + ${p[0]}px),calc(-50% + ${p[1]}px)) rotate(${p[2]}deg) scale(${scale})`
          card.style.setProperty('--tier-z', String(z))
          card.dataset.copyVisible = String(visible)
        })
      }
      frame = requestAnimationFrame(tick)
    }
    const resetClock = () => { last = null }
    document.addEventListener('visibilitychange', resetClock)
    frame = requestAnimationFrame(tick)
    return () => { cancelAnimationFrame(frame); observer.disconnect(); document.removeEventListener('visibilitychange', resetClock) }
  }, [plans.length])
  return <div className={`store-deck deck-${productId}`} ref={deck} role="group" tabIndex={0} aria-label={t(`${brand} ${plans.length} 个规格，悬停或聚焦展开全部`)}
    onPointerDown={event => { if (event.pointerType !== 'mouse') event.currentTarget.focus() }}
    onPointerEnter={event => { if (event.pointerType === 'mouse') hovered.current = true }}
    onPointerLeave={() => { hovered.current = false; focused.current = false }}
    onFocus={() => { focused.current = true }}
    onBlur={() => { focused.current = false }}>
    {plans.map((plan, i) => <div className="store-tier" data-tier={i} key={plan.id}>
      <div className="store-tier-face">
      <span className="store-tier-copy"><span className="store-tier-brand">{brand}</span><strong className={'store-tier-name' + (plan.name.length > 12 ? ' store-tier-name-long' : '')}>{plan.name}</strong></span>
      <span className="store-tier-price">{plan.price === null ? <small>{t('待定价')}</small> : <>¥{formatCatalogPrice(plan.price)}<small>{t('/ ' + (plan.unit || '月'))}</small></>}</span>
      </div>
    </div>)}
  </div>
}
