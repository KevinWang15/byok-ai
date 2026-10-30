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
}

export function createBrowserAdapter(options: {
  provider: ProviderPreset; values: ProviderValues; servers: McpServerConfig[]
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
        const result = streamText({
          model: options.provider.createModel(options.values),
          system: options.systemPrompt, messages: toModelMessages(messages), tools,
          stopWhen: stepCountIs(options.maxSteps), abortSignal, maxRetries: 0, onError: () => {},
          // The last step, or the first after the tool budget is spent, answers instead of calling tools.
          prepareStep: ({ steps, stepNumber }) => {
            const calls = steps.reduce((total, step) => total + step.toolCalls.length, 0)
            const spent = options.maxToolCalls !== undefined && calls >= options.maxToolCalls
            if (!spent && stepNumber < options.maxSteps - 1) return undefined
            return { toolChoice: 'none', instructions: [options.systemPrompt, FINAL_STEP_INSTRUCTION].filter(Boolean).join('\n\n') }
          },
          ...(options.maxOutputTokens ? { maxOutputTokens: options.maxOutputTokens } : {}),
        })
        for await (const event of result.fullStream) {
          // A model that calls tools on the answering step anyway has run out of steps.
          if (event.type === 'error' && ToolChoiceViolationError.isInstance(event.error)) { options.onError(INCOMPLETE_MESSAGES.steps); break }
          if (event.type === 'error') throw event.error
          // The last step's reason: 'length' was cut off; 'tool-calls' means the step limit ended the loop.
          if (event.type === 'finish') {
            if (event.finishReason === 'length') options.onError(INCOMPLETE_MESSAGES.length)
            else if (event.finishReason === 'tool-calls') options.onError(INCOMPLETE_MESSAGES.steps)
          }
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
      } catch {
        if (!abortSignal.aborted) {
          // Do not surface raw provider errors: some include request headers or URLs with keys.
          options.onError('Could not complete the response. Check your key, model, provider CORS support, and MCP connection, then try again.')
          throw new Error('Provider or MCP request failed.')
        }
      } finally {
        abortSignal.removeEventListener('abort', close)
        await Promise.allSettled(clients.map(client => client.close()))
      }
    },
  }
}
