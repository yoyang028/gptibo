import test from 'node:test'
import assert from 'node:assert/strict'
import worker from '../worker/index.ts'
import { accountReport } from '../worker/account-check.ts'
import { ACCOUNT_CHECK_BODY_MAX_BYTES, ACCOUNT_SESSION_MAX_BYTES, compactAccountSession, readAccountSession } from '../shared/chatgpt-account.ts'
import type { Env } from '../worker/platform.ts'

const origin = 'https://shop.example.invalid'
const session = (extra: Record<string, unknown> = {}) => JSON.stringify({ user: { email: 'account@example.test' }, accessToken: 'fixture-account-free', account: { id: 'account-fixture' }, ...extra })
const free = { accounts: { default: { account: { account_id: 'account-fixture', plan_type: 'free', structure: 'personal' }, entitlement: { has_active_subscription: false } } } }
function env() {
  return {
    API_LIMITER: { limit: async () => ({ success: true }) }, EXPENSIVE_LIMITER: { limit: async () => ({ success: true }) }, INTEREST_LIMITER: { limit: async () => ({ success: true }) },
    INTEREST_DB: new Proxy({}, { get() { throw new Error('Account checks must never access customer or order storage') } }),
    ASSETS: { fetch: async () => new Response('asset') },
  } as unknown as Env
}
const request = (data: unknown, headers = {}) => new Request(origin + '/api/tools/account-check', { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(data) })

test('Session parsing rejects malformed, excessive, incomplete, unsafe and expired input without claiming authentication', () => {
  for (const raw of ['', '[]', 'null', '{', session({ user: {} }), session({ accessToken: 'bad\r\nheader' }), 'x'.repeat(32001)]) assert.equal(readAccountSession(raw).ok, false)
  const token = 'fixture.' + Buffer.from(JSON.stringify({ exp: 1, plan: 'plus' })).toString('base64url') + '.not-a-signature'
  const expired = readAccountSession(session({ accessToken: token }))
  assert.equal(expired.ok ? null : expired.code, 'expired')
  const good = readAccountSession(session({ expires: '2099-01-01T00:00:00Z', plan: 'pro' }))
  assert.equal(good.ok, true)
  if (good.ok) { assert.equal(good.session.email, 'account@example.test'); assert.equal('plan' in good.session, false) }
})

test('account replies use the requested account and never infer a paid or free subscription from missing data', () => {
  assert.equal(accountReport(free, 'account-fixture').plan, 'free')
  assert.equal(accountReport(free, 'another-account').state, 'unknown')
  for (const raw of [null, {}, { plan: 'free' }, { accounts: {} }, { accounts: { default: { account: {} } } }, { accounts: { default: { account: { plan_type: 'unexpected-secret-value' } } } }]) {
    const result = accountReport(raw, null)
    assert.equal(result.state, 'unknown'); assert.equal(result.plan, null); assert.equal(result.subscriptionActive, null)
  }
  const result = accountReport(free, 'account-fixture')
  assert.equal(result.source, null, 'no missing channel is guessed to be web/never subscribed')
  assert.equal(result.region, null); assert.equal(result.subscriptionExpiresAt, null)
  assert.equal(accountReport({ accounts: { one: free.accounts.default, two: free.accounts.default } }, null).state, 'unknown')
  assert.equal(accountReport({ accounts: { default: { ...free.accounts.default, entitlement: { has_active_subscription: true } } } }, null).state, 'unknown')
})

test('large complete Sessions keep their account fields while truncated and oversized input still fail explicitly', () => {
  const raw = session({ expires: '2099-01-01T00:00:00Z', featureFlags: 'synthetic-extra-session-data'.repeat(12000) })
  assert(raw.length > 300000)
  const parsed = readAccountSession(raw)
  assert(parsed.ok)
  assert.equal(parsed.session.email, 'account@example.test')
  assert.equal(parsed.session.accessToken, 'fixture-account-free')
  assert.equal(parsed.session.accountId, 'account-fixture')
  const compact = compactAccountSession(parsed.session)
  assert.deepEqual(JSON.parse(compact), { user: { email: 'account@example.test' }, accessToken: 'fixture-account-free', account: { id: 'account-fixture' }, expires: '2099-01-01T00:00:00.000Z' })
  assert(compact.length < 1000); assert.doesNotMatch(compact, /featureFlags|synthetic-extra/)
  const truncated = readAccountSession(raw.slice(0, 32000))
  assert.equal(truncated.ok ? null : truncated.code, 'format')
  const oversized = readAccountSession(session({ featureFlags: 'x'.repeat(ACCOUNT_SESSION_MAX_BYTES) }))
  assert.equal(oversized.ok ? null : oversized.code, 'size')
  const multibyte = readAccountSession(session({ featureFlags: '测'.repeat(ACCOUNT_SESSION_MAX_BYTES / 2) }))
  assert.equal(multibyte.ok ? null : multibyte.code, 'size', 'input limits count UTF-8 bytes')
})

test('a large pasted Session produces one compact, consented provider read without forwarding unrelated data', async t => {
  const raw = session({ featureFlags: 'synthetic-extra-session-data'.repeat(12000), callback: 'https://evil.test' })
  const parsed = readAccountSession(raw); assert(parsed.ok)
  let calls = 0
  t.mock.method(globalThis, 'fetch', async (url: string, options: RequestInit) => {
    calls++; assert.equal(url, 'https://chatgpt.com/backend-api/accounts/check/v4-2023-04-27?timezone_offset_min=-480')
    assert.equal(options.method, 'GET'); assert.equal(options.body, undefined)
    assert.equal(new Headers(options.headers).get('Authorization'), 'Bearer fixture-account-free')
    assert.doesNotMatch(JSON.stringify(options), /featureFlags|synthetic-extra|evil/)
    return Response.json(free)
  })
  const response = await worker.fetch(request({ session: compactAccountSession(parsed.session), consent: true }), env())
  assert.equal(response.status, 200); assert.equal((await response.json()).report.plan, 'free'); assert.equal(calls, 1)
  assert.equal((await worker.fetch(request({ session: raw, consent: true }), env())).status, 413)
  assert.equal(calls, 1, 'the server keeps its bounded request budget even though the browser accepts a large paste')
})

test('JSON escaping of a bounded token cannot exhaust the account-check request budget', async t => {
  const parsed = readAccountSession(session({ accessToken: '\\'.repeat(16000) })); assert(parsed.ok)
  const input = { session: compactAccountSession(parsed.session), consent: true }
  assert(Buffer.byteLength(JSON.stringify(input)) > 34000)
  assert(Buffer.byteLength(JSON.stringify(input)) < ACCOUNT_CHECK_BODY_MAX_BYTES)
  t.mock.method(globalThis, 'fetch', async () => Response.json(free))
  assert.equal((await worker.fetch(request(input), env())).status, 200)
})

test('known subscription metadata is normalized and extra fields, credentials and identifiers never reach the report', () => {
  const result = accountReport({ accounts: { default: {
    account: { account_id: 'account-fixture', plan_type: 'plus', structure: 'personal', billing_country: 'ph', private_note: 'PRIVATE' },
    entitlement: { has_active_subscription: true, expires_at: '2026-12-31T00:00:00Z' },
    subscription: { subscription_source: 'apple', will_renew: false }, accessToken: 'PRIVATE-TOKEN',
  } } }, 'account-fixture')
  assert.equal(result.state, 'checked'); assert.equal(result.plan, 'plus'); assert.equal(result.region, 'PH'); assert.equal(result.source, 'ios'); assert.equal(result.autoRenew, false)
  assert.equal(result.subscriptionExpiresAt, '2026-12-31T00:00:00.000Z')
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE|account-fixture|accessToken/)
  assert.equal(accountReport({ accounts: { default: { account: { plan_type: 'team', structure: 'workspace' } } } }, null).plan, 'workspace')
})

test('public account check requires same-origin JSON, explicit consent and rate budgets before reading ChatGPT', async t => {
  let calls = 0
  t.mock.method(globalThis, 'fetch', async () => { calls++; throw new Error('unexpected network') })
  const e = env()
  for (const [r, status] of [
    [new Request(origin + '/api/tools/account-check'), 405],
    [request({ session: session(), consent: true }, { Origin: 'https://evil.example.test' }), 403],
    [request({ session: session(), consent: true }, { 'Content-Type': 'text/plain' }), 415],
    [request({ session: session() }), 400],
    [request({ session: '{', consent: true }), 400],
    [request({ session: 'x'.repeat(ACCOUNT_CHECK_BODY_MAX_BYTES), consent: true }), 413],
  ] as const) assert.equal((await worker.fetch(r, e)).status, status)
  e.INTEREST_LIMITER.limit = async () => ({ success: false })
  const limited = await worker.fetch(request({ session: session(), consent: true }), e)
  assert.equal(limited.status, 429); assert.equal(limited.headers.get('Retry-After'), '60')
  e.EXPENSIVE_LIMITER.limit = async () => ({ success: false })
  assert.equal((await worker.fetch(request({ session: session(), consent: true }), e)).status, 429)
  assert.equal(calls, 0)
})

test('account check makes exactly one bounded read to the fixed ChatGPT endpoint; no supplier, database or original Session forwarding', async t => {
  let calls = 0
  t.mock.method(globalThis, 'fetch', async (url: string, options: RequestInit) => {
    calls++
    assert.equal(url, 'https://chatgpt.com/backend-api/accounts/check/v4-2023-04-27?timezone_offset_min=-480')
    assert.equal(options.method, 'GET'); assert.equal(options.redirect, 'manual'); assert.equal(options.body, undefined)
    const headers = new Headers(options.headers)
    assert.equal(headers.get('Authorization'), 'Bearer fixture-account-free')
    assert.equal(headers.get('ChatGPT-Account-Id'), 'account-fixture')
    assert.equal(headers.has('Cookie'), false)
    assert.doesNotMatch(JSON.stringify(options), /account@example|evil\.test|PRIVATE/)
    return Response.json(free)
  })
  const response = await worker.fetch(request({ session: session({ callback: 'https://evil.test', private: 'PRIVATE' }), consent: true }), env())
  assert.equal(response.status, 200); assert.equal(response.headers.get('Cache-Control'), 'no-store'); assert.equal(calls, 1)
  const raw = await response.text()
  const output = JSON.parse(raw)
  assert.equal(output.report.state, 'checked'); assert.equal(output.report.plan, 'free')
  assert.doesNotMatch(raw, /fixture-account-free|account@example|account-fixture|PRIVATE/)
})

test('query failures, redirects and oversized/malformed provider replies stay unconfirmed and never produce a free-account pass', async t => {
  for (const [response, state] of [
    [() => new Response('PRIVATE', { status: 401 }), 'expired'], [() => new Response('PRIVATE', { status: 403 }), 'unavailable'],
    [() => new Response('PRIVATE', { status: 429 }), 'limited'], [() => new Response(null, { status: 302, headers: { Location: 'https://evil.test' } }), 'unavailable'],
    [() => new Response('<html>PRIVATE</html>'), 'unknown'], [() => Response.json({ accounts: {} }), 'unknown'],
    [() => new Response('x'.repeat(128001)), 'unknown'], [() => { throw new Error('PRIVATE-TRANSPORT') }, 'unavailable'],
  ] as const) {
    t.mock.method(globalThis, 'fetch', async () => response())
    const r = await worker.fetch(request({ session: session(), consent: true }), env())
    const raw = await r.text(), result = JSON.parse(raw).report
    assert.equal(r.status, 200); assert.equal(result.state, state); assert.equal(result.plan, null); assert.equal(result.subscriptionActive, null)
    assert.doesNotMatch(raw, /PRIVATE|evil\.test|fixture-account/)
    t.mock.restoreAll()
  }
})

test('locally expired credentials never leave the server and plaintext writes never reach any account check', async t => {
  t.mock.method(globalThis, 'fetch', async () => { throw new Error('No network allowed') })
  const r = await worker.fetch(request({ session: session({ expires: '2000-01-01T00:00:00Z' }), consent: true }), env())
  assert.equal((await r.json() as { report: { state: string } }).report.state, 'expired')
  assert.equal((await worker.fetch(new Request('http://shop.example.invalid/api/tools/account-check', { method: 'POST', body: '{}' }), env())).status, 403)
})
