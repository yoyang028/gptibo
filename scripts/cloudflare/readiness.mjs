import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { projectRoot } from './prepare.mjs'

const disabled = ['ORDER_TESTING_ENABLED', 'EMAIL_PRODUCTS_ENABLED', 'XGIFT_CHECKOUT_ENABLED', 'PAYMENT_CHECKOUT_ENABLED', 'PAYMENT_TEST_ENABLED', 'ACCOUNT_SUPPLIER_CHECKOUT_ENABLED', 'DELIVERY_SUPPLIER_CHECKOUT_ENABLED']
export function inspectPreparation(config, secretNames = []) {
  const checks = []
  const add = (name, passed, scope = 'offline') => checks.push({ name, passed: Boolean(passed), scope })
  const domain = config.routes?.length === 1 && config.routes[0].custom_domain === true ? config.routes[0].pattern : ''
  add('single configured custom-domain hostname', typeof domain === 'string' && domain.length > 0 && !/[/*:]/.test(domain) && !/\.(invalid|test|example)$/.test(domain))
  add('alternate public preview URLs disabled', config.workers_dev === false && config.preview_urls === false)
  add('API handled before SPA assets', config.assets?.binding === 'ASSETS' && config.assets?.run_worker_first?.includes('/api/*') && config.assets?.not_found_handling === 'single-page-application')
  add('reconciliation scheduled every minute', config.triggers?.crons?.includes('* * * * *'))
  const limits = new Map((config.ratelimits ?? []).map(l => [l.name, l.simple]))
  add('three edge request limits configured', ['INTEREST_LIMITER', 'API_LIMITER', 'EXPENSIVE_LIMITER'].every(name => limits.get(name)?.limit > 0 && limits.get(name)?.period === 60))
  add('test payments and unrelated products disabled', disabled.every(name => config.vars?.[name] === 'false'))
  add('preparation cannot sell or write to supplier', config.vars?.RECHARGE_CHECKOUT_ENABLED === 'false' && config.vars?.RECHARGE_READ_ONLY === 'true')
  add('platform collection with bound callback', config.vars?.RECHARGE_COLLECTION_MODE === 'platform_collect' && config.vars?.RECHARGE_NOTIFY_URL === `https://${domain}/api/recharge/webhook`)
  let map
  try { map = JSON.parse(config.vars.RECHARGE_PRODUCT_MAP) } catch { /* Fail closed below. */ }
  add('only ChatGPT Plus mapped', map && Object.keys(map).length === 1 && map.plus === 'chatgpt_plus_cdk_1m')
  add('independent D1 binding', config.d1_databases?.length === 1 && config.d1_databases[0].binding === 'INTEREST_DB' && !!config.d1_databases[0].migrations_dir)
  add('Cloudflare account selected', /^[a-f0-9]{32}$/i.test(config.account_id ?? ''), 'cloud')
  const database = config.d1_databases?.[0]?.database_id ?? ''
  add('D1 provisioned and ID selected', /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(database) && !/^0+(?:-0+)*$/.test(database), 'cloud')
  for (const name of ['ADMIN_USERNAME', 'ADMIN_EMAIL', 'ADMIN_TOTP_SECRET', 'RESEND_API_KEY', 'RESEND_FROM', 'PARTNER_AUTH_SECRET', 'RECHARGE_API_BASE', 'RECHARGE_PARTNER_ID', 'RECHARGE_KEY_ID', 'RECHARGE_CLIENT_SECRET', 'RECHARGE_WEBHOOK_SECRET']) add('production secret configured: ' + name, secretNames.includes(name), 'secrets')
  return { checkedAt: new Date().toISOString(), offlineReady: checks.filter(c => c.scope === 'offline').every(c => c.passed), cloudConfigurationReady: checks.every(c => c.passed), salesEnabled: false, remoteStateVerified: false, checks }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const file = process.argv[2] ?? path.join(projectRoot, 'artifacts/cloudflare/prepared/wrangler.json')
  const result = inspectPreparation(JSON.parse(fs.readFileSync(file, 'utf8')))
  fs.writeFileSync(path.join(path.dirname(file), 'readiness.json'), JSON.stringify(result, null, 2) + '\n')
  console.log(JSON.stringify(result, null, 2))
  if (!result.offlineReady) process.exitCode = 1
}
