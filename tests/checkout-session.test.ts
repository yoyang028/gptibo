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

test('a complete large Session confirms its account and submits the supported token credential without truncation', () => {
  const raw = JSON.stringify({ user: { email: 'buyer@example.test' }, accessToken: 'private-token', expires: '2099-01-01T00:00:00Z', featureFlags: 'synthetic-extra-session-data'.repeat(12000) }, null, 2)
  assert(raw.length > 250000)
  const parsed = checkoutSession(raw)
  assert.equal(parsed.email, 'buyer@example.test')
  assert.equal(parsed.problem, '')
  assert.deepEqual(parsed.credential, { mode: 'access_token', access_token: 'private-token' })
  assert.equal(checkoutSession(raw.slice(0, 32000)).credential, null, 'a truncated paste must never be submitted')
  assert.equal(checkoutSession(raw, 'access_token').credential?.mode, 'access_token', 'unknown submissions retain their original mode')
  assert.equal(checkoutSession(raw.replace('2099-01-01', '2000-01-01')).credential, null, 'Session expiry remains checked before extracting its token')
})

test('multibyte and heavily escaped Session content stay within the fulfillment wire budget', () => {
  for (const extra of ['中文内容'.repeat(4000), '"'.repeat(12500)]) {
    const raw = JSON.stringify({ user: { email: 'buyer@example.test' }, accessToken: 'private-token', extra })
    assert(raw.length < 32000)
    assert(new TextEncoder().encode(JSON.stringify({ mode: 'session', session: raw })).length > 32000)
    assert.equal(checkoutSession(raw).credential?.mode, 'access_token')
    assert.deepEqual(checkoutSession(raw, 'session').credential, { mode: 'session', session: raw }, 'recovery must not change the digest of an already accepted Session')
  }
})

test('oversized input and token credentials fail explicitly instead of silently dropping their tail', () => {
  const input = (accessToken: string, extra = '') => JSON.stringify({ user: { email: 'buyer@example.test' }, accessToken, extra })
  const oversized = checkoutSession(input('private-token', 'x'.repeat(1024 * 1024)))
  assert.equal(oversized.credential, null)
  assert.match(oversized.problem, /1 MB/)
  const longToken = checkoutSession(input('x'.repeat(32001)))
  assert.equal(longToken.credential, null)
  assert.match(longToken.problem, /Access Token/)
  const boundary = checkoutSession(input('x'.repeat(32000)))
  assert.equal(boundary.credential?.mode, 'access_token')
  assert(new TextEncoder().encode(JSON.stringify({ action: 'submit', key: crypto.randomUUID(), customerConfirmedEmail: true, credential: boundary.credential })).length < 40000)
})
