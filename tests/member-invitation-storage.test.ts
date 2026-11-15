import test, { type TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { invitationSnapshot, readInvitation, subscribeInvitation } from '../src/lib/member-invitation.ts'

const storageKey = 'scholai.invitation.v1:store-3', entryKey = 'scholai.invitation.entry.v1:store-3'
const a = 'A'.repeat(32), b = 'B'.repeat(32)

function browser(t: TestContext) {
  const values = new Map<string, string>(), events = new EventTarget()
  const location = { pathname: '/', search: '' }
  const state = { cookie: '', blocked: false, meta: null as { code: string; alias: string } | null }
  const document = {
    querySelector: () => state.meta ? { getAttribute: (name: string) => name === 'content' ? state.meta!.code : name === 'data-alias' ? state.meta!.alias : null } : null,
    get cookie() { return state.cookie },
    set cookie(value: string) { state.cookie = value.includes('Max-Age=0') ? '' : value },
  }
  const localStorage = {
    getItem(key: string) { if (state.blocked) throw new Error('storage disabled'); return values.get(key) ?? null },
    setItem(key: string, value: string) { if (state.blocked) throw new Error('storage disabled'); values.set(key, value) },
    removeItem(key: string) { if (state.blocked) throw new Error('storage disabled'); values.delete(key) },
  }
  for (const [name, value] of Object.entries({ location, document, localStorage, window: events })) {
    const original = Object.getOwnPropertyDescriptor(globalThis, name)
    Object.defineProperty(globalThis, name, { value, configurable: true })
    t.after(() => { if (original) Object.defineProperty(globalThis, name, original); else Reflect.deleteProperty(globalThis, name) })
  }
  return { values, events, location, state }
}

test('a validated referral document wins over conflicting query, cookie and previous storage and retains its shareable alias', t => {
  const f = browser(t)
  f.location.pathname = '/ref/xingqiu/product/chatgpt'; f.location.search = '?invite=' + b
  f.state.meta = { code: a, alias: 'xingqiu' }; f.state.cookie = 'scholai_s3_invitation=' + b
  f.values.set(storageKey, b)
  assert.equal(readInvitation(), a)
  assert.equal(invitationSnapshot(), a + '|xingqiu')
  assert.deepEqual(JSON.parse(f.values.get(entryKey)!), { code: a, alias: 'xingqiu' })
  assert.equal(f.state.cookie, '')
  f.location.pathname = '/ref/xingqiu/account'
  assert.equal(readInvitation(), a)
  f.location.pathname = '/product/chatgpt'; f.state.meta = null; f.location.search = ''
  assert.equal(readInvitation(), a)
  assert.equal(invitationSnapshot(), a + '|xingqiu')
})

test('legacy query and cookie links retain their existing code selection while stale alias metadata is discarded', t => {
  const f = browser(t)
  f.values.set(storageKey, a); f.values.set(entryKey, JSON.stringify({ code: a, alias: 'old-star' }))
  f.state.cookie = 'scholai_s3_invitation=' + a; f.location.search = '?invite=' + b.toLowerCase()
  assert.equal(readInvitation(), b)
  assert.equal(f.values.get(entryKey), undefined)
  assert.equal(invitationSnapshot(), b + '|')
  f.location.search = '?invite=invalid'; f.state.cookie = 'scholai_s3_invitation=' + a
  assert.equal(readInvitation(), a)
  assert.equal(f.state.cookie, '')
})

test('disabled storage preserves the cookie and validated document so checkout can still read the same inviter', t => {
  const f = browser(t)
  f.state.blocked = true; f.state.cookie = 'scholai_s3_invitation=' + a
  f.location.pathname = '/ref/xingqiu'; f.state.meta = { code: a, alias: 'xingqiu' }
  assert.equal(readInvitation(), a)
  assert.equal(invitationSnapshot(), a + '|xingqiu')
  assert.equal(f.state.cookie, 'scholai_s3_invitation=' + a)
  f.location.pathname = '/ref/xingqiu/product/chatgpt'
  assert.equal(readInvitation(), a)
  f.state.meta = null; f.location.pathname = '/product/chatgpt'
  assert.equal(readInvitation(), a)
})

test('malformed records and alias metadata never become a different visible referral source', t => {
  const f = browser(t)
  f.values.set(storageKey, 'invalid')
  assert.equal(readInvitation(), ''); assert.equal(invitationSnapshot(), '')
  f.values.set(storageKey, a); f.values.set(entryKey, '{invalid')
  assert.equal(invitationSnapshot(), a + '|')
  f.values.set(entryKey, JSON.stringify({ code: b, alias: 'other-star' }))
  assert.equal(invitationSnapshot(), a + '|')
  f.values.set(entryKey, JSON.stringify({ code: a, alias: 'invalid/<script>' }))
  assert.equal(invitationSnapshot(), a + '|')
})

test('invitation subscriptions publish captured legacy sources and respond to storage changes with a clean unsubscribe', async t => {
  const f = browser(t)
  let calls = 0
  const unsubscribe = subscribeInvitation(() => calls++)
  f.state.cookie = 'scholai_s3_invitation=' + a
  assert.equal(readInvitation(), a)
  await Promise.resolve()
  assert.equal(calls, 1)
  f.values.set(storageKey, b)
  f.events.dispatchEvent(Object.assign(new Event('storage'), { key: storageKey }))
  assert.equal(calls, 2); assert.equal(invitationSnapshot(), b + '|')
  unsubscribe()
  f.events.dispatchEvent(Object.assign(new Event('storage'), { key: storageKey }))
  assert.equal(calls, 2)
})
