import { createContext, useContext } from 'react'
import type { AssistantRuntime } from '@assistant-ui/react'
import type { ProviderPreset, ProviderValues, AskAIOptions } from './types'
import type { Conversation } from './storage'
import type { Workspace } from './conversation-files'

export type AskAIPage = 'chat' | 'settings' | 'history' | 'tools'
export interface ProviderConnection { provider: ProviderPreset; values: ProviderValues }
export interface AskAIContextValue {
  title: string
  providers: ProviderPreset[]
  mcpServers: NonNullable<AskAIOptions['mcpServers']>
  /** Names of the tools that run in the page. */
  clientTools: string[]
  /** The open conversation's files, when the workspace is on. */
  workspace?: Workspace
  /** Whether the user can attach images now: the `images` option, with a provider that accepts them. */
  images: boolean
  /** An image of the open conversation by attachment id; undefined when it is no longer stored. */
  loadImage: (id: string) => Promise<Blob | undefined>
  open: boolean
  setOpen: (open: boolean) => void
  page: AskAIPage
  setPage: (page: AskAIPage) => void
  connection?: ProviderConnection
  connect: (provider: ProviderPreset, values: ProviderValues) => string | undefined
  disconnect: () => void
  conversations: Conversation[]
  activeConversation: Conversation
  newConversation: () => void
  selectConversation: (id: string) => void
  deleteConversation: (id: string) => void
  busy: boolean
  storageError: boolean
  error: string
  runtime: AssistantRuntime
}
export const AskAIContext = createContext<AskAIContextValue | null>(null)
/** State, actions, and the assistant-ui runtime, without any UI or CSS. */
export function useAskAI(): AskAIContextValue {
  const value = useContext(AskAIContext)
  if (!value) throw new Error('useAskAI must be used inside AskAIProvider or AskAI.')
  return value
}
