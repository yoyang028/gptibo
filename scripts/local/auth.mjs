import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../artifacts/local')
const secrets = path.join(root, '.secrets')
const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'

function base32(bytes) {
  let accumulator = 0, bits = 0, output = ''
  for (const byte of bytes) {
    accumulator = (accumulator << 8) | byte
    bits += 8
    while (bits >= 5) { bits -= 5; output += alphabet[(accumulator >>> bits) & 31] }
  }
  return output
}

export function totp(secret, milliseconds = Date.now()) {
  let accumulator = 0, bits = 0
  const decoded = []
  for (const char of secret.trim()) {
    const value = alphabet.indexOf(char)
    if (value < 0) throw new Error('Invalid local TOTP configuration')
    accumulator = (accumulator << 5) | value
    bits += 5
    if (bits >= 8) { bits -= 8; decoded.push((accumulator >>> bits) & 255) }
  }
  const counter = Buffer.alloc(8)
  counter.writeBigUInt64BE(BigInt(Math.floor(milliseconds / 30000)))
  const digest = crypto.createHmac('sha1', Buffer.from(decoded)).update(counter).digest()
  const offset = digest[19] & 15
  return String((digest.readUInt32BE(offset) & 0x7fffffff) % 1000000).padStart(6, '0')
}

export function latestCode(email) {
  const directory = path.join(root, 'mailbox')
  const files = fs.readdirSync(directory).filter(name => name.endsWith('.json'))
    .map(name => ({name, updated: fs.statSync(path.join(directory, name)).mtimeMs}))
    .sort((a, b) => b.updated - a.updated)
  for (const file of files) {
    const message = JSON.parse(fs.readFileSync(path.join(directory, file.name), 'utf8'))
    if (!message.to.includes(email)) continue
    const code = message.text.match(/\b\d{6}\b/)
    if (code) return {code: code[0], receivedAt: new Date(file.updated).toISOString()}
  }
  throw Object.assign(new Error('No local verification email yet. Click 获取验证码 in the browser first.'), {code: 'LOCAL_MAIL_NOT_FOUND'})
}

function showCodes(mode, watch) {
  const frontendPort = process.argv.includes('--quefa') ? 5176 : 5175
  const email = mode === 'admin' ? 'admin@example.invalid' : mode === 'partner' ? 'partner@example.invalid' : mode
  const secret = mode === 'admin' ? fs.readFileSync(path.join(secrets, 'admin-totp'), 'utf8') : null
  let previous = ''
  const display = () => {
    const now = Date.now()
    const lines = ['GPTibo 本地登录助手', '']
    if (mode === 'admin') {
      lines.push(`管理后台: http://127.0.0.1:${frontendPort}/admin`, '管理员用户名: dev-admin')
      lines.push('当前 TOTP（填写到“2FA 验证码”）: ' + totp(secret, now))
    } else {
      lines.push('登录邮箱: ' + email)
      if (mode === 'partner') lines.push(`代理后台: http://127.0.0.1:${frontendPort}/partner`)
    }
    try {
      const message = latestCode(email)
      if (now - Date.parse(message.receivedAt) >= 10 * 60 * 1000) {
        lines.push('邮箱验证码: 最近一封已过期，请在登录页重新点击“获取验证码”。')
      } else {
        lines.push('邮箱验证码: ' + message.code + '（收到时间 ' + new Date(message.receivedAt).toLocaleString('zh-CN', {hour12: false}) + '）')
      }
    } catch (error) {
      if (!['ENOENT', 'LOCAL_MAIL_NOT_FOUND'].includes(error.code)) throw error
      lines.push('邮箱验证码: 等待本地邮件，请先在登录页点击“获取验证码”。')
    }
    lines.push('', mode === 'admin' ? '获取验证码后保持登录页打开，将两种验证码分别填写。' : '获取验证码后保持登录页打开，填写最新的邮箱验证码。', '邮箱验证码只能使用一次；已登录或刷新页面后，请重新获取。')
    if (mode === 'admin') lines.push('2FA 动态码每 30 秒更新，请使用当前显示的号码。')
    if (watch) lines.push('窗口会自动更新；关闭窗口或按 Ctrl+C 退出。')
    const output = lines.join('\n')
    if (output !== previous) {
      if (watch && process.stdout.isTTY) console.clear()
      console.log(output)
      previous = output
    }
  }
  display()
  if (watch) setInterval(display, 1000)
}

const isEntry = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isEntry) {
  const mode = process.argv[2] ?? 'admin'
  if (mode === 'init') {
    fs.mkdirSync(secrets, {recursive: true, mode: 0o700})
    for (const name of ['owner-password', 'app-password', 'auth-secret', 'admin-totp']) {
      const filename = path.join(secrets, name)
      if (!fs.existsSync(filename)) fs.writeFileSync(filename, name === 'admin-totp' ? base32(crypto.randomBytes(20)) : crypto.randomBytes(32).toString('hex'), {flag: 'wx', mode: 0o600})
    }
    console.log('Independent development secrets initialized; existing values preserved.')
  } else {
    showCodes(mode, process.argv.includes('--watch'))
  }
}
