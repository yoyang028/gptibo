import test from 'node:test'
import assert from 'node:assert/strict'
import { memberFixture } from './member-fixture.ts'
import { createEmailVerificationToken } from 'better-auth/api'
import { memberAuth } from '../worker/member-auth.ts'

test('consumer email/password registration verifies email and grants an invitation without a purchase', async t => {
  const f = await memberFixture(t)
  const signup = await f.call('/api/member/auth/sign-up/email', { email: 'new@example.test', password: f.password, callbackURL: f.origin + '/account' })
  assert.equal(signup.status, 200, await signup.clone().text())
  assert.equal((await (await f.call('/api/member/session')).json()).member, null)
  const before = await f.call('/api/member/auth/sign-in/email', { email: 'new@example.test', password: f.password })
  assert.equal(before.status, 403)
  const otp = f.sent[0].text.match(/验证码：(\d{6})/)![1]
  const stored = f.db.prepare('SELECT value FROM member_s3_verification WHERE identifier=?').get('email-verification-otp-new@example.test')!.value as string
  assert(!stored.includes(otp), 'Only a keyed hash of the code is stored')
  const verified = await f.call('/api/member/auth/email-otp/verify-email', { email: 'new@example.test', otp })
  assert.equal(verified.status, 200, await verified.clone().text())
  const cookie = f.cookieOf(verified)
  const info = await (await f.call('/api/member/session', undefined, cookie)).json()
  assert.equal(info.member.email, 'new@example.test')
  assert.match(info.member.inviteUrl, /^https:\/\/general\.example\.test\/ref\/[a-z0-9]{10}$/)
  assert.match(info.member.inviteCode, /^[A-Z0-9]{32}$/)
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM orders').get()!.n, 0)
  assert.match(f.sent[0].subject, /AI星球/)
  assert.match(f.sent[0].from, /^"AI星球" </)
  assert(!f.sent[0].text.includes('https://'))
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
  const response = await f.call('/api/member/auth/email-otp/request-password-reset', { email: 'reset@example.test' })
  assert.equal(response.status, 200, await response.clone().text())
  const otp = f.sent.at(-1)!.text.match(/验证码：(\d{6})/)![1]
  const newPassword = f.password + '-changed'
  const reset = await f.call('/api/member/auth/email-otp/reset-password', { email: 'reset@example.test', otp, password: newPassword })
  assert.equal(reset.status, 200, await reset.clone().text())
  assert.equal((await (await f.call('/api/member/session', undefined, member.cookie)).json()).member, null)
  assert.equal((await f.call('/api/member/auth/sign-in/email', { email: 'reset@example.test', password: newPassword })).status, 200)
  assert.notEqual((await f.call('/api/member/auth/email-otp/reset-password', { email: 'reset@example.test', otp, password: f.password })).status, 200)
})

test('verification codes expire, are purpose bound, enforce attempts and never enable passwordless login', async t => {
  const f = await memberFixture(t), email = 'attempts@example.test'
  assert.equal((await f.call('/api/member/auth/sign-up/email', { email, password: f.password })).status, 200)
  const otp = f.sent[0].text.match(/验证码：(\d{6})/)![1]
  assert.notEqual((await f.call('/api/member/auth/email-otp/reset-password', { email, otp, password: f.password + '-new' })).status, 200)
  assert.equal((await f.call('/api/member/auth/sign-in/email-otp', { email, otp })).status, 404)
  assert.equal((await f.call('/api/member/auth/email-otp/send-verification-otp', { email, type: 'sign-in' })).status, 400)
  const wrong = otp === '000000' ? '000001' : '000000'
  for (let i = 0; i < 5; i++) assert.notEqual((await f.call('/api/member/auth/email-otp/verify-email', { email, otp: wrong })).status, 200)
  assert.notEqual((await f.call('/api/member/auth/email-otp/verify-email', { email, otp })).status, 200)
  assert.equal(f.db.prepare('SELECT emailVerified FROM member_s3_user WHERE email=?').get(email)!.emailVerified, 0)
})

test('resend cooldown preserves a valid code; successful verification cannot be replayed', async t => {
  const f = await memberFixture(t), email = 'cooldown@example.test'
  await f.call('/api/member/auth/sign-up/email', { email, password: f.password })
  const otp = f.sent[0].text.match(/验证码：(\d{6})/)![1]
  const resent = await f.call('/api/member/auth/email-otp/send-verification-otp', { email, type: 'email-verification' })
  assert.equal(resent.status, 429)
  assert.equal(f.sent.length, 1)
  const response = await f.call('/api/member/auth/email-otp/verify-email', { email, otp })
  assert.equal(response.status, 200, await response.clone().text())
  assert.notEqual((await f.call('/api/member/auth/email-otp/verify-email', { email, otp })).status, 200)
})

test('expired codes and unknown reset accounts do not authenticate or send unnecessary mail', async t => {
  const f = await memberFixture(t), email = 'expired@example.test'
  await f.call('/api/member/auth/sign-up/email', { email, password: f.password })
  const otp = f.sent[0].text.match(/验证码：(\d{6})/)![1]
  f.db.prepare('UPDATE member_s3_verification SET expiresAt=? WHERE identifier=?').run(new Date(Date.now() - 1000).toISOString(), 'email-verification-otp-' + email)
  assert.notEqual((await f.call('/api/member/auth/email-otp/verify-email', { email, otp })).status, 200)
  assert.equal((await f.call('/api/member/auth/email-otp/request-password-reset', { email: 'unknown@example.test' })).status, 200)
  assert.equal(f.sent.length, 1)
})

test('an email code can win only one concurrent verification request', async t => {
  const f = await memberFixture(t), email = 'race-code@example.test'
  await f.call('/api/member/auth/sign-up/email', { email, password: f.password })
  const otp = f.sent[0].text.match(/验证码：(\d{6})/)![1]
  const responses = await Promise.all([1,2].map(() => f.call('/api/member/auth/email-otp/verify-email', { email, otp })))
  assert.equal(responses.filter(r => r.status === 200).length, 1)
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM member_s3_session').get()!.n, 1)
})

test('already issued legacy verification and password-reset links remain usable without issuing new links', async t => {
  const f = await memberFixture(t), email = 'legacy-link@example.test'
  await f.call('/api/member/auth/sign-up/email', { email, password: f.password })
  const user = f.db.prepare('SELECT id FROM member_s3_user WHERE email=?').get(email)!
  const token = await createEmailVerificationToken(f.env.MEMBER_AUTH_SECRET!, email, undefined, 3600, { userId: user.id })
  const verification = await f.call('/api/member/auth/verify-email?token=' + token + '&callbackURL=' + encodeURIComponent(f.origin + '/account'))
  assert.equal(verification.status, 302, await verification.clone().text())
  const ctx = await memberAuth(f.env, f.origin).$context, resetToken = crypto.randomUUID()
  await ctx.internalAdapter.createVerificationValue({ identifier: 'reset-password:' + resetToken, value: String(user.id), expiresAt: new Date(Date.now() + 3600000) })
  const reset = await f.call('/api/member/auth/reset-password', { token: resetToken, newPassword: f.password + '-legacy' })
  assert.equal(reset.status, 200, await reset.clone().text())
  assert.equal((await f.call('/api/member/auth/sign-in/email', { email, password: f.password + '-legacy' })).status, 200)
  assert.equal((await f.call('/api/member/auth/request-password-reset', { email })).status, 409)
  assert.equal(f.sent.length, 1)
})
