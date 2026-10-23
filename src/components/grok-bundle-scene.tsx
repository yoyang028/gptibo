import { useEffect, useId, useRef } from 'react'
import './grok-bundle-scene.css'

const services = [
  { id: 'grok', name: 'Grok', hint: '问答、语音与创作，使用订阅内的共享 AI 用量。' },
  { id: 'x', name: 'X', hint: '连接个人 X 账号后，享受所选档位对应的认证与创作者权益。' },
  { id: 'cursor', name: 'Cursor', hint: 'AI 编程与代码编辑；第三方模型在 Premium 及以上可选，需单独计费。' },
  { id: 'bot', name: 'Bot', hint: 'Grok Bot 智能体：Premium、Super、Ultra 包含，Plus 不包含。' },
]

/** Transparent monochrome marks; names identify services rather than plan tiers. */
export function GrokBundleScene({ detail = false, selectedTier }: { detail?: boolean; selectedTier?: string }) {
  const scene = useRef<HTMLDivElement>(null)
  const id = useId()
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
  return <div ref={scene} className={'grok-bundle-scene' + (detail ? ' grok-bundle-detail' : '')} data-active="false" role="group" aria-label="Grok、X、Cursor 与 Bot 服务介绍">
    <div className="grok-bundle-services">
      {services.map(service => <button key={service.id} type="button" className="grok-bundle-service" data-service={service.id} aria-label={service.name} aria-describedby={id + '-' + service.id} onClick={event => event.currentTarget.focus()}>
        <span className="grok-bundle-mark">
          <span className={'grok-bundle-symbol grok-bundle-' + service.id} data-symbol={service.id} aria-hidden="true">
            {service.id === 'grok' ? <span className="grok-bundle-mask" style={{ maskImage: 'url(/brands/grok-official.svg)' }}/>
              : service.id === 'cursor' ? <span className="grok-bundle-mask" style={{ maskImage: 'url(/brands/cursor-official.svg)' }}/>
              : service.id === 'x' ? <svg viewBox="0 0 24 24" fill="currentColor" focusable="false"><path d="M18.9 2H22l-6.77 7.74L23.2 22h-6.24l-4.89-7.4L5.6 22H2.47l7.15-8.17L1.2 2h6.4l4.43 6.77L18.9 2ZM17.8 20h1.73L6.65 3.9H4.8L17.8 20Z"/></svg>
              : <svg viewBox="0 0 84 84" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" focusable="false">
                <path d="M42 20V9m-6 0h12"/><rect x="12" y="23" width="60" height="46" rx="16"/>
                <path d="M5 39v13m74-13v13M26 75v5m32-5v5"/>
                <g className="grok-bot-eyes"><path d="M30 41v7m24-7v7" strokeWidth="5"/></g>
                <path d="M32 57c6 4 14 4 20 0" strokeWidth="3"/>
              </svg>}
          </span>
        </span>
        <span className="grok-bundle-name">{service.name}</span>
        <span className="grok-bundle-hint" role="tooltip" id={id + '-' + service.id}>{service.id === 'bot' && selectedTier === 'Plus' ? '当前 Plus 不包含 Bot；需要智能体功能请选择 Premium 或以上档位。' : service.hint}</span>
      </button>)}
    </div>
  </div>
}
