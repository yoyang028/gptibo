// The native local dialog captures this helper's stdout in memory. Never invoke
// the preview action in a shell transcript: its QR contains the production seed.
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {createHash} from 'node:crypto'
import QRCode from 'qrcode'
import {validTotpSecret, verifyTotp} from '../../worker/totp.ts'

export function enrollmentUri({secret, username, domain}) {
  if (!validTotpSecret(secret) || typeof username !== 'string' || username.length < 1 || username.length > 80 || Array.from(username).some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127 || char === ':') || typeof domain !== 'string' || domain.length > 253 || !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(domain)) throw new Error('Invalid local enrollment configuration')
  const issuer = `GPTibo (${domain})`
  const uri = new URL('otpauth://totp/' + encodeURIComponent(issuer + ':' + username))
  uri.search = new URLSearchParams({secret, issuer, algorithm: 'SHA1', digits: '6', period: '30'})
  return uri.toString()
}

export function enrollmentFingerprint(input) {
  enrollmentUri(input)
  return createHash('sha256').update('admin-enrollment-v1:' + input.domain + ':' + input.username + ':' + input.secret).digest('hex')
}

export async function enrollmentPreview(input) {
  return {image: await QRCode.toDataURL(enrollmentUri(input), {width: 300, margin: 4, errorCorrectionLevel: 'M'}), fingerprint: enrollmentFingerprint(input)}
}

export async function verifyEnrollment(input, now = Date.now()) {
  const fingerprint = enrollmentFingerprint(input)
  return {verified: await verifyTotp(input.secret, input.code, now) !== null, fingerprint}
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    let raw = ''
    for await (const chunk of process.stdin) {raw += chunk; if (raw.length > 4096) throw new Error('Input too large')}
    const input = JSON.parse(raw); raw = ''
    const result = input.action === 'preview' ? await enrollmentPreview(input) : input.action === 'verify' ? await verifyEnrollment(input) : null
    if (!result) throw new Error('Unsupported action')
    input.secret = ''; input.code = ''
    process.stdout.write(JSON.stringify(result))
  } catch {process.stderr.write('Local admin enrollment failed; sensitive input withheld.\n'); process.exitCode = 1}
}
