import test from 'node:test'
import assert from 'node:assert/strict'
import { memberFixture } from './member-fixture.ts'

async function fixture(t: Parameters<typeof memberFixture>[0]) {
  const f = await memberFixture(t)
  f.env.ASSETS = { fetch: async request => {
    assert.equal(new URL(request.url).pathname, '/')
    for (const name of ['If-None-Match', 'If-Modified-Since', 'Range', 'If-Range']) assert.equal(request.headers.get(name), null)
    return new Response('<!doctype html><html><head><title>Store</title></head><body><div id="root"></div></body></html>', { headers: { 'Content-Type': 'text/html; charset=utf-8', ETag: 'static-storefront', 'Content-Length': '100' } })
  } }
  return f
}

test('a member can customize once; concurrent attempts, collisions and retries keep the original identity', async t => {
  const f = await fixture(t), a = await f.identity('alias-a@example.test'), b = await f.identity('alias-b@example.test')
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
  for (const path of [new URL(defaultUrl).pathname, '/ref/my-planet', '/ref/my-planet/product/chatgpt', '/ref/my-planet/account', '/ref/my-planet/orders']) {
    const response = await f.call(path)
    assert.equal(response.status, 200)
    assert.equal(response.headers.get('Location'), null)
    assert.match(response.headers.get('Set-Cookie')!, new RegExp('scholai_s3_invitation=' + before + ';'))
    assert.match(response.headers.get('Set-Cookie')!, /Secure/)
    assert.equal(response.headers.get('Cache-Control'), 'no-store')
    assert.equal(response.headers.get('ETag'), null)
    assert.equal(response.headers.get('Content-Length'), null)
    assert.match(await response.text(), new RegExp('name="scholai-member-invitation" content="' + before + '"'))
  }
  for (const [path, target] of [['/ref/MY-PLANET', '/ref/my-planet'], ['/ref/my-planet/', '/ref/my-planet'], ['/i/my-planet', '/ref/my-planet'], ['/i/MY-PLANET/product/chatgpt?source=friend', '/ref/my-planet/product/chatgpt?source=friend'], [new URL(defaultUrl).pathname.replace('/ref/', '/i/'), new URL(defaultUrl).pathname]]) {
    const response = await f.call(path)
    assert.equal(response.status, 302)
    assert.equal(response.headers.get('Location'), target)
    assert.match(response.headers.get('Set-Cookie')!, new RegExp('scholai_s3_invitation=' + before + ';'))
    assert.equal((await f.call(target)).status, 200)
  }
  assert.throws(() => f.db.prepare("UPDATE member_invite_aliases SET alias='overwrite' WHERE member_id=?").run(a.id), /permanent/)
  assert.throws(() => f.db.prepare('DELETE FROM member_invite_aliases WHERE member_id=?').run(a.id), /permanent/)
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM orders').get()!.n, 0)
})

test('short invitations enforce actual host, verified membership, frozen state and same-origin writes', async t => {
  const f = await fixture(t), a = await f.identity('alias-guard@example.test'), path = new URL(a.info.member.inviteUrl).pathname
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
  assert.equal((await f.call(path)).status, 200)
  f.env.MEMBERSHIP_ENABLED = 'false'
  assert.equal((await f.call(path)).status, 404)
})

test('referral documents revalidate conditional requests and fail closed when the storefront asset is unavailable', async t => {
  const f = await fixture(t), a = await f.identity('alias-assets@example.test'), url = a.info.member.inviteUrl
  const { default: worker } = await import('../worker/index.ts')
  const response = await worker.fetch(new Request(url, { headers: { 'If-None-Match': 'static-storefront', 'If-Modified-Since': new Date().toUTCString(), Range: 'bytes=0-10', 'If-Range': 'static-storefront' } }), f.env)
  assert.equal(response.status, 200)
  assert.match(await response.text(), /scholai-member-invitation/)
  assert.equal((await f.call(new URL(url).pathname, {})).status, 405)
  f.env.ASSETS = { fetch: async () => new Response('unavailable', { status: 503 }) }
  const unavailable = await f.call(new URL(url).pathname)
  assert.equal(unavailable.status, 503)
  assert.equal(unavailable.headers.get('Set-Cookie'), null)
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM orders').get()!.n, 0)
})
