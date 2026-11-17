// What an MCP tool call returned (a CallToolResult: `content`, maybe `structuredContent`, and
// `isError`), for callers that pass it on: the workspace saves it to a file, and page elements'
// read expressions get it from MCP().

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)

/** The text of an MCP result's content: its text parts, anything else as JSON. */
export const mcpText = (content: unknown) => Array.isArray(content)
  ? content.map(part => part?.type === 'text' && typeof part.text === 'string' ? part.text : JSON.stringify(part)).join('\n')
  : JSON.stringify(content) ?? ''

/** The error an MCP result reports, or undefined when it reports none. */
export function mcpError(result: unknown): string | undefined {
  if (isRecord(result) && result.isError) return 'The tool reported an error: ' + mcpText(result.content).slice(0, 2000)
}

/** An MCP result as a value: its structured content when it has some, else its text. Throws the error it reports. */
export function mcpValue(result: unknown): unknown {
  const error = mcpError(result)
  if (error) throw new Error(error)
  if (!isRecord(result)) return result
  if (result.structuredContent !== undefined) return result.structuredContent
  return mcpText(result.content)
}
