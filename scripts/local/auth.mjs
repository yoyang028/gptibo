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
  throw new Error('No local verification email yet. Click 获取验证码 in the browser first.')
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
    const email = mode === 'admin' ? 'admin@example.invalid' : mode === 'partner' ? 'partner@example.invalid' : mode
    if (mode === 'admin') {
      console.log('管理员用户名: dev-admin')
      console.log('当前 TOTP: ' + totp(fs.readFileSync(path.join(secrets, 'admin-totp'), 'utf8')))
    }
    const message = latestCode(email)
    console.log('邮箱验证码: ' + message.code + '（收到时间 ' + message.receivedAt + '）')
  }
}
