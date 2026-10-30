import type { ThreadMessage } from '@assistant-ui/react'
import type { ProviderValues } from './types'

export interface Conversation {
  id: string
  title: string
  updatedAt: number
  messages: readonly ThreadMessage[]
  draft?: string
}
export interface StoredConnection { providerId: string; values: ProviderValues }
export interface StoredState {
  version: 2
  connection?: StoredConnection
  conversations: Conversation[]
  activeConversationId?: string
}
// A random id from getRandomValues, which every origin has. crypto.randomUUID exists only in secure
// contexts (HTTPS or localhost), so a site served over plain HTTP on a LAN address would fail here.
function randomId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')
}
export function newConversation(): Conversation {
  return { id: randomId(), title: 'New conversation', updatedAt: Date.now(), messages: [], draft: '' }
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
function readConversations(value: unknown): Conversation[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((c: unknown) => {
    if (!isRecord(c) || typeof c.id !== 'string' || typeof c.title !== 'string' || !Array.isArray(c.messages)) return []
    const messages: ThreadMessage[] = []
    for (const m of c.messages) {
      if (!isRecord(m) || typeof m.id !== 'string' || !['user', 'assistant', 'system'].includes(String(m.role)) || !Array.isArray(m.content)) return []
      if (!m.content.every(p => isRecord(p) && typeof p.type === 'string' && (p.type !== 'text' || typeof p.text === 'string'))) return []
      const createdAt = new Date(typeof m.createdAt === 'string' ? m.createdAt : 0)
      if (!Number.isFinite(createdAt.getTime())) return []
      messages.push({
        ...m, createdAt,
        ...(m.role === 'assistant' && isRecord(m.status) && ['running', 'requires-action'].includes(String(m.status.type))
          ? { status: { type: 'incomplete', reason: 'cancelled' } } : {}),
      } as unknown as ThreadMessage)
    }
    return [{ id: c.id, title: c.title, updatedAt: typeof c.updatedAt === 'number' ? c.updatedAt : 0,
      messages, draft: typeof c.draft === 'string' ? c.draft : '' }]
  })
}
/** Reads the current format or migrates the original conversation-only array. Never logs secrets. */
export function loadState(key: string): { data: StoredState; error: boolean } {
  const empty: StoredState = { version: 2, conversations: [] }
  try {
    const value: unknown = JSON.parse(localStorage.getItem(key) || 'null')
    if (value === null) return { data: empty, error: false }
    if (Array.isArray(value)) return { data: { ...empty, conversations: readConversations(value) }, error: false }
    if (!isRecord(value) || value.version !== 2) return { data: empty, error: true }
    const connection = value.connection
    const validConnection = isRecord(connection) && typeof connection.providerId === 'string' &&
      isRecord(connection.values) && Object.values(connection.values).every(v => typeof v === 'string')
    return { data: {
      version: 2,
      conversations: readConversations(value.conversations),
      activeConversationId: typeof value.activeConversationId === 'string' ? value.activeConversationId : undefined,
      connection: validConnection ? { providerId: connection.providerId as string, values: connection.values as ProviderValues } : undefined,
    }, error: false }
  } catch { return { data: empty, error: true } }
}
/** The connection saved under a key: alone, or inside a key's full state. */
export function loadConnection(key: string): StoredConnection | undefined {
  return loadState(key).data.connection
}
export function saveConnection(key: string, connection: StoredConnection | undefined): boolean {
  const { data } = loadState(key)
  const saved = saveState(key, { ...data, connection })
  notifyConnection(key)
  return saved
}

// Assistants that share a connection key follow each other's connect and disconnect: in this tab
// through these listeners, in other tabs through the storage event.
const connectionListeners = new Map<string, Set<() => void>>()
export function notifyConnection(key: string): void {
  for (const listener of connectionListeners.get(key) ?? []) listener()
}
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
export function saveState(key: string, state: StoredState): boolean {
  try { localStorage.setItem(key, JSON.stringify(state)); return true } catch { return false }
}
