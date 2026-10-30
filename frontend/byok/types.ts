import type { ComponentType, ReactNode } from 'react'
import type { LanguageModel, ToolSet } from 'ai'
import type { TextMessagePartComponent, ToolCallMessagePartComponent } from '@assistant-ui/react'

export type ProviderValues = Record<string, string>
export interface ProviderFormProps {
  values: ProviderValues
  onChange: (values: ProviderValues) => void
}
export interface ProviderPreset {
  id: string
  name: string
  description: string
  defaultValues: ProviderValues
  fields?: { name: string; label: string; type?: 'text' | 'password' | 'url'; placeholder?: string; required?: boolean }[]
  Form?: ComponentType<ProviderFormProps>
  validate?: (values: ProviderValues) => string | undefined
  createModel: (values: ProviderValues) => LanguageModel
}
export interface McpServerConfig {
  /** Unique identifier; used to namespace tool names. */
  id: string
  name: string
  url: string
  headers?: Record<string, string> | (() => Promise<Record<string, string>>)
}
export interface AskAIOptions {
  providers?: ProviderPreset[]
  mcpServers?: McpServerConfig[]
  /**
   * Tools that run in the page, beside the MCP servers' (AI SDK `tool()` definitions).
   * Names are used as given and may not contain "__". Pass new definitions as the page's state
   * changes: every call runs the latest one. Adding or removing a name restarts the runtime.
   */
  clientTools?: ToolSet
  systemPrompt?: string
  storageKey?: string
  /**
   * Where the provider connection is saved; `storageKey` when omitted. Assistants with the
   * same key share one connection: connecting or disconnecting in one updates the others, in
   * this tab and in other tabs. Each keeps its own conversations under its `storageKey`.
   */
  connectionKey?: string
  title?: string
  maxSteps?: number
  /** Output token limit per model step; the provider's default when omitted. */
  maxOutputTokens?: number
  /** Tool calls allowed per answer; after that the model answers without tools. Unlimited when omitted. */
  maxToolCalls?: number
}

export interface AskAIProviderProps extends AskAIOptions { children: ReactNode }
export interface AskAIChatProps {
  /** Override message text and tool rendering while retaining chat behavior. */
  components?: {
    Text?: TextMessagePartComponent
    ToolFallback?: ToolCallMessagePartComponent
    /** Layout slots run inside the existing assistant-ui runtime and message scopes. */
    UserMessage?: ComponentType
    AssistantMessage?: ComponentType
    Empty?: ComponentType
    Composer?: ComponentType
  }
}
export interface AskAIProps extends AskAIOptions, AskAIChatProps { children?: ReactNode }
