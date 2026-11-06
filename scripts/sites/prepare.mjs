import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { prepareConfig, projectRoot } from '../cloudflare/prepare.mjs'

export function prepareSite(site, domain, databaseId, accountId) {
  if (!['general','wholesale'].includes(site)) throw new Error('Select --site general or wholesale')
  const config = prepareConfig(domain, databaseId, accountId)
  config.name = `gptibo-${site}`
  config.d1_databases[0].database_name = `gptibo-${site}`
  config.main = path.join(projectRoot, 'worker/index.ts')
  config.assets.directory = path.join(projectRoot, `artifacts/sites/${site}/dist`)
  config.d1_databases[0].migrations_dir = path.join(projectRoot, 'migrations')
  config.vars.STOREFRONT_KIND = site
  config.vars.WHOLESALE_PAYMENT_INSTRUCTIONS = ''
  if (site === 'wholesale') delete config.triggers
  // Never repurpose the existing live shop or another new shop's data/domain.
  for (const filename of ['artifacts/cloudflare/prepared/wrangler.json', `artifacts/sites/${site === 'general' ? 'wholesale' : 'general'}/prepared/wrangler.json`]) {
    const full = path.join(projectRoot, filename)
    if (!fs.existsSync(full)) continue
    const other = JSON.parse(fs.readFileSync(full, 'utf8'))
    if (other.routes?.some(r => r.pattern === domain) || (databaseId && other.d1_databases?.some(d => d.database_id === databaseId))) throw new Error('Each storefront requires a separate hostname and D1 database')
  }
  return config
}
export function writeSitePreparation(site, domain, databaseId, accountId) {
  const config = prepareSite(site, domain, databaseId, accountId)
  const directory = path.join(projectRoot, 'artifacts/sites', site, 'prepared'), filename = path.join(directory, 'wrangler.json')
  if (process.platform === 'win32' && !/^D:\\/i.test(directory)) throw new Error('Prepared files must stay on D:')
  if (fs.existsSync(filename)) {
    const previous = JSON.parse(fs.readFileSync(filename, 'utf8'))
    if (previous.routes?.[0]?.pattern !== domain || previous.d1_databases?.[0]?.database_id !== config.d1_databases[0].database_id || previous.account_id !== config.account_id) throw new Error('Existing prepared resource identity differs; do not overwrite it')
  }
  fs.mkdirSync(directory, { recursive: true })
  fs.writeFileSync(filename, JSON.stringify(config, null, 2) + '\n')
  return filename
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2), value = name => args.includes(name) ? args[args.indexOf(name) + 1] : undefined
  console.log(writeSitePreparation(value('--site'), value('--domain'), value('--d1-id'), value('--account-id')))
  console.log('Prepared locally only. No deployment, DNS, payment or existing store was changed.')
}
