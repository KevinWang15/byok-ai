import { streamText, stepCountIs, ToolChoiceViolationError, type ModelMessage, type ToolSet } from 'ai'
import { createMCPClient, type MCPClient } from '@ai-sdk/mcp'
import type { ChatModelAdapter, ThreadMessage, ThreadAssistantMessagePart } from '@assistant-ui/react'
import type { McpServerConfig, ProviderPreset, ProviderValues } from './types'

/** Preserve interleaved calls/results, and repair calls interrupted before a result arrived. */
export function toModelMessages(messages: readonly ThreadMessage[]): ModelMessage[] {
  const output: ModelMessage[] = []
  for (const message of messages) {
    if (message.role !== 'assistant') {
      output.push({ role: message.role, content: message.content.flatMap(p => p.type === 'text' ? [p.text] : []).join('\n') })
      continue
    }
    for (const part of message.content) {
      if (part.type === 'text') output.push({ role: 'assistant', content: part.text })
      if (part.type === 'tool-call') {
        output.push({ role: 'assistant', content: [{ type: 'tool-call', toolCallId: part.toolCallId, toolName: part.toolName, input: part.args }] })
        output.push({ role: 'tool', content: [{
          type: 'tool-result', toolCallId: part.toolCallId, toolName: part.toolName,
          output: { type: 'text', value: part.result === undefined ? 'Tool execution was interrupted. No result is available.' : JSON.stringify(part.result) },
        }] })
      }
    }
  }
  return output
}

/** Added to the system prompt for the step that must answer: the tool budget is spent, or it is the last step. */
export const FINAL_STEP_INSTRUCTION = 'No more tool calls are available for this answer. Answer now from the results you have, and say briefly what you could not check.'

/** Shown when a response ended without finishing: cut off by the output limit, or out of steps. */
export const INCOMPLETE_MESSAGES = {
  length: 'The answer stopped at the model\'s output limit. Ask it to continue.',
  steps: 'The assistant used all its steps before finishing. Ask it to continue, or narrow the question.',
  empty: 'The model finished without writing an answer. Try again.',
}

/** Shown when the network dropped during a response, as opposed to a provider or MCP failure. */
export const CONNECTION_LOST_MESSAGE = 'The connection was interrupted. Try again.'
const FAILURE_MESSAGE = 'Could not complete the response. Check your key, model, provider CORS support, and MCP connection, then try again.'
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
  systemPrompt: string; maxSteps: number; maxOutputTokens?: number; maxToolCalls?: number; onError: (message: string) => void
}): ChatModelAdapter {
  return {
    async *run({ messages, abortSignal }) {
      options.onError('')
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
        for (const server of options.servers) {
          abortSignal.throwIfAborted()
          if (!/^[a-zA-Z0-9_-]+$/.test(server.id)) throw new Error('MCP IDs must contain only letters, numbers, underscores or hyphens.')
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
          }
        }
        const model = options.provider.createModel(options.values)
        const history = toModelMessages(messages)
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
        if (finish === 'length') options.onError(INCOMPLETE_MESSAGES.length)
        else if (finish === 'tool-calls') options.onError(INCOMPLETE_MESSAGES.steps)
        else if (!answered()) options.onError(INCOMPLETE_MESSAGES.empty)
      } catch (error) {
        if (!abortSignal.aborted) {
          // Raw provider errors are neither shown nor attached: some carry request headers or URLs with keys.
          options.onError(isNetworkFailure(error) ? CONNECTION_LOST_MESSAGE : FAILURE_MESSAGE)
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
