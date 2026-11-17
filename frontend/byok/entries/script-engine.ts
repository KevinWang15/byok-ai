import variant from '@jitl/quickjs-wasmfile-release-sync'
import { runScript } from '../sandbox'
import type { ScriptRunner } from '../script-runner'

// `@kevinwang15/byok-ai/script-engine`: workspace scripts run in this thread, where there are no
// workers (Node: evaluations, tests). Give it to the agent as `workspace.run`. The engine is
// bundled into this entry alone. A run ends at the time limit (SCRIPT_LIMITS), but Stop can't end
// it early: in a page, the assistant's own runner, which uses a worker, can.

/** Runs a workspace script in this thread, in the same sandbox the page's worker uses. */
export const inProcessScriptRunner: ScriptRunner = request => runScript(variant, request)
