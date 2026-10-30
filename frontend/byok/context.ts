import { createContext, useContext } from 'react'
import type { AssistantRuntime } from '@assistant-ui/react'
import type { ProviderPreset, ProviderValues, AskAIOptions } from './types'
import type { Conversation } from './storage'

export type AskAIPage = 'chat' | 'settings' | 'history' | 'tools'
export interface ProviderConnection { provider: ProviderPreset; values: ProviderValues }
export interface AskAIContextValue {
  title: string
  providers: ProviderPreset[]
  mcpServers: NonNullable<AskAIOptions['mcpServers']>
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
