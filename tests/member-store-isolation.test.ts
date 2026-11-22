import assert from 'node:assert/strict'
import test from 'node:test'
import worker from '../worker/index.ts'
import { memberFixture } from './member-fixture.ts'
import { memberEnvironment } from '../worker/member-scope.ts'
import { checkRewardTarget, reconcileMemberRewards } from '../worker/member-rewards.ts'
import { enqueueMemberNotification } from '../worker/member-notifications.ts'

const academic = 'https://academic.example.test'

test('the same email and custom alias can exist separately, while passwords, sessions, links and legacy paths stay store-local', async t => {
  const f = await memberFixture(t)
  f.env.MEMBERSHIP_PLATFORM_HOST = new URL(academic).hostname
  const email = 'both-shops@example.test'
  const general = await f.register(email)
  const primaryPassword = 'Local-academic-password-123!'
  const primary = await f.register(email, academic, primaryPassword)
  assert.notEqual(general.id, primary.id)
  assert.match(general.cookie, /scholai_s3\.session_token=/)
  assert.match(primary.cookie, /scholai_platform\.session_token=/)
  assert.match(f.sent[0].subject, /^AI星球 · /)
  assert.notEqual(f.sent[0].subject, f.sent[1].subject)
  assert.equal((await (await f.call('/api/member/session', undefined, general.cookie, academic)).json()).member, null)
  assert.equal((await (await f.call('/api/member/session', undefined, primary.cookie)).json()).member, null)
  assert.equal((await f.call('/api/member/auth/sign-in/email', { email, password: f.password }, '', academic)).status, 401)
  assert.equal((await f.call('/api/member/auth/sign-in/email', { email, password: primaryPassword })).status, 401)
  assert.equal((await (await f.call('/api/catalog', undefined, '', academic)).json()).membershipEnabled, true)
  assert.equal((await (await f.call('/api/catalog?partner=store-3', undefined, '', academic)).json()).membershipEnabled, false)
  assert.equal((await (await f.call('/api/catalog', undefined, '', 'https://unbound.example.test')).json()).membershipEnabled, false)

  f.env.ASSETS = { fetch: async () => new Response('<html><head></head><body></body></html>', { headers: { 'Content-Type': 'text/html' } }) }
  assert.equal((await f.call(new URL(general.info.member.inviteUrl).pathname, undefined, '', academic)).status, 404)
  assert.equal((await f.call(new URL(primary.info.member.inviteUrl).pathname)).status, 404)
  for (const [origin, user, store] of [[f.origin, general, 'store-3'], [academic, primary, 'platform']] as const) {
    const saved = await f.call('/api/member/invitation', { alias: 'research-friends' }, user.cookie, origin)
    assert.equal(saved.status, 200)
    assert.equal((await saved.json()).inviteUrl, `${origin}/ref/research-friends`)
    const page = await f.call('/ref/research-friends/product/chatgpt', undefined, '', origin)
    assert.equal(page.status, 200)
    assert((await page.text()).includes(`content="${user.info.member.inviteCode}" data-alias="research-friends" data-store="${store}"`))
  }
  assert.notEqual(general.info.member.inviteCode, primary.info.member.inviteCode)
})

test('store-local purchases, rewards, holds, refunds, notifications and administrator statistics use the order’s own shop', async t => {
  const f = await memberFixture(t)
  f.env.MEMBERSHIP_PLATFORM_HOST = new URL(academic).hostname
  const primaryEnv = memberEnvironment(f.env, 'platform')
  const memberEmail = 'isolated-member@example.test', customerEmail = 'same-new-customer@example.test'
  const main = await f.register(memberEmail, academic), vip = await f.register(memberEmail)
  const upstream = f.enableSupplier()
  f.db.prepare("UPDATE catalog_plans SET price_cents=11800 WHERE id='plus'").run()
  const code = { platform: main.info.member.inviteCode as string, 'store-3': vip.info.member.inviteCode as string }
  const guest = { platform: await f.buyer(academic), 'store-3': await f.buyer() }
  async function quote(at: string, cookie: string, email: string, promotion: { inviteCode?: string; newcomer?: boolean; rewardCents?: number }) {
    const data = { plan: 'plus', email, promotion }
    const response = await f.call('/api/orders/promotion-quote', data, cookie, at)
    assert.equal(response.status, 200, await response.clone().text())
    return { data, value: await response.json() }
  }
  async function create(at: string, cookie: string, email: string, promotion: { inviteCode?: string; newcomer?: boolean; rewardCents?: number }) {
    const q = await quote(at, cookie, email, promotion)
    const response = await f.call('/api/orders', { ...q.data, expectedPrice: q.value.cashCents, key: crypto.randomUUID() }, cookie, at)
    assert.equal(response.status, 201, await response.clone().text())
    return (await response.json()).order
  }
  async function deliver(at: string, cookie: string, id: string) {
    const path = `/api/orders/${id}/fulfillment`
    assert.equal((await f.call(path, { action: 'query' }, cookie, at)).status, 200)
    const remote = [...upstream.remotes.values()].find(order => order.merchant_order_no === id)!
    remote.payment_status = 'paid'
    remote.fulfillment_status = 'succeeded'
    const credential = { mode: 'session' as const, session: JSON.stringify({ user: { email: 'same-recharge-account@example.test' } }) }
    await checkRewardTarget(f.env, id, credential)
    assert.equal((await f.call(path, { action: 'query' }, cookie, at)).status, 200)
  }
  const wrongInvite = await quote(academic, guest.platform, customerEmail, { inviteCode: code['store-3'] })
  assert.equal(wrongInvite.value.inviteValid, false)
  assert.equal(wrongInvite.value.newcomerEligible, false)
  assert.equal((await f.call('/api/orders/promotion-quote', { plan: 'plus', email: customerEmail, partner: 'store-3', promotion: {} }, guest.platform, academic)).status, 409)
  assert.equal((await f.call('/api/orders/promotion-quote', { plan: 'plus', email: customerEmail, promotion: { rewardCents: 1000 } }, vip.cookie, academic)).status, 403)

  const vipOrder = await create(f.origin, guest['store-3'], customerEmail, { inviteCode: code['store-3'], newcomer: true })
  await deliver(f.origin, guest['store-3'], vipOrder.id)
  const mainOrder = await create(academic, guest.platform, customerEmail, { inviteCode: code.platform, newcomer: true })
  await deliver(academic, guest.platform, mainOrder.id)
  assert.equal(vipOrder.price, 133)
  assert.equal(mainOrder.price, 113)
  assert.equal((await f.call(`/api/orders/${vipOrder.id}`, undefined, guest['store-3'], academic)).status, 404)
  assert.equal((await f.call(`/api/orders/${mainOrder.id}`, undefined, guest.platform)).status, 404)

  await reconcileMemberRewards(f.env)
  await reconcileMemberRewards(primaryEnv)
  for (const store of ['store-3', 'platform'] as const) {
    const scoped = memberEnvironment(f.env, store)
    await scoped.INTEREST_DB.prepare('UPDATE member_reward_grants SET eligible_at=?').bind(Date.now() - 1).run()
    await reconcileMemberRewards(scoped)
  }
  const primaryWallet = async () => (await (await f.call('/api/member/session', undefined, main.cookie, academic)).json())
  const vipWallet = async () => (await (await f.call('/api/member/session', undefined, vip.cookie)).json())
  assert.equal((await primaryWallet()).rewards[0].source_order_id, mainOrder.id)
  assert.equal((await vipWallet()).rewards[0].source_order_id, vipOrder.id)
  assert.equal((await primaryWallet()).balanceCents, 1000)
  assert.equal((await vipWallet()).balanceCents, 1000)

  const held = await create(academic, main.cookie, memberEmail, { rewardCents: 1000 })
  assert.equal(held.price, 108)
  assert.equal(held.promotion.procurementStatus, 'awaiting_supplier')
  assert.equal((await primaryWallet()).balanceCents, 0)
  assert.equal((await vipWallet()).balanceCents, 1000)
  assert.equal((await f.call(`/api/orders/${held.id}/fulfillment`, { action: 'query' }, main.cookie, academic)).status, 409)
  assert.equal(upstream.writes.filter(write => write.path === '/v1/orders').length, 2)
  assert.equal((await f.call(`/api/orders/${held.id}/promotion-cancel`, { version: held.version }, main.cookie, academic)).status, 200)
  assert.equal((await primaryWallet()).balanceCents, 1000)

  const alert = await enqueueMemberNotification(primaryEnv, 'scope-demo', 'review', held.id, null, '测试通知', '本地验收')
  assert(alert)
  const notification = f.db.prepare('SELECT mail_body FROM member_platform_notifications WHERE id=?').get(alert)!
  assert.match(String(notification.mail_body), /academic\.example\.test\/admin\?view=members&store=platform/)
  assert.equal(f.db.prepare('SELECT id FROM member_notifications WHERE id=?').get(alert), undefined)

  f.db.prepare('UPDATE orders SET refunded_cents=300 WHERE id=?').run(mainOrder.id)
  for (const [store, order, cents, refunds] of [['store-3', vipOrder, 13300, 0], ['platform', mainOrder, 11300, 300]] as const) {
    const report = await f.call(`/api/admin/member-ops/statistics?store=${store}`, undefined, f.admin, academic)
    assert.equal(report.status, 200, await report.clone().text())
    const stats = await report.json()
    assert.equal(stats.totals.orders, 1)
    assert.equal(stats.totals.paid_cents, cents)
    assert.equal(stats.totals.refunded_cents, refunds)
    assert.equal(stats.totals.delivered_orders, 1)
    const list = await (await f.call(`/api/admin/members?store=${store}&q=${encodeURIComponent(memberEmail)}`, undefined, f.admin)).json()
    assert.equal(list.stats.received_cents, cents)
    assert.equal(list.stats.net_received_cents, cents - refunds)
    assert.equal(list.rewards[0].source_order_id, order.id)
    assert.equal(list.stats.members, 1)
  }
  assert.equal((await f.call('/api/admin/member-ops/statistics?store=platform', undefined, main.cookie, academic)).status, 401)
  assert.equal((await f.call('/api/admin/member-ops/reconciliation?store=platform', { id: vipOrder.id, action: 'check' }, f.admin)).status, 409)
  const loyaltyView = f.db.prepare('SELECT total_cents FROM owner_customer_orders WHERE id=?').get(held.id)!
  assert.equal(loyaltyView.total_cents, 10800)

  // Pausing one enrollment switch keeps its saved orders protected.
  f.env.MEMBERSHIP_PLATFORM_ENABLED = 'false'
  assert.equal((await (await f.call('/api/member/session', undefined, main.cookie, academic)).json()).enabled, false)
  assert.equal((await vipWallet()).enabled, true)
  assert.equal((await worker.fetch(new Request(academic + `/api/orders/${held.id}`, { headers: { Cookie: main.cookie } }), f.env)).status, 200)
})
