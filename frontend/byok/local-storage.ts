// Reading and writing one localStorage key as JSON, for storage.ts and connection.ts. Failures
// never throw: a read that fails is `error`, a write that fails returns false.

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/** The key's value as JSON (null when unset); `error` when storage can't be read or holds no JSON. */
export function readStored(key: string): { value: unknown; error: boolean } {
  try { return { value: JSON.parse(localStorage.getItem(key) ?? 'null'), error: false } } catch { return { value: null, error: true } }
}
/** Saves the value as JSON, or removes the key when it is undefined. Whether that worked. */
export function writeStored(key: string, value: unknown): boolean {
  try {
    if (value === undefined) localStorage.removeItem(key)
    else localStorage.setItem(key, JSON.stringify(value))
    return true
  } catch { return false }
}
