import type { Conversation } from './storage'

export function relativeConversationTime(timestamp: number, now: number): string {
  const seconds = Math.max(0, (now - timestamp) / 1000)
  if (seconds < 60) return 'Just now'
  const relative = new Intl.RelativeTimeFormat('en', { numeric: 'always' })
  if (seconds < 3600) return relative.format(-Math.floor(seconds / 60), 'minute')
  if (seconds < 86400) return relative.format(-Math.floor(seconds / 3600), 'hour')
  if (seconds < 604800) return relative.format(-Math.floor(seconds / 86400), 'day')
  if (seconds < 2592000) return relative.format(-Math.floor(seconds / 604800), 'week')
  if (seconds < 31536000) return relative.format(-Math.floor(seconds / 2592000), 'month')
  return relative.format(-Math.floor(seconds / 31536000), 'year')
}

export function conversationPreview(conversation: Conversation): string {
  if (conversation.draft.trim()) return 'Draft: ' + conversation.draft.trim()
  for (const message of [...conversation.messages].reverse()) {
    const text = message.content.flatMap(part => part.type === 'text' ? [part.text] : []).join(' ').trim()
    if (text) return text.replace(/\s+/g, ' ').slice(0, 180)
  }
  return 'No messages yet'
}
