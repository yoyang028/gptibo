import fs from 'node:fs'
import path from 'node:path'
import {projectRoot} from './prepare.mjs'
import {totp} from '../local/auth.mjs'

const privateRoot = path.join(projectRoot, 'artifacts/local/.secrets/quefa-cloudflare-mock')
const mailbox = path.join(projectRoot, 'artifacts/local/cloudflare/mailbox')
if (!fs.existsSync(path.join(privateRoot, 'admin-totp'))) throw new Error('Run local-cloudflare.cmd start first')
console.log('Local Cloudflare admin: https://127.0.0.1:8771/admin ; username: dev-admin')
console.log('Click 获取验证码 in the browser. Codes below are local fixtures only.')
function show() {
  const otp = totp(fs.readFileSync(path.join(privateRoot, 'admin-totp'), 'utf8'))
  const files = fs.readdirSync(mailbox).filter(name => name.endsWith('.json')).map(name => ({name, time: fs.statSync(path.join(mailbox, name)).mtimeMs})).sort((a,b) => b.time-a.time)
  let emailCode = 'waiting for local email'
  for (const file of files) {
    const mail = JSON.parse(fs.readFileSync(path.join(mailbox, file.name), 'utf8'))
    const code = mail.to.includes('admin@example.invalid') && mail.text?.match(/\b\d{6}\b/)
    if (code) {emailCode = code[0]; break}
  }
  console.log(new Date().toLocaleTimeString() + ' | email: ' + emailCode + ' | 2FA: ' + otp)
}
show(); setInterval(show, 5000)
