import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { defaultConnectionKey, isEmptyConversation, loadConnection, loadState, migrateConnection, newConversation, sameConnection, saveConnection, saveState, subscribeConnection, type StoredState } from '../frontend/byok/storage'

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
  } })
})
test('restores provider credentials and custom form values within their namespace', () => {
  const state: StoredState = { version: 2, conversations: [], connection: {
    providerId: 'company', values: { apiKey: 'test-key', model: 'model', baseURL: 'https://example.test/v1', organization: 'team' },
  } }
  assert.equal(saveState('one', state), true)
  assert.equal(loadState('one').error, false)
  assert.deepEqual(loadState('one').data.connection, state.connection)
  assert.equal(loadState('two').data.connection, undefined)
  assert.ok(!items.get('one')?.includes('createModel'))
})
test('reads legacy histories and repairs a response interrupted by reload', () => {
  const date = new Date().toISOString()
  items.set('legacy', JSON.stringify([{ id: 'chat', title: 'Question', updatedAt: 1, messages: [{
    id: 'response', role: 'assistant', content: [{ type: 'text', text: 'Partial response' }],
    createdAt: date, status: { type: 'running' },
  }] }]))
  const loaded = loadState('legacy')
  assert.equal(loaded.error, false)
  assert.equal(loaded.data.version, 2)
  const message = loaded.data.conversations[0].messages[0]
  assert.ok(message.createdAt instanceof Date)
  if (message.role === 'assistant') assert.deepEqual(message.status, { type: 'incomplete', reason: 'cancelled' })
  assert.equal(saveState('legacy', loaded.data), true)
  assert.equal(JSON.parse(items.get('legacy')!).version, 2)
})
test('bad persisted JSON or credentials cannot crash initialization', () => {
  items.set('bad', '{')
  assert.equal(loadState('bad').error, true)
  items.set('bad', JSON.stringify({ version: 2, connection: { providerId: 'x', values: { apiKey: 42 } }, conversations: [{ id: 'broken', title: 'Broken', messages: [null] }] }))
  assert.equal(loadState('bad').data.connection, undefined)
  assert.deepEqual(loadState('bad').data.conversations, [])
})
test('disconnect removes stored credentials without deleting histories or draft selection', () => {
  const state: StoredState = { version: 2, connection: { providerId: 'x', values: { apiKey: 'secret' } },
    conversations: [{ id: 'c', title: 'Draft', messages: [], updatedAt: 1, draft: 'Unsent text' }], activeConversationId: 'c' }
  saveState('app', state)
  saveState('app', { ...state, connection: undefined })
  assert.ok(!items.get('app')!.includes('secret'))
  assert.deepEqual(loadState('app').data.conversations, state.conversations)
  assert.equal(loadState('app').data.activeConversationId, 'c')
})
test('denied storage and quota failures are surfaced without throwing', () => {
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, get() { throw new Error('Denied') } })
  assert.equal(loadState('app').error, true)
  assert.equal(saveState('app', { version: 2, conversations: [] }), false)
})
test('a shared connection key holds the connection apart from any conversations', () => {
  const connection = { providerId: 'x', values: { apiKey: 'secret' } }
  saveState('shared', { version: 2, conversations: [{ id: 'c', title: 'Kept', messages: [], updatedAt: 1, draft: 'Unsent' }] })
  assert.equal(saveConnection('shared', connection), true)
  assert.deepEqual(loadConnection('shared'), connection)
  assert.equal(loadState('shared').data.conversations.length, 1, 'conversations kept')
  saveConnection('shared', undefined)
  assert.equal(loadConnection('shared'), undefined)
  assert.ok(!items.get('shared')!.includes('secret'))
})
test('assistants sharing a connection key hear its changes, from this tab and from others', () => {
  let heard = 0
  const stop = subscribeConnection('shared', () => heard++)
  saveConnection('shared', { providerId: 'x', values: { apiKey: 'k' } })
  assert.equal(heard, 1)
  for (const listener of windowListeners.get('storage') ?? []) listener({ key: 'shared' })
  for (const listener of windowListeners.get('storage') ?? []) listener({ key: 'other' })
  assert.equal(heard, 2, 'another tab wrote this key; other keys are ignored')
  stop()
  saveConnection('shared', undefined)
  assert.equal(heard, 2, 'unsubscribed')
  assert.equal(windowListeners.get('storage')?.size, 0)
  assert.equal(sameConnection({ providerId: 'x', values: { apiKey: 'k' } }, { providerId: 'x', values: { apiKey: 'k' } }), true)
  assert.equal(sameConnection({ providerId: 'x', values: { apiKey: 'k' } }, { providerId: 'x', values: { apiKey: 'j' } }), false)
  assert.equal(sameConnection(undefined, undefined), true)
})
test('new conversations get ids without crypto.randomUUID, which insecure origins lack', () => {
  const original = crypto.randomUUID
  Object.defineProperty(crypto, 'randomUUID', { configurable: true, value: undefined })
  try {
    const ids = new Set(Array.from({ length: 100 }, () => newConversation().id))
    assert.equal(ids.size, 100)
    for (const id of ids) assert.match(id, /^[0-9a-f]{32}$/)
  } finally { Object.defineProperty(crypto, 'randomUUID', { configurable: true, value: original }) }
})
test('a connection saved inside a namespace moves to its own key once, and a disconnect stays done', () => {
  const connection = { providerId: 'x', values: { apiKey: 'old-key' } }
  saveState('app', { version: 2, connection, conversations: [{ id: 'c', title: 'Kept', messages: [], updatedAt: 1, draft: 'Unsent' }], activeConversationId: 'c' })
  const key = defaultConnectionKey('app')
  migrateConnection('app', key)
  assert.deepEqual(loadConnection(key), connection)
  assert.equal(loadState('app').data.connection, undefined, 'the namespace no longer holds it')
  assert.equal(loadState('app').data.conversations.length, 1)
  assert.equal(loadState('app').data.activeConversationId, 'c')
  // Disconnected afterwards: migrating again brings nothing back.
  saveConnection(key, undefined)
  migrateConnection('app', key)
  assert.equal(loadConnection(key), undefined)
  // A key that already has a connection keeps it.
  saveConnection(key, { providerId: 'y', values: { apiKey: 'new-key' } })
  saveState('app', { version: 2, connection, conversations: [] })
  migrateConnection('app', key)
  assert.equal(loadConnection(key)?.providerId, 'y')
  assert.ok(!items.get('app')!.includes('old-key'))
})
test('empty conversations are never kept: ones saved before are dropped on load', () => {
  const message = { id: 'm', role: 'user', createdAt: new Date().toISOString(), content: [{ type: 'text', text: 'Hi' }] }
  saveState('app', { version: 2, conversations: [
    { id: 'empty', title: 'New conversation', messages: [], updatedAt: 3, draft: '' },
    { id: 'draft', title: 'New conversation', messages: [], updatedAt: 2, draft: 'Unsent' },
    { id: 'real', title: 'Hi', messages: [message as never], updatedAt: 1 },
  ] })
  assert.deepEqual(loadState('app').data.conversations.map(c => c.id), ['draft', 'real'])
  assert.equal(isEmptyConversation(newConversation()), true)
  assert.equal(isEmptyConversation({ messages: [], draft: '  ' }), true)
  assert.equal(isEmptyConversation({ messages: [], draft: 'x' }), false)
})
