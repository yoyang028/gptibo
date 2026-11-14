import test from 'node:test'
import assert from 'node:assert/strict'
import { operationsFixture } from './member-operations-fixture.ts'
import { collectMemberNotifications, maintainMemberNotifications, sendMemberNotification, retryMemberNotification, NOTIFICATION_RETRY_WINDOW } from '../worker/member-notifications.ts'

test('notification collector deduplicates reward and administrator events, exposes only the member own feed, and logs provider acceptance', async t => {
  const f = await operationsFixture(t); await f.earn(1)
  const other = await f.identity('other@example.test'), o = await f.create()
  f.db.prepare("UPDATE member_order_promotions SET review_status='required' WHERE order_id=?").run(o.id)
  const delivered = await f.create()
  f.db.prepare("UPDATE orders SET status='failed',created_at=? WHERE id=?").run(Date.now() - 2 * 86400000, delivered.id)
  const g = f.db.prepare('SELECT id FROM member_reward_grants').get()!
  f.db.prepare('UPDATE member_reward_grants SET expires_at=? WHERE id=?').run(Date.now() + 2 * 86400000, g.id)
  await Promise.all([collectMemberNotifications(f.env), collectMemberNotifications(f.env)])
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM member_notifications').get()!.n, 4)
  assert.equal((await (await f.call('/api/member/session', undefined, other.cookie)).json()).notifications.length, 0)
  assert.equal((await (await f.call('/api/member/session', undefined, f.member.cookie)).json()).notifications.length, 2)
  const sends: { body: string; key: string }[] = []
  t.mock.method(globalThis, 'fetch', async (u: string, options: RequestInit) => {
    assert.equal(u, 'https://api.resend.com/emails'); sends.push({ body: String(options.body), key: new Headers(options.headers).get('Idempotency-Key')! })
    return Response.json({ id: 'provider_' + sends.length })
  })
  await Promise.all([maintainMemberNotifications(f.env), maintainMemberNotifications(f.env)])
  assert.equal(sends.length, 4); assert.equal(new Set(sends.map(s => s.key)).size, 4)
  assert.equal(f.db.prepare("SELECT COUNT(*) n FROM member_notifications WHERE status='sent'").get()!.n, 4)
  assert.throws(() => f.db.exec("UPDATE member_notifications SET mail_body='{}'"), /immutable/)
  const adminList = await f.call('/api/admin/member-ops/notifications', undefined, f.admin)
  assert.equal(adminList.status, 200)
  assert.equal((await f.call('/api/admin/member-ops/notifications')).status, 401)
})

test('uncertain sends replay original immutable payload and key within the window; expired ambiguity is held for manual confirmation', async t => {
  const f = await operationsFixture(t), o = await f.create(), held = await f.create()
  f.db.prepare("UPDATE member_order_promotions SET review_status='required' WHERE order_id=?").run(o.id)
  await collectMemberNotifications(f.env)
  const n = f.db.prepare('SELECT * FROM member_notifications').get()!, attempts: { body: string; key: string }[] = []
  t.mock.method(globalThis, 'fetch', async (_u: string, options: RequestInit) => { attempts.push({ body: String(options.body), key: new Headers(options.headers).get('Idempotency-Key')! }); if (attempts.length === 1) throw Error('accepted but response lost'); return Response.json({ id: 'provider_original' }) })
  await sendMemberNotification(f.env, String(n.id))
  assert.equal(f.db.prepare('SELECT status FROM member_notifications').get()!.status, 'retry')
  f.env.RESEND_FROM = 'Changed <changed@example.invalid>'
  f.db.exec('UPDATE member_notifications SET next_attempt_at=0')
  await sendMemberNotification(f.env, String(n.id))
  assert.deepEqual(attempts[0], attempts[1])
  assert.equal(f.db.prepare('SELECT provider_id FROM member_notifications').get()!.provider_id, 'provider_original')
  // Separate unresolved send older than Resend's safety window is never resent.
  f.db.prepare("UPDATE member_order_promotions SET review_status='required' WHERE order_id=?").run(held.id)
  await collectMemberNotifications(f.env)
  const old = f.db.prepare("SELECT * FROM member_notifications WHERE status='pending'").get()!
  f.db.prepare("UPDATE member_notifications SET status='retry',first_attempt_at=?,attempts=1 WHERE id=?").run(Date.now() - NOTIFICATION_RETRY_WINDOW - 1, old.id)
  await maintainMemberNotifications(f.env)
  assert.equal(attempts.length, 2)
  const stale = f.db.prepare('SELECT * FROM member_notifications WHERE id=?').get(old.id)!
  assert.equal(stale.status, 'unknown')
  await assert.rejects(retryMemberNotification(f.env, String(old.id), Number(stale.version), '核对原通知'), /安全重试/)
  await retryMemberNotification(f.env, String(old.id), Number(stale.version), '在邮件服务后台核实原邮件已被接收', true)
  assert.equal(f.db.prepare('SELECT status FROM member_notifications WHERE id=?').get(old.id)!.status, 'sent')
  assert.equal(attempts.length, 2)
})

test('resolved items are cancelled before first send; permanent provider failures remain reviewable and retries are versioned', async t => {
  const f = await operationsFixture(t), o = await f.create()
  f.db.prepare("UPDATE member_order_promotions SET review_status='required' WHERE order_id=?").run(o.id)
  await collectMemberNotifications(f.env)
  const n = f.db.prepare('SELECT * FROM member_notifications').get()!
  await assert.rejects(retryMemberNotification(f.env, String(n.id), Number(n.version), '不能虚构发送', true), /尚未尝试/)
  f.db.prepare("UPDATE member_order_promotions SET review_status='approved' WHERE order_id=?").run(o.id)
  t.mock.method(globalThis, 'fetch', async () => { throw Error('must not send resolved item') })
  await sendMemberNotification(f.env, String(n.id))
  assert.equal(f.db.prepare('SELECT status FROM member_notifications').get()!.status, 'cancelled')
  f.db.prepare("UPDATE member_order_promotions SET review_status='required' WHERE order_id=?").run(o.id)
  // A new order is a new event, not a resend with altered payload.
  t.mock.reset()
  const next = await f.create()
  f.db.prepare("UPDATE member_order_promotions SET review_status='required' WHERE order_id=?").run(next.id)
  await collectMemberNotifications(f.env)
  const pending = f.db.prepare("SELECT * FROM member_notifications WHERE status='pending'").get()!
  t.mock.method(globalThis, 'fetch', async () => new Response('{}', { status: 422 }))
  await sendMemberNotification(f.env, String(pending.id))
  const failed = f.db.prepare('SELECT * FROM member_notifications WHERE id=?').get(pending.id)!
  assert.equal(failed.status, 'failed')
  await retryMemberNotification(f.env, String(failed.id), Number(failed.version), '配置已更正，重试原通知')
  await assert.rejects(retryMemberNotification(f.env, String(failed.id), Number(failed.version), '过期操作'), /状态已变化/)
})
