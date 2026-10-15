// Run only with in-memory credentials. Never write keys, response bodies or
// partner identities to a bundle, log or result artifact.
import fs from 'node:fs'
import path from 'node:path'
import { build } from 'esbuild'
import { Miniflare, convertV4MiniflareOptions } from 'miniflare'
import { projectRoot } from './prepare.mjs'

const directory = path.join(projectRoot, 'artifacts/local/evidence/cloudflare-readonly')
fs.mkdirSync(directory, {recursive: true})
const base = new URL(process.env.RECHARGE_API_BASE)
if (base.protocol !== 'https:' || base.pathname !== '/v1' || base.search || base.hash || base.username || base.password) throw new Error('Invalid read-only target')
const bindings = Object.fromEntries(['RECHARGE_API_BASE', 'RECHARGE_PARTNER_ID', 'RECHARGE_KEY_ID', 'RECHARGE_CLIENT_SECRET'].map(name => {
  if (!process.env[name]) throw new Error('Missing in-memory supplier credential')
  return [name, process.env[name]]
}))
Object.assign(bindings, {RECHARGE_READ_ONLY: 'true', RECHARGE_CHECKOUT_ENABLED: 'true', RECHARGE_COLLECTION_MODE: 'platform_collect', RECHARGE_PRODUCT_MAP: '{"plus":"chatgpt_plus_cdk_1m"}', RECHARGE_WEBHOOK_SECRET: 'readonly_probe_never_a_business_webhook', RECHARGE_NOTIFY_URL: 'https://shop.example.invalid/api/recharge/webhook'})
const bundle = path.join(directory, 'readonly-worker.mjs')
await build({entryPoints: [path.join(projectRoot, 'scripts/cloudflare/probe-worker.ts')], bundle: true, format: 'esm', platform: 'browser', target: 'es2023', outfile: bundle, logLevel: 'silent'})
const nativeFetch = globalThis.fetch
const calls = []
const options = convertV4MiniflareOptions({
  modules: true, scriptPath: bundle, compatibilityDate: '2026-09-26', cf: false, bindings,
  outboundService: async request => {
    const url = new URL(request.url)
    if (url.origin !== base.origin || request.method !== 'GET' || url.search || !['/v1/agent-profile', '/v1/products', '/v1/payment-methods'].includes(url.pathname)) throw new Error('Read-only network boundary blocked request')
    calls.push({method: 'GET', path: url.pathname})
    return nativeFetch(url, {method: 'GET', headers: Object.fromEntries(request.headers), redirect: 'manual', signal: AbortSignal.timeout(10000)})
  },
})
const mf = new Miniflare({...options, telemetry: {enabled: false}, resourceTmpPath: path.join(directory, 'tmp')})
try {
  const response = await mf.dispatchFetch('https://readonly.example.invalid/')
  const result = await response.json()
  const proof = {...result, checkedAt: new Date().toISOString(), backend: 'actual-workerd', calls, supplierWrites: 0}
  fs.writeFileSync(path.join(directory, 'result.json'), JSON.stringify(proof, null, 2) + '\n')
  if (response.status !== 200 || !result.ok || calls.length !== 3) throw new Error('Read-only Worker validation failed; details are saved without keys')
  console.log(JSON.stringify({checks: result.checks.length, passed: true, signedQueries: calls.length, supplierWrites: 0, supplyPriceCents: result.supplyPriceCents}))
} finally { await mf.dispose() }
