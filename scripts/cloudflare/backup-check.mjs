// Consistent local SQLite backups, restored into a second actual D1 runtime.
// This exercise only accepts this project's isolated simulation state.
import fs from 'node:fs'
import path from 'node:path'
import assert from 'node:assert/strict'
import { DatabaseSync, backup } from 'node:sqlite'
import { randomUUID, createHash } from 'node:crypto'
import { Miniflare, convertV4MiniflareOptions } from 'miniflare'
import { projectRoot } from './prepare.mjs'

const sourceDirectory = path.join(projectRoot, 'artifacts/local/cloudflare/state/d1/miniflare-D1DatabaseObject')
const directory = path.join(projectRoot, 'artifacts/local/evidence/cloudflare-backup', randomUUID())
const stateDirectory = path.join(directory, 'restored-state')
const restored = path.join(stateDirectory, 'd1/miniflare-D1DatabaseObject')
fs.mkdirSync(restored, {recursive: true})
const files = fs.readdirSync(sourceDirectory).filter(name => name.endsWith('.sqlite'))
assert.equal(files.filter(name => name !== 'metadata.sqlite').length, 1, 'only the independent local D1 database may be backed up')
let expected
const manifest = []
for (const name of files) {
  const source = new DatabaseSync(path.join(sourceDirectory, name), {readOnly: true})
  try { await backup(source, path.join(restored, name)) } finally { source.close() }
  const data = fs.readFileSync(path.join(restored, name))
  manifest.push({name, bytes: data.length, sha256: createHash('sha256').update(data).digest('hex')})
  if (name !== 'metadata.sqlite') {
    const copy = new DatabaseSync(path.join(restored, name), {readOnly: true})
    try {
      assert.equal(copy.prepare('PRAGMA integrity_check').get().integrity_check, 'ok')
      expected = Object.fromEntries(['orders', 'recharge_redemptions', 'recharge_webhooks', 'refund_cases', 'local_migrations'].map(table => [table, copy.prepare('SELECT COUNT(*) n FROM ' + table).get().n]))
      assert(expected.orders > 0 && expected.recharge_redemptions > 0 && expected.refund_cases > 0)
    } finally { copy.close() }
  }
}
const opts = convertV4MiniflareOptions({modules: true, script: 'export default {fetch(){return new Response("local restore check")}}', compatibilityDate: '2026-09-26', cf: false, d1Databases: {INTEREST_DB: 'gptibo-cloudflare-local'}, outboundService: () => {throw new Error('Restore verification has no network access')}})
const mf = new Miniflare({...opts, telemetry: {enabled: false}, resourcePersistencePath: stateDirectory, resourceTmpPath: path.join(directory, 'tmp')})
try {
  const db = await mf.getD1Database('INTEREST_DB')
  const actual = {}
  for (const table of Object.keys(expected)) actual[table] = (await db.prepare('SELECT COUNT(*) n FROM ' + table).first()).n
  assert.deepEqual(actual, expected)
  await db.prepare('SELECT paused,remote_attempt_no FROM recharge_redemptions LIMIT 1').all()
  const result = {checkedAt: new Date().toISOString(), passed: true, source: 'isolated local simulation only', restoredBackend: 'actual-workerd-d1', counts: actual, files: manifest}
  fs.writeFileSync(path.join(directory, 'result.json'), JSON.stringify(result, null, 2) + '\n')
  fs.writeFileSync(path.join(projectRoot, 'artifacts/local/evidence/cloudflare-backup/latest.json'), JSON.stringify({directory, ...result}, null, 2) + '\n')
  console.log(JSON.stringify({passed: true, restoredBackend: result.restoredBackend, counts: actual}))
} finally {await mf.dispose()}
