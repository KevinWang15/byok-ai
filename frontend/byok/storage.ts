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
export function newConversation(): Conversation {
  return { id: crypto.randomUUID(), title: 'New conversation', updatedAt: Date.now(), messages: [], draft: '' }
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
export function saveState(key: string, state: StoredState): boolean {
  try { localStorage.setItem(key, JSON.stringify(state)); return true } catch { return false }
}
