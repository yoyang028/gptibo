import { memberInvitationPath } from './member-invitation-path.ts'
import { STOREFRONT_GUIDE_PATHS } from './storefront-guides.ts'

const trackedPages = new Set<string>(['/', '/orders', '/check', '/account', ...STOREFRONT_GUIDE_PATHS])
const productPage = /^\/product\/[a-z0-9-]+$/

export function storefrontVisit(pathname: string) {
  if (!pathname.startsWith('/') || pathname.length > 120) return null
  const path = pathname.replace(/\/$/, '') || '/'
  const invitation = memberInvitationPath(path)
  const shopPath = path.match(/^\/(?:r|s)\/([^/]+)(\/.*)?$/)
  const page = (invitation ? invitation.suffix : shopPath ? shopPath[2] : path) || '/'
  if (!trackedPages.has(page) && !productPage.test(page)) return null
  // Attribute invitation traffic to the current domain and report only the page path.
  return { path: invitation ? page : path, shopSlug: shopPath?.[1] }
}
