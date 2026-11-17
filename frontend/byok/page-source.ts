// What a host writes in its markup for page context (page-context.ts): the attribute names, the
// shape of a data-ai-context-source, and the functions that build the attributes. Nothing else,
// and no imports, so the pages that carry the attributes load nothing of the assistant with them.

/** How a reader calls MCP tools: by full name (`serverId__toolName`), with an object of arguments. */
export type McpCall = (name: string, params?: Record<string, unknown>) => Promise<unknown>

export const PAGE_CONTEXT_ATTRIBUTES = {
  description: 'data-ai-context',
  data: 'data-ai-context-data',
  source: 'data-ai-context-source',
} as const

/** A call of one of this answer's MCP tools, by its full name (`serverId__toolName`). */
export interface McpSource { mcp: string; params?: Record<string, unknown> }
/** A call of a reader the host registers (the `pageReaders` option), by name. */
export interface ReaderSource { reader: string; args?: unknown }
/**
 * Where an element's data is (data-ai-context-source): a call, or an object or array of sources,
 * other JSON values kept as they are. An object is a call when its keys are `mcp` (a string) and
 * maybe `params`, or `reader` (a string) and maybe `args`; any other object holds parts.
 */
export type PageSource = McpSource | ReaderSource | { [part: string]: PageSource } | PageSource[] | string | number | boolean | null

/**
 * A function the host offers sources by name: reads from the page what no tool computes. It gets
 * the source's `args`, and the element, MCP() and the answer's abort signal; it may return a promise.
 */
export type PageReader = (args: unknown, context: { element: Element; mcp: McpCall; signal?: AbortSignal }) => unknown
export type PageReaders = Readonly<Record<string, PageReader>>

/** The attributes pageContextAttributes and pageContextData build, to spread on the element. */
export type PageContextAttributes = { [PAGE_CONTEXT_ATTRIBUTES.description]: string; [PAGE_CONTEXT_ATTRIBUTES.data]?: string; [PAGE_CONTEXT_ATTRIBUTES.source]?: string }

/** The attributes for an element that can be added, with its data at `source`: spread them on it. */
export function pageContextAttributes(description: string, source?: PageSource): PageContextAttributes {
  return { [PAGE_CONTEXT_ATTRIBUTES.description]: description, ...(source === undefined ? {} : { [PAGE_CONTEXT_ATTRIBUTES.source]: JSON.stringify(source) }) }
}

/** The attributes for an element that can be added, with its data as text in the markup: for small data. */
export function pageContextData(description: string, data: string): PageContextAttributes {
  return { [PAGE_CONTEXT_ATTRIBUTES.description]: description, [PAGE_CONTEXT_ATTRIBUTES.data]: data }
}
