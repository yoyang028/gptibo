// Local-only upstream fixture. This module never forwards a request to a network.
import { createHash, createHmac } from 'node:crypto'
export const xiaojiuFixtureKey = 'd'.repeat(64)
export const xiaojiuFixtureSecret = 'e'.repeat(128)
export function createXiaojiuFixture() {
  const orders = new Map(),
    nonces = new Set()
  let requests = 0,
    debits = 0
  const product = {
    id: 10,
    title: { 'zh-CN': '本机小久测试卡' },
    is_active: true,
    fulfillment_type: 'auto',
    skus: [
      {
        id: 123,
        sku_code: 'LOCAL-CARD',
        price_amount: '2.00',
        is_active: true,
        stock_status: 'in_stock',
        stock_quantity: 100,
      },
    ],
  }
  return {
    stats: () => ({ requests, debits }),
    async fetch(request) {
      requests++
      const url = new URL(request.url),
        raw = await request.text(),
        h = request.headers
      if (url.origin !== 'https://98-xj.com')
        throw new Error('Fixture origin rejected')
      const nonce = h.get('Dujiao-Next-Nonce')
      const canonical = [
        request.method,
        url.pathname,
        h.get('Dujiao-Next-Timestamp'),
        nonce,
        createHash('sha256').update(raw).digest('hex'),
      ].join('\n')
      if (
        h.get('Dujiao-Next-Api-Key') !== xiaojiuFixtureKey ||
        !nonce ||
        nonces.has(nonce) ||
        h.get('Dujiao-Next-Signature') !==
          createHmac('sha256', xiaojiuFixtureSecret)
            .update(canonical)
            .digest('hex')
      )
        return Response.json(
          { ok: false, error_code: 'authentication_failed' },
          { status: 401 },
        )
      nonces.add(nonce)
      if (
        request.method === 'POST' &&
        url.pathname === '/api/v1/upstream/ping' &&
        raw === ''
      )
        return Response.json({
          ok: true,
          user_id: 1,
          balance: '100.00',
          currency: 'CNY',
        })
      if (
        request.method === 'GET' &&
        url.pathname === '/api/v1/upstream/products'
      )
        return Response.json({
          ok: true,
          items: [product],
          page: 1,
          page_size: 50,
          total: 1,
        })
      if (
        request.method === 'GET' &&
        url.pathname === '/api/v1/upstream/products/10'
      )
        return Response.json({ ok: true, product })
      if (
        request.method === 'POST' &&
        url.pathname === '/api/v1/upstream/orders'
      ) {
        const input = JSON.parse(raw)
        if (
          input.sku_id !== 123 ||
          input.quantity !== 1 ||
          input.payment_mode !== 'wallet' ||
          typeof input.downstream_order_no !== 'string'
        )
          return Response.json(
            { ok: false, error_code: 'invalid_request' },
            { status: 400 },
          )
        if (!orders.has(input.downstream_order_no)) {
          debits++
          orders.set(input.downstream_order_no, {
            order_id: 8000 + debits,
            downstream_order_no: input.downstream_order_no,
          })
        }
        return Response.json({
          ok: true,
          ...orders.get(input.downstream_order_no),
          amount: '2.00',
          currency: 'CNY',
          status: 'completed',
        })
      }
      const remote = [...orders.values()].find(
        (order) => url.pathname === '/api/v1/upstream/orders/' + order.order_id,
      )
      if (request.method === 'GET' && remote)
        return Response.json({
          ok: true,
          ...remote,
          amount: '2.00',
          refunded_amount: '0.00',
          currency: 'CNY',
          status: 'completed',
          items: [
            {
              product_id: 10,
              sku_id: 123,
              quantity: 1,
              unit_price: '2.00',
              total_price: '2.00',
              fulfillment_type: 'auto',
            },
          ],
          fulfillment: {
            type: 'auto',
            status: 'delivered',
            payload: 'XIAOJIU-LOCAL-FIXTURE-CARD',
          },
        })
      return Response.json(
        { ok: false, error_code: 'order_not_found' },
        { status: 404 },
      )
    },
  }
}
