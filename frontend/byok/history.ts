import { conversationBranch, type Conversation } from './storage'
import { isImageAttachment } from './images'
import type { AskAIText } from './text'

/** How long ago `timestamp` was, in `text`'s language: "Just now", "5 minutes ago". */
export function relativeConversationTime(timestamp: number, now: number, text: Pick<AskAIText, 'locale' | 'justNow'>): string {
  const seconds = Math.max(0, (now - timestamp) / 1000)
  if (seconds < 60) return text.justNow
  const relative = new Intl.RelativeTimeFormat(text.locale, { numeric: 'always' })
  if (seconds < 3600) return relative.format(-Math.floor(seconds / 60), 'minute')
  if (seconds < 86400) return relative.format(-Math.floor(seconds / 3600), 'hour')
  if (seconds < 604800) return relative.format(-Math.floor(seconds / 86400), 'day')
  if (seconds < 2592000) return relative.format(-Math.floor(seconds / 604800), 'week')
  if (seconds < 31536000) return relative.format(-Math.floor(seconds / 2592000), 'month')
  return relative.format(-Math.floor(seconds / 31536000), 'year')
}

/** A conversation's name: its title, or, when its first message has no words, what it holds. */
export function conversationTitle(conversation: Conversation, text: Pick<AskAIText, 'untitled' | 'imageConversation'>): string {
  if (conversation.title) return conversation.title
  const first = conversation.messages.find(({ message }) => message.role === 'user')?.message
  return first?.role === 'user' && first.attachments.some(isImageAttachment) ? text.imageConversation : text.untitled
}

export function conversationPreview(conversation: Conversation, text: Pick<AskAIText, 'draft' | 'noMessages'>): string {
  if (conversation.draft.trim()) return text.draft(conversation.draft.trim())
  for (const message of conversationBranch(conversation).reverse()) {
    const words = message.content.flatMap(part => part.type === 'text' ? [part.text] : []).join(' ').trim()
    if (words) return words.replace(/\s+/g, ' ').slice(0, 180)
  }
  return text.noMessages
}
