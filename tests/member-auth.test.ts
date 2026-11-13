import test from 'node:test'
import assert from 'node:assert/strict'
import { memberFixture } from './member-fixture.ts'

test('consumer email/password registration verifies email and grants an invitation without a purchase', async t => {
  const f = await memberFixture(t)
  const signup = await f.call('/api/member/auth/sign-up/email', { email: 'new@example.test', password: f.password, callbackURL: f.origin + '/account' })
  assert.equal(signup.status, 200, await signup.clone().text())
  assert.equal((await (await f.call('/api/member/session')).json()).member, null)
  const before = await f.call('/api/member/auth/sign-in/email', { email: 'new@example.test', password: f.password })
  assert.equal(before.status, 403)
  const link = f.sent[0].text.match(/https:\/\/\S+/)![0]
  const verified = await f.call(new URL(link).pathname + new URL(link).search)
  assert.equal(verified.status, 302, await verified.clone().text())
  const cookie = f.cookieOf(verified)
  const info = await (await f.call('/api/member/session', undefined, cookie)).json()
  assert.equal(info.member.email, 'new@example.test')
  assert.match(info.member.inviteUrl, /^https:\/\/general\.example\.test\/\?invite=[A-Z0-9]{32}$/)
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM orders').get()!.n, 0)
  assert.match(f.sent[0].subject, /通用商店/)
  assert(!f.sent[0].text.includes('shop.example.invalid'))
  const saved = f.db.prepare('SELECT password FROM member_s3_account').get()!.password
  assert(saved && saved !== f.password)
})

test('member cookie cannot authenticate on the academic store and membership is disabled by default', async t => {
  const f = await memberFixture(t), member = await f.identity('isolated@example.test')
  const academic = await (await f.call('/api/member/session', undefined, member.cookie, 'https://shop.example.invalid')).json()
  assert.equal(academic.enabled, false)
  assert.equal(academic.member, null)
  f.env.MEMBERSHIP_ENABLED = 'false'
  assert.equal((await (await f.call('/api/member/session', undefined, member.cookie)).json()).enabled, false)
  assert.equal((await f.call('/api/member/auth/sign-in/email', { email: 'isolated@example.test', password: f.password })).status, 404)
})

test('reset password uses Resend and revokes existing sessions', async t => {
  const f = await memberFixture(t), member = await f.register('reset@example.test')
  const response = await f.call('/api/member/auth/request-password-reset', { email: 'reset@example.test', redirectTo: f.origin + '/account' })
  assert.equal(response.status, 200, await response.clone().text())
  const link = new URL(f.sent.at(-1)!.text.match(/https:\/\/\S+/)![0])
  const redirected = await f.call(link.pathname + link.search)
  const destination = new URL(redirected.headers.get('location')!)
  const newPassword = f.password + '-changed'
  const reset = await f.call('/api/member/auth/reset-password', { token: destination.searchParams.get('token'), newPassword })
  assert.equal(reset.status, 200, await reset.clone().text())
  assert.equal((await (await f.call('/api/member/session', undefined, member.cookie)).json()).member, null)
  assert.equal((await f.call('/api/member/auth/sign-in/email', { email: 'reset@example.test', password: newPassword })).status, 200)
})
