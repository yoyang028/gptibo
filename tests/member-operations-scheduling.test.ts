import test from 'node:test'
import assert from 'node:assert/strict'
import worker from '../worker/index.ts'
import { operationsFixture } from './member-operations-fixture.ts'

test('operational cron work stays below the free invocation budget and notification delivery survives an older supplier-job failure', async t => {
  const f = await operationsFixture(t)
  for (let i = 0; i < 20; i++) await f.create('scheduling@example.test')
  let calls = 0, failLegacy = false
  const prepare = f.env.INTEREST_DB.prepare.bind(f.env.INTEREST_DB), batch = f.env.INTEREST_DB.batch.bind(f.env.INTEREST_DB)
  t.mock.method(f.env.INTEREST_DB, 'prepare', (sql: string) => {
    if (failLegacy && sql === 'SELECT id FROM owner_shop_settings ORDER BY slot') throw new Error('legacy job unavailable')
    const q = prepare(sql), first = q.first.bind(q), all = q.all.bind(q), run = q.run.bind(q)
    q.first = async <T>() => { calls++; return first<T>() }
    q.all = async <T>() => { calls++; return all<T>() }
    q.run = async () => { calls++; return run() }
    return q
  })
  t.mock.method(f.env.INTEREST_DB, 'batch', async (items: Parameters<typeof batch>[0]) => { calls++; return batch(items) })
  const external = globalThis.fetch
  t.mock.method(globalThis, 'fetch', async (url: string, options: RequestInit) => {
    calls++
    if (url === 'https://api.resend.com/emails') return Response.json({ id: 'budget_notification' })
    return external(url, options)
  })
  // Slot 2 handles one risk source, leaving the original jobs their budget.
  await worker.scheduled({ scheduledTime: 2 * 60000 }, f.env)
  assert(calls <= 50, 'calls used: ' + calls)
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM member_risk_subjects WHERE checked_at>0').get()!.n, 1)
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM member_risk_cases').get()!.n, 1)
  calls = 0; failLegacy = true
  // Slot 0 runs in finally, even when a pre-existing job fails.
  await assert.rejects(worker.scheduled({ scheduledTime: 4 * 60000 }, f.env), /legacy job unavailable/)
  assert(calls <= 50, 'calls used: ' + calls)
  assert.equal(f.db.prepare("SELECT COUNT(*) n FROM member_notifications WHERE status='sent'").get()!.n, 1)
  assert.equal(f.upstream.writes.length, 0)
})
