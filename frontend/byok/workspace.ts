// A conversation's workspace: a few named text files the assistant keeps beside the conversation
// and computes over (workspace-tools.ts). Each conversation has its own, deleted with it. In the
// browser the files live in the origin private file system (OPFS): private to the site, kept across
// reloads, and never sent anywhere. Names are flat (no folders) and the contents are UTF-8 text.

export interface WorkspaceFile { name: string; size: number; modifiedAt: number }

/** One conversation's files. Sizes are UTF-8 bytes. */
export interface Workspace {
  list(): Promise<WorkspaceFile[]>
  /** The file's text, or undefined when there is no such file. */
  read(name: string): Promise<string | undefined>
  write(name: string, text: string): Promise<void>
  /** Whether a file was removed. */
  remove(name: string): Promise<boolean>
}

/** The workspaces of one assistant's conversations (one `storageKey`). */
export interface WorkspaceStore {
  open(conversationId: string): Workspace
  /** Removes a conversation's workspace and every file in it. */
  removeConversation(conversationId: string): Promise<void>
}

export const WORKSPACE_LIMITS = {
  /** UTF-8 bytes in one file. */
  fileBytes: 8 * 1024 * 1024,
  /** UTF-8 bytes across a conversation's files. */
  totalBytes: 64 * 1024 * 1024,
  files: 200,
}

const NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/
/** Why a file name is not allowed, or undefined when it is. */
export function fileNameProblem(name: string): string | undefined {
  if (!NAME.test(name) || name.includes('..')) return 'A file name is 1 to 128 letters, digits, ".", "-" or "_", starting with a letter or digit, without "..".'
}
function checkName(name: string) {
  const problem = fileNameProblem(name)
  if (problem) throw new Error(problem)
}

export const byteLength = (text: string) => new TextEncoder().encode(text).length

/** Why writing `name` with `text` would exceed the limits, or undefined. `files` is the workspace now. */
export function writeProblem(files: readonly WorkspaceFile[], name: string, text: string): string | undefined {
  const size = byteLength(text)
  if (size > WORKSPACE_LIMITS.fileBytes) return `A file can hold at most ${WORKSPACE_LIMITS.fileBytes} bytes; this one would be ${size}.`
  const others = files.filter(file => file.name !== name)
  if (others.length + 1 > WORKSPACE_LIMITS.files) return `A workspace holds at most ${WORKSPACE_LIMITS.files} files. Delete some first.`
  const total = others.reduce((sum, file) => sum + file.size, size)
  if (total > WORKSPACE_LIMITS.totalBytes) return `A workspace holds at most ${WORKSPACE_LIMITS.totalBytes} bytes; it would hold ${total}. Delete some files first.`
}

// ------------------------------------------------------------------------------------------------
// In memory: for tests, and for a host that wants nothing kept.

export function memoryWorkspaceStore(): WorkspaceStore {
  const conversations = new Map<string, Map<string, { text: string; modifiedAt: number }>>()
  const filesOf = (id: string) => conversations.get(id) ?? conversations.set(id, new Map()).get(id)!
  return {
    open: id => ({
      async list() {
        return [...filesOf(id)].map(([name, file]) => ({ name, size: byteLength(file.text), modifiedAt: file.modifiedAt })).sort((a, b) => a.name.localeCompare(b.name))
      },
      async read(name) { checkName(name); return filesOf(id).get(name)?.text },
      async write(name, text) {
        checkName(name)
        const problem = writeProblem(await this.list(), name, text)
        if (problem) throw new Error(problem)
        filesOf(id).set(name, { text, modifiedAt: Date.now() })
      },
      async remove(name) { checkName(name); return filesOf(id).delete(name) },
    }),
    async removeConversation(id) { conversations.delete(id) },
  }
}

// ------------------------------------------------------------------------------------------------
// The origin private file system: <root>/byok-ai/<storage key>/<conversation id>/<file>.

const STORAGE_UNAVAILABLE = 'This browser does not offer private file storage here (private windows may not), so the workspace is unavailable.'

// A storage key or conversation id as one directory name: anything but letters, digits, "-" and "_" escaped.
const directoryName = (value: string) => value.replace(/[^A-Za-z0-9_-]/g, char => '%' + char.charCodeAt(0).toString(16).padStart(2, '0'))

async function rootOf(storageKey: string, create: boolean): Promise<FileSystemDirectoryHandle | undefined> {
  if (typeof navigator === 'undefined' || !navigator.storage?.getDirectory) throw new Error(STORAGE_UNAVAILABLE)
  let root: FileSystemDirectoryHandle
  try { root = await navigator.storage.getDirectory() } catch { throw new Error(STORAGE_UNAVAILABLE) }
  try {
    const library = await root.getDirectoryHandle('byok-ai', { create })
    return await library.getDirectoryHandle(directoryName(storageKey), { create })
  } catch (error) {
    if (!create && error instanceof DOMException && error.name === 'NotFoundError') return undefined
    throw error
  }
}

const notFound = (error: unknown) => error instanceof DOMException && error.name === 'NotFoundError'

export function opfsWorkspaceStore(storageKey: string): WorkspaceStore {
  // A conversation's directory, made only when a file is first written.
  const directory = async (id: string, create: boolean) => {
    const root = await rootOf(storageKey, create)
    if (!root) return undefined
    try { return await root.getDirectoryHandle(directoryName(id), { create }) } catch (error) {
      if (!create && notFound(error)) return undefined
      throw error
    }
  }
  return {
    open: id => ({
      async list() {
        const dir = await directory(id, false)
        if (!dir) return []
        const files: WorkspaceFile[] = []
        for await (const handle of dir.values()) {
          if (handle.kind !== 'file' || fileNameProblem(handle.name)) continue
          const file = await (handle as FileSystemFileHandle).getFile()
          files.push({ name: handle.name, size: file.size, modifiedAt: file.lastModified })
        }
        return files.sort((a, b) => a.name.localeCompare(b.name))
      },
      async read(name) {
        checkName(name)
        const dir = await directory(id, false)
        if (!dir) return undefined
        try { return await (await (await dir.getFileHandle(name)).getFile()).text() } catch (error) {
          if (notFound(error)) return undefined
          throw error
        }
      },
      async write(name, text) {
        checkName(name)
        const problem = writeProblem(await this.list(), name, text)
        if (problem) throw new Error(problem)
        const handle = await (await directory(id, true))!.getFileHandle(name, { create: true })
        // A writable stream replaces the file only when it closes, so a failed write leaves it as it was.
        const writable = await handle.createWritable()
        try { await writable.write(text); await writable.close() } catch (error) {
          await writable.abort().catch(() => {})
          throw error instanceof DOMException && error.name === 'QuotaExceededError' ? new Error('The browser has no more storage for this site.') : error
        }
      },
      async remove(name) {
        checkName(name)
        const dir = await directory(id, false)
        if (!dir) return false
        try { await dir.removeEntry(name); return true } catch (error) {
          if (notFound(error)) return false
          throw error
        }
      },
    }),
    async removeConversation(id) {
      const root = await rootOf(storageKey, false).catch(() => undefined)
      await root?.removeEntry(directoryName(id), { recursive: true }).catch(error => { if (!notFound(error)) throw error })
    },
  }
}
