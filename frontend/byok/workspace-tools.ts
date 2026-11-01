import { jsonSchema, tool, type ToolSet } from 'ai'
import type { Workspace } from './conversation-files'
import { SCRIPT_LIMITS } from './sandbox'
import type { ScriptRunner } from './script-runner'

// The workspace tools: the assistant keeps files beside the conversation and runs JavaScript over
// them. Large data goes into files rather than into the conversation: a tool's result can be saved
// straight to a file (save_tool_result), and a script reads it and returns only what the answer
// needs. The tools are named `workspace__…`, so the "workspace" MCP server id is reserved.

export const WORKSPACE_ID = 'workspace'
const READ_DEFAULT = 4_000
const READ_MAX = 20_000

/** What a tool call returned, as text to save: an MCP result's content, anything else as JSON. */
export function toolResultText(result: unknown, fromMcp: boolean): string {
  if (fromMcp && typeof result === 'object' && result !== null) {
    const { content, structuredContent, isError } = result as { content?: unknown; structuredContent?: unknown; isError?: boolean }
    if (isError) throw new Error('The tool reported an error: ' + mcpText(content).slice(0, 2000))
    if (structuredContent !== undefined) return JSON.stringify(structuredContent, null, 2)
    if (Array.isArray(content)) return mcpText(content)
  }
  return typeof result === 'string' ? result : JSON.stringify(result, null, 2) ?? 'null'
}
const mcpText = (content: unknown) => Array.isArray(content)
  ? content.map(part => part?.type === 'text' && typeof part.text === 'string' ? part.text : JSON.stringify(part)).join('\n')
  : JSON.stringify(content) ?? ''

// A short view of saved text, so the model can write a script without reading the whole file.
function preview(text: string) {
  return { size: new TextEncoder().encode(text).length, characters: text.length, start: text.slice(0, 600) }
}

export function workspaceTools(options: {
  /** The open conversation's workspace, opened when a tool first needs it. */
  workspace: () => Workspace
  run: ScriptRunner
  /** The other tools of this answer, which save_tool_result can call. */
  tools: () => ToolSet
  /** Which of those are MCP tools, whose results are MCP content. */
  isMcp: (name: string) => boolean
}): ToolSet {
  // One workspace operation at a time: a script works on a snapshot, so parallel calls must not interleave.
  let queue: Promise<unknown> = Promise.resolve()
  const serial = <T>(work: () => Promise<T>): Promise<T> => {
    const next = queue.then(work, work)
    queue = next.catch(() => {})
    return next
  }
  const ws = () => options.workspace()

  return {
    [WORKSPACE_ID + '__list_files']: tool({
      description: 'List the files in this conversation\'s workspace, with their sizes in bytes.',
      inputSchema: jsonSchema<Record<string, never>>({ type: 'object', properties: {}, additionalProperties: false }),
      execute: () => serial(async () => ({ files: (await ws().list()).map(({ name, size }) => ({ name, size })) })),
    }),
    [WORKSPACE_ID + '__read_file']: tool({
      description: `Read part of a workspace file as text: up to ${READ_MAX} characters from offset (default ${READ_DEFAULT}). To compute over a large file, use ${WORKSPACE_ID}__run_javascript instead of reading it all.`,
      inputSchema: jsonSchema<{ name: string; offset?: number; length?: number }>({
        type: 'object', additionalProperties: false, required: ['name'],
        properties: {
          name: { type: 'string' },
          offset: { type: 'integer', minimum: 0, description: 'Character offset to start at. Default 0.' },
          length: { type: 'integer', minimum: 1, maximum: READ_MAX, description: `Characters to read. Default ${READ_DEFAULT}.` },
        },
      }),
      execute: ({ name, offset = 0, length = READ_DEFAULT }) => serial(async () => {
        const text = await ws().read(name)
        if (text === undefined) throw new Error(`There is no file named ${name}.`)
        const start = Math.max(0, Math.floor(offset))
        const end = Math.min(text.length, start + Math.min(READ_MAX, Math.max(1, Math.floor(length))))
        return { name, characters: text.length, offset: start, text: text.slice(start, end), ...(end < text.length ? { nextOffset: end } : {}) }
      }),
    }),
    [WORKSPACE_ID + '__write_file']: tool({
      description: 'Create or replace a workspace file with the given text. Names are letters, digits, ".", "-" and "_", like data.csv.',
      inputSchema: jsonSchema<{ name: string; text: string }>({
        type: 'object', additionalProperties: false, required: ['name', 'text'],
        properties: { name: { type: 'string' }, text: { type: 'string' } },
      }),
      execute: ({ name, text }) => serial(async () => {
        await ws().write(name, text)
        return { name, size: new TextEncoder().encode(text).length }
      }),
    }),
    [WORKSPACE_ID + '__delete_file']: tool({
      description: 'Delete a workspace file.',
      inputSchema: jsonSchema<{ name: string }>({ type: 'object', additionalProperties: false, required: ['name'], properties: { name: { type: 'string' } } }),
      execute: ({ name }) => serial(async () => ({ name, deleted: await ws().remove(name) })),
    }),
    [WORKSPACE_ID + '__save_tool_result']: tool({
      description: `Call another of your tools and save its result to a workspace file instead of returning it here. Use it for results too large to read, then compute over the file with ${WORKSPACE_ID}__run_javascript. Returns the file's size and its first characters.`,
      inputSchema: jsonSchema<{ tool: string; arguments?: Record<string, unknown>; file: string }>({
        type: 'object', additionalProperties: false, required: ['tool', 'file'],
        properties: {
          tool: { type: 'string', description: 'The tool\'s full name, as you would call it.' },
          arguments: { type: 'object', description: 'The tool\'s arguments.' },
          file: { type: 'string', description: 'The file to save the result to, like orders.json.' },
        },
      }),
      execute: async ({ tool: name, arguments: input = {}, file }, callOptions) => {
        if (name.startsWith(WORKSPACE_ID + '__')) throw new Error('Workspace tools can\'t be saved: call them directly.')
        const target = options.tools()[name]
        if (!target?.execute) throw new Error(`There is no tool named ${name}.`)
        const result = await target.execute(input as never, callOptions as never)
        const text = toolResultText(result, options.isMcp(name))
        return serial(async () => {
          await ws().write(file, text)
          return { file, ...preview(text) }
        })
      },
    }),
    [WORKSPACE_ID + '__run_javascript']: tool({
      description: [
        'Run JavaScript over the workspace files, for calculation and analysis, and get back what the code returns.',
        'The code is the body of an async function: `return` a JSON value (a summary, not raw data;',
        `at most ${SCRIPT_LIMITS.resultChars} characters as JSON). Available: files.list() → [{name, size}], files.read(name) → text or undefined,`,
        'files.readJSON(name), files.write(name, textOrValue) (values are saved as JSON), files.delete(name), console.log(...).',
        'Standard JavaScript only: no fetch, DOM, timers or imports.',
        `It stops after ${SCRIPT_LIMITS.timeMs / 1000} seconds. Writes are saved only if the code finishes without an error.`,
      ].join(' '),
      inputSchema: jsonSchema<{ code: string }>({
        type: 'object', additionalProperties: false, required: ['code'],
        properties: { code: { type: 'string', description: 'For example: const rows = files.readJSON("orders.json"); return rows.length' } },
      }),
      execute: ({ code }, { abortSignal }) => serial(async () => {
        const workspace = ws()
        const listed = await workspace.list()
        const files: Record<string, string> = {}
        for (const file of listed) files[file.name] = (await workspace.read(file.name)) ?? ''
        const outcome = await options.run({ code, files }, abortSignal)
        const logs = outcome.logs ? { logs: outcome.logs + (outcome.logsTruncated ? '\n…(more output was cut)' : '') } : {}
        if (!outcome.ok) return { ok: false, error: outcome.error, ...logs }
        // Deletes first, so space they free counts for the writes.
        for (const name of outcome.deleted) await workspace.remove(name)
        for (const [name, text] of Object.entries(outcome.written)) await workspace.write(name, text)
        const changed = [...Object.keys(outcome.written), ...outcome.deleted]
        return { ok: true, result: outcome.result, ...logs, ...(changed.length ? { written: Object.keys(outcome.written), deleted: outcome.deleted } : {}) }
      }),
    }),
  }
}
