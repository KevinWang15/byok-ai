import test from 'node:test'
import assert from 'node:assert/strict'
import { conversationDate, relativeConversationTime } from '../frontend/byok/history'

test('history labels cover time boundaries, invalid legacy dates, and clock skew', () => {
  const now = Date.UTC(2026, 9, 30, 12)
  for (const [age, label] of [
    [0, 'Just now'], [59_999, 'Just now'], [60_000, '1 minute ago'],
    [120_000, '2 minutes ago'], [3_600_000, '1 hour ago'],
    [86_400_000, '1 day ago'], [604_800_000, '1 week ago'],
    [2_592_000_000, '1 month ago'], [31_536_000_000, '1 year ago'],
  ] as const) assert.equal(relativeConversationTime(now - age, now), label)
  assert.equal(relativeConversationTime(now + 60_000, now), 'Just now')
  for (const invalid of [0, -1, NaN, Infinity, 1e20]) {
    assert.equal(conversationDate(invalid), undefined)
    assert.equal(relativeConversationTime(invalid, now), 'Unknown date')
  }
})
