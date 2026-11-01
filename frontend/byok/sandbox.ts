import { newQuickJSWASMModuleFromVariant, shouldInterruptAfterDeadline, type QuickJSContext, type QuickJSHandle, type QuickJSSyncVariant } from 'quickjs-emscripten-core'
import { fileNameProblem, writeProblem, type WorkspaceFile } from './workspace'

// Runs a script the model wrote over a snapshot of a conversation's files, in QuickJS: a separate
// JavaScript engine compiled to WebAssembly, which sees only what is handed to it here. There is no
// network, page, storage or timer, only the files and console. Writes collect in the result and are
// saved by the caller only if the script finished, so a failed script changes nothing.
// Pure: the engine is passed in, so tests run it in Node; the browser runs it in a worker
// (sandbox-worker.ts), which a timeout can stop outright.

export const SCRIPT_LIMITS = {
  /** Wall-clock time the engine allows a script. */
  timeMs: 10_000,
  /** The engine's heap. */
  memoryBytes: 256 * 1024 * 1024,
  stackBytes: 1024 * 1024,
  /** Characters of the returned value (as JSON), and of the console output. */
  resultChars: 20_000,
  logChars: 20_000,
}

export interface ScriptRequest { code: string; files: Record<string, string> }
export type ScriptResult =
  | { ok: true; result: unknown; logs: string; logsTruncated: boolean; written: Record<string, string>; deleted: string[] }
  | { ok: false; error: string; logs: string; logsTruncated: boolean }

// What the script sees: files and console, over host functions it can't reach directly.
const PRELUDE = `"use strict";
(() => {
  const host = { read: __read, write: __write, remove: __remove, list: __list, log: __log };
  for (const name of ["__read", "__write", "__remove", "__list", "__log"]) delete globalThis[name];
  const text = value => typeof value === "string" ? value : JSON.stringify(value);
  const show = value => typeof value === "string" ? value : (() => { try { return JSON.stringify(value) } catch { return String(value) } })();
  const files = Object.freeze({
    list: () => JSON.parse(host.list()),
    read: name => host.read(String(name)),
    readJSON: name => { const content = host.read(String(name)); return content === undefined ? undefined : JSON.parse(content) },
    write: (name, value) => {
      if (value === undefined) throw new TypeError("files.write needs a string, or a value to save as JSON");
      host.write(String(name), text(value));
    },
    delete: name => host.remove(String(name)),
  });
  const log = (...values) => host.log(values.map(show).join(" "));
  Object.defineProperty(globalThis, "files", { value: files });
  Object.defineProperty(globalThis, "console", { value: Object.freeze({ log, info: log, warn: log, error: log }) });
})();`

function friendly(message: string): string {
  if (/interrupted/i.test(message)) return `The script ran longer than ${SCRIPT_LIMITS.timeMs / 1000} seconds and was stopped.`
  if (/out of memory/i.test(message)) return 'The script used more memory than allowed.'
  if (/stack overflow|maximum call stack/i.test(message)) return 'The script recursed too deeply.'
  return message.slice(0, 2000)
}

export async function runScript(variant: QuickJSSyncVariant, request: ScriptRequest): Promise<ScriptResult> {
  let logs = ''
  let logsTruncated = false
  const log = (line: string) => {
    if (logsTruncated) return
    if (logs.length + line.length + 1 > SCRIPT_LIMITS.logChars) { logs += line.slice(0, Math.max(0, SCRIPT_LIMITS.logChars - logs.length)); logsTruncated = true; return }
    logs += (logs ? '\n' : '') + line
  }
  const failed = (error: string): ScriptResult => ({ ok: false, error, logs, logsTruncated })
  // The files as the script changes them: the snapshot, then its writes and deletes.
  const written = new Map<string, string>()
  const deleted = new Set<string>()
  const current = (name: string) => written.has(name) ? written.get(name) : deleted.has(name) ? undefined : request.files[name]
  const listing = (): WorkspaceFile[] => {
    const names = new Set([...Object.keys(request.files), ...written.keys()])
    return [...names].flatMap(name => {
      const text = current(name)
      return text === undefined ? [] : [{ name, size: new TextEncoder().encode(text).length, modifiedAt: 0 }]
    }).sort((a, b) => a.name.localeCompare(b.name))
  }

  // A fresh engine each run: nothing a script leaves behind (or an engine it breaks) reaches the next.
  let engine
  try { engine = await newQuickJSWASMModuleFromVariant(variant) } catch { return failed('The script engine could not start.') }
  const runtime = engine.newRuntime()
  runtime.setMemoryLimit(SCRIPT_LIMITS.memoryBytes)
  runtime.setMaxStackSize(SCRIPT_LIMITS.stackBytes)
  runtime.setInterruptHandler(shouldInterruptAfterDeadline(Date.now() + SCRIPT_LIMITS.timeMs))
  const context = runtime.newContext()
  const define = (name: string, fn: (...args: string[]) => string | undefined | void) => {
    const handle = context.newFunction(name, (...args) => {
      const strings = args.map(arg => context.typeof(arg) === 'string' ? context.getString(arg) : '')
      try {
        const value = fn(...strings)
        return typeof value === 'string' ? context.newString(value) : context.undefined
      } catch (error) { return { error: context.newError(error instanceof Error ? error.message : String(error)) } }
    })
    context.setProp(context.global, name, handle)
    handle.dispose()
  }
  const check = (name: string) => { const problem = fileNameProblem(name); if (problem) throw new Error(problem) }
  define('__read', name => { check(name); return current(name) })
  define('__write', (name, text) => {
    check(name)
    const problem = writeProblem(listing(), name, text)
    if (problem) throw new Error(problem)
    written.set(name, text)
    deleted.delete(name)
  })
  define('__remove', name => {
    check(name)
    const existed = current(name) !== undefined
    written.delete(name)
    if (name in request.files) deleted.add(name)
    return existed ? 'true' : 'false'
  })
  define('__list', () => JSON.stringify(listing().map(({ name, size }) => ({ name, size }))))
  define('__log', line => log(line))

  // A value the script returned as JSON, or the error it threw: evaluated inside the engine.
  const settle = (context: QuickJSContext, handle: QuickJSHandle) => {
    const state = context.getPromiseState(handle)
    if (state.type === 'pending') return { error: 'The script returned a promise that never settled. Nothing here is asynchronous: return the value itself.' }
    if (state.type === 'rejected') {
      const error = context.dump(state.error) as { message?: string; stack?: string } | string
      state.error.dispose()
      return { error: typeof error === 'string' ? error : [error?.message, error?.stack].filter(Boolean).join('\n') }
    }
    const value = state.value
    const json = context.getProp(context.global, 'JSON')
    const stringify = context.getProp(json, 'stringify')
    const out = context.callFunction(stringify, json, value)
    stringify.dispose(); json.dispose(); value.dispose()
    if (out.error) {
      const error = context.dump(out.error) as { message?: string }
      out.error.dispose()
      return { error: 'The returned value is not JSON: ' + (error?.message ?? String(error)) }
    }
    const text = context.typeof(out.value) === 'string' ? context.getString(out.value) : undefined
    out.value.dispose()
    return { text }
  }

  try {
    const prelude = context.evalCode(PRELUDE, 'prelude.js')
    if (prelude.error) { prelude.error.dispose(); return failed('The script engine could not start.') }
    prelude.value.dispose()
    // The code is a strict function body: it can return a value, and its line numbers are its own.
    const evaluated = context.evalCode(`(async () => { "use strict"; ${request.code}\n})()`, 'script.js')
    if (evaluated.error) {
      const error = context.dump(evaluated.error) as { message?: string; stack?: string }
      evaluated.error.dispose()
      return failed(friendly([error?.message, error?.stack].filter(Boolean).join('\n') || String(error)))
    }
    const jobs = runtime.executePendingJobs()
    if (jobs.error) {
      const error = context.dump(jobs.error) as { message?: string }
      jobs.error.dispose()
      evaluated.value.dispose()
      return failed(friendly(error?.message ?? String(error)))
    }
    const settled = settle(context, evaluated.value)
    evaluated.value.dispose()
    if ('error' in settled) return failed(friendly(String(settled.error)))
    if (settled.text !== undefined && settled.text.length > SCRIPT_LIMITS.resultChars) {
      return failed(`The returned value is ${settled.text.length} characters as JSON, over the ${SCRIPT_LIMITS.resultChars} allowed. Return a summary, or write the full result to a file and return its name.`)
    }
    return {
      ok: true, result: settled.text === undefined ? null : JSON.parse(settled.text), logs, logsTruncated,
      written: Object.fromEntries(written), deleted: [...deleted],
    }
  } catch (error) {
    // The engine itself failed: an exhausted stack or heap can abort it.
    return failed(friendly(error instanceof Error ? error.message : String(error)))
  }
  // The engine is dropped whole, so the runtime isn't freed: after a stack overflow QuickJS can't free it cleanly.
}
