import { StorefrontI18nProvider } from './lib/storefront-i18n-provider'
import { WorkspaceBoot } from './components/workspace-loading'
import { lazy, Suspense } from 'react'
import App from './App'
import { SITE_KIND } from './lib/site-profile'

const Admin = lazy(() => import('./admin/Admin'))
const Partner = lazy(() => import('./partner/Partner'))
const GeneralStore = lazy(() => import('./storefront/GeneralStore'))
const Wholesale = lazy(() => import('./wholesale/Wholesale'))
export default function Root() {
  return location.pathname === '/admin' || location.pathname.startsWith('/admin/')
    ? <Suspense fallback={<WorkspaceBoot />}><Admin /></Suspense>
    : SITE_KIND === 'wholesale'
      ? <Suspense fallback={<WorkspaceBoot />}><Wholesale /></Suspense>
    : ['/join', '/join/', '/partner'].includes(location.pathname)
      ? <Suspense fallback={<WorkspaceBoot />}><Partner /></Suspense>
      : <StorefrontI18nProvider>{SITE_KIND === 'general' ? <Suspense fallback={<WorkspaceBoot />}><GeneralStore /></Suspense> : <App />}</StorefrontI18nProvider>
}
