import type { ThreadMessage } from '@assistant-ui/react'
import { isImageId } from './conversation-files'
import { isPageElementId, PAGE_ELEMENT_TYPE } from './page-context'
import { isRecord, readStored, writeStored } from './local-storage'

// The conversations, saved in localStorage under the conversations key (`storageKey`): the
// conversations and which one is open. The provider connection has its own key (connection.ts).
// Records that don't have this shape are skipped, never repaired. Nothing here logs.
//
// A conversation is a tree: regenerating an answer or editing a message and sending it again
// adds a message beside the one it replaces, after the same message. Each branch is one path
// from the first message to a last one, and one branch is shown at a time.

/** A message and the one it follows: null for a first message. Messages following the same one are its versions. */
export interface ConversationMessage {
  message: ThreadMessage
  parentId: string | null
}
export interface Conversation {
  id: string
  title: string
  updatedAt: number
  /** Every message of every branch, each after the one it follows. */
  messages: readonly ConversationMessage[]
  /** The last message of the branch shown; null while there are none. */
  headId: string | null
  draft: string
}
export interface StoredConversations {
  conversations: Conversation[]
  activeConversationId?: string
}

export const DEFAULT_STORAGE_KEY = 'byok-ai:conversations'

// Ids from getRandomValues: crypto.randomUUID exists only in secure contexts (HTTPS or localhost).
function randomId(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), byte => byte.toString(16).padStart(2, '0')).join('')
}
export function newConversation(id = randomId()): Conversation {
  return { id, title: '', updatedAt: Date.now(), messages: [], headId: null, draft: '' }
}
/** The branch shown: its messages from the first to the last (`headId`). */
export function conversationBranch(conversation: Pick<Conversation, 'messages' | 'headId'>): ThreadMessage[] {
  const byId = new Map(conversation.messages.map(item => [item.message.id, item]))
  const branch: ThreadMessage[] = []
  for (let item = conversation.headId === null ? undefined : byId.get(conversation.headId); item; item = item.parentId === null ? undefined : byId.get(item.parentId)) {
    branch.push(item.message)
  }
  return branch.reverse()
}
/** A conversation with no messages and no unsent draft. It is never listed or saved. */
export const isEmptyConversation = (conversation: Pick<Conversation, 'messages' | 'draft'>) =>
  conversation.messages.length === 0 && !conversation.draft.trim()


// A sent image: its bytes are in the conversation's image store, under its id (images.ts).
const isSavedImage = (value: unknown) => isRecord(value) && value.type === 'image' && typeof value.id === 'string' && isImageId(value.id) &&
  typeof value.name === 'string' && typeof value.contentType === 'string' && isRecord(value.status) && value.status.type === 'complete'
// A page element added to a message: its id, description and place; what it is read from lives in the page (page-context.ts).
// Its content is one part: where it was, as the descriptions of the elements it was inside.
const isPlace = (value: unknown) => Array.isArray(value) && value.length === 1 && isRecord(value[0]) && value[0].type === 'data' && value[0].name === 'page-element' &&
  isRecord(value[0].data) && Array.isArray(value[0].data.inside) && value[0].data.inside.every(name => typeof name === 'string')
const isSavedPageElement = (value: unknown) => isRecord(value) && value.type === 'page-element' && typeof value.id === 'string' && isPageElementId(value.id) &&
  typeof value.name === 'string' && value.contentType === PAGE_ELEMENT_TYPE && isRecord(value.status) && value.status.type === 'complete' && isPlace(value.content)
function readMessage(value: unknown): ThreadMessage | undefined {
  if (!isRecord(value) || typeof value.id !== 'string' || !['user', 'assistant', 'system'].includes(String(value.role)) || !Array.isArray(value.content)) return
  if (!value.content.every(part => isRecord(part) && typeof part.type === 'string' && (part.type !== 'text' || typeof part.text === 'string'))) return
  // A user message's attachments are the images and page elements sent with it.
  if (value.role === 'user' && (!Array.isArray(value.attachments) || !value.attachments.every(a => isSavedImage(a) || isSavedPageElement(a)))) return
  const createdAt = new Date(typeof value.createdAt === 'string' ? value.createdAt : NaN)
  if (!Number.isFinite(createdAt.getTime())) return
  // A response still running when the page closed can't be resumed: it is shown as cancelled.
  const interrupted = value.role === 'assistant' && isRecord(value.status) && ['running', 'requires-action'].includes(String(value.status.type))
  return { ...value, createdAt, ...(interrupted ? { status: { type: 'incomplete', reason: 'cancelled' } } : {}) } as unknown as ThreadMessage
}
// The tree: every message once, after the one it follows (so a parent comes first), and the
// branch shown ending at one of them.
function readTree(items: readonly unknown[], headId: unknown): Pick<Conversation, 'messages' | 'headId'> | undefined {
  const messages: ConversationMessage[] = []
  const ids = new Set<string>()
  for (const item of items) {
    if (!isRecord(item) || !(item.parentId === null || (typeof item.parentId === 'string' && ids.has(item.parentId)))) return
    const message = readMessage(item.message)
    if (!message || ids.has(message.id)) return
    ids.add(message.id)
    messages.push({ message, parentId: item.parentId })
  }
  if (messages.length ? typeof headId !== 'string' || !ids.has(headId) : headId !== null) return
  return { messages, headId: headId as string | null }
}
function readConversation(value: unknown): Conversation | undefined {
  if (!isRecord(value) || typeof value.id !== 'string' || typeof value.title !== 'string' || typeof value.draft !== 'string' ||
    typeof value.updatedAt !== 'number' || !Number.isFinite(value.updatedAt) || !Array.isArray(value.messages)) return
  const tree = readTree(value.messages, value.headId)
  if (!tree) return
  return { id: value.id, title: value.title, updatedAt: value.updatedAt, draft: value.draft, ...tree }
}

/** The saved conversations; `error` when storage is unreadable or holds something else. */
export function loadConversations(key: string): { data: StoredConversations; error: boolean } {
  const { value, error } = readStored(key)
  if (value === null) return { data: { conversations: [] }, error }
  if (!isRecord(value) || !Array.isArray(value.conversations)) return { data: { conversations: [] }, error: true }
  return { data: {
    conversations: value.conversations.flatMap(conversation => readConversation(conversation) ?? []),
    activeConversationId: typeof value.activeConversationId === 'string' ? value.activeConversationId : undefined,
  }, error: false }
}
export function saveConversations(key: string, data: StoredConversations): boolean {
  return writeStored(key, data)
}
