import { invitationAliasPattern, memberInvitationPath } from '../../shared/member-invitation-path.ts'
import { memberInvitationCookie, MEMBER_STORE_IDS, type MemberStoreId } from '../../shared/member-promotions.ts'

const storageKey = (store: MemberStoreId) => `scholai.invitation.v1:${store}`
const entryKey = (store: MemberStoreId) => `scholai.invitation.entry.v1:${store}`
const changeEvent = 'scholai-invitation-change'
const codePattern = /^[A-Z0-9]{32}$/
type Invitation = { code: string; alias: string }

function documentInvitation(store: MemberStoreId): Invitation | null {
  const path = memberInvitationPath(location.pathname)
  if (!path) return null
  const meta = document.querySelector('meta[name="scholai-member-invitation"]')
  const code = meta?.getAttribute('content') ?? ''
  const sourceStore = meta?.getAttribute('data-store') || 'store-3'
  return sourceStore === store && codePattern.test(code) && meta?.getAttribute('data-alias') === path.alias ? { code, alias: path.alias } : null
}

function storedInvitation(store: MemberStoreId): Invitation | null {
  try {
    const code = localStorage.getItem(storageKey(store)) ?? ''
    if (!codePattern.test(code)) return null
    let alias = ''
    try {
      const record = JSON.parse(localStorage.getItem(entryKey(store)) ?? 'null')
      if (record?.code === code && typeof record.alias === 'string' && invitationAliasPattern.test(record.alias)) alias = record.alias
    } catch { /* A legacy code remains usable without display metadata. */ }
    return { code, alias }
  } catch { return null }
}

export function invitationSnapshot(store: MemberStoreId = 'store-3') {
  const record = documentInvitation(store) ?? storedInvitation(store)
  return record ? record.code + '|' + record.alias : ''
}

export function subscribeInvitation(listener: () => void) {
  const storage = (event: StorageEvent) => { if (!event.key || MEMBER_STORE_IDS.some(store => event.key === storageKey(store) || event.key === entryKey(store))) listener() }
  window.addEventListener(changeEvent, listener)
  window.addEventListener('storage', storage)
  return () => { window.removeEventListener(changeEvent, listener); window.removeEventListener('storage', storage) }
}

export function readInvitation(store: MemberStoreId = 'store-3') {
  const fromDocument = documentInvitation(store)
  // Only the original pilot has legacy query links in circulation.
  const candidate = store === 'store-3' ? new URLSearchParams(location.search).get('invite')?.trim().toUpperCase() ?? '' : ''
  const cookieName = memberInvitationCookie(store)
  const cookie = document.cookie.split(';').map(v => v.trim()).find(v => v.startsWith(cookieName + '='))?.slice(cookieName.length + 1) ?? ''
  const valid = fromDocument?.code ?? [candidate, cookie].find(value => codePattern.test(value)) ?? ''
  const previous = storedInvitation(store)
  const record = valid ? { code: valid, alias: fromDocument?.alias ?? (previous?.code === valid ? previous.alias : '') } : previous
  if (!record) return ''
  const before = invitationSnapshot(store)
  try {
    localStorage.setItem(storageKey(store), record.code)
    if (record.alias) localStorage.setItem(entryKey(store), JSON.stringify(record))
    else localStorage.removeItem(entryKey(store))
    if (cookie) document.cookie = `${cookieName}=; Path=/; Max-Age=0; SameSite=Lax`
    if (before !== invitationSnapshot(store)) queueMicrotask(() => window.dispatchEvent(new Event(changeEvent)))
  } catch { /* Keep the cookie and document fallback when storage is blocked. */ }
  return record.code
}
