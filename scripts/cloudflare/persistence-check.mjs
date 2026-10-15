import fs from 'node:fs'
import path from 'node:path'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import {projectRoot} from './prepare.mjs'

const directory = path.join(projectRoot, 'artifacts/local/evidence/cloudflare-round1')
const previous = JSON.parse(fs.readFileSync(path.join(directory, 'results.json'), 'utf8'))
assert.equal(previous.failure, undefined, 'complete browser acceptance before checking persistence')
const orderId = previous.checks.find(check => check.name.startsWith('UI creates')).orderId
const {chromium} = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE_PATH || 'D:/ChatGPT/CodexCache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright')
const browser = await chromium.launch({headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || 'D:/ChatGPT/Caches/playwright/chromium-1234/chrome-win64/chrome.exe'})
try {
  const context = await browser.newContext({baseURL: 'https://127.0.0.1:8771', ignoreHTTPSErrors: true, storageState: path.join(directory, 'synthetic-buyer-storage.json')})
  const response = await context.request.get('/api/orders/' + orderId, {headers: {Connection: 'close'}})
  assert.equal(response.status(), 200)
  const {order} = await response.json()
  assert.equal(order.status, 'success'); assert.equal(order.paymentStatus, 'paid'); assert.equal(order.fulfillment.attemptNo, 2)
  const page = await context.newPage(); await page.goto('https://127.0.0.1:8771/orders')
  await page.locator('.order-row').filter({hasText: orderId}).waitFor()
  const result = {checkedAt: new Date().toISOString(), passed: true, backend: 'actual-workerd-d1', restoredBuyerSession: true, completedOrderPreserved: true, originalAttempts: 2}
  fs.writeFileSync(path.join(directory, 'persistence-result.json'), JSON.stringify(result, null, 2) + '\n')
  console.log(JSON.stringify(result))
  await context.close()
} finally {await browser.close()}
