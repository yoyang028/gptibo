import test from 'node:test'
import assert from 'node:assert/strict'
import { checkoutSession } from '../src/lib/checkout-session.ts'
import { legacyRechargeSession, readRechargeInput, RECHARGE_BODY_MAX_BYTES, RECHARGE_TOKEN_MAX_CHARS } from '../shared/recharge-credential.ts'

const token = 'SYNTHETIC-SESSION-TOKEN-ONLY'
const json = (extra: Record<string, unknown> = {}) => JSON.stringify({ user: { email: 'buyer@example.test' }, sessionToken: token, accessToken: 'different-access-token', ...extra })

test('accessToken-only JSON is rejected locally instead of being relabelled as a recharge Session', () => {
  for (const raw of ['{', 'null', '{}', '[]', JSON.stringify({ user: { email: 'buyer@example.test' }, accessToken: 'private-access-token' })]) {
    const parsed = checkoutSession(raw)
    assert.equal(parsed.credential, null)
    assert.ok(parsed.problem)
  }
  assert.match(checkoutSession('{"accessToken":"private-access-token"}').problem, /sessionToken/)
  assert.equal(checkoutSession('').problem, '')
})

test('Session Token is extracted independently from root, data and auth, with no required Access Token', () => {
  for (const key of ['sessionToken', 'session']) for (const wrapper of ['', 'data', 'auth']) {
    const fields = { [key]: ' ' + token + ' ', user: { email: 'buyer@example.test' } }
    const parsed = checkoutSession(JSON.stringify(wrapper ? { [wrapper]: fields } : fields))
    assert.equal(parsed.email, 'buyer@example.test')
    assert.equal(parsed.problem, '')
    assert.deepEqual(parsed.credential, { mode: 'session', session: token })
  }
})

test('opaque raw Session Token is supported without claiming to have identified an email', () => {
  const parsed = checkoutSession(' ' + token + '\n')
  assert.equal(parsed.email, '')
  assert.equal(parsed.problem, '')
  assert.deepEqual(parsed.credential, { mode: 'session', session: token })
})

test('a raw token explicitly marked as an API access token is not accepted as a Session Token', () => {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url')
  for (const [header, claims] of [[{ typ: 'at+jwt' }, {}], [{ typ: 'JWT' }, { aud: 'https://api.openai.com/v1' }]]) {
    const raw = encode(header) + '.' + encode(claims) + '.SYNTHETIC'
    assert.equal(checkoutSession(raw).credential, null)
    assert.match(checkoutSession(raw).problem, /Access Token/)
  }
})

test('a multi-megabyte complete JSON is extracted before enforcing the actual token limit', () => {
  const raw = json({ featureFlags: 'synthetic-client-flags'.repeat(100000) })
  assert(raw.length > 1024 * 1024)
  const parsed = checkoutSession(raw)
  assert.equal(parsed.email, 'buyer@example.test')
  assert.deepEqual(parsed.credential, { mode: 'session', session: token })
  assert.equal(checkoutSession(raw.slice(0, 32000)).credential, null)
})

test('128 KiB character limit applies to the extracted token, not unrelated input or the obsolete 32k bound', () => {
  const boundary = 'x'.repeat(RECHARGE_TOKEN_MAX_CHARS)
  const parsed = checkoutSession(json({ sessionToken: boundary, featureFlags: '中文'.repeat(160000) }))
  assert.deepEqual(parsed.credential, { mode: 'session', session: boundary })
  assert(new TextEncoder().encode(JSON.stringify({ credential: parsed.credential })).length < RECHARGE_BODY_MAX_BYTES)
  const excessive = checkoutSession(json({ sessionToken: boundary + 'x' }))
  assert.equal(excessive.credential, null)
  assert.match(excessive.problem, /128 KiB/)
})

test('Access Token expiry does not replace or invalidate a distinct live Session Token', () => {
  const expiredAccess = 'e30.' + Buffer.from('{"exp":1}').toString('base64url') + '.fixture'
  assert.deepEqual(checkoutSession(json({ accessToken: expiredAccess, expires: '2099-01-01T00:00:00Z' })).credential, { mode: 'session', session: token })
  assert.equal(checkoutSession(json({ expires: '2000-01-01T00:00:00Z' })).credential, null)
})

test('original unknown Session and Access Token requests retain exact bytes, including expiry and spacing', () => {
  const original = '  { "user": { "email": "buyer@example.test" }, "accessToken": " private-token ", "expires": "2000-01-01T00:00:00Z" }\n'
  assert.deepEqual(checkoutSession(original, 'session').credential, { mode: 'session', session: original })
  assert.deepEqual(checkoutSession(original, 'access_token').credential, { mode: 'access_token', access_token: ' private-token ' })
  assert.deepEqual(checkoutSession(token, 'session').credential, { mode: 'session', session: token })
})

test('long unknown legacy compact submissions can be reconstructed without inventing a new credential', () => {
  const raw = JSON.stringify({ user: { email: 'buyer@example.test' }, accessToken: 'private-token', featureFlags: 'x'.repeat(400000) })
  assert.deepEqual(checkoutSession(raw, 'session').credential, legacyRechargeSession(raw))
})

test('the old 32k compaction drops a valid Session Token while the replacement matches the workbench', () => {
  const raw = json({ featureFlags: 'x'.repeat(36000) })
  const old = legacyRechargeSession(raw)
  assert(old?.mode === 'session')
  assert.equal(JSON.parse(old.session).sessionToken, undefined)
  const current = checkoutSession(raw)
  assert.equal(current.problem, '')
  assert.deepEqual(current.credential, { mode: 'session', session: token })
})

test('named cookie chunks are joined in numeric order and unrelated cookies are omitted', () => {
  const raw = 'irrelevant=DO-NOT-FORWARD; __Secure-next-auth.session-token.1=TOKEN; __Secure-next-auth.session-token.0=SESSION-'
  assert.deepEqual(checkoutSession(raw).credential, { mode: 'session', session: 'SESSION-TOKEN' })
  for (const raw of ['__Secure-next-auth.session-token.0=only-head', '__Secure-next-auth.session-token.1=only-tail', '__Secure-next-auth.session-token.0=a; __Secure-next-auth.session-token.2=c', '__Secure-next-auth.session-token=whole; __Secure-next-auth.session-token.0=chunk', '__Secure-next-auth.session-token.0=a; __Secure-next-auth.session-token.0=b']) {
    assert.equal(checkoutSession(raw).credential, null)
  }
})

test('extraction returns public constant errors, never includes the submitted secret in validation output', () => {
  const raw = '{"accessToken":"DO-NOT-ECHO-PRIVATE-CREDENTIAL"}'
  const parsed = readRechargeInput(raw)
  assert(!JSON.stringify(parsed).includes('DO-NOT-ECHO'))
})
