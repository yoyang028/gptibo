// Read-only Cloudflare account/zone preflight. Authentication is kept in the
// project's ignored D-drive profile; tokens never enter logs or result files.
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import {spawnSync} from 'node:child_process'
import {fileURLToPath} from 'node:url'
import {projectRoot, prepareConfig, writePreparation} from './prepare.mjs'
import {inspectPreparation} from './readiness.mjs'

const directory = path.join(projectRoot, 'artifacts/cloudflare/account')
export const readScopes = ['account:read', 'user:read', 'zone:read']
export function accountEnvironment(base, root) {
  const env = {...base, XDG_CONFIG_HOME: path.join(root, 'artifacts/cloudflare/account/config'), WRANGLER_LOG_PATH: path.join(root, 'artifacts/cloudflare/account/logs/wrangler.log'), WRANGLER_LOG: 'log', WRANGLER_WRITE_LOGS: 'false', WRANGLER_LOG_SANITIZE: 'true', WRANGLER_SEND_METRICS: 'false', WRANGLER_SEND_ERROR_REPORTS: 'false', CLOUDFLARE_AUTH_USE_KEYRING: 'false', CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV: 'false', TEMP: path.join(root, 'artifacts/cloudflare/account/tmp'), TMP: path.join(root, 'artifacts/cloudflare/account/tmp')}
  for (const name of ['CLOUDFLARE_API_TOKEN', 'CF_API_TOKEN', 'CLOUDFLARE_API_KEY', 'CF_API_KEY', 'CLOUDFLARE_EMAIL', 'CF_EMAIL', 'CLOUDFLARE_ACCOUNT_ID', 'CF_ACCOUNT_ID', 'WRANGLER_AUTH_PROFILE', 'CLOUDFLARE_API_BASE_URL', 'CF_API_BASE_URL', 'WRANGLER_API_BASE_URL', 'CLOUDFLARE_ENV']) delete env[name]
  return env
}
export async function cloudflareRead(route, token, fetcher = fetch) {
  // No caller-supplied methods, origins, credentials or redirect policy.
  if (!/^\/zones(?:\?[^#]*)?$/.test(route) && !/^\/zones\/[a-f0-9]{32}\/dns_records(?:\?[^#]*)?$/.test(route)) throw new Error('Cloudflare preflight only permits zone and DNS reads')
  let response
  try { response = await fetcher('https://api.cloudflare.com/client/v4' + route, {method: 'GET', headers: {Authorization: 'Bearer ' + token}, redirect: 'error', signal: AbortSignal.timeout(15000)}) }
  catch { throw new Error('Cloudflare read-only request could not connect') }
  if (!response.ok) throw new Error('Cloudflare read-only request rejected: HTTP ' + response.status)
  let data
  try { data = await response.json() } catch { throw new Error('Invalid Cloudflare read-only response') }
  if (data.success !== true || !Array.isArray(data.result) || data.result_info?.total_pages > 1) throw new Error('Cloudflare read-only result is incomplete')
  return data.result
}
export function selectDomainAccount(domain, identity, zones) {
  prepareConfig(domain)
  const matching = zones.filter(zone => zone.status === 'active' && (domain === zone.name || domain.endsWith('.' + zone.name)) && /^[a-f0-9]{32}$/.test(zone.id ?? '') && /^[a-f0-9]{32}$/.test(zone.account?.id ?? '') && identity.accounts?.some(account => account.id === zone.account.id))
  const unique = [...new Map(matching.map(zone => [zone.id, zone])).values()]
  if (identity.loggedIn !== true || unique.length !== 1) return {verified: false, reason: unique.length > 1 ? 'ambiguous-active-zones' : 'no-accessible-active-zone'}
  const zone = unique[0]
  return {verified: true, accountId: zone.account.id, zoneId: zone.id, zoneName: zone.name}
}
function privateWranglerJSON(args, env, allowLoggedOut = false) {
  const run = spawnSync(process.execPath, [path.join(projectRoot, 'node_modules/wrangler/bin/wrangler.js'), '--config', path.join(projectRoot, 'artifacts/cloudflare/prepared/wrangler.json'), ...args], {cwd: directory, env, encoding: 'utf8', windowsHide: true, timeout: 45000, maxBuffer: 2 * 1024 * 1024})
  // auth token stdout is intentionally captured only in memory.
  let result
  try { result = JSON.parse(run.stdout) } catch { throw new Error('Wrangler read-only command did not return valid JSON') }
  if (run.status !== 0 && !(allowLoggedOut && result.loggedIn === false)) throw new Error('Wrangler read-only command failed; check the private Wrangler log')
  return result
}
export async function checkAccount() {
  if (process.platform === 'win32' && !/^D:\\/i.test(projectRoot)) throw new Error('Cloudflare profile must stay on D:')
  // Wrangler prefers this legacy directory over XDG_CONFIG_HOME. Never modify
  // or silently authenticate through a different global profile.
  if (fs.existsSync(path.join(os.homedir(), '.wrangler'))) throw new Error('A legacy global Wrangler directory exists; resolve profile isolation before using this project preflight')
  const env = accountEnvironment(process.env, projectRoot)
  for (const folder of [env.XDG_CONFIG_HOME, env.TEMP, path.dirname(env.WRANGLER_LOG_PATH)]) fs.mkdirSync(folder, {recursive: true})
  const filename = path.join(projectRoot, 'artifacts/cloudflare/prepared/wrangler.json')
  const config = JSON.parse(fs.readFileSync(filename, 'utf8'))
  const domain = config.routes?.[0]?.pattern
  prepareConfig(domain)
  const identity = privateWranglerJSON(['whoami', '--json'], env, true)
  const result = {checkedAt: new Date().toISOString(), domain, requiredReadScopes: readScopes, authenticated: identity.loggedIn === true, accountCount: identity.accounts?.length ?? 0, accountZoneAccessVerified: false, dnsRecordsRead: false, dnsChangeRequired: null, cloudResourcesChanged: false, uploaded: false}
  if (result.authenticated) {
    const credential = privateWranglerJSON(['auth', 'token', '--json'], env)
    if (!['oauth', 'api_token'].includes(credential.type) || typeof credential.token !== 'string' || !credential.token) throw new Error('Unsupported Cloudflare credential type')
    const labels = domain.split('.')
    const zones = (await Promise.all(labels.slice(0, -1).map((_, index) => cloudflareRead('/zones?' + new URLSearchParams({name: labels.slice(index).join('.'), status: 'active', per_page: '50'}), credential.token)))).flat()
    const selection = selectDomainAccount(domain, identity, zones)
    result.accountZoneAccessVerified = selection.verified
    result.selection = selection
    if (selection.verified) {
      try {
        result.dnsRecords = (await cloudflareRead('/zones/' + selection.zoneId + '/dns_records?' + new URLSearchParams({name: domain, per_page: '100'}), credential.token)).map(({id, type, name, content, proxied}) => ({id, type, name, content, proxied}))
        result.dnsRecordsRead = true
        result.dnsChangeRequired = result.dnsRecords.some(record => record.type === 'CNAME')
      } catch { result.dnsReadPending = 'Current authorization could not read DNS records; retain the public DNS snapshot and verify records before publishing' }
      if (config.account_id && config.account_id !== selection.accountId) throw new Error('Prepared account differs from the verified domain account; configuration was not changed')
      const databaseId = config.d1_databases[0].database_id
      const prepared = writePreparation(domain, /^0+(?:-0+)*$/.test(databaseId) ? undefined : databaseId, selection.accountId)
      const readiness = inspectPreparation(JSON.parse(fs.readFileSync(prepared, 'utf8')))
      fs.writeFileSync(path.join(path.dirname(prepared), 'readiness.json'), JSON.stringify(readiness, null, 2) + '\n')
      result.localAccountIdConfigured = true
    }
    credential.token = ''
  }
  fs.writeFileSync(path.join(directory, 'account-preflight.json'), JSON.stringify(result, null, 2) + '\n')
  return result
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = await checkAccount()
    console.log(JSON.stringify({authenticated: result.authenticated, accountCount: result.accountCount, accountZoneAccessVerified: result.accountZoneAccessVerified, dnsRecordsRead: result.dnsRecordsRead, dnsChangeRequired: result.dnsChangeRequired, cloudResourcesChanged: false, uploaded: false}))
    if (!result.accountZoneAccessVerified) process.exitCode = 1
  } catch { console.error('Cloudflare account preflight did not complete. No resources were created, no deployment was uploaded, and DNS was not changed.'); process.exitCode = 1 }
}
