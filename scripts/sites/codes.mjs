// This command only reads the two synthetic preview mailboxes.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { totp } from '../local/auth.mjs'
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../artifacts/sites/local')
export function latestMail(site, email) {
  if (!['platform'].includes(site)) throw new Error('Unknown local site')
  const directory = path.join(root, site, 'mailbox')
  if (!fs.existsSync(directory)) return null
  return fs.readdirSync(directory).filter(f => f.endsWith('.json')).map(f => JSON.parse(fs.readFileSync(path.join(directory, f), 'utf8'))).filter(m => m.to.includes(email)).sort((a,b) => b.savedAt - a.savedAt)[0] ?? null
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  for (const site of ['platform']) {
    const filename = path.join(root, site, 'credentials.json')
    if (!fs.existsSync(filename)) { console.log(`${site}: 请先运行 npm run sites:preview`); continue }
    const credentials = JSON.parse(fs.readFileSync(filename, 'utf8'))
    if (!credentials.localOnly) throw new Error('Refusing non-preview credentials')
    console.log(`${site} 本地管理员 preview-admin，当前 2FA: ${totp(credentials.totp)}`)
    for (const email of ['agent@example.invalid', 'admin@example.invalid']) {
      const mail = latestMail(site, email), code = mail?.text.match(/\b\d{6}\b/)?.[0]
      console.log(`${email}: ${mail && Date.now() - mail.savedAt < 600000 && code ? code : '请先在此站点击获取验证码'}`)
    }
  }
}
