import test from 'node:test'
import assert from 'node:assert/strict'
import { checkoutSession } from '../src/lib/checkout-session.ts'

test('Session input requires both a complete account and token before authorizing recharge', () => {
  for (const raw of ['{', 'null', '{}', '{"user":{"email":"buyer@example.test"}}', '{"user":{"email":"wrong"},"accessToken":"token"}', '{"user":{"email":"buyer@example.test"},"accessToken":" "}']) {
    const parsed = checkoutSession(raw)
    assert.equal(parsed.credential, null)
    assert.equal(parsed.email, '')
    assert.ok(parsed.problem)
  }
  assert.equal(checkoutSession('').problem, '')
})

test('Session recovery preserves exact JSON bytes for the original idempotent submission', () => {
  const original = '  { "user": { "email": "buyer@example.test" }, "accessToken": "private-token" }\n'
  const parsed = checkoutSession(original, 'session')
  assert.equal(parsed.email, 'buyer@example.test')
  assert.equal(parsed.problem, '')
  assert.deepEqual(parsed.credential, { mode: 'session', session: original })
})

test('an existing uncertain access-token submission can recover from Session without changing credential mode or token bytes', () => {
  const raw = JSON.stringify({ user: { email: 'buyer@example.test' }, accessToken: ' private-token ' })
  assert.deepEqual(checkoutSession(raw, 'access_token').credential, { mode: 'access_token', access_token: ' private-token ' })
  assert.deepEqual(checkoutSession(raw).credential, { mode: 'session', session: raw })
})

test('a large Session keeps the full user/account identity in Session mode instead of falling back to a bare token', () => {
  const core = { user: { email: 'buyer@example.test', id: 'user-fixture', name: 'Fixture', mfa: true }, accessToken: 'private-token', expires: '2099-01-01T00:00:00Z', account: { id: 'account-fixture', planType: 'free', structure: 'personal' }, authProvider: 'auth0' }
  const raw = JSON.stringify({ ...core, featureFlags: 'synthetic-extra-session-data'.repeat(12000) }, null, 2)
  assert(raw.length > 250000)
  const parsed = checkoutSession(raw)
  assert.equal(parsed.email, 'buyer@example.test')
  assert.equal(parsed.problem, '')
  assert.equal(parsed.credential?.mode, 'session')
  assert.deepEqual(JSON.parse(parsed.credential!.session!), core)
  assert(new TextEncoder().encode(JSON.stringify(parsed.credential)).length < 32000)
  assert.equal(checkoutSession(raw.slice(0, 32000)).credential, null, 'a truncated paste must never be submitted')
  assert.equal(checkoutSession(raw, 'access_token').credential?.mode, 'access_token', 'unknown submissions retain their original mode')
  assert.equal(checkoutSession(raw.replace('2099-01-01', '2000-01-01')).credential, null, 'Session expiry remains checked before compaction')
})

test('oversized formatting is removed before any Session fields are omitted', () => {
  const original = { user: { email: 'buyer@example.test' }, accessToken: 'private-token', other: { preserve: true } }
  const raw = ' '.repeat(35000) + JSON.stringify(original)
  const parsed = checkoutSession(raw)
  assert.equal(parsed.credential?.mode, 'session')
  assert.deepEqual(JSON.parse(parsed.credential!.session!), original)
})

test('multibyte and heavily escaped Session content stay within the fulfillment wire budget', () => {
  for (const extra of ['中文内容'.repeat(4000), '"'.repeat(12500)]) {
    const raw = JSON.stringify({ user: { email: 'buyer@example.test' }, accessToken: 'private-token', extra })
    assert(raw.length < 32000)
    assert(new TextEncoder().encode(JSON.stringify({ mode: 'session', session: raw })).length > 32000)
    const compact = checkoutSession(raw).credential
    assert.equal(compact?.mode, 'session')
    assert.deepEqual(JSON.parse(compact!.session!), { user: { email: 'buyer@example.test' }, accessToken: 'private-token' })
    assert.deepEqual(checkoutSession(raw, 'session').credential, compact, 're-pasting the large original must recover the exact compact Session already submitted')
  }
})

test('legacy Session recovery keeps exact escaping even above the old conservative 32 KB byte budget', () => {
  const raw = JSON.stringify({ user: { email: 'buyer@example.test' }, accessToken: 'private-token', extra: '"'.repeat(8000) })
  assert(new TextEncoder().encode(JSON.stringify({ mode: 'session', session: raw })).length > 32000)
  assert.deepEqual(checkoutSession(raw, 'session').credential, { mode: 'session', session: raw })
})

test('oversized input and token credentials fail explicitly instead of silently dropping their tail', () => {
  const input = (accessToken: string, extra = '') => JSON.stringify({ user: { email: 'buyer@example.test' }, accessToken, extra })
  const oversized = checkoutSession(input('private-token', 'x'.repeat(1024 * 1024)))
  assert.equal(oversized.credential, null)
  assert.match(oversized.problem, /1 MB/)
  const longToken = checkoutSession(input('x'.repeat(32001)))
  assert.equal(longToken.credential, null)
  assert.match(longToken.problem, /Access Token/)
  assert.equal(checkoutSession(input('x'.repeat(32000))).credential, null, 'do not silently change a new submission to token mode when essential Session fields cannot fit')
  const oversizedAccount = checkoutSession(JSON.stringify({ user: { email: 'buyer@example.test', id: 'x'.repeat(33000) }, accessToken: 'private-token' }))
  assert.equal(oversizedAccount.credential, null, 'do not drop an oversized identity field or truncate credentials')
  assert.match(oversizedAccount.problem, /必要账号资料/)
  const boundary = checkoutSession(input('x'.repeat(31000)))
  assert.equal(boundary.credential?.mode, 'session')
  assert(new TextEncoder().encode(JSON.stringify({ action: 'submit', key: crypto.randomUUID(), customerConfirmedEmail: true, credential: boundary.credential })).length < 40000)
})
