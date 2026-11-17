import test from 'node:test'
import assert from 'node:assert/strict'
import { MockLanguageModelV4 } from 'ai/test'
import { simulateReadableStream, type ToolSet } from 'ai'
import type { LanguageModelV4StreamPart } from '@ai-sdk/provider'
import type { ChatModelRunOptions, ChatModelRunResult, ThreadMessage } from '@assistant-ui/react'
import { createApp } from '../backend/app'
import { createBrowserAdapter, toModelMessages } from '../frontend/byok/agent'
import {
  declarationProblem, mcpCall, PAGE_CONTEXT_ATTRIBUTES as A, pageContextAttributes, pageContextData, PAGE_CONTEXT_LIMITS, PAGE_ELEMENT_TYPE, pageContextTools, pageElementRegistry, pageElementsIn,
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

// A source with the docs tools, and readers of the page.
const tools: ToolSet = {
  docs__table: { inputSchema: {} as never, execute: async () => ({ content: [{ type: 'text', text: 'ignored' }], structuredContent: { rows: 2 } }) },
  docs__totals: { inputSchema: {} as never, execute: async (input: unknown) => ({ content: [{ type: 'text', text: JSON.stringify({ total: 7, asked: input }) }] }) },
  docs__text: { inputSchema: {} as never, execute: async (input: unknown) => ({ content: [{ type: 'text', text: 'got ' + JSON.stringify(input) }] }) },
  docs__broken: { inputSchema: {} as never, execute: async () => ({ isError: true, content: [{ type: 'text', text: 'no access' }] }) },
  page_tool: { inputSchema: {} as never, execute: async () => 'a page tool' },
}
const mcp = mcpCall({ tools: () => tools, isMcp: name => name.startsWith('docs__'), callOptions: { toolCallId: 't', messages: [], context: {} } })
const source = (value: unknown) => JSON.stringify(value)

test('an element gives its description, and its data as text, as its source reads it, or none', async () => {
  assert.deepEqual(await read({ [A.description]: ' Totals ' }), { description: 'Totals' })
  assert.deepEqual(await read({ [A.description]: 'Totals', [A.data]: '{"a":1}' }), { description: 'Totals', data: '{"a":1}' }, 'raw data stays text')
  assert.deepEqual(await read({ [A.description]: 'Totals', [A.source]: source({ mcp: 'docs__table' }) }, { mcp }), { description: 'Totals', data: { rows: 2 } })
  assert.deepEqual(await read({ [A.description]: 'Totals', [A.source]: source([1, 'two']) }), { description: 'Totals', data: [1, 'two'] }, 'plain JSON stays as it is')
})

test('a source that fails, gives nothing or no JSON, or takes too long says which', async () => {
  const fails = (attributes: Record<string, string>, pattern: RegExp, options = {}) => assert.rejects(read({ [A.description]: 'X', ...attributes }, options), pattern)
  const readers = {
    nothing: () => undefined, big: () => 10n, never: () => new Promise(() => {}),
    throws: () => { throw new Error('no data') }, rejects: async () => { throw new Error('later no data') },
  }
  await fails({ [A.source]: '{mcp:' }, /data-ai-context-source is not JSON/)
  await fails({ [A.source]: source({ mcp: 'docs__totals', params: [1] }) }, /failed: The params for docs__totals are not an object/, { mcp })
  await fails({ [A.source]: source({ mcp: 'docs__broken' }) }, /failed: The tool reported an error: no access/, { mcp })
  await fails({ [A.source]: source({ reader: 'missing' }) }, /failed: The page offers no reader named "missing"/, { readers })
  await fails({ [A.source]: source({ reader: 'throws' }) }, /failed: no data/, { readers })
  await fails({ [A.source]: source({ reader: 'rejects' }) }, /failed: later no data/, { readers })
  await fails({ [A.source]: source({ reader: 'nothing' }) }, /data-ai-context-source gave nothing/, { readers })
  await fails({ [A.source]: source({ reader: 'big' }) }, /gave a value that is not JSON/, { readers })
  await fails({ [A.source]: source({ reader: 'never' }) }, /took longer than 0.05 seconds/, { readers, timeoutMs: 50 })
  const stop = new AbortController()
  const pending = read({ [A.description]: 'X', [A.source]: source({ reader: 'never' }) }, { readers, signal: stop.signal })
  stop.abort(new Error('Stopped'))
  await assert.rejects(pending, /Stopped/)
  // Both ways of giving data is a mistake in the page, found before anything runs.
  await fails({ [A.data]: '1', [A.source]: '1' }, /sets data-ai-context-data and data-ai-context-source; an element has at most one of them/)
  assert.equal(declarationProblem(element({ [A.description]: 'X', [A.source]: '1' })), undefined)
})

test('MCP() calls this answer\'s MCP tools by full name and gives structured content, else its text, as JSON when it is', async () => {
  assert.deepEqual(await mcp('docs__table'), { rows: 2 })
  assert.deepEqual(await mcp('docs__totals', { q: 1 }), { total: 7, asked: { q: 1 } })
  assert.equal(await mcp('docs__text', { q: 1 }), 'got {"q":1}')
  await assert.rejects(mcp('docs__broken'), /The tool reported an error: no access/)
  await assert.rejects(mcp('page_tool'), /no such MCP tool/, 'only MCP tools')
  await assert.rejects(mcp('table'), /full name/)
  await assert.rejects(mcp('docs__text', [] as never), /params is an object/)
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

test('the model reads an element the user added, through the MCP tools and the page\'s readers its source names', async () => {
  const app = await createApp()
  const url = await app.listen({ host: '127.0.0.1', port: 0 })
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { location: { href: url } } })
  try {
    const usage = { inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 1, text: 1, reasoning: 0 } }
    const stream = (chunks: LanguageModelV4StreamPart[]) => ({ stream: simulateReadableStream({ chunks, initialDelayInMs: null, chunkDelayInMs: null }) })
    const registry = pageElementRegistry()
    const clock = registry.add(element({ [A.description]: 'The clock', [A.source]: source({ time: { mcp: 'docs__get_current_time', params: { timezone: 'UTC' } }, zone: { reader: 'zone' } }) }))
    const gone = registry.add(element({ [A.description]: 'A removed panel' }, false))
    const call = (id: string, toolCallId: string) => ({ type: 'tool-call' as const, toolCallId, toolName: READ_ELEMENT_TOOL, input: JSON.stringify({ id }) })
    const model = new MockLanguageModelV4({ doStream: [
      stream([call(clock.id!, 'a'), call(gone.id!, 'b'), call('e'.repeat(32), 'c'), { type: 'finish', finishReason: { unified: 'tool-calls', raw: undefined }, usage }]),
      stream([{ type: 'text-start', id: 't' }, { type: 'text-delta', id: 't', delta: 'It is late.' }, { type: 'text-end', id: 't' },
        { type: 'finish', finishReason: { unified: 'stop', raw: undefined }, usage }]),
    ] })
    const adapter = createBrowserAdapter({ provider: { id: 'test', name: 'Test', description: '', defaultValues: {}, createModel: () => model },
      values: {}, servers: [{ id: 'docs', name: 'Docs', url: url + '/api/mcp' }], systemPrompt: '', maxSteps: 3, onError: () => {}, pageElements: registry,
      pageReaders: () => ({ zone: () => 'UTC' }) })
    const message = userWith([added(clock.id!, 'The clock'), added(gone.id!, 'A removed panel')], 'What time does it say?')
    let last: ChatModelRunResult = {}
    const options = { messages: [message], abortSignal: new AbortController().signal, runConfig: {}, context: {}, unstable_getMessage: () => message } as unknown as ChatModelRunOptions
    for await (const part of adapter.run(options) as AsyncGenerator<ChatModelRunResult>) last = part
    assert.ok(model.doStreamCalls[0].tools?.some(t => t.name === READ_ELEMENT_TOOL))
    const results = Object.fromEntries((last.content ?? []).flatMap(p => p.type === 'tool-call' ? [[p.toolCallId, p.result]] : []))
    assert.equal((results.a as { description: string }).description, 'The clock')
    // The MCP server's time and the page's reader, in one read.
    assert.match((results.a as { data: { time: string } }).data.time, /\d{1,2}:\d{2}/)
    assert.equal((results.a as { data: { zone: string } }).data.zone, 'UTC')
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
  const big = registry.add(element({ [A.description]: 'Every hour', [A.source]: source({ reader: 'series' }) }))
  const small = registry.add(element({ [A.description]: 'One figure', [A.data]: '42' }))
  const callOptions = { toolCallId: 't', messages: [], context: {} }
  const tools: ToolSet = {}
  const make = (canSave: boolean) => pageContextTools({ registry, elements: new Set([big.id!, small.id!]), tools: () => tools, isMcp: () => false, readers: () => ({ series: () => rows }), canSave })[READ_ELEMENT_TOOL]
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

test('a source is data: MCP calls, the host\'s readers and literal values, in parts, each part on its own', async () => {
  const seen: unknown[] = []
  const readers = { shown: async (args: unknown, context: { element: Element }) => { seen.push(args, context.element.getAttribute(A.description)); return { rows: [1, 2] } } }
  const source = {
    totals: { mcp: 'docs__totals', params: { range: '7d' } }, plain: { mcp: 'docs__totals' },
    page: { reader: 'shown', args: { key: 'panel-1' } }, broken: { mcp: 'docs__broken' }, missing: { reader: 'nope' },
    parts: [{ mcp: 'docs__totals' }, 2], note: 'kept as it is', mixed: { mcp: 'docs__totals', extra: 1 },
  }
  assert.deepEqual(await read({ [A.description]: 'Panel', [A.source]: JSON.stringify(source) }, { mcp, readers }), { description: 'Panel', data: {
    totals: { total: 7, asked: { range: '7d' } }, plain: { total: 7, asked: {} },
    page: { rows: [1, 2] }, broken: { error: 'The tool reported an error: no access' }, missing: { error: 'The page offers no reader named "nope".' },
    parts: [{ total: 7, asked: {} }, 2], note: 'kept as it is',
    // An object with other keys is parts, not a call: its mcp is a value like any other.
    mixed: { mcp: 'docs__totals', extra: 1 },
  } })
  assert.deepEqual(seen, [{ key: 'panel-1' }, 'Panel'])
  // A source that is one call fails as a whole; so does one that is not JSON or has bad params.
  await assert.rejects(read({ [A.description]: 'X', [A.source]: '{"mcp":"docs__broken"}' }, { mcp }), /data-ai-context-source failed: The tool reported an error: no access/)
  await assert.rejects(read({ [A.description]: 'X', [A.source]: '{mcp:' }, { mcp }), /data-ai-context-source is not JSON/)
  await assert.rejects(read({ [A.description]: 'X', [A.source]: '{"mcp":"docs__totals","params":[1]}' }, { mcp }), /params for docs__totals are not an object/)
  // Nothing in a source runs as code.
  Object.assign(globalThis, { pwned: false })
  await read({ [A.description]: 'X', [A.source]: JSON.stringify({ a: 'globalThis.pwned = true', b: { mcp: 'docs__totals', params: { q: '"); pwned = true; ("' } } }) }, { mcp })
  assert.equal((globalThis as { pwned?: boolean }).pwned, false)
})

test('pageContextAttributes writes the description and the source as JSON; pageContextData, text data', () => {
  assert.deepEqual(pageContextAttributes('Spend', { mcp: 'finops__totals', params: { measure: 'cost.billed' } }),
    { [A.description]: 'Spend', [A.source]: '{"mcp":"finops__totals","params":{"measure":"cost.billed"}}' })
  assert.deepEqual(pageContextAttributes('Just a label'), { [A.description]: 'Just a label' })
  assert.deepEqual(pageContextData('Selected team', 'Platform'), { [A.description]: 'Selected team', [A.data]: 'Platform' })
})
