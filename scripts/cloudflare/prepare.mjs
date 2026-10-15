import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'

export const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
export function prepareConfig(domain, databaseId, accountId) {
  if (typeof domain !== 'string' || domain !== domain.toLowerCase() || domain.length > 253 || !/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(domain) || /(?:^|\.)(?:localhost|invalid|test|example)$/.test(domain)) throw new Error('Provide the owned hostname only, without scheme, path or wildcard')
  const config = JSON.parse(fs.readFileSync(path.join(projectRoot, 'wrangler.production.example.jsonc'), 'utf8'))
  if (databaseId !== undefined && !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(databaseId)) throw new Error('Invalid D1 database identifier')
  if (accountId !== undefined && !/^[a-f0-9]{32}$/i.test(accountId)) throw new Error('Invalid Cloudflare account identifier')
  if (accountId) config.account_id = accountId
  config.routes[0].pattern = domain
  config.d1_databases[0].database_id = databaseId ?? config.d1_databases[0].database_id
  config.vars.RECHARGE_NOTIFY_URL = `https://${domain}/api/recharge/webhook`
  return config
}
export function writePreparation(domain, databaseId, accountId) {
  const config = prepareConfig(domain, databaseId, accountId)
  const directory = path.join(projectRoot, 'artifacts/cloudflare/prepared')
  if (process.platform === 'win32' && !/^D:\\/i.test(projectRoot)) throw new Error('Prepared files must stay on D:')
  fs.mkdirSync(directory, { recursive: true })
  const filename = path.join(directory, 'wrangler.json')
  if (fs.existsSync(filename)) {
    const previous = JSON.parse(fs.readFileSync(filename, 'utf8'))
    if (previous.routes?.[0]?.pattern !== domain) throw new Error('Existing preparation belongs to a different domain')
    if (!databaseId && previous.d1_databases?.[0]?.database_id !== config.d1_databases[0].database_id) throw new Error('Pass the existing D1 ID explicitly; preparation never replaces a configured resource with a placeholder')
    if (!accountId && previous.account_id) throw new Error('Pass the existing account ID explicitly; preparation never drops a selected account')
  }
  config.$schema = path.join(projectRoot, 'node_modules/wrangler/config-schema.json')
  config.main = path.join(projectRoot, 'worker/index.ts')
  config.assets.directory = path.join(projectRoot, 'dist')
  config.d1_databases[0].migrations_dir = path.join(projectRoot, 'migrations')
  fs.writeFileSync(filename, JSON.stringify(config, null, 2) + '\n')
  let revision = 'uncommitted'
  let sourceDirty = true
  try { revision = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: projectRoot, encoding: 'utf8', windowsHide: true }).trim() } catch { /* Archive exports have no Git metadata. */ }
  try { sourceDirty = Boolean(execFileSync('git', ['status', '--porcelain'], {cwd: projectRoot, encoding: 'utf8', windowsHide: true}).trim()) } catch { /* Remain explicit about unknown source state. */ }
  fs.writeFileSync(path.join(directory, 'preparation.json'), JSON.stringify({ domain, preparedAt: new Date().toISOString(), baseCommit: revision, sourceDirty, uploaded: false, checkoutEnabled: false, databaseProvisioned: databaseId !== undefined }, null, 2) + '\n')
  return filename
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2)
  const value = name => args.includes(name) ? args[args.indexOf(name) + 1] : undefined
  const filename = writePreparation(value('--domain'), value('--d1-id'), value('--account-id'))
  console.log('Prepared private local configuration: ' + filename)
  console.log('No Cloudflare resources, DNS records, secrets or deployments were changed. Checkout remains closed.')
}
