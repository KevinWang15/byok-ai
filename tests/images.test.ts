import test from 'node:test'
import assert from 'node:assert/strict'
import { MockLanguageModelV4 } from 'ai/test'
import type { ChatModelRunOptions, ChatModelRunResult, PendingAttachment, ThreadMessage } from '@assistant-ui/react'
import { memoryConversationFiles } from '../frontend/byok/conversation-files'
import { IMAGE_LIMITS, imageAttachmentAdapter } from '../frontend/byok/images'
import { createBrowserAdapter, IMAGE_NOTES, toModelMessages } from '../frontend/byok/agent'
import { loadConversations } from '../frontend/byok/storage'

const ID = 'a'.repeat(32)
const sent = (id = ID) => ({ id, type: 'image', name: 'chart.png', contentType: 'image/png', status: { type: 'complete' }, content: [] })
const userWith = (attachments: unknown[], text = 'What is in this?') =>
  ({ role: 'user', id: 'u', createdAt: new Date(), content: text ? [{ type: 'text', text }] : [], attachments, metadata: { custom: {} } }) as unknown as ThreadMessage

test('a user message with images becomes text and image parts, in order', async () => {
  const store = memoryConversationFiles().images('c')
  await store.save(ID, new Blob([new Uint8Array([137, 80, 78, 71])], { type: 'image/png' }))
  const [message] = await toModelMessages([userWith([sent()])], { store, accepted: true })
  assert.equal(message.role, 'user')
  const content = message.content as { type: string; text?: string; image?: Uint8Array; mediaType?: string }[]
  assert.deepEqual(content.map(p => p.type), ['text', 'image'])
  assert.equal(content[0].text, 'What is in this?')
  assert.deepEqual([...content[1].image!], [137, 80, 78, 71])
  assert.equal(content[1].mediaType, 'image/png')
  // Without images, a message stays plain text.
  assert.deepEqual(await toModelMessages([userWith([])], { store, accepted: true }), [{ role: 'user', content: 'What is in this?' }])
})

test('an image the model cannot see is a note: not accepted, or no longer stored', async () => {
  const store = memoryConversationFiles().images('c')
  await store.save(ID, new Blob(['x'], { type: 'image/png' }))
  const text = async (accepted: boolean, id = ID) => JSON.stringify(await toModelMessages([userWith([sent(id)], '')], { store, accepted }))
  assert.match(await text(false), new RegExp(IMAGE_NOTES.unsupported))
  assert.match(await text(true, 'b'.repeat(32)), new RegExp(IMAGE_NOTES.missing))
  assert.match(JSON.stringify(await toModelMessages([userWith([sent()])])), new RegExp(IMAGE_NOTES.unsupported), 'no store at all')
})

test('the adapter sends images only to a provider that accepts them', async () => {
  const usage = { inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 1, text: 1, reasoning: 0 } }
  const answer = () => ({ stream: new ReadableStream({ start(c) {
    c.enqueue({ type: 'text-start', id: 't' }); c.enqueue({ type: 'text-delta', id: 't', delta: 'A chart.' }); c.enqueue({ type: 'text-end', id: 't' })
    c.enqueue({ type: 'finish', finishReason: { unified: 'stop', raw: undefined }, usage }); c.close()
  } }) })
  const store = memoryConversationFiles().images('c')
  await store.save(ID, new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' }))
  const ask = async (acceptsImages: boolean) => {
    const model = new MockLanguageModelV4({ doStream: async () => answer() })
    const adapter = createBrowserAdapter({ provider: { id: 't', name: 'T', description: '', defaultValues: {}, createModel: () => model, acceptsImages },
      values: {}, servers: [], systemPrompt: '', maxSteps: 1, onError: () => {}, images: store })
    const message = userWith([sent()])
    for await (const _ of adapter.run({ messages: [message], abortSignal: new AbortController().signal, runConfig: {}, context: {}, unstable_getMessage: () => message } as unknown as ChatModelRunOptions) as AsyncGenerator<ChatModelRunResult>) { void _ }
    return JSON.stringify(model.doStreamCalls[0].prompt)
  }
  assert.match(await ask(true), /"type":"file".*"mediaType":"image\/png"/)
  const without = await ask(false)
  assert.doesNotMatch(without, /"type":"file"/)
  assert.match(without, new RegExp(IMAGE_NOTES.unsupported))
})

test('attaching: images are prepared on add, saved on send, and limited per message', async () => {
  const files = memoryConversationFiles()
  let attached = 0
  let conversation = 'first'
  const adapter = imageAttachmentAdapter({ attached: () => attached, images: () => files.images(conversation), prepare: async file => file })
  const file = new File([new Uint8Array([9, 9])], 'shot.png', { type: 'image/png' })
  const pending = await (adapter.add({ file }) as Promise<PendingAttachment>)
  assert.match(pending.id, /^[a-f0-9]{32}$/)
  assert.equal(pending.type, 'image')
  assert.equal(pending.contentType, 'image/png')
  conversation = 'second'
  const complete = await adapter.send(pending)
  assert.deepEqual({ ...complete }, { id: pending.id, type: 'image', name: 'shot.png', contentType: 'image/png', status: { type: 'complete' }, content: [] })
  assert.equal(await files.images('first').load(pending.id), undefined)
  assert.equal((await files.images('second').load(pending.id))?.size, 2, 'saved where the message was sent')
  attached = IMAGE_LIMITS.perMessage
  await assert.rejects(adapter.add({ file }) as Promise<unknown>, /at most 4 images/)
  // Added together (a paste of several), they count while they are prepared.
  attached = IMAGE_LIMITS.perMessage - 1
  let release!: () => void
  const slow = imageAttachmentAdapter({ attached: () => attached, images: () => files.images('c'), prepare: file => new Promise(resolve => { release = () => resolve(file) }) })
  const first = slow.add({ file }) as Promise<unknown>
  await assert.rejects(slow.add({ file }) as Promise<unknown>, /at most/)
  release()
  await first
  // A converted image is named for what is sent.
  const converted = imageAttachmentAdapter({ attached: () => 0, images: () => files.images('c'), prepare: async () => new Blob(['j'], { type: 'image/jpeg' }) })
  assert.equal((await (converted.add({ file: new File(['g'], 'anim.gif', { type: 'image/gif' }) }) as Promise<{ name: string }>)).name, 'anim.jpg')
})

test('saved user messages keep only well-formed image attachments', () => {
  const store = (attachments: unknown) => {
    const message = { id: 'm', role: 'user', createdAt: new Date().toISOString(), content: [{ type: 'text', text: 'hi' }], attachments, metadata: { custom: {} } }
    const values = new Map([['k', JSON.stringify({ conversations: [{ id: 'c', title: 't', updatedAt: 1, draft: '', messages: [message] }] })]])
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: (key: string) => values.get(key) ?? null } })
    return loadConversations('k').data.conversations.length
  }
  assert.equal(store([]), 1)
  assert.equal(store([sent()]), 1)
  assert.equal(store(undefined), 0, 'a user message always has attachments')
  assert.equal(store([{ ...sent(), id: '../x' }]), 0)
  assert.equal(store([{ ...sent(), type: 'document' }]), 0)
  assert.equal(store([{ ...sent(), status: { type: 'requires-action', reason: 'composer-send' } }]), 0, 'only sent images')
})
