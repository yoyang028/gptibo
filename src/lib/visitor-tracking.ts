import { useEffect, useRef } from 'react'
import { storefrontVisit } from '../../shared/storefront-visit.ts'
import { storefrontScopeHeaders } from './storefront-routing'

let ephemeralId = ''

function trackVisitor(path: string) {
  let visitorId: string
  try {
    const stored = localStorage.getItem('ymx-visitor-id')
    visitorId = stored && /^[a-f0-9-]{36}$/.test(stored) ? stored : crypto.randomUUID()
    localStorage.setItem('ymx-visitor-id', visitorId)
  } catch { visitorId = ephemeralId ||= crypto.randomUUID() }
  void fetch('/api/visitors', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...storefrontScopeHeaders({ pathname: path }) },
    body: JSON.stringify({ visitorId, path }),
    credentials: 'same-origin',
    keepalive: true,
  }).catch(() => { /* Analytics must never interrupt shopping. */ })
}

export function useStorefrontVisit(page: string, shopAvailable: boolean) {
  const visit = useRef<{ page: string; pathname: string; sent: boolean }>(null)
  useEffect(() => {
    const pathname = location.pathname
    if (visit.current?.pathname !== pathname || visit.current.page !== page) {
      visit.current = { page, pathname, sent: false }
    }
    const current = visit.current
    if (!shopAvailable || current.sent) return
    const route = storefrontVisit(pathname)
    if (!route) return

    const report = () => {
      if (document.hidden || current.sent) return
      current.sent = true
      trackVisitor(route.path)
    }
    if (!document.hidden) {
      report()
      return
    }
    document.addEventListener('visibilitychange', report)
    return () => document.removeEventListener('visibilitychange', report)
  }, [page, shopAvailable])
}
