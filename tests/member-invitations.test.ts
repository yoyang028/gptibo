import test from 'node:test'
import assert from 'node:assert/strict'
import { memberFixture } from './member-fixture.ts'

test('a member can customize once; concurrent attempts, collisions and retries keep the original identity', async t => {
  const f = await memberFixture(t), a = await f.identity('alias-a@example.test'), b = await f.identity('alias-b@example.test')
  const before = a.info.member.inviteCode, defaultUrl = a.info.member.inviteUrl
  for (const alias of ['ab','admin','bad/address','-invalid','中文名字']) assert.equal((await f.call('/api/member/invitation', { alias }, a.cookie)).status, 400)
  const chosen = await f.call('/api/member/invitation', { alias: ' My-Planet ' }, a.cookie)
  assert.equal(chosen.status, 200, await chosen.clone().text())
  assert.equal((await chosen.json()).inviteUrl, f.origin + '/ref/my-planet')
  assert.equal((await f.call('/api/member/invitation', { alias: 'MY-PLANET' }, a.cookie)).status, 200, 'An identical retry is idempotent')
  assert.equal((await f.call('/api/member/invitation', { alias: 'second-try' }, a.cookie)).status, 409)
  assert.equal((await f.call('/api/member/invitation', { alias: 'my-planet' }, b.cookie)).status, 409, 'A taken alias does not consume the other member’s chance')
  const concurrent = await Promise.all(['another-planet','star-friend'].map(alias => f.call('/api/member/invitation', { alias }, b.cookie)))
  assert.deepEqual(concurrent.map(r => r.status).sort(), [200,409])
  const info = await (await f.call('/api/member/session', undefined, a.cookie)).json()
  assert.equal(info.member.inviteCode, before)
  assert.equal(info.member.inviteCustomized, true)
  assert.equal(f.db.prepare("SELECT COUNT(*) n FROM member_operation_events WHERE category='invitation'").get()!.n, 2)
  for (const path of [new URL(defaultUrl).pathname, '/ref/my-planet', '/ref/MY-PLANET', '/i/my-planet', '/i/MY-PLANET', new URL(defaultUrl).pathname.replace('/ref/', '/i/')]) {
    const response = await f.call(path)
    assert.equal(response.status, 302)
    assert.equal(response.headers.get('Location'), '/')
    assert.match(response.headers.get('Set-Cookie')!, new RegExp('scholai_s3_invitation=' + before + ';'))
    assert.match(response.headers.get('Set-Cookie')!, /Secure/)
    assert.equal(response.headers.get('Cache-Control'), 'no-store')
  }
  assert.throws(() => f.db.prepare("UPDATE member_invite_aliases SET alias='overwrite' WHERE member_id=?").run(a.id), /permanent/)
  assert.throws(() => f.db.prepare('DELETE FROM member_invite_aliases WHERE member_id=?').run(a.id), /permanent/)
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM orders').get()!.n, 0)
})

test('short invitations enforce actual host, verified membership, frozen state and same-origin writes', async t => {
  const f = await memberFixture(t), a = await f.identity('alias-guard@example.test'), path = new URL(a.info.member.inviteUrl).pathname
  assert.equal((await f.call('/api/member/invitation', { alias: 'guest-alias' })).status, 401)
  const forged = new Request(f.origin + '/api/member/invitation', { method: 'POST', headers: { Cookie: a.cookie, Origin: 'https://foreign.example.test', 'Content-Type': 'application/json' }, body: JSON.stringify({ alias: 'forged-alias' }) })
  const { default: worker } = await import('../worker/index.ts')
  assert.equal((await worker.fetch(forged, f.env)).status, 403)
  assert.equal((await f.call(path, undefined, '', 'https://shop.example.invalid')).status, 404)
  assert.equal((await f.call('/ref/missing-alias')).status, 404)
  assert.equal((await f.call('/i/missing-alias')).status, 404)
  f.db.prepare('UPDATE member_profiles SET frozen=1 WHERE id=?').run(a.id)
  assert.equal((await f.call(path)).status, 404)
  assert.equal((await f.call('/api/member/invitation', { alias: 'frozen-alias' }, a.cookie)).status, 403)
  f.db.prepare('UPDATE member_profiles SET frozen=0 WHERE id=?').run(a.id)
  assert.equal((await f.call(path)).status, 302)
  f.env.MEMBERSHIP_ENABLED = 'false'
  assert.equal((await f.call(path)).status, 404)
})
