import test from 'node:test'
import assert from 'node:assert/strict'
import { MockLanguageModelV4 } from 'ai/test'
import { simulateReadableStream } from 'ai'
import type { LanguageModelV4StreamPart } from '@ai-sdk/provider'
import type { ChatModelRunOptions, ChatModelRunResult, ThreadMessage } from '@assistant-ui/react'
import { createApp } from '../backend/app'
import { createBrowserAdapter, toModelMessages, INCOMPLETE_MESSAGES } from '../frontend/byok/agent'

const usage = { inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 1, text: 1, reasoning: 0 } }
function stream(chunks: LanguageModelV4StreamPart[]) {
  return { stream: simulateReadableStream({ chunks, initialDelayInMs: null, chunkDelayInMs: null }) }
}
const user = { role: 'user', id: 'u', createdAt: new Date(), content: [{ type: 'text', text: 'What time is it?' }], attachments: [], metadata: { custom: {} } } as ThreadMessage
function runOptions(signal = new AbortController().signal): ChatModelRunOptions {
  return { messages: [user], abortSignal: signal, runConfig: {}, context: {} as ChatModelRunOptions['context'], unstable_getMessage: () => user }
}
test('browser adapter discovers MCP tools, executes a call, and gives its result back to the model', async () => {
  const app = await createApp()
  const url = await app.listen({ host: '127.0.0.1', port: 0 })
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { location: { href: url } } })
  try {
    const model = new MockLanguageModelV4({ doStream: [
      stream([{ type: 'tool-call', toolCallId: 'call-1', toolName: 'workspace__get_current_time', input: '{"timezone":"UTC"}' },
        { type: 'finish', finishReason: { unified: 'tool-calls', raw: undefined }, usage }]),
      stream([{ type: 'text-start', id: 't' }, { type: 'text-delta', id: 't', delta: 'The current time is available.' }, { type: 'text-end', id: 't' },
        { type: 'finish', finishReason: { unified: 'stop', raw: undefined }, usage }]),
    ] })
    const errors: string[] = []
    const adapter = createBrowserAdapter({ provider: { id: 'test', name: 'Test', description: '', defaultValues: {}, createModel: () => model },
      values: {}, servers: [{ id: 'workspace', name: 'Workspace', url: url + '/api/mcp' }], systemPrompt: 'Help.', maxSteps: 3, onError: e => errors.push(e) })
    let last: ChatModelRunResult = {}
    for await (const part of adapter.run(runOptions()) as AsyncGenerator<ChatModelRunResult>) last = part
    assert.equal(model.doStreamCalls.length, 2)
    assert.ok(model.doStreamCalls[1].prompt.some(m => m.role === 'tool'))
    assert.ok(last.content?.some(p => p.type === 'tool-call' && p.result !== undefined))
    assert.ok(last.content?.some(p => p.type === 'text' && p.text.includes('current time')))
    assert.deepEqual(errors, [''])
  } finally { await app.close() }
})
test('an answer cut off by the output limit, or out of steps, says so; maxOutputTokens reaches the model', async () => {
  const run = async (finish: 'length' | 'tool-calls', maxSteps: number) => {
    const chunks: LanguageModelV4StreamPart[] = finish === 'length'
      ? [{ type: 'text-start', id: 't' }, { type: 'text-delta', id: 't', delta: 'Half an ans' }, { type: 'text-end', id: 't' },
        { type: 'finish', finishReason: { unified: 'length', raw: undefined }, usage }]
      : [{ type: 'tool-call', toolCallId: 'c', toolName: 'missing_tool', input: '{}' }, { type: 'finish', finishReason: { unified: 'tool-calls', raw: undefined }, usage }]
    const model = new MockLanguageModelV4({ doStream: async () => stream(chunks) })
    const errors: string[] = []
    const adapter = createBrowserAdapter({ provider: { id: 'test', name: 'Test', description: '', defaultValues: {}, createModel: () => model },
      values: {}, servers: [], systemPrompt: '', maxSteps, maxOutputTokens: 1234, onError: e => errors.push(e) })
    for await (const _ of adapter.run(runOptions()) as AsyncGenerator<ChatModelRunResult>) { void _ }
    return { errors, model }
  }
  const cut = await run('length', 3)
  assert.equal(cut.errors.at(-1), INCOMPLETE_MESSAGES.length)
  assert.equal(cut.model.doStreamCalls[0].maxOutputTokens, 1234)
  const steps = await run('tool-calls', 1)
  assert.equal(steps.errors.at(-1), INCOMPLETE_MESSAGES.steps)
})
test('interrupted tool calls always get a matching result in subsequent history', () => {
  const assistant = { role: 'assistant', content: [{ type: 'tool-call', toolCallId: 'c', toolName: 'tool', args: {}, argsText: '{}' }] } as unknown as ThreadMessage
  const result = toModelMessages([user, assistant])
  assert.equal(result.length, 3)
  assert.equal(result[2].role, 'tool')
  assert.match(JSON.stringify(result[2]), /interrupted/)
})
test('provider failures give a safe error without exposing credentials', async () => {
  const errors: string[] = []
  const model = new MockLanguageModelV4({ doStream: async () => { throw new Error('secret-key-123') } })
  const adapter = createBrowserAdapter({ provider: { id: 'test', name: 'Test', description: '', defaultValues: {}, createModel: () => model },
    values: {}, servers: [], systemPrompt: '', maxSteps: 2, onError: e => errors.push(e) })
  await assert.rejects(async () => { for await (const _ of adapter.run(runOptions()) as AsyncGenerator<ChatModelRunResult>) { void _ } }, /Provider or MCP request failed/)
  assert.ok(errors.at(-1)?.includes('CORS'))
  assert.ok(!errors.join().includes('secret-key'))
})
test('pre-aborted runs stop before connecting or invoking a model', async () => {
  const controller = new AbortController(); controller.abort()
  let invoked = false
  const adapter = createBrowserAdapter({ provider: { id: 'test', name: 'Test', description: '', defaultValues: {}, createModel: () => { invoked = true; return new MockLanguageModelV4() } },
    values: {}, servers: [{ id: 'test', name: 'Test', url: 'http://localhost:1' }], systemPrompt: '', maxSteps: 2, onError: () => {} })
  for await (const _ of adapter.run(runOptions(controller.signal)) as AsyncGenerator<ChatModelRunResult>) { void _ }
  assert.equal(invoked, false)
})
test('MCP rejects unrelated web origins and has no chat endpoint', async () => {
  const app = await createApp()
  try {
    const denied = await app.inject({ method: 'POST', url: '/api/mcp', headers: { origin: 'https://evil.example' }, payload: {} })
    assert.equal(denied.statusCode, 403)
    assert.equal((await app.inject({ method: 'POST', url: '/api/chat', payload: {} })).statusCode, 404)
    assert.equal((await app.inject({ url: '/health' })).statusCode, 200)
  } finally { await app.close() }
})
