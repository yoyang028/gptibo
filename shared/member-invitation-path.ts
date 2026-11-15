export const invitationAliasPattern = /^[a-z0-9][a-z0-9-]{1,18}[a-z0-9]$/

// A referral prefix carries attribution, never a separate shop selection.
export function memberInvitationPath(pathname: string) {
  const match = pathname.match(/^\/(ref|i)\/([^/]+)(\/.*)?$/)
  if (!match) return null
  const alias = match[2].toLowerCase()
  if (!invitationAliasPattern.test(alias)) return null
  return { alias, prefix: `/${match[1]}/${match[2]}`, canonicalBase: `/ref/${alias}`, suffix: match[3] ?? '' }
}
