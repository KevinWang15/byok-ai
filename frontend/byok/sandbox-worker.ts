import variant from '@jitl/quickjs-wasmfile-release-sync'
import { runScript, type ScriptRequest } from './sandbox'

// One script per worker: the page starts a worker, posts the request, and ends it with the reply.
self.onmessage = async (event: MessageEvent<ScriptRequest>) => {
  self.postMessage(await runScript(variant, event.data))
}
