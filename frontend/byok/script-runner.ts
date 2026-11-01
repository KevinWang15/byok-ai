import { SCRIPT_LIMITS, type ScriptRequest, type ScriptResult } from './sandbox'

/** Runs a script off the page, in a worker of its own (sandbox.ts). */
export type ScriptRunner = (request: ScriptRequest, signal?: AbortSignal) => Promise<ScriptResult>

// The engine stops a script at its deadline; the worker is ended a little later regardless, and
// at once when the answer is stopped.
const GRACE_MS = 5_000

export const workerScriptRunner: ScriptRunner = (request, signal) => new Promise(resolve => {
  const failed = (error: string) => resolve({ ok: false, error, logs: '', logsTruncated: false })
  if (signal?.aborted) return failed('Stopped.')
  let worker: Worker
  try { worker = new Worker(new URL('./sandbox-worker.ts', import.meta.url), { type: 'module' }) } catch { return failed('The script engine could not start.') }
  const end = (result?: ScriptResult, error?: string) => {
    clearTimeout(timer)
    signal?.removeEventListener('abort', onAbort)
    worker.terminate()
    if (result) resolve(result)
    else failed(error!)
  }
  const onAbort = () => end(undefined, 'Stopped.')
  const timer = setTimeout(() => end(undefined, `The script ran longer than ${SCRIPT_LIMITS.timeMs / 1000} seconds and was stopped.`), SCRIPT_LIMITS.timeMs + GRACE_MS)
  signal?.addEventListener('abort', onAbort)
  worker.onmessage = (event: MessageEvent<ScriptResult>) => end(event.data)
  worker.onerror = event => { event.preventDefault(); end(undefined, 'The script engine could not start.') }
  worker.postMessage(request)
})
