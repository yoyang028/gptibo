import test from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { readFileSync } from 'node:fs'
import { STOREFRONT_GUIDE_PATHS } from '../shared/storefront-guides.ts'
import { storefrontVisit } from '../shared/storefront-visit.ts'
import { adminVisitorSummary, recordVisitor, visitorSummary } from '../worker/visitors.ts'
import type { Env, Statement, Value } from '../worker/platform.ts'

function setup() {
  const db = new DatabaseSync(':memory:')
  db.exec('CREATE TABLE partners(id TEXT PRIMARY KEY,slug TEXT,name TEXT,active INTEGER,created_at INTEGER)')
  db.exec(`CREATE TABLE owner_shop_settings(id TEXT PRIMARY KEY,slug TEXT,slot INTEGER,settings TEXT);
    INSERT INTO owner_shop_settings VALUES('platform','',1,'{"name":"主店","active":true}'),('store-2','store-2',2,'{"name":"预留店","active":false}'),('store-3','store-3',3,'{"name":"通用店","active":true}')`)
  db.exec(readFileSync(new URL('../migrations/0015_visitor_analytics.sql', import.meta.url), 'utf8'))
  db.prepare('INSERT INTO partners VALUES (?,?,?,?,?)').run('partner-a', 'ABCDEF', '代理 A', 1, 1)
  db.prepare('INSERT INTO partners VALUES (?,?,?,?,?)').run('partner-b', 'GHIJKL', '代理 B', 0, 2)
  const database = {
    prepare(sql: string): Statement {
      let values: Value[] = []
      return {
        bind(...next) { values = next; return this },
        async first<T>() { return (db.prepare(sql).get(...values) ?? null) as T | null },
        async all<T>() { return { results: db.prepare(sql).all(...values) as T[] } },
        async run() { return db.prepare(sql).run(...values) },
      }
    },
    async batch() { return [] },
  }
  return { db, env: { INTEREST_DB: database } as Env }
}

test('sidebar visitor totals deduplicate within the selected shop or channel and scope the shop table', async t => {
  const { db, env } = setup()
  t.after(() => db.close())
  const day = new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10)
  const record = db.prepare('INSERT INTO visitor_days(day,shop_id,visitor_hash,page_views) VALUES(?,?,?,?)')
  record.run(day,'platform','same-browser',2)
  record.run(day,'store-3','same-browser',3)
  record.run(day,'store-3','other-browser',1)
  record.run(day,'partner-a','same-browser',4)
  const summary = (params:string) => adminVisitorSummary(env,new URL('https://shop.example.invalid/api/admin/visitors?days=1&' + params))
  const all = await summary('scope=all')
  assert.deepEqual([all.visitors,all.pageViews],[2,10])
  const owner = await summary('scope=owner')
  assert.deepEqual([owner.visitors,owner.pageViews,owner.partners.length],[2,6,0])
  const store = await summary('store=store-3')
  assert.deepEqual([store.visitors,store.pageViews,store.trend.length],[2,4,1])
  assert.deepEqual(store.ownerStores.map(s => s.id),['store-3'])
  const agent = await summary('scope=agent')
  assert.deepEqual([agent.visitors,agent.pageViews,agent.ownerStores.length],[1,4,0])
  assert.deepEqual((await summary('store=store-2')).trend,[{day,visitors:0,pageViews:0}])
})

test('storefront visits are scoped by partner and deduplicated across pages and shops', async t => {
  const { db, env } = setup(); t.after(() => db.close())
  const visitorId = crypto.randomUUID()
  const send = (path: string, id = visitorId, origin = 'https://shop.example.invalid') => recordVisitor(new Request('https://shop.example.invalid/api/visitors', {
    method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ path, visitorId: id }),
  }), env)
  await send('/')
  await send('/product/chatgpt')
  await send('/r/ABCDEF')
  await send('/r/ABCDEF/product/chatgpt')
  await send('/r/ABCDEF/orders', crypto.randomUUID())
  const platform = await visitorSummary(env, new URL('https://shop.example.invalid/?days=7'), 'platform')
  const partner = await visitorSummary(env, new URL('https://shop.example.invalid/?days=7'), 'partner-a')
  const overall = await adminVisitorSummary(env, new URL('https://shop.example.invalid/?days=7'))
  assert.deepEqual([platform.visitors, platform.pageViews], [1, 2])
  assert.deepEqual([partner.visitors, partner.pageViews], [2, 3])
  assert.deepEqual([overall.visitors, overall.pageViews], [2, 5])
  assert.deepEqual([overall.partners[0].id, overall.partners[0].visitors], ['partner-a', 2])
  assert.deepEqual([overall.partners[1].id, overall.partners[1].visitors], ['partner-b', 0])
  assert.equal(overall.trend.length, 7)
  await assert.rejects(send('/r/GHIJKL'), { status: 404 })
  await assert.rejects(send('/admin'), { status: 400 })
  await assert.rejects(send('/', visitorId, 'https://evil.test'), { status: 403 })
  assert.equal(db.prepare('SELECT COUNT(*) n FROM visitor_days').get()!.n, 3)
})

test('member, guide and invitation visits count for the corresponding direct or partner shop', async t => {
  const { db, env } = setup(); t.after(() => db.close())
  const main = 'https://shop.example.invalid', vip = 'https://vip.example.invalid'
  env.OWNER_STOREFRONT_HOSTS = JSON.stringify({ 'vip.example.invalid': 'store-3' })
  const mainBrowser = crypto.randomUUID(), vipBrowser = crypto.randomUUID(), partnerBrowser = crypto.randomUUID()
  const send = (origin: string, path: string, visitorId: string) => recordVisitor(new Request(origin + '/api/visitors', {
    method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ path, visitorId }),
  }), env)
  for (const path of ['/', '/product/chatgpt', '/guides/apple-id']) assert.equal((await send(main, path, mainBrowser)).status, 200)
  for (const path of ['/account', '/ref/xingqiu/guides/gemini-student', '/i/xingqiu/']) assert.equal((await send(vip, path, vipBrowser)).status, 200)
  assert.equal((await send(main, '/s/store-3/guides/apple-id', vipBrowser)).status, 200)
  assert.equal((await send(main, '/r/ABCDEF/guides/apple-id/', partnerBrowser)).status, 200)
  await assert.rejects(send(vip, '/r/ABCDEF/guides/apple-id', partnerBrowser), { status: 404 })
  await assert.rejects(send(main, '/r/GHIJKL/guides/apple-id', partnerBrowser), { status: 404 })
  const summary = (scope: string) => adminVisitorSummary(env, new URL(`${main}/api/admin/visitors?days=1&${scope}`))
  for (const [scope, uv, pv] of [['store=platform', 1, 3], ['store=store-3', 1, 4], ['scope=agent', 1, 1], ['scope=owner', 2, 7]] as const) {
    const data = await summary(scope)
    assert.deepEqual([data.visitors, data.pageViews], [uv, pv])
  }
})

test('the shared visitor path rule recognizes every storefront guide and strips invitation aliases', () => {
  for (const page of ['/account', ...STOREFRONT_GUIDE_PATHS]) {
    assert.equal(storefrontVisit(page)?.path, page)
    assert.equal(storefrontVisit(`/ref/tester${page}`)?.path, page)
    assert.equal(storefrontVisit(`/s/store-3${page}`)?.shopSlug, 'store-3')
  }
  for (const path of ['/admin', '/api/orders', '/join', '/partner', '/guides/unknown', '/r/ABCDEF/admin', '/s/store-3/api/orders', '/ref/tester/partner']) {
    assert.equal(storefrontVisit(path), null, path)
  }
})

test('1-day range uses the current Beijing date and preserves visitor deduplication and shop attribution', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-11-01T16:30:00Z') })
  const { db, env } = setup(); t.after(() => db.close())
  const insert = db.prepare('INSERT INTO visitor_days(day,shop_id,visitor_hash,page_views) VALUES (?,?,?,?)')
  insert.run('2026-11-02', 'platform', 'shared', 3)
  insert.run('2026-11-02', 'partner-a', 'shared', 2)
  insert.run('2026-11-02', 'partner-a', 'other', 4)
  insert.run('2026-11-01', 'platform', 'yesterday', 50)
  insert.run('2026-11-01', 'partner-a', 'yesterday', 60)
  const url = new URL('https://shop.example.invalid/api/admin/visitors?days=1')
  const summary = await adminVisitorSummary(env, url)
  assert.deepEqual([summary.days, summary.visitors, summary.pageViews], [1, 2, 9])
  assert.deepEqual(summary.trend.map(row => ({ ...row })), [{ day: '2026-11-02', pageViews: 9, visitors: 2 }])
  assert.deepEqual({ ...summary.platform }, { pageViews: 3, visitors: 1 })
  const partner = await visitorSummary(env, url, 'partner-a')
  assert.deepEqual([partner.visitors, partner.pageViews], [2, 6])
  assert.deepEqual([summary.partners[0].id, summary.partners[0].pageViews], ['partner-a', 6])
  const empty = await visitorSummary(env, url, 'partner-b')
  assert.deepEqual(empty.trend, [{ day: '2026-11-02', pageViews: 0, visitors: 0 }])
  assert.deepEqual([empty.visitors, empty.pageViews], [0, 0])
  const week = await visitorSummary(env, new URL('?days=7', url))
  assert.equal(week.pageViews, 119)
})

test('90-day range includes older visits and keeps 30-day results separate', async t => {
  const { db, env } = setup(); t.after(() => db.close())
  const oldDay = new Date(Date.now() - 75 * 86400000 + 8 * 3600000).toISOString().slice(0, 10)
  db.prepare('INSERT INTO visitor_days(day,shop_id,visitor_hash,page_views) VALUES (?,?,?,?)').run(oldDay, 'partner-a', 'old-visitor', 3)
  const url = (days: number) => new URL(`https://shop.example.invalid/api/admin/visitors?days=${days}`)
  assert.deepEqual([ (await visitorSummary(env, url(30), 'partner-a')).pageViews, (await visitorSummary(env, url(90), 'partner-a')).pageViews ], [0, 3])
  const admin = await adminVisitorSummary(env, url(90))
  assert.equal(admin.trend.length, 90)
  assert.equal(admin.partners[0].pageViews, 3)
  await assert.rejects(visitorSummary(env, url(91)), { status: 400 })
})

test('account-check page visits retain root and partner attribution without recording submitted account data', async t => {
  const { db, env } = setup(); t.after(() => db.close())
  for (const path of ['/check', '/r/ABCDEF/check', '/s/ABCDEF/check']) {
    const r = await recordVisitor(new Request('https://shop.example.invalid/api/visitors', { method: 'POST', headers: { Origin: 'https://shop.example.invalid', 'Content-Type': 'application/json' }, body: JSON.stringify({ path, visitorId: crypto.randomUUID() }) }), env)
    assert.equal(r.status, 200)
  }
  const rows = db.prepare('SELECT shop_id,SUM(page_views) n FROM visitor_days GROUP BY shop_id ORDER BY shop_id').all()
  assert.deepEqual(rows.map(r => [r.shop_id, r.n]), [['partner-a', 2], ['platform', 1]])
})
