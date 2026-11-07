import test from 'node:test'
import assert from 'node:assert/strict'
import { api } from '../src/lib/api.ts'
import { RECHARGE_INPUT_VERSION, RECHARGE_INPUT_VERSION_HEADER } from '../shared/recharge-input-version.ts'

test('supplier operations have time for chained calls while order reads stay bounded', async t => {
  const budgets: number[] = []
  t.mock.method(AbortSignal, 'timeout', (ms: number) => { budgets.push(ms); return new AbortController().signal })
  t.mock.method(globalThis, 'fetch', async () => Response.json({ ok: true }))
  await api('/api/orders', { key: 'original-order' })
  await api('/api/orders/original/fulfillment', { action: 'poll' })
  await api('/api/orders/original/fulfillment', { action: 'submit' })
  await api('/api/admin/refunds/original', { action: 'approve-submit-platform' })
  await api('/api/orders')
  await api('/api/catalog')
  assert.deepEqual(budgets, [50000, 50000, 50000, 50000, 15000, 15000])
})

test('closing the checkout still aborts a supplier operation before its timeout', async t => {
  const controller = new AbortController()
  t.mock.method(globalThis, 'fetch', async (_url: string, options: RequestInit) => {
    controller.abort()
    options.signal!.throwIfAborted()
  })
  await assert.rejects(api('/api/orders/original/fulfillment', { action: 'poll' }, controller.signal), { name: 'AbortError' })
})

test('only new recharge submissions identify the safe input parser to the server', async t => {
  const seen: (string | null)[] = []
  t.mock.method(globalThis, 'fetch', async (_url: string, options: RequestInit) => {
    seen.push(new Headers(options.headers).get(RECHARGE_INPUT_VERSION_HEADER))
    return Response.json({ ok: true })
  })
  await api('/api/orders/original/fulfillment', { action: 'submit' })
  await api('/api/orders/original/fulfillment', { action: 'poll' })
  await api('/api/orders', { plan: 'plus' })
  assert.deepEqual(seen, [RECHARGE_INPUT_VERSION, null, null])
})

test('a recharge input upgrade reloads the page once without replaying the submission', async t => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'window')
  let reloads = 0, requests = 0
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { location: { reload: () => { reloads++ } } } })
  t.after(() => { if (original) Object.defineProperty(globalThis, 'window', original); else Reflect.deleteProperty(globalThis, 'window') })
  t.mock.method(globalThis, 'fetch', async () => { requests++; return Response.json({ error: '请刷新整个网页，原订单和付款保留。' }, { status: 426 }) })
  await assert.rejects(api('/api/orders/original/fulfillment', { action: 'submit' }), /刷新整个网页/)
  assert.equal(requests, 1)
  assert.equal(reloads, 1)
})
