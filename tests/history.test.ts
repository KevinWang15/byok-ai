import test from 'node:test'
import assert from 'node:assert/strict'
import { conversationPreview, conversationTitle, relativeConversationTime } from '../frontend/byok/history'
import { newConversation } from '../frontend/byok/storage'
import { defaultText } from '../frontend/byok/text'

test('history labels cover each unit boundary and a clock running ahead', () => {
  const now = Date.UTC(2026, 9, 30, 12)
  for (const [age, label] of [
    [0, 'Just now'], [59_999, 'Just now'], [60_000, '1 minute ago'],
    [120_000, '2 minutes ago'], [3_600_000, '1 hour ago'],
    [86_400_000, '1 day ago'], [604_800_000, '1 week ago'],
    [2_592_000_000, '1 month ago'], [31_536_000_000, '1 year ago'],
  ] as const) assert.equal(relativeConversationTime(now - age, now, defaultText), label)
  assert.equal(relativeConversationTime(now + 60_000, now, defaultText), 'Just now')
})

test('history speaks the text\'s language', () => {
  const now = Date.UTC(2026, 9, 30, 12)
  const zh = { ...defaultText, locale: 'zh-CN', justNow: '刚刚', untitled: '新对话', noMessages: '还没有消息', draft: (text: string) => `草稿：${text}` }
  assert.equal(relativeConversationTime(now - 120_000, now, zh), '2分钟前')
  assert.equal(relativeConversationTime(now, now, zh), '刚刚')
  const blank = newConversation('a')
  assert.equal(conversationTitle(blank, zh), '新对话')
  assert.equal(conversationTitle({ ...blank, title: 'Plans' }, zh), 'Plans')
  assert.equal(conversationPreview(blank, zh), '还没有消息')
  assert.equal(conversationPreview({ ...blank, draft: ' later ' }, zh), '草稿：later')
})
