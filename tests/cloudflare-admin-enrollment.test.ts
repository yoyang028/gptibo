import test from 'node:test'
import assert from 'node:assert/strict'
import {enrollmentUri, enrollmentFingerprint, enrollmentPreview, verifyEnrollment} from '../scripts/cloudflare/admin-enrollment.mjs'

const input = {secret: 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ', username: 'fixture-admin', domain: 'shop.example.com'}

test('production enrollment QR uses the existing seed and the same RFC TOTP settings as the Worker', async () => {
  const uri = new URL(enrollmentUri(input))
  assert.equal(uri.protocol, 'otpauth:'); assert.equal(uri.hostname, 'totp')
  assert.equal(decodeURIComponent(uri.pathname.slice(1)), 'GPTibo (shop.example.com):fixture-admin')
  assert.equal(uri.searchParams.get('secret'), input.secret)
  assert.equal(uri.searchParams.get('issuer'), 'GPTibo (shop.example.com)')
  assert.equal(uri.searchParams.get('algorithm'), 'SHA1'); assert.equal(uri.searchParams.get('digits'), '6'); assert.equal(uri.searchParams.get('period'), '30')
  const preview = await enrollmentPreview(input)
  assert(preview.image.startsWith('data:image/png;base64,'))
  assert.equal(Buffer.from(preview.image.split(',')[1], 'base64').readUInt32BE(0), 0x89504e47)
  assert.match(preview.fingerprint, /^[a-f0-9]{64}$/)
})

test('enrollment only confirms an actual valid code and binds proof to the current account, domain and seed', async () => {
  const valid = await verifyEnrollment({...input, code: '287082'}, 59000)
  assert.equal(valid.verified, true)
  assert.equal((await verifyEnrollment({...input, code: '287082'}, 120000)).verified, false)
  for (const code of ['', '28708', '2870820', 287082]) assert.equal((await verifyEnrollment({...input, code}, 59000)).verified, false)
  assert.notEqual(valid.fingerprint, enrollmentFingerprint({...input, username: 'another-admin'}))
  assert.notEqual(valid.fingerprint, enrollmentFingerprint({...input, domain: 'other.example.com'}))
  assert.notEqual(valid.fingerprint, enrollmentFingerprint({...input, secret: 'A'.repeat(32)}))
  assert.deepEqual(Object.keys(valid).sort(), ['fingerprint', 'verified'])
})

test('enrollment rejects URL, invalid seed and ambiguous account labels before creating a QR', async () => {
  for (const change of [{secret: 'invalid'}, {username: 'admin\nsecret'}, {username: 'a:b'}, {username: ''}, {domain: 'https://shop.example.com'}, {domain: '*.example.com'}, {domain: 'example.com/path'}]) {
    assert.throws(() => enrollmentUri({...input, ...change}), /Invalid local enrollment configuration/)
    await assert.rejects(verifyEnrollment({...input, ...change, code: '287082'}, 59000))
  }
})
