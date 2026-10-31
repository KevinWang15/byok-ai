import test from 'node:test'
import assert from 'node:assert/strict'
import { MockLanguageModelV4 } from 'ai/test'
import { simulateReadableStream, tool } from 'ai'
import { z } from 'zod'
import type { LanguageModelV4StreamPart } from '@ai-sdk/provider'
import type { ChatModelRunOptions, ChatModelRunResult, ThreadMessage } from '@assistant-ui/react'
import { createApp } from '../backend/app'
import { createBrowserAdapter, toModelMessages, INCOMPLETE_MESSAGES, FINAL_STEP_INSTRUCTION, CONNECTION_LOST_MESSAGE } from '../frontend/byok/agent'

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
  // Silent every time: retried once, then the notice.
  const silent = new MockLanguageModelV4({ doStream: async () => stream([{ type: 'finish', finishReason: { unified: 'stop', raw: undefined }, usage }]) })
  const errors: string[] = []
  const adapter = createBrowserAdapter({ provider: { id: 'test', name: 'Test', description: '', defaultValues: {}, createModel: () => silent },
    values: {}, servers: [], systemPrompt: '', maxSteps: 2, onError: e => errors.push(e) })
  for await (const _ of adapter.run(runOptions()) as AsyncGenerator<ChatModelRunResult>) { void _ }
  assert.equal(errors.at(-1), INCOMPLETE_MESSAGES.empty)
  assert.equal(silent.doStreamCalls.length, 2, 'asked once more')
})
test('an answer that comes back empty is asked for once more, without tools, with what the tools returned', async () => {
  const app = await createApp()
  const url = await app.listen({ host: '127.0.0.1', port: 0 })
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { location: { href: url } } })
  const call = stream([{ type: 'tool-call', toolCallId: 'call-1', toolName: 'workspace__get_current_time', input: '{"timezone":"UTC"}' },
    { type: 'finish', finishReason: { unified: 'tool-calls', raw: undefined }, usage }])
  const blank = stream([{ type: 'text-start', id: 't' }, { type: 'text-delta', id: 't', delta: '\n\n' }, { type: 'text-end', id: 't' },
    { type: 'finish', finishReason: { unified: 'stop', raw: undefined }, usage }])
  const answer = stream([{ type: 'text-start', id: 'a' }, { type: 'text-delta', id: 'a', delta: 'The answer.' }, { type: 'text-end', id: 'a' },
    { type: 'finish', finishReason: { unified: 'stop', raw: undefined }, usage }])
  try {
    const model = new MockLanguageModelV4({ doStream: [call, blank, answer] })
    const errors: string[] = []
    const adapter = createBrowserAdapter({ provider: { id: 'test', name: 'Test', description: '', defaultValues: {}, createModel: () => model },
      values: {}, servers: [{ id: 'workspace', name: 'Workspace', url: url + '/api/mcp' }], systemPrompt: 'Help.', maxSteps: 4, onError: e => errors.push(e) })
    let last: ChatModelRunResult = {}
    for await (const part of adapter.run(runOptions()) as AsyncGenerator<ChatModelRunResult>) last = part
    assert.deepEqual(errors, [''])
    assert.ok(last.content?.some(p => p.type === 'text' && p.text.includes('The answer.')))
    const retry = model.doStreamCalls[2]
    assert.equal(retry.toolChoice?.type, 'none')
    assert.ok(JSON.stringify(retry.prompt).includes(FINAL_STEP_INSTRUCTION))
    // The retry sees the tool's result, not only the empty step.
    assert.ok(retry.prompt.some(m => m.role === 'tool'), 'tool results carried into the retry')
  } finally { await app.close() }
})
test('a dropped connection says so instead of blaming the key or CORS', async () => {
  const errors: string[] = []
  const model = new MockLanguageModelV4({ doStream: async () => { throw new TypeError('Failed to fetch') } })
  const adapter = createBrowserAdapter({ provider: { id: 'test', name: 'Test', description: '', defaultValues: {}, createModel: () => model },
    values: {}, servers: [], systemPrompt: '', maxSteps: 2, onError: e => errors.push(e) })
  await assert.rejects(async () => { for await (const _ of adapter.run(runOptions()) as AsyncGenerator<ChatModelRunResult>) { void _ } })
  assert.equal(errors.at(-1), CONNECTION_LOST_MESSAGE)
})
test('after the tool budget, and on the last step, the model answers without tools', async () => {
  const toolStep = (id: string) => stream([{ type: 'tool-call', toolCallId: id, toolName: 'missing_tool', input: '{}' },
    { type: 'tool-call', toolCallId: id + 'b', toolName: 'missing_tool', input: '{}' }, { type: 'finish', finishReason: { unified: 'tool-calls', raw: undefined }, usage }])
  const answer = stream([{ type: 'text-start', id: 't' }, { type: 'text-delta', id: 't', delta: 'Done.' }, { type: 'text-end', id: 't' },
    { type: 'finish', finishReason: { unified: 'stop', raw: undefined }, usage }])
  const run = async (maxSteps: number, maxToolCalls?: number) => {
    const model = new MockLanguageModelV4({ doStream: [toolStep('a'), toolStep('b'), answer] })
    const adapter = createBrowserAdapter({ provider: { id: 'test', name: 'Test', description: '', defaultValues: {}, createModel: () => model },
      values: {}, servers: [], systemPrompt: 'Help.', maxSteps, maxToolCalls, onError: () => {} })
    for await (const _ of adapter.run(runOptions()) as AsyncGenerator<ChatModelRunResult>) { void _ }
    return model.doStreamCalls.map(call => ({ toolChoice: call.toolChoice?.type, final: JSON.stringify(call.prompt).includes(FINAL_STEP_INSTRUCTION) }))
  }
  // Two calls spend a budget of two: the second step answers.
  assert.deepEqual((await run(10, 2)).map(call => call.final), [false, true])
  assert.equal((await run(10, 2))[1].toolChoice, 'none')
  // Without a budget only the last step is held to answering.
  assert.deepEqual((await run(3)).map(call => call.final), [false, false, true])
})
test('client tools run in the page beside MCP tools; names with "__" are refused', async () => {
  const model = new MockLanguageModelV4({ doStream: [
    stream([{ type: 'tool-call', toolCallId: 'c', toolName: 'set_title', input: '{"title":"Spend"}' },
      { type: 'finish', finishReason: { unified: 'tool-calls', raw: undefined }, usage }]),
    stream([{ type: 'text-start', id: 't' }, { type: 'text-delta', id: 't', delta: 'Renamed.' }, { type: 'text-end', id: 't' },
      { type: 'finish', finishReason: { unified: 'stop', raw: undefined }, usage }]),
  ] })
  const titles: string[] = []
  const define = (version: string) => ({ set_title: tool({ description: 'Rename the draft', inputSchema: z.object({ title: z.string() }),
    execute: async ({ title }) => { titles.push(`${version}:${title}`); return { ok: true } } }) })
  // The page's state changes after the run starts: the call runs the latest definition.
  let clientTools = define('first')
  const adapter = createBrowserAdapter({ provider: { id: 'test', name: 'Test', description: '', defaultValues: {}, createModel: () => model },
    values: {}, servers: [], clientTools: () => clientTools, systemPrompt: '', maxSteps: 3, onError: () => {} })
  let last: ChatModelRunResult = {}
  const run = adapter.run(runOptions()) as AsyncGenerator<ChatModelRunResult>
  clientTools = define('latest')
  for await (const part of run) last = part
  assert.deepEqual(titles, ['latest:Spend'])
  assert.deepEqual(model.doStreamCalls[0].tools?.map(t => t.name), ['set_title'])
  assert.ok(last.content?.some(p => p.type === 'tool-call' && p.toolName === 'set_title' && p.result !== undefined))
  const errors: string[] = []
  const bad = createBrowserAdapter({ provider: { id: 'test', name: 'Test', description: '', defaultValues: {}, createModel: () => model },
    values: {}, servers: [], clientTools: () => ({ a__b: clientTools.set_title }), systemPrompt: '', maxSteps: 1, onError: e => errors.push(e) })
  await assert.rejects(async () => { for await (const _ of bad.run(runOptions()) as AsyncGenerator<ChatModelRunResult>) { void _ } })
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
