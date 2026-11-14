export function readInvitation() {
  const storageKey = 'scholai.invitation.v1:store-3'
  const candidate = new URLSearchParams(location.search).get('invite')?.trim().toUpperCase() ?? ''
  const cookie = document.cookie.split(';').map(v => v.trim()).find(v => v.startsWith('scholai_s3_invitation='))?.slice('scholai_s3_invitation='.length) ?? ''
  if (cookie) document.cookie = 'scholai_s3_invitation=; Path=/; Max-Age=0; SameSite=Lax'
  const valid = [candidate, cookie].find(v => /^[A-Z0-9]{32}$/.test(v)) ?? ''
  try {
    if (valid) { localStorage.setItem(storageKey, valid); return valid }
    const previous = localStorage.getItem(storageKey) ?? ''
    return /^[A-Z0-9]{32}$/.test(previous) ? previous : ''
  } catch { return valid }
}
