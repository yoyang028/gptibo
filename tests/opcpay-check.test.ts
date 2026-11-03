import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { inspectOpcpay, inspectionExitCode } from '../scripts/opcpay-check.mjs'

const key = 'fixture-opcpay-secret-only'
function capabilities() {
  return {
    api_version: '1.1', provider_configured: true,
    capabilities: {
      purchase_entry: true, entitlement_query: true, consumption: true,
      purchase_request_query: true, purchase_request_list: true, consumption_list: true,
      webhooks: true, entitlement_monitoring: true, transaction_query: false,
      transaction_list: false, refund: false, refund_query: false, bills: false,
      automatic_renewal: false, consumption_reversal: false,
    },
  }
}
function product() {
  return {
    capability_status: 'ENABLED', product_name: 'Fixture product', billing_mode: 'QUANTITY',
    charging_options: [{
      sku_id: 'fixture-sku', display_name: 'Fixture count package', billing_mode: 'QUANTITY',
      price: '12.34', currency: 'CNY', quota_unit: 'COUNT', quota_amount: 17,
    }],
  }
}

test('missing API key makes no requests and reports no live verification', async t => {
  t.mock.method(globalThis, 'fetch', async () => { throw new Error('No request should be made') })
  for (const apiKey of ['', '   ']) {
    const report = await inspectOpcpay({ apiKey })
    assert.equal(report.configured, false)
    assert.equal(report.queried, false)
    assert.equal(report.missingTransactionCapabilities, null)
    assert.equal(report.storefrontCollectionEnabled, false)
    assert.equal(inspectionExitCode(report), 2)
  }
  assert.equal(fetch.mock.callCount(), 0)
})

test('SDK inspection only GETs capabilities and product using server credentials', async t => {
  const calls: string[] = []
  t.mock.method(globalThis, 'fetch', async (url: string, options: RequestInit) => {
    assert.ok(options.signal)
    assert.equal(options.method, 'GET')
    assert.equal(options.redirect, 'error')
    assert.equal(options.body, undefined)
    assert.equal((options.headers as Record<string, string>).Authorization, 'Bearer ' + key)
    const target = new URL(url)
    assert.equal(target.origin, 'https://ai6666.com')
    calls.push(target.pathname)
    return Response.json(target.pathname.endsWith('/capabilities') ? capabilities() : product())
  })
  const report = await inspectOpcpay({ apiKey: key })
  assert.deepEqual(calls.sort(), ['/opcpay/api/pay/v1/capabilities', '/opcpay/api/pay/v1/product'])
  assert.equal(report.readOnly, true)
  assert.equal(report.entitlementPurchaseAvailable, true)
  assert.equal(report.storefrontCollectionEnabled, false)
  assert.deepEqual(report.missingTransactionCapabilities, ['transaction_query', 'transaction_list', 'refund', 'refund_query', 'bills'])
  assert.deepEqual(report.product.options, [{ skuId: 'fixture-sku', name: 'Fixture count package', billingMode: 'QUANTITY', price: '12.34', currency: 'CNY', quotaUnit: 'COUNT', quotaAmount: 17 }])
  assert.equal(inspectionExitCode(report), 0)
})

test('upstream extra fields and exception bodies cannot leak credentials', async t => {
  t.mock.method(globalThis, 'fetch', async (url: string) => {
    if (url.endsWith('/capabilities')) return Response.json({ ...capabilities(), extra: key, limitations: [key] })
    return Response.json({ ...product(), product_name: key, extra: key, charging_options: [{ ...product().charging_options[0], display_name: 'Echo ' + key, extra: key }] })
  })
  const report = await inspectOpcpay({ apiKey: key })
  assert.equal(report.product.name, '[REDACTED]')
  assert.equal(report.product.options[0].name, 'Echo [REDACTED]')
  assert.ok(!JSON.stringify(report).includes(key))
  t.mock.method(globalThis, 'fetch', async () => Response.json({ error: key, error_code: 'INVALID_API_KEY', request_id: key }, { status: 401 }))
  const failed = await inspectOpcpay({ apiKey: key })
  assert.deepEqual(failed.checks.capabilities, { ok: false, code: 'INVALID_API_KEY', httpStatus: 401 })
  assert.equal(inspectionExitCode(failed), 1)
  assert.ok(!JSON.stringify(failed).includes(key))
})

test('partial failure preserves verified product but never assumes missing capabilities', async t => {
  t.mock.method(globalThis, 'fetch', async (url: string) => {
    if (url.endsWith('/capabilities')) throw new Error('Network details and ' + key)
    return Response.json(product())
  })
  const report = await inspectOpcpay({ apiKey: key })
  assert.equal(report.queried, true)
  assert.equal(report.capabilities, null)
  assert.equal(report.missingTransactionCapabilities, null)
  assert.equal(report.product.options[0].price, '12.34')
  assert.equal(report.entitlementPurchaseAvailable, false)
  assert.equal(inspectionExitCode(report), 1)
  assert.ok(!JSON.stringify(report).includes(key))
})

test('malformed capability flags and product structures fail closed', async t => {
  for (const invalid of [null, {}, { ...capabilities(), capabilities: { ...capabilities().capabilities, transaction_query: 'true' } }]) {
    t.mock.method(globalThis, 'fetch', async (url: string) => Response.json(url.endsWith('/capabilities') ? invalid : { capability_status: 'ENABLED', charging_options: [{}] }))
    const report = await inspectOpcpay({ apiKey: key })
    assert.equal(report.capabilities, null)
    assert.equal(report.product, null)
    assert.equal(report.entitlementPurchaseAvailable, false)
    assert.equal(report.storefrontCollectionEnabled, false)
    assert.equal(inspectionExitCode(report), 1)
  }
})

test('disabled products, empty catalogs and unconfigured provider do not offer purchases', async t => {
  for (const [caps, catalog] of [
    [capabilities(), { capability_status: 'NOT_CONFIGURED', charging_options: [] }],
    [capabilities(), { ...product(), charging_options: [] }],
    [{ ...capabilities(), provider_configured: false }, product()],
    [capabilities(), { ...product(), capability_status: 'DISABLED' }],
  ]) {
    t.mock.method(globalThis, 'fetch', async (url: string) => Response.json(url.endsWith('/capabilities') ? caps : catalog))
    const report = await inspectOpcpay({ apiKey: key })
    assert.equal(report.entitlementPurchaseAvailable, false)
    assert.equal(report.storefrontCollectionEnabled, false)
    assert.equal(inspectionExitCode(report), 0)
  }
})

test('even future capability flags cannot register an unimplemented storefront adapter', async t => {
  const caps = capabilities()
  for (const name of Object.keys(caps.capabilities)) caps.capabilities[name] = true
  t.mock.method(globalThis, 'fetch', async (url: string) => Response.json(url.endsWith('/capabilities') ? caps : product()))
  const report = await inspectOpcpay({ apiKey: key })
  assert.deepEqual(report.missingTransactionCapabilities, [])
  assert.equal(report.storefrontCollectionEnabled, false)
})

test('CLI missing-key result is structured, has no stack trace and exits 2', () => {
  const result = spawnSync(process.execPath, ['scripts/opcpay-check.mjs'], {
    cwd: new URL('..', import.meta.url), encoding: 'utf8', windowsHide: true,
    env: { ...process.env, opcpay_api_key: '' },
  })
  assert.equal(result.status, 2)
  assert.equal(result.stderr, '')
  const report = JSON.parse(result.stdout)
  assert.equal(report.configured, false)
  assert.equal(report.queried, false)
})
