import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import {
  isEmptyConversation, loadConnection, loadConversations, newConversation, sameConnection, saveConnection, saveConversations,
  subscribeConnection, type StoredConversations,
} from '../frontend/byok/storage'

let items: Map<string, string>
const windowListeners = new Map<string, Set<(event: { key: string | null }) => void>>()
Object.defineProperty(globalThis, 'window', { configurable: true, value: {
  addEventListener: (type: string, listener: (event: { key: string | null }) => void) => windowListeners.set(type, (windowListeners.get(type) ?? new Set()).add(listener)),
  removeEventListener: (type: string, listener: (event: { key: string | null }) => void) => windowListeners.get(type)?.delete(listener),
} })
beforeEach(() => {
  items = new Map()
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => items.set(key, value),
    removeItem: (key: string) => items.delete(key),
  } })
})
const at = new Date(Date.UTC(2026, 9, 30)).toISOString()
const userMessage = { id: 'u', role: 'user', createdAt: at, content: [{ type: 'text', text: 'Question' }], attachments: [] }

test('conversations and the open one round-trip through their key', () => {
  const data = { conversations: [{ id: 'c', title: 'Question', updatedAt: 1, draft: 'Unsent', messages: [userMessage] }], activeConversationId: 'c' }
  assert.equal(saveConversations('app', data as unknown as StoredConversations), true)
  const loaded = loadConversations('app')
  assert.equal(loaded.error, false)
  assert.equal(loaded.data.activeConversationId, 'c')
  assert.equal(loaded.data.conversations[0].draft, 'Unsent')
  assert.ok(loaded.data.conversations[0].messages[0].createdAt instanceof Date)
  assert.deepEqual(loadConversations('other'), { data: { conversations: [] }, error: false })
})
test('a response still running when the page closed comes back cancelled', () => {
  items.set('app', JSON.stringify({ conversations: [{ id: 'c', title: 'Question', updatedAt: 1, draft: '', messages: [
    userMessage, { id: 'a', role: 'assistant', createdAt: at, content: [{ type: 'text', text: 'Partial' }], status: { type: 'running' } },
  ] }] }))
  const message = loadConversations('app').data.conversations[0].messages[1]
  assert.equal(message.role, 'assistant')
  if (message.role === 'assistant') assert.deepEqual(message.status, { type: 'incomplete', reason: 'cancelled' })
})
test('records without the saved shape are skipped and the rest load', () => {
  items.set('app', JSON.stringify({ conversations: [
    { id: 'kept', title: 'Question', updatedAt: 1, draft: '', messages: [userMessage] },
    { id: 'no-date', title: 'Question', draft: '', messages: [userMessage] },
    { id: 'bad-message', title: 'Question', updatedAt: 1, draft: '', messages: [null] },
    { id: 'bad-created', title: 'Question', updatedAt: 1, draft: '', messages: [{ ...userMessage, createdAt: 'later' }] },
  ] }))
  assert.deepEqual(loadConversations('app').data.conversations.map(c => c.id), ['kept'])
})
test('unreadable storage is reported, never thrown', () => {
  items.set('app', '{')
  assert.equal(loadConversations('app').error, true)
  items.set('app', JSON.stringify([]))
  assert.equal(loadConversations('app').error, true)
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, get() { throw new Error('Denied') } })
  assert.equal(loadConversations('app').error, true)
  assert.equal(saveConversations('app', { conversations: [] }), false)
  assert.equal(saveConnection('app:connection', undefined), false)
})
test('a connection is saved under its own key and removed on disconnect', () => {
  const connection = { providerId: 'company', values: { apiKey: 'secret', baseURL: 'https://example.test/v1', organization: 'team' } }
  assert.equal(saveConnection('app:connection', connection), true)
  assert.deepEqual(loadConnection('app:connection'), connection)
  assert.equal(loadConnection('other:connection'), undefined)
  saveConnection('app:connection', undefined)
  assert.equal(items.has('app:connection'), false)
  items.set('app:connection', JSON.stringify({ providerId: 'x', values: { apiKey: 42 } }))
  assert.equal(loadConnection('app:connection'), undefined)
})
test('assistants sharing a connection key hear its changes, from this tab and from others', () => {
  let heard = 0
  const stop = subscribeConnection('shared', () => heard++)
  saveConnection('shared', { providerId: 'x', values: { apiKey: 'k' } })
  assert.equal(heard, 1)
  for (const listener of windowListeners.get('storage') ?? []) listener({ key: 'shared' })
  for (const listener of windowListeners.get('storage') ?? []) listener({ key: 'other' })
  assert.equal(heard, 2, 'only writes to this key count')
  stop()
  saveConnection('shared', undefined)
  assert.equal(heard, 2)
  assert.equal(windowListeners.get('storage')?.size, 0)
})
test('connections are the same when provider and every value match', () => {
  const a = { providerId: 'x', values: { apiKey: 'k' } }
  assert.equal(sameConnection(a, { providerId: 'x', values: { apiKey: 'k' } }), true)
  assert.equal(sameConnection(a, { providerId: 'x', values: { apiKey: 'j' } }), false)
  assert.equal(sameConnection(a, { providerId: 'y', values: { apiKey: 'k' } }), false)
  assert.equal(sameConnection(a, { providerId: 'x', values: { apiKey: 'k', model: 'm' } }), false)
  assert.equal(sameConnection(undefined, undefined), true)
  assert.equal(sameConnection(a, undefined), false)
})
test('a conversation counts once it has a message or a non-blank draft', () => {
  assert.equal(isEmptyConversation(newConversation()), true)
  assert.equal(isEmptyConversation({ messages: [], draft: '  ' }), true)
  assert.equal(isEmptyConversation({ messages: [], draft: 'x' }), false)
  assert.equal(isEmptyConversation({ messages: [userMessage as never], draft: '' }), false)
})
test('conversation ids are 32 hex digits, made without crypto.randomUUID', () => {
  const original = crypto.randomUUID
  Object.defineProperty(crypto, 'randomUUID', { configurable: true, value: undefined })
  try {
    const ids = new Set(Array.from({ length: 100 }, () => newConversation().id))
    assert.equal(ids.size, 100)
    for (const id of ids) assert.match(id, /^[0-9a-f]{32}$/)
  } finally { Object.defineProperty(crypto, 'randomUUID', { configurable: true, value: original }) }
})
