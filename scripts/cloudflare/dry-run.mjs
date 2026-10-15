// Bundle with the actual Wrangler deploy pipeline without uploading a version,
// changing DNS, creating D1, or reading the user's global Wrangler credentials.
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync, execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { projectRoot } from './prepare.mjs'
import { inspectPreparation } from './readiness.mjs'

const directory = path.join(projectRoot, 'artifacts/cloudflare/prepared')
const filename = path.join(directory, 'wrangler.json')
const check = inspectPreparation(JSON.parse(fs.readFileSync(filename, 'utf8')))
if (!check.offlineReady) throw new Error('Deployment preparation checks failed; run cloudflare:check')
const output = path.join(directory, 'bundle')
const logs = path.join(directory, 'logs')
const temporary = path.join(directory, 'tmp')
for (const folder of [output, logs, temporary]) fs.mkdirSync(folder, {recursive: true})
const env = {
  ...process.env, XDG_CONFIG_HOME: path.join(directory, 'config'), WRANGLER_LOG_PATH: path.join(logs, 'wrangler.log'),
  WRANGLER_SEND_METRICS: 'false', CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV: 'false', TEMP: temporary, TMP: temporary,
}
// A dry run needs no cloud identity. Do not pass inherited API credentials to it.
for (const name of ['CLOUDFLARE_API_TOKEN', 'CF_API_TOKEN', 'CLOUDFLARE_API_KEY', 'CF_API_KEY', 'CLOUDFLARE_EMAIL', 'CF_EMAIL']) delete env[name]
const run = spawnSync(process.execPath, [path.join(projectRoot, 'node_modules/wrangler/bin/wrangler.js'), 'deploy', '--config', filename, '--dry-run', '--outdir', output], {cwd: projectRoot, env, encoding: 'utf8', windowsHide: true, timeout: 120000})
fs.writeFileSync(path.join(logs, 'dry-run.txt'), String(run.stdout ?? '') + String(run.stderr ?? ''))
if (run.status !== 0) {
  console.error('Wrangler dry run failed. See artifacts/cloudflare/prepared/logs/dry-run.txt')
  process.exit(1)
}
const files = fs.readdirSync(output).filter(name => fs.statSync(path.join(output, name)).isFile()).map(name => {
  const data = fs.readFileSync(path.join(output, name))
  return {name, bytes: data.length, sha256: createHash('sha256').update(data).digest('hex')}
})
let sourceCommit = 'uncommitted'; let sourceDirty = true
try {
  sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], {cwd: projectRoot, encoding: 'utf8', windowsHide: true}).trim()
  sourceDirty = Boolean(execFileSync('git', ['status', '--porcelain'], {cwd: projectRoot, encoding: 'utf8', windowsHide: true}).trim())
} catch { /* Archive exports have no Git metadata. */ }
fs.writeFileSync(path.join(directory, 'bundle-manifest.json'), JSON.stringify({builtAt: new Date().toISOString(), sourceCommit, sourceDirty, command: 'wrangler deploy --dry-run', uploaded: false, files}, null, 2) + '\n')
console.log('Wrangler deployment bundle verified locally; nothing uploaded. Files: ' + files.length)
