import assert from 'node:assert/strict'
import test from 'node:test'
import { customerProductCopy, customerProductName, variantLabel } from '../src/lib/shop-presentation.ts'
import type { ShopProduct, ShopProductGroupId } from '../shared/shop-products.ts'

const product = (name: string, groupId: ShopProductGroupId, duration = '') =>
  Object.freeze({ name, groupId, duration }) as ShopProduct

test('Apple ID choices keep the region and account type while the source keeps its full conditions', () => {
  for (const [name, expected] of [
    ['日本 Apple ID · 老号（注册时间5年以上）', '日本 · 老号'],
    ['尼日利亚 Apple ID · 新号（已养号1月以上）', '尼日利亚 · 新号'],
    ['美国 Apple ID · 已购 Shadowrocket', '美国 · Shadowrocket'],
    ['香港 Apple ID · 新号（已养号1月以上）', '香港 · 新号'],
  ]) {
    const source = product(name, 'apple-id', '完整账号条件')
    assert.equal(variantLabel(source, 'Apple ID'), expected)
    assert.equal(source.name, name)
    assert.equal(source.duration, '完整账号条件')
  }
})

test('Gemini choices distinguish the delivery method and only retain cohort years when accounts need disambiguation', () => {
  const account = product('Google AI Pro 成品账号 · 随机 · 2020-2025', 'gemini', '会员剩余期未注明')
  const older = product('Google AI Pro 成品账号 · 随机 · 2009-2017', 'gemini', '会员剩余期未注明')
  const link = product('Google AI Pro · 18 个月激活链接', 'gemini', '18 个月')
  assert.equal(variantLabel(account, 'Gemini', [account, link]), '成品账号')
  assert.equal(variantLabel(link, 'Gemini', [account, link]), '18 个月 · 激活链接')
  assert.equal(variantLabel(account, 'Gemini', [account, older, link]), '成品账号 · 2020–2025')
  assert.equal(variantLabel(older, 'Gemini', [account, older, link]), '成品账号 · 2009–2017')
  assert.equal(account.duration, '会员剩余期未注明')
})

test('Customer-facing names remove the requested Google prefixes without rewriting other products or links', () => {
  assert.equal(customerProductName('Google Gemini'), 'Gemini')
  assert.equal(customerProductName('Google Gmail · 2020-2024 · 随机'), 'Gmail · 2020-2024 · 随机')
  assert.equal(customerProductCopy('Google Gmail 账号，不含 Google AI Pro。'), 'Gmail 账号，不含 Google AI Pro。')
  assert.equal(customerProductName('Google AI Pro · https://accounts.google.com/'), 'Google AI Pro · https://accounts.google.com/')
})

test('Shortened choices keep the existing Claude and Codex tier labels', () => {
  assert.equal(variantLabel(product('Claude Max 5x', 'claude'), 'Claude'), 'Max 5×')
  assert.equal(variantLabel(product('Codex 250 额度', 'codex-credits'), 'Codex 额度'), '250 点')
})
