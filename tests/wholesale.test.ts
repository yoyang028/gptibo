import test from 'node:test'
import assert from 'node:assert/strict'
import { customerFixture } from './customer-fixture.ts'
import worker from '../worker/index.ts'

async function fixture() {
  const f = await customerFixture()
  f.env.STOREFRONT_KIND = 'wholesale'
  f.env.WHOLESALE_PAYMENT_INSTRUCTIONS = 'LOCAL TEST ONLY — no real payments'
  const agent = await f.agent('Wholesale test agent')
  async function product(id = 'test-card', fulfillment = 'stock', price = 500) {
    const result = await f.request('/api/admin/wholesale/products', { id, name: 'Test product', description: 'Synthetic inventory', category: '测试', price_cents: price, fulfillment, active: true, version: null }, f.admin)
    assert.equal(result.status, 200, await result.text())
  }
  async function topup(amount = 10000, cookie = agent.cookie, key = crypto.randomUUID()) {
    const result = await f.request('/api/wholesale/topups', { amount_cents: amount, payment_reference: 'synthetic-reference', request_key: key }, cookie)
    assert.equal(result.status, 200)
    return (await result.json() as any).topup
  }
  async function approve(id: string, amount: number, receipt = crypto.randomUUID()) {
    return f.request('/api/admin/wholesale/topups/' + id, { status: 'approved', confirmed_amount_cents: amount, receipt, note: 'Synthetic payment verified in test' }, f.admin)
  }
  async function fund(amount = 10000, cookie = agent.cookie) {
    const t = await topup(amount, cookie)
    const r = await approve(t.id, amount)
    assert.equal(r.status, 200, await r.text())
  }
  const buy = (key = crypto.randomUUID(), quantity = 1, productId = 'test-card', cookie = agent.cookie, max = 500) => f.request('/api/wholesale/orders', { product_id: productId, quantity, max_unit_price_cents: max, request_key: key }, cookie)
  const balance = (id = agent.id) => (f.db.prepare('SELECT balance_cents FROM wholesale_wallets WHERE partner_id=?').get(id) as any)?.balance_cents ?? 0
  const stock = (items: string[], id = 'test-card') => f.request('/api/admin/wholesale/products/' + id + '/stock', { items }, f.admin)
  return { ...f, createAgent: f.agent, agent, product, topup, approve, fund, buy, balance, stock }
}

test('wholesale is deployment-gated, and prices and administration require identity', async () => {
  const f = await fixture()
  try {
    assert.equal((await f.request('/api/wholesale/products')).status, 401)
    assert.equal((await f.request('/api/admin/wholesale/products', undefined, f.agent.cookie)).status, 401)
    assert.equal((await f.request('/api/catalog')).status, 404)
    assert.equal((await f.request('/api/orders', {})).status, 404)
    assert.equal((await f.request('/api/catalog?identity=1')).status, 200)
    f.env.STOREFRONT_KIND = 'general'
    assert.equal((await f.request('/api/wholesale/account', undefined, f.agent.cookie)).status, 404)
  } finally { f.db.close() }
})
test('admin can onboard agents, inspect their balance, and disable all existing access without deleting money', async () => {
  const f = await fixture()
  try {
    const response = await f.request('/api/admin/wholesale/accounts', { name: 'New wholesale agent', email: 'new-agent@example.invalid' }, f.admin)
    assert.equal(response.status, 201)
    assert.equal((await f.request('/api/admin/wholesale/accounts', { name: 'Duplicate', email: 'new-agent@example.invalid' }, f.admin)).status, 409)
    await f.fund(5000)
    const list = await (await f.request('/api/admin/wholesale/accounts', undefined, f.admin)).json() as any
    const account = list.accounts.find((a: any) => a.id === f.agent.id)
    assert.equal(account.balance_cents, 5000)
    assert.equal((await f.request('/api/admin/wholesale/accounts/' + account.id, { active: false, version: account.version }, f.admin)).status, 200)
    assert.equal((await f.request('/api/wholesale/account', undefined, f.agent.cookie)).status, 401)
    assert.equal(f.balance(), 5000)
    const ledger = await (await f.request('/api/admin/wholesale/accounts/' + account.id + '/ledger', undefined, f.admin)).json() as any
    assert.equal(ledger.ledger[0].amount_cents, 5000)
  } finally { f.db.close() }
})
test('product updates use versions, stale quotes cannot debit, and inventory delivery modes cannot change', async () => {
  const f = await fixture()
  try {
    await f.product(); await f.stock(['SYNTHETIC-IMMUTABLE-MODE'])
    const input = { id: 'test-card', name: 'Updated name', category: '数字商品', description: '', price_cents: 600, fulfillment: 'stock', active: true, version: 0 }
    assert.equal((await f.request('/api/admin/wholesale/products', input, f.admin)).status, 200)
    assert.equal((await f.request('/api/admin/wholesale/products', input, f.admin)).status, 409)
    assert.equal((await f.request('/api/admin/wholesale/products', { ...input, version: 1, fulfillment: 'manual' }, f.admin)).status, 409)
    await f.fund()
    assert.equal((await f.buy()).status, 409)
    assert.equal(f.balance(), 10000)
    assert.equal((f.db.prepare("SELECT COUNT(*) n FROM admin_audit WHERE action='wholesale-product'").get() as any).n, 2)
  } finally { f.db.close() }
})
test('top-up declaration never credits money; verification enforces amount, unique receipt and single credit', async () => {
  const f = await fixture()
  try {
    const t = await f.topup(10000)
    assert.equal(f.balance(), 0)
    assert.equal((await f.approve(t.id, 9999)).status, 409)
    const results = await Promise.all([f.approve(t.id, 10000, 'BANK-TEST-123'), f.approve(t.id, 10000, 'BANK-TEST-123')])
    assert.ok(results.some(r => r.status === 200))
    assert.equal(f.balance(), 10000)
    assert.equal((f.db.prepare("SELECT COUNT(*) n FROM wholesale_ledger WHERE kind='topup'").get() as any).n, 1)
    const second = await f.topup(10000)
    assert.equal((await f.approve(second.id, 10000, 'bank-test-123')).status, 409)
    assert.equal(f.balance(), 10000)
    assert.equal((f.db.prepare('SELECT status FROM wholesale_topups WHERE id=?').get(second.id) as any).status, 'pending')
  } finally { f.db.close() }
})
test('rejected and unconfigured top-ups cannot add funds; idempotency binds the original amount', async () => {
  const f = await fixture()
  try {
    const key = crypto.randomUUID(), t = await f.topup(1000, f.agent.cookie, key)
    const duplicate = await f.topup(1000, f.agent.cookie, key)
    assert.equal(duplicate.id, t.id)
    const changed = await f.request('/api/wholesale/topups', { amount_cents: 5000, payment_reference: 'synthetic-reference', request_key: key }, f.agent.cookie)
    assert.equal(changed.status, 409)
    assert.equal((await f.request('/api/admin/wholesale/topups/' + t.id, { status: 'rejected', note: 'Not received' }, f.admin)).status, 200)
    assert.equal((await f.approve(t.id, 1000)).status, 409)
    assert.equal(f.balance(), 0)
    f.env.WHOLESALE_PAYMENT_INSTRUCTIONS = ''
    assert.equal((await f.request('/api/wholesale/topups', { amount_cents: 1000, payment_reference: 'test', request_key: crypto.randomUUID() }, f.agent.cookie)).status, 409)
  } finally { f.db.close() }
})
test('concurrent identical purchases reserve one card and debit once; changed retries are rejected', async () => {
  const f = await fixture()
  try {
    await f.product(); await f.fund(); assert.equal((await f.stock(['SYNTHETIC-CARD-1', 'SYNTHETIC-CARD-2'])).status, 200)
    const key = crypto.randomUUID()
    const responses = await Promise.all([f.buy(key), f.buy(key), f.buy(key)])
    const orders = await Promise.all(responses.map(async r => { assert.ok([200, 201].includes(r.status), await r.clone().text()); return (await r.json() as any).order }))
    assert.equal(new Set(orders.map(o => o.id)).size, 1)
    assert.equal(orders[0].status, 'fulfilled'); assert.equal(orders[0].delivery.length, 1)
    assert.match(orders[0].delivery[0], /^SYNTHETIC-CARD-/)
    assert.equal(f.balance(), 9500)
    assert.equal((await f.buy(key, 2)).status, 409)
    assert.equal((f.db.prepare('SELECT COUNT(*) n FROM wholesale_ledger').get() as any).n, 2)
    const stored = f.db.prepare('SELECT * FROM wholesale_stock').all()
    assert.ok(!JSON.stringify(stored).includes('SYNTHETIC-CARD-'))
  } finally { f.db.close() }
})
test('concurrent stock exhaustion rolls back losing debits; stock cannot be reused or partially imported', async () => {
  const f = await fixture()
  try {
    await f.product(); await f.fund(); await f.stock(['ONE-SYNTHETIC-CARD'])
    const responses = await Promise.all([f.buy(), f.buy()])
    assert.deepEqual(responses.map(r => r.status).sort(), [201, 409])
    assert.equal(f.balance(), 9500)
    assert.equal((await f.stock(['NEW-SYNTHETIC-CARD', 'ONE-SYNTHETIC-CARD'])).status, 409)
    assert.equal((f.db.prepare('SELECT COUNT(*) n FROM wholesale_stock').get() as any).n, 1)
  } finally { f.db.close() }
})
test('concurrent wallet exhaustion never produces a negative balance or takes unpaid stock', async () => {
  const f = await fixture()
  try {
    await f.product(); await f.fund(500); await f.stock(['SYNTHETIC-A', 'SYNTHETIC-B'])
    const responses = await Promise.all([f.buy(), f.buy()])
    assert.deepEqual(responses.map(r => r.status).sort(), [201, 409])
    assert.equal(f.balance(), 0)
    assert.equal((f.db.prepare('SELECT COUNT(*) n FROM wholesale_stock WHERE order_id IS NULL').get() as any).n, 1)
  } finally { f.db.close() }
})
test('price ceiling, quantities and inactive products are enforced by the server', async () => {
  const f = await fixture()
  try {
    await f.product(); await f.fund(); await f.stock(['SYNTHETIC-CARD'])
    assert.equal((await f.buy(crypto.randomUUID(), 1, 'test-card', f.agent.cookie, 499)).status, 409)
    for (const q of [0, -1, 1.5, 101]) assert.equal((await f.buy(crypto.randomUUID(), q)).status, 400)
    f.db.prepare('UPDATE wholesale_products SET active=0 WHERE id=?').run('test-card')
    assert.equal((await f.buy()).status, 404)
    assert.equal(f.balance(), 10000)
  } finally { f.db.close() }
})
test('manual fulfillment is private; repeated full refunds credit once and never recycle stock', async () => {
  const f = await fixture()
  try {
    await f.product('test-manual', 'manual'); await f.product(); await f.fund(); await f.stock(['SYNTHETIC-RETIRED'])
    const manual = (await (await f.buy(crypto.randomUUID(), 1, 'test-manual')).json() as any).order
    assert.equal(manual.status, 'pending'); assert.deepEqual(manual.delivery, [])
    assert.equal((await f.request('/api/admin/wholesale/orders/' + manual.id + '/fulfill', { note: 'Delivered', delivery: 'SYNTHETIC-DELIVERY' }, f.admin)).status, 200)
    const secondAgent = await f.createAgent('Other agent')
    assert.equal((await f.request('/api/wholesale/orders/' + manual.id, undefined, secondAgent.cookie)).status, 404)
    const order = (await (await f.buy()).json() as any).order
    const refund = () => f.request('/api/admin/wholesale/orders/' + order.id + '/refund', { note: 'Approved refund' }, f.admin)
    await Promise.all([refund(), refund()])
    assert.equal(f.balance(), 9500)
    assert.equal((f.db.prepare("SELECT COUNT(*) n FROM wholesale_ledger WHERE kind='refund'").get() as any).n, 1)
    assert.equal((f.db.prepare('SELECT COUNT(*) n FROM wholesale_stock WHERE order_id IS NULL').get() as any).n, 0)
    const view = await (await f.request('/api/wholesale/orders/' + order.id, undefined, f.agent.cookie)).json() as any
    assert.deepEqual(view.order.delivery, [])
    assert.throws(() => f.db.exec('DELETE FROM wholesale_ledger'), /immutable/)
  } finally { f.db.close() }
})
test('API keys are one-time secrets, account-scoped, revocable and cannot credit funds or mint keys', async () => {
  const f = await fixture()
  try {
    await f.product('test-manual', 'manual'); await f.fund()
    const issued = await (await f.request('/api/wholesale/keys', { name: 'Integration test' }, f.agent.cookie)).json() as any
    assert.match(issued.token, /^ws_[a-f0-9]{64}$/)
    const keys = await (await f.request('/api/wholesale/keys', undefined, f.agent.cookie)).text()
    assert.ok(!keys.includes(issued.token))
    assert.ok(!JSON.stringify(f.db.prepare('SELECT * FROM wholesale_api_keys').all()).includes(issued.token))
    const api = (path: string, data?: unknown, origin?: string) => worker.fetch(new Request('https://shop.example.invalid/api/wholesale' + path, { method: data === undefined ? 'GET' : 'POST', headers: { Authorization: 'Bearer ' + issued.token, 'Content-Type': 'application/json', ...(origin ? { Origin: origin } : {}) }, body: data === undefined ? undefined : JSON.stringify(data) }), f.env)
    assert.equal((await api('/account')).status, 200)
    assert.equal((await api('/keys', { name: 'forbidden' })).status, 403)
    assert.equal((await api('/topups', {})).status, 403)
    const key = crypto.randomUUID(), data = { request_key: key, product_id: 'test-manual', quantity: 1, max_unit_price_cents: 500 }
    assert.equal((await api('/orders', data, 'https://attacker.example')).status, 403)
    assert.equal((await api('/orders', data)).status, 201)
    assert.equal((await api('/orders', data)).status, 200)
    assert.equal((await api('/orders?request_key=' + key)).status, 200)
    assert.equal(f.balance(), 9500)
    assert.equal((await f.request('/api/wholesale/keys/' + issued.id + '/revoke', {}, f.agent.cookie)).status, 200)
    assert.equal((await api('/account')).status, 401)
  } finally { f.db.close() }
})
test('session CSRF, disabled accounts, key expiry and rotated credentials are rejected', async () => {
  const f = await fixture()
  try {
    assert.equal((await f.request('/api/wholesale/keys', { name: 'bad' }, f.agent.cookie, 'https://attacker.example')).status, 403)
    const issued = await (await f.request('/api/wholesale/keys', { name: 'Expiry test' }, f.agent.cookie)).json() as any
    const auth = () => worker.fetch(new Request('https://shop.example.invalid/api/wholesale/account', { headers: { Authorization: 'Bearer ' + issued.token } }), f.env)
    f.db.prepare('UPDATE wholesale_api_keys SET expires_at=1 WHERE id=?').run(issued.id)
    assert.equal((await auth()).status, 401)
    f.db.prepare('UPDATE wholesale_api_keys SET expires_at=? WHERE id=?').run(Date.now() + 100000, issued.id)
    f.db.prepare('UPDATE partners SET active=0 WHERE id=?').run(f.agent.id)
    assert.equal((await auth()).status, 401)
    assert.equal((await f.request('/api/wholesale/products', undefined, f.agent.cookie)).status, 401)
    f.db.prepare('UPDATE partners SET active=1,auth_version=auth_version+1 WHERE id=?').run(f.agent.id)
    assert.equal((await auth()).status, 401)
  } finally { f.db.close() }
})
