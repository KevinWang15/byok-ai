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
  /** Whether the model takes images in the user's messages (the `images` option). Default false. */
  acceptsImages?: boolean
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
  /**
   * Gives the assistant a workspace: files kept with each conversation in the browser's private
   * file system (OPFS), and JavaScript it can run over them in a sandbox (QuickJS in a worker, with
   * no network or page access) for calculation and analysis. The tools are named `workspace__…`, so
   * no MCP server may use the id "workspace". Deleting a conversation deletes its files. Default false.
   */
  workspace?: boolean
  /**
   * Lets the user attach images to a message (button, paste or drop) when the connected provider
   * `acceptsImages`. Images are scaled to what models read and kept with the conversation in the
   * browser's private file system (OPFS), not in localStorage; each later turn sends them again.
   * Deleting a conversation deletes them. Default false.
   */
  images?: boolean
  systemPrompt?: string
  /** Where conversations and the open one are saved. Default `byok-ai:conversations`. */
  storageKey?: string
  /**
   * Where the provider connection is saved: `${storageKey}:connection` when omitted, and never
   * `storageKey` itself. Assistants with the same key share one connection: connecting or
   * disconnecting in one updates the others, in this tab and in other tabs. Each keeps its own
   * conversations under its `storageKey`.
   */
  connectionKey?: string
  title?: string
  /** Model steps per answer, each a model call that may call tools. Default 8. */
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
