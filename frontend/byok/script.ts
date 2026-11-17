// What a workspace script is given and gives back, and its limits: the contract between the page,
// which asks for a run (script-runner.ts), and the sandbox that runs it in a worker (sandbox.ts).
// It holds no engine, so the page can read it without loading one.

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
