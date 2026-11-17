import { jsonSchema, tool, type ToolExecutionOptions, type ToolSet } from 'ai'
import type { CompleteAttachment, CreateAttachment, ThreadMessage } from '@assistant-ui/react'
import { mcpValue } from './mcp-result'
import { PAGE_CONTEXT_ATTRIBUTES, type McpCall, type PageReaders } from './page-source'
import { SAVED_RESULT, WORKSPACE_ID, type SavableTool } from './workspace-tools'

export { PAGE_CONTEXT_ATTRIBUTES, pageContextAttributes, pageContextData } from './page-source'
export type { McpCall, McpSource, PageContextAttributes, PageReader, PageReaders, PageSource, ReaderSource } from './page-source'

// Page context (the `pageContext` option): the user adds elements of the page to a message, and
// the model reads their data when it needs it. The host decides what can be added by describing
// it in the markup, with any framework or none (page-source.ts):
//
//   data-ai-context="<what the element is>"           required: makes it addable
//   data-ai-context-data="<its data>"                  optional: the data as text, for small data
//   data-ai-context-source="<JSON: where its data is>" optional: read when the model asks
//
// An element has at most one of the last two (one with both can't be added, and the console says
// why); with neither, its description is all there is. Elements nest: one inside another can be
// added on its own, with it, or not at all, and reading one gives only its own data.
//
// A source is data, never code: calls of this answer's MCP tools and of readers the host registers
// in its code (the pageReaders option), in parts as the element shows them. Its calls start
// together, and a part that fails becomes { error } in its place.
//
// A message holds what was added as attachments (type 'page-element'): an id, the description,
// and the descriptions of the elements it is inside, nothing read. The model reads one with
// page__read_element, whose result is kept with the conversation like any tool's. The elements
// themselves are known only while the page lives: an id names the element picked, while it is in
// the document.

export const PAGE_CONTEXT_LIMITS = {
  /** Page elements in one message. */
  perMessage: 8,
  /** How long reading a source may take, its calls included. */
  readMs: 60_000,
  /** The most characters of data (as JSON) a read gives the model; more can be saved to the workspace. */
  resultChars: 20_000,
}

/** The tools are named `page__…`, so no MCP server may use this id. */
export const PAGE_CONTEXT_ID = 'page'
export const READ_ELEMENT_TOOL = PAGE_CONTEXT_ID + '__read_element'
/** The content type of a page element attachment. */
export const PAGE_ELEMENT_TYPE = 'application/x-byok-page-element'

/** Where a picked element was: the descriptions of the elements it is inside, outermost first. */
export interface PageElementPlace { inside: string[] }
/**
 * A page element as a message holds it: its id, its description as `name`, and its place as the
 * one part of its content.
 */
export type PageElementAttachment = CompleteAttachment & {
  type: 'page-element'; contentType: typeof PAGE_ELEMENT_TYPE
  content: [{ type: 'data'; name: 'page-element'; data: PageElementPlace }]
}
export const isPageElementAttachment = (attachment: { type?: string; contentType?: string }): attachment is PageElementAttachment =>
  attachment.type === 'page-element' && attachment.contentType === PAGE_ELEMENT_TYPE
/** The descriptions of the elements a page element attachment was inside, outermost first. */
export const insideOf = (attachment: PageElementAttachment): readonly string[] => attachment.content[0].data.inside
// Ids from getRandomValues: crypto.randomUUID exists only in secure contexts.
const newElementId = () => Array.from(crypto.getRandomValues(new Uint8Array(16)), byte => byte.toString(16).padStart(2, '0')).join('')
/** "2 elements": the default summary of a message's page elements. */
export const elementCount = (count: number) => count === 1 ? '1 element' : `${count} elements`
/**
 * Shows or hides a part drawn on the page (the picker's, a mark). `hidden` alone loses to a host's
 * `display` on the part (a flex label, say), so it is also hidden inline, which no stylesheet
 * overrides; shown, the host's display applies again.
 */
export function setShown(node: HTMLElement, shown: boolean) {
  node.hidden = !shown
  node.style.display = shown ? '' : 'none'
}
export const isPageElementId = (id: string) => /^[a-f0-9]{32}$/.test(id)

/** The element's description, or undefined when it has none. */
export function descriptionOf(element: Element): string | undefined {
  return element.getAttribute(PAGE_CONTEXT_ATTRIBUTES.description)?.trim() || undefined
}
/** Why the element can't be added (it declares its data twice), or undefined when it can. */
const DECLARED = [PAGE_CONTEXT_ATTRIBUTES.data, PAGE_CONTEXT_ATTRIBUTES.source]
export function declarationProblem(element: Element): string | undefined {
  const declared = DECLARED.filter(name => element.hasAttribute(name))
  if (declared.length > 1) return `"${descriptionOf(element)}" sets ${declared.join(' and ')}; an element has at most one of them.`
}
// A mistake in the page is the developer's to see, once per element, not the user's.
const warned = new WeakSet<Element>()
/** Whether the element can be added: it has a description, and declares its data at most once. */
export function isAddable(element: Element): boolean {
  if (descriptionOf(element) === undefined) return false
  const problem = declarationProblem(element)
  if (problem && !warned.has(element)) {
    warned.add(element)
    console.warn(`byok-ai page context: ${problem} It can't be added.`)
  }
  return !problem
}
const SELECTOR = `[${PAGE_CONTEXT_ATTRIBUTES.description}]`
/** The elements that can be added from `node` up: itself and its ancestors, outermost first. */
export function addableChain(node: Element | null): Element[] {
  const chain: Element[] = []
  for (let element = node?.closest(SELECTOR); element; element = element.parentElement?.closest(SELECTOR)) {
    if (isAddable(element)) chain.unshift(element)
  }
  return chain
}
/** Every element of the document that can be added, in document order (a parent before its children). */
export function addableElements(root: ParentNode = document): Element[] {
  return [...root.querySelectorAll(SELECTOR)].filter(isAddable)
}
/** The descriptions of the described elements an element is inside, outermost first. */
export function placeOf(element: Element): PageElementPlace {
  const inside: string[] = []
  for (let parent = element.parentElement?.closest(SELECTOR); parent; parent = parent.parentElement?.closest(SELECTOR)) {
    const description = descriptionOf(parent)
    if (description !== undefined) inside.unshift(description)
  }
  return { inside }
}

/** The elements picked while this page lives, by attachment id. One per assistant. */
export interface PageElementRegistry {
  /** Remembers the element and returns the attachment that stands for it in the composer. */
  add(element: Element): CreateAttachment
  /** The element picked as `id`, while it is in the document. */
  picked(id: string): Element | undefined
}
export function pageElementRegistry(): PageElementRegistry {
  // Weak, so that picking never keeps a removed element alive.
  const elements = new Map<string, WeakRef<Element>>()
  return {
    add(element) {
      const id = newElementId()
      elements.set(id, new WeakRef(element))
      return { id, type: 'page-element', name: descriptionOf(element) ?? '', contentType: PAGE_ELEMENT_TYPE,
        content: [{ type: 'data', name: 'page-element', data: placeOf(element) }] }
    },
    picked(id) {
      const element = elements.get(id)?.deref()
      return element?.isConnected ? element : undefined
    },
  }
}

/** The ids of the page elements added to these messages. */
export function pageElementsIn(messages: readonly ThreadMessage[]): Set<string> {
  const ids = new Set<string>()
  for (const message of messages) {
    if (message.role !== 'user') continue
    for (const attachment of message.attachments) if (isPageElementAttachment(attachment)) ids.add(attachment.id)
  }
  return ids
}

/** Told to the model with a user message, in place of the elements added to it: each one's id, description and place. */
export function pageElementsNote(elements: readonly PageElementAttachment[], readable: boolean): string {
  const added = elements.length === 1 ? 'an element' : `${elements.length} elements`
  const how = readable
    ? `. Read the data of the ones you need with ${READ_ELEMENT_TOOL}`
    : '. Reading them is not available now, so only their descriptions are known'
  return [`The user added ${added} from the page to this message${how}:`, ...elements.map(element => {
    const inside = insideOf(element)
    return `- ${element.id}: ${JSON.stringify(element.name)}` + (inside.length ? ` (inside ${inside.map(name => JSON.stringify(name)).join(' › ')})` : '')
  })].join('\n')
}

const errorText = (error: unknown) => error instanceof Error ? error.message : String(error)
const SOURCE = PAGE_CONTEXT_ATTRIBUTES.source

// A source with its calls started: a promise where each call is, every other value as it is. An
// object is a call when its keys are mcp (a string) and maybe params, or reader and maybe args.
const keysAre = (value: object, required: string, optional: string) => Object.keys(value).every(key => key === required || key === optional)
function started(source: unknown, call: { mcp: McpCall; reader: (name: string, args: unknown) => unknown }): unknown {
  if (Array.isArray(source)) return source.map(part => started(part, call))
  if (typeof source !== 'object' || source === null) return source
  const record = source as Record<string, unknown>
  if (typeof record.mcp === 'string' && keysAre(record, 'mcp', 'params')) {
    const { mcp: name, params = {} } = record
    if (typeof params !== 'object' || params === null || Array.isArray(params)) throw new Error(`The params for ${name} are not an object.`)
    return Promise.resolve().then(() => call.mcp(name, params as Record<string, unknown>))
  }
  if (typeof record.reader === 'string' && keysAre(record, 'reader', 'args')) {
    const { reader: name, args } = record
    return Promise.resolve().then(() => call.reader(name, args))
  }
  return Object.fromEntries(Object.entries(record).map(([key, part]) => [key, started(part, call)]))
}

// The value with every promise in it awaited, in parallel: the value itself, and those in its plain
// objects and arrays at any depth. A nested promise that rejects becomes { error } in its place, so
// one failed part leaves the rest.
async function settled(value: unknown, depth = 0): Promise<unknown> {
  if (depth > 8) return value
  if (value instanceof Promise) return settled(await value, depth + 1)
  const nested = async (item: unknown) => {
    try { return await settled(item, depth + 1) } catch (error) { return { error: errorText(error) } }
  }
  if (Array.isArray(value)) return Promise.all(value.map(nested))
  if (typeof value === 'object' && value !== null && Object.getPrototypeOf(value) === Object.prototype) {
    const entries = await Promise.all(Object.entries(value).map(async ([key, item]) => [key, await nested(item)] as const))
    return Object.fromEntries(entries)
  }
  return value
}

// The value as JSON data. A string stays as it is.
function asData(value: unknown): unknown {
  if (value === undefined) throw new Error(`The element's ${SOURCE} gave nothing.`)
  let json: string | undefined
  try { json = JSON.stringify(value) } catch (error) { throw new Error(`The element's ${SOURCE} gave a value that is not JSON: ${errorText(error)}`, { cause: error }) }
  if (json === undefined) throw new Error(`The element's ${SOURCE} gave a value that is not JSON.`)
  return JSON.parse(json)
}

/** Reads what the element declares: its description, and its data unless it has none. */
export async function readPageElement(element: Element, options: { mcp: McpCall; readers?: PageReaders; signal?: AbortSignal; timeoutMs?: number }): Promise<{ description: string; data?: unknown }> {
  const description = descriptionOf(element)
  if (description === undefined) throw new Error('The element no longer has a description.')
  const problem = declarationProblem(element)
  if (problem) throw new Error(problem)
  const data = element.getAttribute(PAGE_CONTEXT_ATTRIBUTES.data)
  if (data !== null) return { description, data }
  const text = element.getAttribute(SOURCE)
  if (text === null) return { description }
  let source: unknown
  try { source = JSON.parse(text) } catch (error) { throw new Error(`The element's ${SOURCE} is not JSON: ${errorText(error)}`, { cause: error }) }
  const reader = (name: string, args: unknown) => {
    const read = options.readers?.[name]
    if (!read) throw new Error(`The page offers no reader named "${name}".`)
    return read(args, { element, mcp: options.mcp, signal: options.signal })
  }
  // A call can't be stopped, but the answer stops waiting for it.
  const timeoutMs = options.timeoutMs ?? PAGE_CONTEXT_LIMITS.readMs
  const limits = AbortSignal.any([AbortSignal.timeout(timeoutMs), ...(options.signal ? [options.signal] : [])])
  limits.throwIfAborted()
  const stopped = new Promise<never>((_, reject) => limits.addEventListener('abort', () => reject(options.signal?.aborted
    ? options.signal.reason : new Error(`The element's ${SOURCE} took longer than ${timeoutMs / 1000} seconds.`)), { once: true }))
  // Settled after the read finished, it is nobody's concern.
  stopped.catch(() => {})
  let value: unknown
  try {
    value = await Promise.race([Promise.resolve().then(() => settled(started(source, { mcp: options.mcp, reader }))), stopped])
  } catch (error) {
    if (limits.aborted) throw error
    throw new Error(`The element's ${SOURCE} failed: ${errorText(error)}`, { cause: error })
  }
  return { description, data: asData(value) }
}

/** MCP() for sources and readers: calls one of this answer's MCP tools and gives its result as a value. */
export function mcpCall(options: { tools: () => ToolSet; isMcp: (name: string) => boolean; callOptions: ToolExecutionOptions<unknown> }): McpCall {
  return async (name, params = {}) => {
    if (typeof name !== 'string' || !options.isMcp(name)) {
      throw new Error(`MCP(${JSON.stringify(name)}): there is no such MCP tool. Use its full name, "<server id>__<tool name>".`)
    }
    if (typeof params !== 'object' || params === null || Array.isArray(params)) throw new Error(`MCP("${name}", params): params is an object.`)
    const execute = options.tools()[name]?.execute
    if (!execute) throw new Error(`MCP("${name}"): there is no such MCP tool.`)
    return mcpValue(await execute(params, options.callOptions))
  }
}

// What a read gives the model: all of it, up to `resultChars` of JSON; else its start, and how to get the rest.
function forModel(read: { description: string; data?: unknown }, canSave: boolean) {
  const json = JSON.stringify(read.data) ?? ''
  if (json.length <= PAGE_CONTEXT_LIMITS.resultChars) return read
  return {
    description: read.description, characters: json.length, start: json.slice(0, 2000),
    note: canSave
      ? `The data is too large to give here. Save it with ${WORKSPACE_ID}__save_tool_result (tool "${READ_ELEMENT_TOOL}", the same arguments) and compute over the file.`
      : `The data is too large to give here; this is its start.`,
  }
}

/** The page context tool: reads an element the user added to this conversation. */
export function pageContextTools(options: {
  registry: PageElementRegistry
  /** The ids of the elements added to this conversation's messages. */
  elements: ReadonlySet<string>
  /** The other tools of this answer, which sources and readers call through MCP(). */
  tools: () => ToolSet
  isMcp: (name: string) => boolean
  /** The host's readers, as they are when a read starts. */
  readers?: () => PageReaders
  /** Whether the workspace can save a read too large to give the model whole (it saves the whole read: SAVED_RESULT). */
  canSave: boolean
}): ToolSet {
  const read = async ({ id }: { id: string }, callOptions: ToolExecutionOptions<unknown>) => {
    if (!options.elements.has(id)) throw new Error(`No element with the id ${id} was added to this conversation.`)
    const element = options.registry.picked(id)
    if (!element) throw new Error('This element is no longer on the page. The user can add it again.')
    return readPageElement(element, { mcp: mcpCall({ ...options, callOptions }), readers: options.readers?.(), signal: callOptions.abortSignal })
  }
  const readElement: SavableTool = tool({
    description: 'Read an element the user added from the page to a message, by the id listed there: its description, and its data as the page has it now (none when the description is all there is). Reading an element gives only its own data, not that of elements inside it.',
    inputSchema: jsonSchema<{ id: string }>({
      type: 'object', additionalProperties: false, required: ['id'],
      properties: { id: { type: 'string', description: 'The element\'s id, as listed in the message.' } },
    }),
    execute: async (input, callOptions) => forModel(await read(input, callOptions), options.canSave),
  })
  readElement[SAVED_RESULT] = (input, callOptions) => read(input as { id: string }, callOptions)
  return { [READ_ELEMENT_TOOL]: readElement }
}
