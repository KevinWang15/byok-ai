import test from 'node:test'
import assert from 'node:assert/strict'
import variant from '@jitl/quickjs-wasmfile-release-sync'
import { tool, jsonSchema, type ToolSet } from 'ai'
import { MockLanguageModelV4 } from 'ai/test'
import type { ChatModelRunOptions, ChatModelRunResult, ThreadMessage } from '@assistant-ui/react'
import { fileNameProblem, memoryWorkspaceStore, writeProblem, WORKSPACE_LIMITS } from '../frontend/byok/workspace'
import { runScript, SCRIPT_LIMITS } from '../frontend/byok/sandbox'
import { toolResultText, workspaceTools } from '../frontend/byok/workspace-tools'
import { createBrowserAdapter } from '../frontend/byok/agent'
import type { ScriptRunner } from '../frontend/byok/script-runner'

const run = (code: string, files: Record<string, string> = {}) => runScript(variant, { code, files })
const nodeRunner: ScriptRunner = request => runScript(variant, request)
// The tools' execute, called as the AI SDK would.
const call = (tools: ToolSet, name: string, input: unknown) =>
  tools[name].execute!(input as never, { toolCallId: 'c', messages: [], abortSignal: new AbortController().signal } as never) as Promise<Record<string, unknown>>

test('file names are flat and plain; limits count UTF-8 bytes across the workspace', () => {
  for (const ok of ['data.csv', 'a', 'Q3_report-2.json']) assert.equal(fileNameProblem(ok), undefined, ok)
  for (const bad of ['', '.hidden', '../x', 'a/b', 'a..b', 'x'.repeat(129), 'é.txt', '-a']) assert.ok(fileNameProblem(bad), bad)
  assert.match(writeProblem([], 'big', 'x'.repeat(WORKSPACE_LIMITS.fileBytes + 1))!, /at most/)
  const full = Array.from({ length: WORKSPACE_LIMITS.files }, (_, i) => ({ name: 'f' + i, size: 1, modifiedAt: 0 }))
  assert.match(writeProblem(full, 'another', '')!, /files/)
  assert.equal(writeProblem(full, 'f0', 'replaced'), undefined, 'replacing a file adds none')
  const heavy = [{ name: 'a', size: WORKSPACE_LIMITS.totalBytes - 1, modifiedAt: 0 }]
  assert.match(writeProblem(heavy, 'b', 'é')!, /bytes/, 'é is two bytes')
})

test('the memory store keeps each conversation apart and removes one whole', async () => {
  const store = memoryWorkspaceStore()
  await store.open('one').write('a.txt', 'hello')
  assert.equal(await store.open('one').read('a.txt'), 'hello')
  assert.equal(await store.open('two').read('a.txt'), undefined)
  assert.deepEqual((await store.open('one').list()).map(f => [f.name, f.size]), [['a.txt', 5]])
  await store.removeConversation('one')
  assert.deepEqual(await store.open('one').list(), [])
  await assert.rejects(store.open('one').read('../etc'), /file name/)
})

test('a script reads files, returns a JSON value, and its writes and deletes come back', async () => {
  const result = await run(`
    const rows = files.readJSON("orders.json")
    console.log("rows", rows.length, { first: rows[0] })
    files.write("total.json", { total: rows.reduce((sum, row) => sum + row.amount, 0) })
    files.write("note.txt", "done")
    files.delete("old.txt")
    return { names: files.list().map(file => file.name), missing: files.read("nope") === undefined }`,
  { 'orders.json': JSON.stringify([{ amount: 2 }, { amount: 3.5 }]), 'old.txt': 'x' })
  assert.deepEqual(result, {
    ok: true, result: { names: ['note.txt', 'orders.json', 'total.json'], missing: true },
    logs: 'rows 2 {"first":{"amount":2}}', logsTruncated: false,
    written: { 'total.json': '{"total":5.5}', 'note.txt': 'done' }, deleted: ['old.txt'],
  })
  assert.deepEqual(await run('await null; return [1, "two"]'), { ok: true, result: [1, 'two'], logs: '', logsTruncated: false, written: {}, deleted: [] })
  assert.equal((await run('const x = 1')).ok && (await run('const x = 1') as { result: unknown }).result, null, 'no return is null')
})

test('a script sees only files and console', async () => {
  const result = await run('return [typeof fetch, typeof window, typeof setTimeout, typeof __read, typeof require, typeof files, typeof console.log]')
  assert.deepEqual(result.ok && result.result, ['undefined', 'undefined', 'undefined', 'undefined', 'undefined', 'object', 'function'])
  const frozen = await run('files.read = () => "x"; return files.read("a")', { a: 'real' })
  assert.equal(frozen.ok, false, 'files cannot be replaced (strict mode)')
})

test('failures report plainly, keep the logs, and change nothing', async () => {
  const thrown = await run('console.log("before"); files.write("a", "1"); throw new Error("boom")')
  assert.equal(thrown.ok, false)
  assert.ok(!thrown.ok && thrown.error.startsWith('boom'))
  assert.equal(thrown.logs, 'before')
  assert.ok(!('written' in thrown))
  const syntax = await run('return (')
  assert.ok(!syntax.ok && syntax.error.length > 0)
  const badName = await run('files.write("../up", "x")')
  assert.ok(!badName.ok && /file name/.test(badName.error))
  const tooBig = await run(`return "x".repeat(${SCRIPT_LIMITS.resultChars + 1})`)
  assert.ok(!tooBig.ok && /write the full result to a file/.test(tooBig.error))
  const bigint = await run('return 1n')
  assert.ok(!bigint.ok && /not JSON/.test(bigint.error))
  const deep = await run('const f = n => f(n + 1); f(0)')
  assert.ok(!deep.ok && /recursed too deeply/.test(deep.error))
  const memory = await run('const a = []; while (true) a.push("x".repeat(1e6))')
  assert.ok(!memory.ok && /memory/.test(memory.error), memory.ok ? '' : memory.error)
  const logs = await run(`for (let i = 0; i < 1e5; i++) console.log("line " + i)`)
  assert.ok(logs.ok && logs.logsTruncated && logs.logs.length <= SCRIPT_LIMITS.logChars)
  // Still works after all that: each run has its own engine.
  assert.deepEqual((await run('return 1 + 1')).ok, true)
})

test('a script that never ends is stopped at the deadline', { timeout: SCRIPT_LIMITS.timeMs + 10_000 }, async () => {
  const result = await run('while (true) {}')
  assert.ok(!result.ok && /longer than/.test(result.error))
})

test('MCP results are saved as their content; other results as JSON', () => {
  assert.equal(toolResultText({ content: [{ type: 'text', text: 'a' }, { type: 'text', text: 'b' }] }, true), 'a\nb')
  assert.equal(toolResultText({ content: [{ type: 'text', text: 'ignored' }], structuredContent: { x: 1 } }, true), '{\n  "x": 1\n}')
  assert.throws(() => toolResultText({ content: [{ type: 'text', text: 'denied' }], isError: true }, true), /denied/)
  assert.equal(toolResultText({ content: 'not mcp' }, false), '{\n  "content": "not mcp"\n}')
  assert.equal(toolResultText('plain', false), 'plain')
})

test('the workspace tools read in pages, save tool results, and commit script writes only on success', async () => {
  const store = memoryWorkspaceStore()
  const workspace = store.open('c')
  const others: ToolSet = {
    list_orders: tool({ inputSchema: jsonSchema<{ n: number }>({ type: 'object', properties: { n: { type: 'number' } } }),
      execute: async ({ n }) => Array.from({ length: n }, (_, i) => ({ id: i, amount: i * 10 })) }),
  }
  const tools: ToolSet = { ...others }
  Object.assign(tools, workspaceTools({ workspace: () => workspace, run: nodeRunner, tools: () => tools, isMcp: () => false }))

  const saved = await call(tools, 'workspace__save_tool_result', { tool: 'list_orders', arguments: { n: 100 }, file: 'orders.json' })
  assert.equal(saved.file, 'orders.json')
  assert.ok((saved.start as string).startsWith('[\n  {'))
  await assert.rejects(call(tools, 'workspace__save_tool_result', { tool: 'workspace__list_files', file: 'x' }), /directly/)
  await assert.rejects(call(tools, 'workspace__save_tool_result', { tool: 'nope', file: 'x' }), /no tool named nope/)

  const page = await call(tools, 'workspace__read_file', { name: 'orders.json', length: 10 })
  assert.equal(page.text, '[\n  {\n    ')
  assert.equal(page.nextOffset, 10)
  await assert.rejects(call(tools, 'workspace__read_file', { name: 'missing.txt' }), /no file named/)

  const sum = await call(tools, 'workspace__run_javascript', { code: 'const rows = files.readJSON("orders.json"); files.write("sum.txt", String(rows.reduce((s, r) => s + r.amount, 0))); return rows.length' })
  assert.deepEqual(sum, { ok: true, result: 100, written: ['sum.txt'], deleted: [] })
  assert.equal(await workspace.read('sum.txt'), '49500')

  const failed = await call(tools, 'workspace__run_javascript', { code: 'files.delete("sum.txt"); files.write("half.txt", "x"); console.log("hi"); null.x' })
  assert.equal(failed.ok, false)
  assert.equal(failed.logs, 'hi')
  assert.equal(await workspace.read('sum.txt'), '49500', 'a failed script deletes nothing')
  assert.equal(await workspace.read('half.txt'), undefined, 'and writes nothing')

  await call(tools, 'workspace__write_file', { name: 'n.txt', text: 'é' })
  assert.deepEqual(await call(tools, 'workspace__list_files', {}), { files: [{ name: 'n.txt', size: 2 }, { name: 'orders.json', size: (await workspace.read('orders.json'))!.length }, { name: 'sum.txt', size: 5 }] })
  assert.deepEqual(await call(tools, 'workspace__delete_file', { name: 'n.txt' }), { name: 'n.txt', deleted: true })
  assert.deepEqual(await call(tools, 'workspace__delete_file', { name: 'n.txt' }), { name: 'n.txt', deleted: false })
})

test('parallel workspace calls run one at a time', async () => {
  const workspace = memoryWorkspaceStore().open('c')
  const tools = workspaceTools({ workspace: () => workspace, run: nodeRunner, tools: () => ({}), isMcp: () => false })
  await workspace.write('n', '0')
  const bump = 'files.write("n", String(Number(files.read("n")) + 1))'
  await Promise.all(Array.from({ length: 5 }, () => call(tools, 'workspace__run_javascript', { code: bump })))
  assert.equal(await workspace.read('n'), '5')
})

const user = { role: 'user', id: 'u', createdAt: new Date(), content: [{ type: 'text', text: 'Hi' }], attachments: [], metadata: { custom: {} } } as ThreadMessage
const runOptions = { messages: [user], abortSignal: new AbortController().signal, runConfig: {}, context: {}, unstable_getMessage: () => user } as unknown as ChatModelRunOptions
test('the adapter offers the workspace tools when asked, and reserves the "workspace" MCP id', async () => {
  const usage = { inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 1, text: 1, reasoning: 0 } }
  const model = new MockLanguageModelV4({ doStream: async () => ({ stream: new ReadableStream({ start(c) {
    c.enqueue({ type: 'text-start', id: 't' }); c.enqueue({ type: 'text-delta', id: 't', delta: 'ok' }); c.enqueue({ type: 'text-end', id: 't' })
    c.enqueue({ type: 'finish', finishReason: { unified: 'stop', raw: undefined }, usage }); c.close()
  } }) }) })
  const provider = { id: 'test', name: 'Test', description: '', defaultValues: {}, createModel: () => model }
  const store = memoryWorkspaceStore()
  const adapter = (servers: { id: string; name: string; url: string }[], errors: string[]) => createBrowserAdapter({
    provider, values: {}, servers, systemPrompt: '', maxSteps: 2, onError: e => errors.push(e),
    workspace: { open: () => store.open('c'), run: nodeRunner },
  })
  for await (const _ of adapter([], []).run(runOptions) as AsyncGenerator<ChatModelRunResult>) { void _ }
  const offered = (model.doStreamCalls[0].tools ?? []).map(t => t.name).sort()
  assert.deepEqual(offered, ['workspace__delete_file', 'workspace__list_files', 'workspace__read_file', 'workspace__run_javascript', 'workspace__save_tool_result', 'workspace__write_file'])

  const errors: string[] = []
  await assert.rejects(async () => {
    for await (const _ of adapter([{ id: 'workspace', name: 'W', url: 'http://127.0.0.1:1/mcp' }], errors).run(runOptions) as AsyncGenerator<ChatModelRunResult>) { void _ }
  })
  assert.equal(model.doStreamCalls.length, 1, 'never reached the model')
})
