import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import {accountEnvironment, cloudflareRead, selectDomainAccount, readScopes} from '../scripts/cloudflare/account.mjs'

test('Cloudflare account preflight isolates credentials and caches and requests only read scopes', () => {
  const root = path.resolve('artifacts/local/evidence/profile-fixture')
  const env = accountEnvironment({CLOUDFLARE_API_TOKEN: 'fixture', CF_API_TOKEN: 'fixture', CLOUDFLARE_API_KEY: 'fixture', CLOUDFLARE_ACCOUNT_ID: 'fixture', WRANGLER_AUTH_PROFILE: 'another-profile', CLOUDFLARE_API_BASE_URL: 'https://other.example.invalid', WRANGLER_API_BASE_URL: 'https://other.example.invalid'}, root)
  for (const name of ['CLOUDFLARE_API_TOKEN', 'CF_API_TOKEN', 'CLOUDFLARE_API_KEY', 'CLOUDFLARE_ACCOUNT_ID', 'WRANGLER_AUTH_PROFILE', 'CLOUDFLARE_API_BASE_URL', 'WRANGLER_API_BASE_URL']) assert.equal(name in env, false)
  for (const name of ['XDG_CONFIG_HOME', 'WRANGLER_LOG_PATH', 'TEMP', 'TMP']) assert(env[name].startsWith(root + path.sep))
  assert.equal(env.WRANGLER_SEND_METRICS, 'false')
  assert.equal(env.WRANGLER_WRITE_LOGS, 'false', 'auth token stdout must never be copied into Wrangler debug logs')
  assert.equal(env.WRANGLER_LOG_SANITIZE, 'true')
  assert.equal(env.CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV, 'false')
  assert.deepEqual(readScopes, ['account:read', 'user:read', 'zone:read'])
})

test('Cloudflare preflight only makes GET zone reads without following redirects', async () => {
  let calls = 0
  const fetcher = async (url, options) => {
    calls++
    assert.equal(new URL(url).origin, 'https://api.cloudflare.com')
    assert.equal(options.method, 'GET'); assert.equal(options.redirect, 'error')
    assert.equal(options.headers.Authorization, 'Bearer fixture')
    assert.equal('body' in options, false)
    return Response.json({success: true, result: []})
  }
  await cloudflareRead('/zones?name=example.com', 'fixture', fetcher)
  await cloudflareRead('/zones/' + 'a'.repeat(32) + '/dns_records?name=shop.example.com', 'fixture', fetcher)
  for (const route of ['/accounts', '/zones/../accounts', '/zones/' + 'a'.repeat(32), '/zones?name=example.com#fragment', 'https://other.example.invalid/zones', '//other.example.invalid/zones']) await assert.rejects(cloudflareRead(route, 'fixture', fetcher))
  assert.equal(calls, 2)
})

test('failed, redirected, malformed or paginated Cloudflare responses do not expose token or response details', async () => {
  for (const response of [new Response('sensitive fixture', {status: 403}), new Response(null, {status: 302, headers: {Location: 'https://other.example.invalid'}}), Response.json({success: false, errors: ['sensitive fixture'], result: []}), Response.json({success: true, result: [], result_info: {total_pages: 2}}), new Response('sensitive fixture')]) {
    await assert.rejects(cloudflareRead('/zones', 'fixture', async () => response), error => !String(error).includes('sensitive fixture') && !String(error).includes('Bearer'))
  }
})

test('only an unambiguous active zone belonging to an authenticated account can select the deployment account', () => {
  const account = 'a'.repeat(32), zone = {id: 'b'.repeat(32), name: 'example.com', status: 'active', account: {id: account}}
  const identity = {loggedIn: true, accounts: [{id: account}]}
  assert.deepEqual(selectDomainAccount('shop.example.com', identity, [zone, zone]), {verified: true, accountId: account, zoneId: zone.id, zoneName: zone.name})
  for (const candidate of [{...zone, status: 'pending'}, {...zone, name: 'other.example.com'}, {...zone, account: {id: 'c'.repeat(32)}}, {...zone, id: 'invalid'}]) assert.equal(selectDomainAccount('shop.example.com', identity, [candidate]).verified, false)
  assert.equal(selectDomainAccount('shop.example.com', {loggedIn: false, accounts: identity.accounts}, [zone]).verified, false)
  assert.equal(selectDomainAccount('shop.example.com', identity, [zone, {...zone, id: 'c'.repeat(32), name: 'shop.example.com'}]).reason, 'ambiguous-active-zones')
  assert.throws(() => selectDomainAccount('https://shop.example.com', identity, [zone]))
})
