export function readInvitation() {
  const storageKey = 'scholai.invitation.v1:store-3'
  const candidate = new URLSearchParams(location.search).get('invite')?.trim().toUpperCase() ?? ''
  const valid = /^[A-Z0-9]{32}$/.test(candidate) ? candidate : ''
  try {
    if (valid) { localStorage.setItem(storageKey, valid); return valid }
    const previous = localStorage.getItem(storageKey) ?? ''
    return /^[A-Z0-9]{32}$/.test(previous) ? previous : ''
  } catch { return valid }
}
