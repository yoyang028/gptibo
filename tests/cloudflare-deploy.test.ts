import test from 'node:test'
import assert from 'node:assert/strict'
import { prepareConfig } from '../scripts/cloudflare/prepare.mjs'
import { inspectPreparation } from '../scripts/cloudflare/readiness.mjs'

test('Cloudflare deployment preparation keeps the original full stack, minute reconciliation and supplier writes closed', () => {
  const config = prepareConfig('shop.example.com')
  const result = inspectPreparation(config)
  assert.equal(result.offlineReady, true)
  assert.equal(result.cloudConfigurationReady, false)
  assert.equal(result.salesEnabled, false); assert.equal(result.remoteStateVerified, false)
  assert.equal(config.main, 'worker/index.ts')
  assert.equal(config.d1_databases[0].migrations_dir, 'migrations')
  assert.equal(config.vars.RECHARGE_NOTIFY_URL, 'https://shop.example.com/api/recharge/webhook')
  assert.equal('RECHARGE_CLIENT_SECRET' in config.vars, false)
  assert.equal(result.checks.filter(c => c.scope !== 'offline').every(c => !c.passed), true)
})

test('invalid domains and resource IDs cannot redirect a prepared shop or inject a wildcard route', () => {
  for (const domain of [undefined, '', 'https://shop.example.com', '*.example.com', 'shop.example.com/api', 'shop.example.com:443', 'Shop.example.com', 'shop.example.invalid', '127.0.0.1', 'shop..example.com', 'a-.example.com', 'shop.example.com\nother.example.com']) assert.throws(() => prepareConfig(domain))
  assert.throws(() => prepareConfig('shop.example.com', 'local-development-database'))
  assert.throws(() => prepareConfig('shop.example.com', undefined, 'not-an-account'))
})

test('offline readiness rejects accidental demo or real purchases, unsafe asset routing and missing reconciliation', () => {
  const changes = [
    c => { c.vars.ORDER_TESTING_ENABLED = 'true' },
    c => { c.vars.PAYMENT_TEST_ENABLED = 'true' },
    c => { c.vars.RECHARGE_CHECKOUT_ENABLED = 'true' },
    c => { c.vars.RECHARGE_READ_ONLY = 'false' },
    c => { c.vars.RECHARGE_COLLECTION_MODE = 'agent_collect' },
    c => { c.vars.RECHARGE_NOTIFY_URL = 'https://other.example.com/api/recharge/webhook' },
    c => { c.vars.RECHARGE_PRODUCT_MAP = '{"pro-5x":"other"}' },
    c => { c.assets.run_worker_first = [] },
    c => { c.triggers.crons = [] },
    c => { c.workers_dev = true },
    c => { c.ratelimits = [] },
  ]
  for (const change of changes) {
    const config = prepareConfig('shop.example.com'); change(config)
    assert.equal(inspectPreparation(config).offlineReady, false)
  }
})

test('filling local identifiers never claims that the Cloudflare account, mail or supplier state was remotely verified', () => {
  const config = prepareConfig('shop.example.com', crypto.randomUUID(), crypto.randomUUID().replaceAll('-', ''))
  const result = inspectPreparation(config, ['ADMIN_USERNAME'])
  assert.equal(result.offlineReady, true); assert.equal(result.cloudConfigurationReady, false)
  assert.equal(result.remoteStateVerified, false); assert.equal(result.salesEnabled, false)
  assert.equal(result.checks.find(c => c.name === 'production secret configured: ADMIN_USERNAME')?.passed, true)
  assert.equal(result.checks.find(c => c.name === 'production secret configured: RESEND_API_KEY')?.passed, false)
})
