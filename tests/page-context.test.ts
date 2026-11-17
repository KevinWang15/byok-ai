import test from 'node:test'
import assert from 'node:assert/strict'
import { MockLanguageModelV4 } from 'ai/test'
import { simulateReadableStream, type ToolSet } from 'ai'
import type { LanguageModelV4StreamPart } from '@ai-sdk/provider'
import type { ChatModelRunOptions, ChatModelRunResult, ThreadMessage } from '@assistant-ui/react'
import { createApp } from '../backend/app'
import { createBrowserAdapter, toModelMessages } from '../frontend/byok/agent'
import {
  declarationProblem, mcpCall, PAGE_CONTEXT_ATTRIBUTES as A, PAGE_CONTEXT_LIMITS, PAGE_ELEMENT_TYPE, pageContextTools, pageElementRegistry, pageElementsIn,
  readPageElement, READ_ELEMENT_TOOL,
} from '../frontend/byok/page-context'
import { memoryConversationFiles } from '../frontend/byok/conversation-files'
import { workspaceTools } from '../frontend/byok/workspace-tools'
import { loadConversations, saveConversations } from '../frontend/byok/storage'

// Elements as the page context reads them: attributes, and whether they are in the document.
const element = (attributes: Record<string, string>, isConnected = true) => ({
  isConnected,
  getAttribute: (name: string) => attributes[name] ?? null,
  hasAttribute: (name: string) => name in attributes,
}) as unknown as Element
const noMcp = mcpCall({ tools: () => ({}), isMcp: () => false, callOptions: { toolCallId: 't', messages: [], context: {} } })
const read = (attributes: Record<string, string>, options: Partial<Parameters<typeof readPageElement>[1]> = {}) =>
  readPageElement(element(attributes), { mcp: noMcp, ...options })

const ID = 'c'.repeat(32)
const added = (id = ID, name = 'Requests per hour chart', inside: string[] = []) => ({ id, type: 'page-element', name, contentType: PAGE_ELEMENT_TYPE, status: { type: 'complete' },
  content: [{ type: 'data', name: 'page-element', data: { inside } }] })
const userWith = (attachments: unknown[], text = 'Why the spike?') =>
  ({ role: 'user', id: 'u', createdAt: new Date(), content: text ? [{ type: 'text', text }] : [], attachments, metadata: { custom: {} } }) as unknown as ThreadMessage

test('an element gives its description, and its data as text, as a read expression\'s value, or none', async () => {
  assert.deepEqual(await read({ [A.description]: ' Totals ' }), { description: 'Totals' })
  assert.deepEqual(await read({ [A.description]: 'Totals', [A.data]: '{"a":1}' }), { description: 'Totals', data: '{"a":1}' }, 'raw data stays text')
  assert.deepEqual(await read({ [A.description]: 'Totals', [A.read]: '({ rows: [1, 2] })' }), { description: 'Totals', data: { rows: [1, 2] } })
  assert.deepEqual(await read({ [A.description]: 'Totals', [A.read]: 'Promise.resolve("later")' }), { description: 'Totals', data: 'later' }, 'promises are awaited')
  // The expression sees the page's globals, and the element itself.
  Object.assign(globalThis, { pageTotals: (id: string) => ({ id, total: 3 }) })
  assert.deepEqual(await read({ [A.description]: 'Totals', [A.read]: 'pageTotals(element.getAttribute("data-id"))', 'data-id': 'x' }), { description: 'Totals', data: { id: 'x', total: 3 } })
})

test('a read expression that fails, returns nothing or no JSON, or takes too long says which', async () => {
  const fails = (attributes: Record<string, string>, pattern: RegExp, options = {}) => assert.rejects(read({ [A.description]: 'X', ...attributes }, options), pattern)
  await fails({ [A.read]: 'return 1' }, /is not a JavaScript expression/)
  await fails({ [A.read]: 'missingGlobal()' }, /failed: missingGlobal is not defined/)
  await fails({ [A.read]: 'Promise.reject(new Error("no data"))' }, /failed: no data/)
  await fails({ [A.read]: 'undefined' }, /returned nothing/)
  await fails({ [A.read]: '10n' }, /not JSON/)
  await fails({ [A.read]: 'new Promise(() => {})' }, /took longer than 0.05 seconds/, { timeoutMs: 50 })
  const stop = new AbortController()
  const pending = read({ [A.description]: 'X', [A.read]: 'new Promise(() => {})' }, { signal: stop.signal })
  stop.abort(new Error('Stopped'))
  await assert.rejects(pending, /Stopped/)
  // Both ways of giving data is a mistake in the page, found before anything runs.
  await fails({ [A.data]: '1', [A.read]: '1' }, /sets both/)
  assert.match(declarationProblem(element({ [A.description]: 'X', [A.data]: '1', [A.read]: '1' }))!, /at most one/)
  assert.equal(declarationProblem(element({ [A.description]: 'X', [A.read]: '1' })), undefined)
})

test('MCP() calls this answer\'s MCP tools by full name and gives structured content, else text', async () => {
  const tools: ToolSet = {
    docs__table: { inputSchema: {} as never, execute: async () => ({ content: [{ type: 'text', text: 'ignored' }], structuredContent: { rows: 2 } }) },
    docs__text: { inputSchema: {} as never, execute: async (input: unknown) => ({ content: [{ type: 'text', text: 'got ' + JSON.stringify(input) }] }) },
    docs__broken: { inputSchema: {} as never, execute: async () => ({ isError: true, content: [{ type: 'text', text: 'no access' }] }) },
    page_tool: { inputSchema: {} as never, execute: async () => 'a page tool' },
  }
  const mcp = mcpCall({ tools: () => tools, isMcp: name => name.startsWith('docs__'), callOptions: { toolCallId: 't', messages: [], context: {} } })
  assert.deepEqual(await mcp('docs__table'), { rows: 2 })
  assert.equal(await mcp('docs__text', { q: 1 }), 'got {"q":1}')
  await assert.rejects(mcp('docs__broken'), /The tool reported an error: no access/)
  await assert.rejects(mcp('page_tool'), /no such MCP tool/, 'only MCP tools')
  await assert.rejects(mcp('table'), /full name/)
  await assert.rejects(mcp('docs__text', [] as never), /params is an object/)
  // From a read expression, with its promise.
  assert.deepEqual(await read({ [A.description]: 'X', [A.read]: 'MCP("docs__table", {}).then(r => r.rows * 10)' }, { mcp }), { description: 'X', data: 20 })
})

test('a message lists its elements for the model after its text, readable or not', async () => {
  const [message] = await toModelMessages([userWith([added()])], { pageElements: true })
  assert.equal(message.role, 'user')
  const text = message.content as string
  assert.match(text, /^Why the spike\?\nThe user added an element from the page to this message\. Read the data of the ones you need with page__read_element:/)
  assert.match(text, new RegExp(`- ${ID}: "Requests per hour chart"$`))
  // An element inside others says which, outermost first.
  const [nested] = await toModelMessages([userWith([added(), added('d'.repeat(32), 'Errors', ['Overview', 'Traffic "now"'])])], { pageElements: true })
  assert.match(nested.content as string, new RegExp(`- ${'d'.repeat(32)}: "Errors" \\(inside "Overview" › "Traffic \\\\"now\\\\""\\)$`))
  const [off] = await toModelMessages([userWith([added(), added('d'.repeat(32), 'Line "two"\nwrapped')], '')])
  assert.match(off.content as string, /^The user added 2 elements .*Reading them is not available now/)
  assert.match(off.content as string, /"Line \\"two\\"\\nwrapped"/, 'descriptions are quoted on one line')
  assert.deepEqual([...pageElementsIn([userWith([added()]), userWith([])])], [ID])
})

test('messages with page elements are saved and load again; other attachments are refused', () => {
  const store = new Map<string, string>()
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: (key: string) => store.get(key) ?? null, setItem: (key: string, value: string) => void store.set(key, value), removeItem: (key: string) => void store.delete(key),
  } })
  const conversation = (attachment: unknown) => ({ id: 'x', title: 'T', updatedAt: 1, draft: '', messages: [userWith([attachment])] })
  saveConversations('k', { conversations: [conversation(added(ID, 'X', ['Outer'])), conversation({ ...added(), id: 'not-an-id' }), conversation({ ...added(), contentType: 'text/plain' }),
    conversation({ ...added(), content: [] }), conversation({ ...added(), content: [{ type: 'data', name: 'page-element', data: { inside: [1] } }] })] })
  const { data } = loadConversations('k')
  assert.equal(data.conversations.length, 1)
  assert.deepEqual(data.conversations[0].messages[0].attachments, [added(ID, 'X', ['Outer'])], 'only one with its place')
})

test('the model reads an element the user added, through an MCP tool the page calls', async () => {
  const app = await createApp()
  const url = await app.listen({ host: '127.0.0.1', port: 0 })
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { location: { href: url } } })
  try {
    const usage = { inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 1, text: 1, reasoning: 0 } }
    const stream = (chunks: LanguageModelV4StreamPart[]) => ({ stream: simulateReadableStream({ chunks, initialDelayInMs: null, chunkDelayInMs: null }) })
    const registry = pageElementRegistry()
    const clock = registry.add(element({ [A.description]: 'The clock', [A.read]: 'MCP("docs__get_current_time", { timezone: "UTC" }).then(time => ({ time }))' }))
    const gone = registry.add(element({ [A.description]: 'A removed panel' }, false))
    const call = (id: string, toolCallId: string) => ({ type: 'tool-call' as const, toolCallId, toolName: READ_ELEMENT_TOOL, input: JSON.stringify({ id }) })
    const model = new MockLanguageModelV4({ doStream: [
      stream([call(clock.id!, 'a'), call(gone.id!, 'b'), call('e'.repeat(32), 'c'), { type: 'finish', finishReason: { unified: 'tool-calls', raw: undefined }, usage }]),
      stream([{ type: 'text-start', id: 't' }, { type: 'text-delta', id: 't', delta: 'It is late.' }, { type: 'text-end', id: 't' },
        { type: 'finish', finishReason: { unified: 'stop', raw: undefined }, usage }]),
    ] })
    const adapter = createBrowserAdapter({ provider: { id: 'test', name: 'Test', description: '', defaultValues: {}, createModel: () => model },
      values: {}, servers: [{ id: 'docs', name: 'Docs', url: url + '/api/mcp' }], systemPrompt: '', maxSteps: 3, onError: () => {}, pageElements: registry })
    const message = userWith([added(clock.id!, 'The clock'), added(gone.id!, 'A removed panel')], 'What time does it say?')
    let last: ChatModelRunResult = {}
    const options = { messages: [message], abortSignal: new AbortController().signal, runConfig: {}, context: {}, unstable_getMessage: () => message } as unknown as ChatModelRunOptions
    for await (const part of adapter.run(options) as AsyncGenerator<ChatModelRunResult>) last = part
    assert.ok(model.doStreamCalls[0].tools?.some(t => t.name === READ_ELEMENT_TOOL))
    const results = Object.fromEntries((last.content ?? []).flatMap(p => p.type === 'tool-call' ? [[p.toolCallId, p.result]] : []))
    assert.equal((results.a as { description: string }).description, 'The clock')
    assert.match((results.a as { data: { time: string } }).data.time, /\d{1,2}:\d{2}/)
    assert.match(JSON.stringify(results.b), /no longer on the page/)
    assert.match(JSON.stringify(results.c), /No element with the id/)
    // An MCP server may not take the tools' id.
    const taken = createBrowserAdapter({ provider: { id: 'test', name: 'Test', description: '', defaultValues: {}, createModel: () => model },
      values: {}, servers: [{ id: 'page', name: 'Page', url: url + '/api/mcp' }], systemPrompt: '', maxSteps: 1, onError: () => {}, pageElements: registry })
    await assert.rejects(async () => { for await (const _ of taken.run(options) as AsyncGenerator<ChatModelRunResult>) void _ })
  } finally { await app.close() }
})

test('a large read gives the model its start; saved to the workspace, it is whole', async () => {
  const registry = pageElementRegistry()
  const rows = Array.from({ length: 3000 }, (_, i) => ({ hour: i, requests: i * 7 }))
  Object.assign(globalThis, { bigSeries: () => rows })
  const big = registry.add(element({ [A.description]: 'Every hour', [A.read]: 'bigSeries()' }))
  const small = registry.add(element({ [A.description]: 'One figure', [A.data]: '42' }))
  const callOptions = { toolCallId: 't', messages: [], context: {} }
  const tools: ToolSet = {}
  const make = (canSave: boolean) => pageContextTools({ registry, elements: new Set([big.id!, small.id!]), tools: () => tools, isMcp: () => false, canSave })[READ_ELEMENT_TOOL]
  const read = (canSave: boolean, id: string) => make(canSave).execute!({ id }, callOptions) as Promise<Record<string, unknown>>

  assert.deepEqual(await read(true, small.id!), { description: 'One figure', data: '42' }, 'small reads are whole')
  const part = await read(true, big.id!)
  assert.equal(part.description, 'Every hour')
  assert.equal(part.characters, JSON.stringify(rows).length)
  assert.equal(part.start, JSON.stringify(rows).slice(0, 2000))
  assert.match(String(part.note), /workspace__save_tool_result \(tool "page__read_element"/)
  assert.doesNotMatch(String((await read(false, big.id!)).note), /workspace/, 'without a workspace, no tool to point to')
  assert.ok(JSON.stringify(part).length < PAGE_CONTEXT_LIMITS.resultChars)

  // Saving the read saves all of it.
  Object.assign(tools, { [READ_ELEMENT_TOOL]: make(true) })
  const workspace = memoryConversationFiles().workspace('c')
  const save = workspaceTools({ workspace: () => workspace, run: async () => { throw new Error('unused') }, tools: () => tools, isMcp: () => false }).workspace__save_tool_result
  await save.execute!({ tool: READ_ELEMENT_TOOL, arguments: { id: big.id! }, file: 'hours.json' }, callOptions)
  assert.deepEqual(JSON.parse((await workspace.read('hours.json'))!).data, rows)
})

test('a policy that refuses compiled code says so, rather than blaming the expression', async () => {
  const original = globalThis.Function
  // What a browser does under a Content-Security-Policy without 'unsafe-eval'.
  globalThis.Function = function () { throw new EvalError('Refused to evaluate a string as JavaScript') } as unknown as FunctionConstructor
  try {
    await assert.rejects(read({ [A.description]: 'X', [A.read]: '1' }), /Content-Security-Policy doesn't allow data-ai-context-read \(it needs 'unsafe-eval'\)/)
  } finally { globalThis.Function = original }
})
