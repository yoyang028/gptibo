import assert from 'node:assert/strict'
import test from 'node:test'
import { CATALOG_CATEGORIES, catalogCategory } from '../src/lib/catalog-categories.ts'

test('catalog offers the six requested categories in their requested order', () => {
  assert.deepEqual(CATALOG_CATEGORIES.map(category => category.name), ['AI订阅', '学习订阅', '生活订阅', '邮箱账号', '接码服务', '工具服务'])
})

test('current families use the same category for built-in and imported products', () => {
  const cases = {
    chatgpt: 'ai', claude: 'ai', 'codex-credits': 'ai', gemini: 'ai', grok: 'ai', muse: 'ai',
    duolingo: 'learning', 'student-verification': 'learning',
    'apple-music': 'lifestyle', 'x-premium': 'lifestyle', gmail: 'mail', 'codex-sms': 'sms',
    'adobe-express': 'tool', 'apple-id': 'tool', 'capcut-pro': 'tool',
  }
  for (const [id, expected] of Object.entries(cases)) {
    assert.equal(catalogCategory({ id }), expected, id)
    assert.equal(catalogCategory({ id: 'custom-fixture', groupId: id, category: '创作与生活' }), expected, id)
  }
})

test('custom service categories take precedence over AI brand names and payment delivery wording', () => {
  assert.equal(catalogCategory({ id: 'custom-deployment', name: 'Codex 远程部署', category: '技术服务' }), 'tool')
  assert.equal(catalogCategory({ id: 'custom-sms', name: 'Claude 短信验证', category: '短信接码' }), 'sms')
  assert.equal(catalogCategory({ id: 'custom-mail', name: '邮箱账号 · 邮件交付', category: '邮箱账号' }), 'mail')
  assert.equal(catalogCategory({ id: 'custom-class', name: 'AI 英语课', category: '语言学习' }), 'learning')
})

test('unrecognized custom products use their declared service or name without treating every subscription as AI', () => {
  assert.equal(catalogCategory({ id: 'custom-music', name: '音乐会员', category: '生活订阅' }), 'lifestyle')
  assert.equal(catalogCategory({ id: 'custom-ai', name: '新服务', category: 'AI 订阅' }), 'ai')
  assert.equal(catalogCategory({ id: 'custom-deployment', name: 'Codex 远程部署' }), 'tool')
  assert.equal(catalogCategory({ id: 'custom-gmail', name: 'Gmail 账号' }), 'mail')
  assert.equal(catalogCategory({ id: 'custom-unknown', name: '新服务', category: '订阅服务' }), 'tool')
  assert.equal(catalogCategory({ id: '__proto__' }), 'tool')
})
