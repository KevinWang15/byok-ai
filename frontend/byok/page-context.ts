import { jsonSchema, tool, type ToolExecutionOptions, type ToolSet } from 'ai'
import type { CompleteAttachment, CreateAttachment, ThreadMessage } from '@assistant-ui/react'
import { mcpValue } from './mcp-result'
import { SAVED_RESULT, WORKSPACE_ID, type SavableTool } from './workspace-tools'

// Page context (the `pageContext` option): the user adds elements of the page to a message, and
// the model reads their data when it needs it. The host decides what can be added by describing
// it in the markup, with any framework or none:
//
//   data-ai-context="<what the element is>"      required: makes it addable
//   data-ai-context-data="<its data>"             optional: the data as text, for small data
//   data-ai-context-read="<JavaScript expression>" optional: evaluated in the page when read
//
// An element has at most one of the last two (one with both can't be added, and the console says
// why); with neither, its description is all there is. Elements nest: one inside another can be
// added on its own, with it, or not at all, and reading one gives only its own data.
// A read expression runs as page code, with `MCP(name, params)` (calls one of this answer's MCP
// tools, returns a promise) and `element` in scope; its value, or what its promise resolves to,
// is the data, as JSON. Promises inside the value's objects and arrays are awaited too, so a
// panel can read as { totals: MCP(…), trend: MCP(…) }; one that fails becomes { error }.
//
// A message holds what was added as attachments (type 'page-element'): an id, the description,
// and the descriptions of the elements it is inside, nothing read. The model reads one with
// page__read_element, whose result is kept with the conversation like any tool's. The elements
// themselves are known only while the page lives: an id names the element picked, while it is in
// the document.

export const PAGE_CONTEXT_ATTRIBUTES = {
  description: 'data-ai-context',
  data: 'data-ai-context-data',
  read: 'data-ai-context-read',
} as const

export const PAGE_CONTEXT_LIMITS = {
  /** Page elements in one message. */
  perMessage: 8,
  /** How long a read expression may take, MCP calls included. */
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
export const isPageElementId = (id: string) => /^[a-f0-9]{32}$/.test(id)

/** The element's description, or undefined when it has none. */
export function descriptionOf(element: Element): string | undefined {
  return element.getAttribute(PAGE_CONTEXT_ATTRIBUTES.description)?.trim() || undefined
}
/** Why the element can't be added (it declares its data twice), or undefined when it can. */
export function declarationProblem(element: Element): string | undefined {
  if (element.hasAttribute(PAGE_CONTEXT_ATTRIBUTES.data) && element.hasAttribute(PAGE_CONTEXT_ATTRIBUTES.read)) {
    return `"${descriptionOf(element)}" sets both ${PAGE_CONTEXT_ATTRIBUTES.data} and ${PAGE_CONTEXT_ATTRIBUTES.read}; an element has at most one.`
  }
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

/** How a read expression calls MCP tools: by full name (`serverId__toolName`), with an object of arguments. */
export type McpCall = (name: string, params?: Record<string, unknown>) => Promise<unknown>

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

// The page's code, compiled as the page runs it: global scope, strict, with MCP and element as its
// only other names.
type Read = (mcp: McpCall, element: Element) => unknown
function compile(code: string): Read {
  try {
    return new Function('MCP', 'element', `"use strict";\nreturn (\n${code}\n)`) as Read
  } catch (error) {
    // A Content-Security-Policy without 'unsafe-eval' refuses any code compiled from text.
    if (error instanceof EvalError) throw new Error(`This page's Content-Security-Policy doesn't allow ${PAGE_CONTEXT_ATTRIBUTES.read} (it needs 'unsafe-eval'), so only the element's description is known.`, { cause: error })
    throw new Error(`The element's ${PAGE_CONTEXT_ATTRIBUTES.read} is not a JavaScript expression: ${errorText(error)}`, { cause: error })
  }
}

// The value with every promise in it awaited, in parallel: the value itself, and those in its plain
// objects and arrays at any depth (a panel's read can be an object of MCP() calls, one per part).
// A nested promise that rejects becomes { error } in its place, so one failed part leaves the rest.
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
  if (value === undefined) throw new Error(`The element's ${PAGE_CONTEXT_ATTRIBUTES.read} returned nothing.`)
  let json: string | undefined
  try { json = JSON.stringify(value) } catch (error) { throw new Error(`The element's ${PAGE_CONTEXT_ATTRIBUTES.read} returned a value that is not JSON: ${errorText(error)}`, { cause: error }) }
  if (json === undefined) throw new Error(`The element's ${PAGE_CONTEXT_ATTRIBUTES.read} returned a value that is not JSON.`)
  return JSON.parse(json)
}

/** Reads what the element declares: its description, and its data unless it has none. */
export async function readPageElement(element: Element, options: { mcp: McpCall; signal?: AbortSignal; timeoutMs?: number }): Promise<{ description: string; data?: unknown }> {
  const description = descriptionOf(element)
  if (description === undefined) throw new Error('The element no longer has a description.')
  const problem = declarationProblem(element)
  if (problem) throw new Error(problem)
  const data = element.getAttribute(PAGE_CONTEXT_ATTRIBUTES.data)
  if (data !== null) return { description, data }
  const code = element.getAttribute(PAGE_CONTEXT_ATTRIBUTES.read)
  if (code === null) return { description }
  const read = compile(code)
  // The expression can't be stopped, but the answer stops waiting for it.
  const timeoutMs = options.timeoutMs ?? PAGE_CONTEXT_LIMITS.readMs
  const limits = AbortSignal.any([AbortSignal.timeout(timeoutMs), ...(options.signal ? [options.signal] : [])])
  limits.throwIfAborted()
  const stopped = new Promise<never>((_, reject) => limits.addEventListener('abort', () => reject(options.signal?.aborted
    ? options.signal.reason : new Error(`The element's ${PAGE_CONTEXT_ATTRIBUTES.read} took longer than ${timeoutMs / 1000} seconds.`)), { once: true }))
  // Settled after the read finished, it is nobody's concern.
  stopped.catch(() => {})
  let value: unknown
  try {
    value = await Promise.race([Promise.resolve().then(() => settled(read(options.mcp, element))), stopped])
  } catch (error) {
    if (limits.aborted) throw error
    throw new Error(`The element's ${PAGE_CONTEXT_ATTRIBUTES.read} failed: ${errorText(error)}`, { cause: error })
  }
  return { description, data: asData(value) }
}

/** MCP() for read expressions: calls one of this answer's MCP tools and gives its result as a value. */
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
  /** The other tools of this answer, which read expressions call through MCP(). */
  tools: () => ToolSet
  isMcp: (name: string) => boolean
  /** Whether the workspace can save a read too large to give the model whole (it saves the whole read: SAVED_RESULT). */
  canSave: boolean
}): ToolSet {
  const read = async ({ id }: { id: string }, callOptions: ToolExecutionOptions<unknown>) => {
    if (!options.elements.has(id)) throw new Error(`No element with the id ${id} was added to this conversation.`)
    const element = options.registry.picked(id)
    if (!element) throw new Error('This element is no longer on the page. The user can add it again.')
    return readPageElement(element, { mcp: mcpCall({ ...options, callOptions }), signal: callOptions.abortSignal })
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
