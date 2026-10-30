import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { loadState, saveState, type StoredState } from '../frontend/byok/storage'

let items: Map<string, string>
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
