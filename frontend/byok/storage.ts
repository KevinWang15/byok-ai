import type { ThreadMessage } from '@assistant-ui/react'
import type { ProviderValues } from './types'
import { isImageId } from './conversation-files'

// What the library saves in localStorage, under two keys:
// - the conversations key (`storageKey`): the conversations and which one is open;
// - the connection key (`connectionKey`): the chosen provider and its form values, API key included.
// Records that don't have this shape are skipped, never repaired. Nothing here logs.

export interface Conversation {
  id: string
  title: string
  updatedAt: number
  messages: readonly ThreadMessage[]
  draft: string
}
export interface StoredConversations {
  conversations: Conversation[]
  activeConversationId?: string
}
export interface StoredConnection { providerId: string; values: ProviderValues }

export const DEFAULT_STORAGE_KEY = 'byok-ai:conversations'
export const defaultConnectionKey = (storageKey: string) => `${storageKey}:connection`

// Ids from getRandomValues: crypto.randomUUID exists only in secure contexts (HTTPS or localhost).
function randomId(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), byte => byte.toString(16).padStart(2, '0')).join('')
}
export function newConversation(id = randomId()): Conversation {
  return { id, title: 'New conversation', updatedAt: Date.now(), messages: [], draft: '' }
}
/** A conversation with no messages and no unsent draft. It is never listed or saved. */
export const isEmptyConversation = (conversation: Pick<Conversation, 'messages' | 'draft'>) =>
  conversation.messages.length === 0 && !conversation.draft.trim()

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

// A sent image: its bytes are in the conversation's image store, under its id (images.ts).
const isSavedImage = (value: unknown) => isRecord(value) && value.type === 'image' && typeof value.id === 'string' && isImageId(value.id) &&
  typeof value.name === 'string' && typeof value.contentType === 'string' && isRecord(value.status) && value.status.type === 'complete'
function readMessage(value: unknown): ThreadMessage | undefined {
  if (!isRecord(value) || typeof value.id !== 'string' || !['user', 'assistant', 'system'].includes(String(value.role)) || !Array.isArray(value.content)) return
  if (!value.content.every(part => isRecord(part) && typeof part.type === 'string' && (part.type !== 'text' || typeof part.text === 'string'))) return
  // A user message's attachments are the images sent with it.
  if (value.role === 'user' && (!Array.isArray(value.attachments) || !value.attachments.every(isSavedImage))) return
  const createdAt = new Date(typeof value.createdAt === 'string' ? value.createdAt : NaN)
  if (!Number.isFinite(createdAt.getTime())) return
  // A response still running when the page closed can't be resumed: it is shown as cancelled.
  const interrupted = value.role === 'assistant' && isRecord(value.status) && ['running', 'requires-action'].includes(String(value.status.type))
  return { ...value, createdAt, ...(interrupted ? { status: { type: 'incomplete', reason: 'cancelled' } } : {}) } as unknown as ThreadMessage
}
function readConversation(value: unknown): Conversation | undefined {
  if (!isRecord(value) || typeof value.id !== 'string' || typeof value.title !== 'string' || typeof value.draft !== 'string' ||
    typeof value.updatedAt !== 'number' || !Number.isFinite(value.updatedAt) || !Array.isArray(value.messages)) return
  const messages = value.messages.map(readMessage)
  if (messages.some(message => !message)) return
  return { id: value.id, title: value.title, updatedAt: value.updatedAt, draft: value.draft, messages: messages as ThreadMessage[] }
}

function read(key: string): { value: unknown; error: boolean } {
  try { return { value: JSON.parse(localStorage.getItem(key) ?? 'null'), error: false } } catch { return { value: null, error: true } }
}
function write(key: string, value: unknown): boolean {
  try {
    if (value === undefined) localStorage.removeItem(key)
    else localStorage.setItem(key, JSON.stringify(value))
    return true
  } catch { return false }
}

/** The saved conversations; `error` when storage is unreadable or holds something else. */
export function loadConversations(key: string): { data: StoredConversations; error: boolean } {
  const { value, error } = read(key)
  if (value === null) return { data: { conversations: [] }, error }
  if (!isRecord(value) || !Array.isArray(value.conversations)) return { data: { conversations: [] }, error: true }
  return { data: {
    conversations: value.conversations.flatMap(conversation => readConversation(conversation) ?? []),
    activeConversationId: typeof value.activeConversationId === 'string' ? value.activeConversationId : undefined,
  }, error: false }
}
export function saveConversations(key: string, data: StoredConversations): boolean {
  return write(key, data)
}

export function loadConnection(key: string): StoredConnection | undefined {
  const { value } = read(key)
  if (!isRecord(value) || typeof value.providerId !== 'string' || !isRecord(value.values)) return
  if (!Object.values(value.values).every(v => typeof v === 'string')) return
  return { providerId: value.providerId, values: value.values as ProviderValues }
}
/** Saves the connection, or removes it when `connection` is undefined, and tells the others. */
export function saveConnection(key: string, connection: StoredConnection | undefined): boolean {
  const saved = write(key, connection)
  for (const listener of connectionListeners.get(key) ?? []) listener()
  return saved
}

// Assistants that share a connection key follow each other's connect and disconnect: in this tab
// through these listeners, in other tabs through the storage event.
const connectionListeners = new Map<string, Set<() => void>>()
/** Calls `listener` after the connection under `key` may have changed. Returns the unsubscribe. */
export function subscribeConnection(key: string, listener: () => void): () => void {
  const listeners = connectionListeners.get(key) ?? new Set()
  listeners.add(listener)
  connectionListeners.set(key, listeners)
  const onStorage = (event: StorageEvent) => { if (event.key === key || event.key === null) listener() }
  window.addEventListener('storage', onStorage)
  return () => {
    listeners.delete(listener)
    if (!listeners.size) connectionListeners.delete(key)
    window.removeEventListener('storage', onStorage)
  }
}
/** Whether two saved connections are the same provider with the same values. */
export function sameConnection(a: StoredConnection | undefined, b: StoredConnection | undefined): boolean {
  if (!a || !b) return a === b
  const keys = Object.keys(a.values)
  return a.providerId === b.providerId && keys.length === Object.keys(b.values).length && keys.every(key => a.values[key] === b.values[key])
}
