import type { ProviderValues } from './types'
import { isRecord, readStored, writeStored } from './local-storage'

// The provider connection, saved in localStorage under the connection key (`connectionKey`): the
// chosen provider and its form values, API key included. Assistants that share the key share the
// connection, and anything else on the page (a job that runs the agent without a chat) can read it
// and follow its changes. Nothing here imports React or the agent.

export interface StoredConnection { providerId: string; values: ProviderValues }
/** The connection key an assistant uses when it is given none. */
export const defaultConnectionKey = (storageKey: string) => `${storageKey}:connection`

/** The saved connection, or undefined when there is none or it has another shape. */
export function loadConnection(key: string): StoredConnection | undefined {
  const { value } = readStored(key)
  if (!isRecord(value) || typeof value.providerId !== 'string' || !isRecord(value.values)) return
  if (!Object.values(value.values).every(v => typeof v === 'string')) return
  return { providerId: value.providerId, values: value.values as ProviderValues }
}
/** Saves the connection, or removes it when `connection` is undefined, and tells the others. */
export function saveConnection(key: string, connection: StoredConnection | undefined): boolean {
  const saved = writeStored(key, connection)
  for (const listener of connectionListeners.get(key) ?? []) listener()
  return saved
}

// Assistants that share a connection key follow each other's connect and disconnect: in this tab
// through these listeners, in other tabs through the storage event.
const connectionListeners = new Map<string, Set<() => void>>()
/** Calls `listener` after the connection under `key` may have changed. Returns the unsubscribe. */
export function subscribeConnection(key: string, listener: () => void): () => void {
  const listeners = connectionListeners.get(key) ?? new Set()
  listeners.add(listener)
  connectionListeners.set(key, listeners)
  const onStorage = (event: StorageEvent) => { if (event.key === key || event.key === null) listener() }
  window.addEventListener('storage', onStorage)
  return () => {
    listeners.delete(listener)
    if (!listeners.size) connectionListeners.delete(key)
    window.removeEventListener('storage', onStorage)
  }
}
/** Whether two saved connections are the same provider with the same values. */
export function sameConnection(a: StoredConnection | undefined, b: StoredConnection | undefined): boolean {
  if (!a || !b) return a === b
  const keys = Object.keys(a.values)
  return a.providerId === b.providerId && keys.length === Object.keys(b.values).length && keys.every(key => a.values[key] === b.values[key])
}
