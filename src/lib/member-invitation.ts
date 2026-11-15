import { invitationAliasPattern, memberInvitationPath } from '../../shared/member-invitation-path.ts'

const storageKey = 'scholai.invitation.v1:store-3'
const entryKey = 'scholai.invitation.entry.v1:store-3'
const changeEvent = 'scholai-invitation-change'
const codePattern = /^[A-Z0-9]{32}$/
type Invitation = { code: string; alias: string }

function documentInvitation(): Invitation | null {
  const path = memberInvitationPath(location.pathname)
  if (!path) return null
  const meta = document.querySelector('meta[name="scholai-member-invitation"]')
  const code = meta?.getAttribute('content') ?? ''
  return codePattern.test(code) && meta?.getAttribute('data-alias') === path.alias ? { code, alias: path.alias } : null
}

function storedInvitation(): Invitation | null {
  try {
    const code = localStorage.getItem(storageKey) ?? ''
    if (!codePattern.test(code)) return null
    let alias = ''
    try {
      const record = JSON.parse(localStorage.getItem(entryKey) ?? 'null')
      if (record?.code === code && typeof record.alias === 'string' && invitationAliasPattern.test(record.alias)) alias = record.alias
    } catch { /* A legacy code remains usable without display metadata. */ }
    return { code, alias }
  } catch { return null }
}

export function invitationSnapshot() {
  const record = documentInvitation() ?? storedInvitation()
  return record ? record.code + '|' + record.alias : ''
}

export function subscribeInvitation(listener: () => void) {
  const storage = (event: StorageEvent) => { if (!event.key || [storageKey, entryKey].includes(event.key)) listener() }
  window.addEventListener(changeEvent, listener)
  window.addEventListener('storage', storage)
  return () => { window.removeEventListener(changeEvent, listener); window.removeEventListener('storage', storage) }
}

export function readInvitation() {
  const fromDocument = documentInvitation()
  const candidate = new URLSearchParams(location.search).get('invite')?.trim().toUpperCase() ?? ''
  const cookie = document.cookie.split(';').map(v => v.trim()).find(v => v.startsWith('scholai_s3_invitation='))?.slice('scholai_s3_invitation='.length) ?? ''
  const valid = fromDocument?.code ?? [candidate, cookie].find(value => codePattern.test(value)) ?? ''
  const previous = storedInvitation()
  const record = valid ? { code: valid, alias: fromDocument?.alias ?? (previous?.code === valid ? previous.alias : '') } : previous
  if (!record) return ''
  const before = invitationSnapshot()
  try {
    localStorage.setItem(storageKey, record.code)
    if (record.alias) localStorage.setItem(entryKey, JSON.stringify(record))
    else localStorage.removeItem(entryKey)
    if (cookie) document.cookie = 'scholai_s3_invitation=; Path=/; Max-Age=0; SameSite=Lax'
    if (before !== invitationSnapshot()) queueMicrotask(() => window.dispatchEvent(new Event(changeEvent)))
  } catch { /* Keep the cookie and document fallback when storage is blocked. */ }
  return record.code
}
