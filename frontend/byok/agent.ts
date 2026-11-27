import { streamText, stepCountIs, ToolChoiceViolationError, type ModelMessage, type ToolSet, type UserContent } from 'ai'
import { createMCPClient, type MCPClient } from '@ai-sdk/mcp'
import type { ChatModelAdapter, ThreadMessage, ThreadAssistantMessagePart } from '@assistant-ui/react'
import type { McpServerConfig, ProviderPreset, ProviderValues } from './types'
import type { AskAIProblem } from './text'
import type { ImageStore, Workspace } from './conversation-files'
import { isImageAttachment } from './images'
import type { ScriptRunner } from './script-runner'
import { WORKSPACE_ID, workspaceTools } from './workspace-tools'
import { isPageElementAttachment, PAGE_CONTEXT_ID, pageContextTools, pageElementsIn, pageElementsNote, type PageElementRegistry, type PageReaders } from './page-context'

/** Said in place of an image the model can't be given. */
export const IMAGE_NOTES = {
  unsupported: 'The user attached an image here, but this model does not accept images.',
  missing: 'The user attached an image here that is no longer stored in this browser.',
}

/**
 * Preserve interleaved calls/results, and repair calls interrupted before a result arrived. A user
 * message's images come from `images` when the model accepts them; otherwise a note says one was
 * there. Its page elements are listed after its text, as readable when `pageElements` is true.
 */
export async function toModelMessages(messages: readonly ThreadMessage[], options: { images?: { store: ImageStore; accepted: boolean }; pageElements?: boolean } = {}): Promise<ModelMessage[]> {
  const { images } = options
  const output: ModelMessage[] = []
  for (const message of messages) {
    if (message.role !== 'assistant') {
      const attachments = message.role === 'user' ? message.attachments : []
      const elements = attachments.filter(isPageElementAttachment)
      const text = [...message.content.flatMap(p => p.type === 'text' ? [p.text] : []), ...(elements.length ? [pageElementsNote(elements, options.pageElements === true)] : [])].join('\n')
      const attached = attachments.filter(isImageAttachment)
      if (message.role === 'system' || !attached.length) { output.push({ role: message.role, content: text }); continue }
      const content: Exclude<UserContent, string> = text ? [{ type: 'text', text }] : []
      for (const attachment of attached) {
        const image = images?.accepted ? await images.store.load(attachment.id).catch(() => undefined) : undefined
        if (image) content.push({ type: 'image', image: new Uint8Array(await image.arrayBuffer()), mediaType: attachment.contentType })
        else content.push({ type: 'text', text: images?.accepted ? IMAGE_NOTES.missing : IMAGE_NOTES.unsupported })
      }
      output.push({ role: 'user', content })
      continue
    }
    for (const part of message.content) {
      if (part.type === 'text') output.push({ role: 'assistant', content: part.text })
      if (part.type === 'tool-call') {
        output.push({ role: 'assistant', content: [{ type: 'tool-call', toolCallId: part.toolCallId, toolName: part.toolName, input: part.args }] })
        // As the AI SDK gives a result to the model in the turn it ran: a string as it is, anything else as JSON.
        output.push({ role: 'tool', content: [{
          type: 'tool-result', toolCallId: part.toolCallId, toolName: part.toolName,
          output: { type: 'text', value: part.result === undefined ? 'Tool execution was interrupted. No result is available.' : typeof part.result === 'string' ? part.result : JSON.stringify(part.result) },
        }] })
      }
    }
  }
  return output
}

/** Added to the system prompt for the step that must answer: the tool budget is spent, or it is the last step. */
export const FINAL_STEP_INSTRUCTION = 'No more tool calls are available for this answer. Answer now from the results you have, and say briefly what you could not check.'

// fetch rejects with a TypeError when the network fails, in browsers and in Node.
const isNetworkFailure = (error: unknown) => error instanceof TypeError || (typeof navigator !== 'undefined' && navigator.onLine === false)

function lastToolCall(content: ThreadAssistantMessagePart[]) {
  for (let i = content.length - 1; i >= 0; i--) if (content[i].type === 'tool-call') return i
  return -1
}

export function createBrowserAdapter(options: {
  provider: ProviderPreset; values: ProviderValues; servers: McpServerConfig[]
  // The page's tools, read when a run starts and again by each call, so a call runs the latest definition.
  clientTools?: () => ToolSet
  // The open conversation's files and how scripts run over them: adds the workspace tools.
  workspace?: { open: () => Workspace; run: ScriptRunner }
  // The open conversation's images, which go to the model if its provider accepts images.
  images?: ImageStore
  // The elements the user picked from the page: adds the page context tool, which reads them.
  pageElements?: PageElementRegistry
  // The host's readers for page sources, read when a read starts, so it uses the latest.
  pageReaders?: () => PageReaders
  systemPrompt: string; maxSteps: number; maxOutputTokens?: number; maxToolCalls?: number
  // Called with undefined when a run starts, then with why it stopped short or failed, if it did.
  onError: (problem: AskAIProblem | undefined) => void
}): ChatModelAdapter {
  return {
    async *run({ messages, abortSignal }) {
      options.onError(undefined)
      const clients: MCPClient[] = []
      const content: ThreadAssistantMessagePart[] = []
      const close = () => { for (const client of clients) void client.close().catch(() => {}) }
      abortSignal.addEventListener('abort', close, { once: true })
      try {
        abortSignal.throwIfAborted()
        const tools: ToolSet = {}
        // Client tool names cannot contain '__', so they never collide with MCP tools.
        for (const [name, tool] of Object.entries(options.clientTools?.() ?? {})) {
          if (!/^[a-zA-Z0-9_-]+$/.test(name) || name.includes('__')) throw new Error('Client tool names must contain only letters, numbers, underscores or hyphens, and no "__".')
          tools[name] = { ...tool, execute: async (input: unknown, callOptions: never) => {
            const current = options.clientTools?.()[name]?.execute
            if (!current) throw new Error(`The page no longer offers ${name}.`)
            return current(input as never, callOptions)
          } } as typeof tool
        }
        const mcpTools = new Set<string>()
        for (const server of options.servers) {
          abortSignal.throwIfAborted()
          if (!/^[a-zA-Z0-9_-]+$/.test(server.id)) throw new Error('MCP IDs must contain only letters, numbers, underscores or hyphens.')
          if (options.workspace && server.id === WORKSPACE_ID) throw new Error(`The MCP id "${WORKSPACE_ID}" is taken by the workspace tools.`)
          if (options.pageElements && server.id === PAGE_CONTEXT_ID) throw new Error(`The MCP id "${PAGE_CONTEXT_ID}" is taken by the page context tools.`)
          const client = await createMCPClient({ transport: {
            type: 'http', url: new URL(server.url, window.location.href).href,
            fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.any([abortSignal, AbortSignal.timeout(60_000), ...(init?.signal ? [init.signal] : [])]) }),
            headers: typeof server.headers === 'function' ? await server.headers() : server.headers,
          } })
          clients.push(client)
          abortSignal.throwIfAborted()
          const discovered = await client.tools()
          for (const [name, tool] of Object.entries(discovered)) {
            const key = server.id + '__' + name
            if (tools[key]) throw new Error('Duplicate MCP tool: ' + key)
            tools[key] = tool
            mcpTools.add(key)
          }
        }
        if (options.workspace) {
          const { open, run } = options.workspace
          let workspace: Workspace | undefined
          Object.assign(tools, workspaceTools({ workspace: () => workspace ??= open(), run, tools: () => tools, isMcp: name => mcpTools.has(name) }))
        }
        if (options.pageElements) {
          Object.assign(tools, pageContextTools({
            registry: options.pageElements, elements: pageElementsIn(messages), tools: () => tools, isMcp: name => mcpTools.has(name), readers: options.pageReaders,
            canSave: options.workspace !== undefined,
          }))
        }
        const model = options.provider.createModel(options.values)
        const history = await toModelMessages(messages, {
          images: options.images && { store: options.images, accepted: options.provider.acceptsImages === true },
          pageElements: options.pageElements !== undefined,
        })
        const finalInstructions = [options.systemPrompt, FINAL_STEP_INSTRUCTION].filter(Boolean).join('\n\n')
        // Streams one run into content; returns how it ended.
        const pump = async function* (result: ReturnType<typeof streamText>) {
          for await (const event of result.fullStream) {
            // A model that calls tools on the answering step anyway has run out of steps.
            if (event.type === 'error' && ToolChoiceViolationError.isInstance(event.error)) return 'tool-calls'
            if (event.type === 'error') throw event.error
            if (event.type === 'finish') return event.finishReason
            if (event.type === 'text-delta') {
              const last = content.at(-1)
              if (last?.type === 'text') content[content.length - 1] = { type: 'text', text: last.text + event.text }
              else content.push({ type: 'text', text: event.text })
            } else if (event.type === 'tool-call') {
              content.push({ type: 'tool-call', toolCallId: event.toolCallId, toolName: event.toolName,
                args: event.input as Record<string, never>, argsText: JSON.stringify(event.input) })
            } else if (event.type === 'tool-result' || event.type === 'tool-error') {
              const index = content.findIndex(p => p.type === 'tool-call' && p.toolCallId === event.toolCallId)
              const part = content[index]
              if (part?.type === 'tool-call') content[index] = { ...part,
                result: event.type === 'tool-result' ? event.output : { error: String(event.error) },
                isError: event.type === 'tool-error' }
            }
            yield { content: [...content] }
          }
          return undefined
        }
        // Text written before the last tool call is not the answer.
        const answered = () => content.slice(lastToolCall(content) + 1).some(p => p.type === 'text' && p.text.trim())
        const result = streamText({
          model, system: options.systemPrompt, messages: history, tools,
          stopWhen: stepCountIs(options.maxSteps), abortSignal, maxRetries: 0, onError: () => {},
          // The last step, or the first after the tool budget is spent, answers instead of calling tools.
          prepareStep: ({ steps, stepNumber }) => {
            const calls = steps.reduce((total, step) => total + step.toolCalls.length, 0)
            const spent = options.maxToolCalls !== undefined && calls >= options.maxToolCalls
            if (!spent && stepNumber < options.maxSteps - 1) return undefined
            return { toolChoice: 'none', instructions: finalInstructions }
          },
          ...(options.maxOutputTokens ? { maxOutputTokens: options.maxOutputTokens } : {}),
        })
        let finish = yield* pump(result)
        // Models sometimes stop with nothing but whitespace. Ask once more, without tools,
        // with everything this run did so far.
        if (finish === 'stop' && !answered()) {
          // Each step's messages hold only that step; the empty last one is left out.
          const done = (await result.steps).slice(0, -1).flatMap(step => step.response.messages)
          finish = yield* pump(streamText({
            model, system: finalInstructions, messages: [...history, ...done, { role: 'user', content: FINAL_STEP_INSTRUCTION }],
            tools, toolChoice: 'none', abortSignal, maxRetries: 0, onError: () => {},
            ...(options.maxOutputTokens ? { maxOutputTokens: options.maxOutputTokens } : {}),
          }))
        }
        // How the answer ended: 'length' was cut off; 'tool-calls' means the step limit ended the loop.
        if (finish === 'length') options.onError({ reason: 'length' })
        else if (finish === 'tool-calls') options.onError({ reason: 'steps' })
        else if (!answered()) options.onError({ reason: 'empty' })
      } catch (error) {
        if (!abortSignal.aborted) {
          // Raw provider errors are neither shown nor attached: some carry request headers or URLs with keys.
          options.onError(isNetworkFailure(error) ? { reason: 'connectionLost' } : { reason: 'failed', mcp: options.servers.length > 0 })
          // eslint-disable-next-line preserve-caught-error
          throw new Error('Provider or MCP request failed.')
        }
      } finally {
        abortSignal.removeEventListener('abort', close)
        await Promise.allSettled(clients.map(client => client.close()))
      }
    },
  }
}
