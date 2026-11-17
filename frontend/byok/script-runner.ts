import { SCRIPT_LIMITS, type ScriptRequest, type ScriptResult } from './script'

/** Runs a script off the page, in a worker of its own (sandbox.ts). */
export type ScriptRunner = (request: ScriptRequest, signal?: AbortSignal) => Promise<ScriptResult>

// The engine stops a script at its deadline; the worker is ended a little later regardless, and
// at once when the answer is stopped.
const GRACE_MS = 5_000

// The worker, engine and all, is one module inlined into a chunk of its own, loaded by the first run.
// A dynamic import of a module is something every bundler follows, from the library's build as from
// its source; a worker file referenced by URL is not (a host's bundler doesn't emit it, and
// pre-bundling moves the code that names it). The worker starts from a blob: URL.
let loadWorker: Promise<new () => Worker> | undefined
const startWorker = async () => new (await (loadWorker ??= import('./sandbox-worker.ts?worker&inline').then(module => module.default)))()

export const workerScriptRunner: ScriptRunner = async (request, signal) => {
  const failed = (error: string): ScriptResult => ({ ok: false, error, logs: '', logsTruncated: false })
  if (signal?.aborted) return failed('Stopped.')
  let worker: Worker
  try { worker = await startWorker() } catch {
    // A failed load is not kept, so a later run tries again.
    loadWorker = undefined
    return failed('The script engine could not start.')
  }
  if (signal?.aborted) { worker.terminate(); return failed('Stopped.') }
  return new Promise(resolve => {
    const end = (result: ScriptResult) => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
      worker.terminate()
      resolve(result)
    }
    const onAbort = () => end(failed('Stopped.'))
    const timer = setTimeout(() => end(failed(`The script ran longer than ${SCRIPT_LIMITS.timeMs / 1000} seconds and was stopped.`)), SCRIPT_LIMITS.timeMs + GRACE_MS)
    signal?.addEventListener('abort', onAbort)
    worker.onmessage = (event: MessageEvent<ScriptResult>) => end(event.data)
    worker.onerror = event => { event.preventDefault(); end(failed('The script engine could not start.')) }
    worker.postMessage(request)
  })
}
