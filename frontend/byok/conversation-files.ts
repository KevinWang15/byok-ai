// What a conversation keeps in the browser beside its messages, which are in localStorage
// (storage.ts):
// - its workspace: a few named text files the assistant computes over (workspace-tools.ts);
// - its images: the pictures the user attached (images.ts), by id. Messages hold only the id.
// Each conversation has its own, deleted with it. In the browser they live in the origin private
// file system (OPFS): private to the site, kept across reloads, and never sent anywhere except to
// the model, as part of a question.

export interface WorkspaceFile { name: string; size: number; modifiedAt: number }

/** One conversation's files. Sizes are UTF-8 bytes. Names are flat (no folders); contents are text. */
export interface Workspace {
  list(): Promise<WorkspaceFile[]>
  /** The file's text, or undefined when there is no such file. */
  read(name: string): Promise<string | undefined>
  write(name: string, text: string): Promise<void>
  /** Whether a file was removed. */
  remove(name: string): Promise<boolean>
}

/** One conversation's attached images, by attachment id. */
export interface ImageStore {
  save(id: string, image: Blob): Promise<void>
  /** The image, or undefined when there is none with this id. */
  load(id: string): Promise<Blob | undefined>
}

/** What one assistant (one `storageKey`) keeps per conversation. */
export interface ConversationFiles {
  workspace(conversationId: string): Workspace
  images(conversationId: string): ImageStore
  /** Removes everything a conversation keeps. */
  remove(conversationId: string): Promise<void>
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
// Image ids are made by images.ts, so anything else is a corrupt reference.
export const isImageId = (id: string) => /^[a-f0-9]{32}$/.test(id)
function checkImageId(id: string) {
  if (!isImageId(id)) throw new Error('Not an image id.')
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

export function memoryConversationFiles(): ConversationFiles {
  const conversations = new Map<string, { files: Map<string, { text: string; modifiedAt: number }>; images: Map<string, Blob> }>()
  const of = (id: string) => conversations.get(id) ?? conversations.set(id, { files: new Map(), images: new Map() }).get(id)!
  return {
    workspace: id => ({
      async list() {
        return [...of(id).files].map(([name, file]) => ({ name, size: byteLength(file.text), modifiedAt: file.modifiedAt })).sort((a, b) => a.name.localeCompare(b.name))
      },
      async read(name) { checkName(name); return of(id).files.get(name)?.text },
      async write(name, text) {
        checkName(name)
        const problem = writeProblem(await this.list(), name, text)
        if (problem) throw new Error(problem)
        of(id).files.set(name, { text, modifiedAt: Date.now() })
      },
      async remove(name) { checkName(name); return of(id).files.delete(name) },
    }),
    images: id => ({
      async save(imageId, image) { checkImageId(imageId); of(id).images.set(imageId, image) },
      async load(imageId) { checkImageId(imageId); return of(id).images.get(imageId) },
    }),
    async remove(id) { conversations.delete(id) },
  }
}

// ------------------------------------------------------------------------------------------------
// The origin private file system: <root>/byok-ai/<storage key>/<conversation id>/{files,images}/<name>.

const STORAGE_UNAVAILABLE = 'This browser does not offer private file storage here, so files and images cannot be kept.'

/**
 * Whether this page can keep files: browsers offer OPFS only in secure contexts (HTTPS, or
 * localhost), so a site served over plain HTTP has no workspace and no image attaching.
 */
export const browserFilesAvailable = () => typeof navigator !== 'undefined' && typeof navigator.storage?.getDirectory === 'function'
const NO_SPACE = 'The browser has no more storage for this site.'

// A storage key or conversation id as one directory name: anything but letters, digits, "-" and "_" escaped.
const directoryName = (value: string) => value.replace(/[^A-Za-z0-9_-]/g, char => '%' + char.charCodeAt(0).toString(16).padStart(2, '0'))
const notFound = (error: unknown) => error instanceof DOMException && error.name === 'NotFoundError'

async function rootOf(storageKey: string, create: boolean): Promise<FileSystemDirectoryHandle | undefined> {
  if (typeof navigator === 'undefined' || !navigator.storage?.getDirectory) throw new Error(STORAGE_UNAVAILABLE)
  let root: FileSystemDirectoryHandle
  try { root = await navigator.storage.getDirectory() } catch { throw new Error(STORAGE_UNAVAILABLE) }
  try {
    const library = await root.getDirectoryHandle('byok-ai', { create })
    return await library.getDirectoryHandle(directoryName(storageKey), { create })
  } catch (error) {
    if (!create && notFound(error)) return undefined
    throw error
  }
}

// Replaces a file's contents. A writable stream replaces the file only when it closes, so a failed
// write leaves it as it was.
async function replace(handle: FileSystemFileHandle, data: string | Blob) {
  const writable = await handle.createWritable()
  try { await writable.write(data); await writable.close() } catch (error) {
    await writable.abort().catch(() => {})
    throw error instanceof DOMException && error.name === 'QuotaExceededError' ? new Error(NO_SPACE) : error
  }
}

export function opfsConversationFiles(storageKey: string): ConversationFiles {
  // A conversation's directory for one kind of data, made only when something is first written.
  const directory = async (id: string, area: 'files' | 'images', create: boolean) => {
    const root = await rootOf(storageKey, create)
    if (!root) return undefined
    try { return await (await root.getDirectoryHandle(directoryName(id), { create })).getDirectoryHandle(area, { create }) } catch (error) {
      if (!create && notFound(error)) return undefined
      throw error
    }
  }
  const readFile = async (dir: FileSystemDirectoryHandle | undefined, name: string) => {
    if (!dir) return undefined
    try { return await (await dir.getFileHandle(name)).getFile() } catch (error) {
      if (notFound(error)) return undefined
      throw error
    }
  }
  return {
    workspace: id => ({
      async list() {
        const dir = await directory(id, 'files', false)
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
        return (await readFile(await directory(id, 'files', false), name))?.text()
      },
      async write(name, text) {
        checkName(name)
        const problem = writeProblem(await this.list(), name, text)
        if (problem) throw new Error(problem)
        await replace(await (await directory(id, 'files', true))!.getFileHandle(name, { create: true }), text)
      },
      async remove(name) {
        checkName(name)
        const dir = await directory(id, 'files', false)
        if (!dir) return false
        try { await dir.removeEntry(name); return true } catch (error) {
          if (notFound(error)) return false
          throw error
        }
      },
    }),
    images: id => ({
      async save(imageId, image) {
        checkImageId(imageId)
        await replace(await (await directory(id, 'images', true))!.getFileHandle(imageId, { create: true }), image)
      },
      async load(imageId) {
        checkImageId(imageId)
        // The stored file has no type of its own: the message's attachment has it.
        return readFile(await directory(id, 'images', false), imageId)
      },
    }),
    async remove(id) {
      const root = await rootOf(storageKey, false).catch(() => undefined)
      await root?.removeEntry(directoryName(id), { recursive: true }).catch(error => { if (!notFound(error)) throw error })
    },
  }
}
