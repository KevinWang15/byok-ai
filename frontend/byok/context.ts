import { createContext, useContext } from 'react'
import type { AssistantRuntime } from '@assistant-ui/react'
import type { ProviderPreset, ProviderValues, AskAIOptions } from './types'
import type { Conversation } from './storage'
import type { Workspace } from './conversation-files'
import type { AnswerComponent } from './answer-components'
import type { AskAIProblem, AskAIText, ConnectProblem } from './text'

export type AskAIPage = 'chat' | 'settings' | 'history' | 'tools'
export interface ProviderConnection { provider: ProviderPreset; values: ProviderValues }
export interface AskAIContextValue {
  title: string
  /** The built-in parts' words: the `text` option over the English defaults. */
  text: AskAIText
  providers: ProviderPreset[]
  mcpServers: NonNullable<AskAIOptions['mcpServers']>
  answerComponents: readonly AnswerComponent[]
  /** Names of the tools that run in the page. */
  clientTools: string[]
  /** The open conversation's files, when the workspace is on. */
  workspace?: Workspace
  /** Whether the user can attach images now: the `images` option, with a provider that accepts them. */
  images: boolean
  /** An image of the open conversation by attachment id; undefined when it is no longer stored. */
  loadImage: (id: string) => Promise<Blob | undefined>
  /** Whether the user can add elements of the page to a message: the `pageContext` option. */
  pageContext: boolean
  /** Whether the user is choosing an element of the page now. */
  picking: boolean
  /**
   * Lets the user choose an element of the page and adds it to the composer. Does nothing while
   * choosing, or when `pageContext` is off. A message that holds as many as it can says so in `error`.
   */
  pickFromPage: () => void
  /** The element a page element attachment of the composer stands for, while it is on the page. */
  pageElement: (id: string) => Element | undefined
  open: boolean
  setOpen: (open: boolean) => void
  page: AskAIPage
  setPage: (page: AskAIPage) => void
  connection?: ProviderConnection
  /** Connects and saves the provider, or says why not. */
  connect: (provider: ProviderPreset, values: ProviderValues) => ConnectProblem | undefined
  disconnect: () => void
  conversations: Conversation[]
  activeConversation: Conversation
  newConversation: () => void
  selectConversation: (id: string) => void
  deleteConversation: (id: string) => void
  busy: boolean
  storageError: boolean
  /** Why the last answer stopped short or failed, or why the last image or page element couldn't be added. */
  error: AskAIProblem | undefined
  runtime: AssistantRuntime
}
export const AskAIContext = createContext<AskAIContextValue | null>(null)
/** The enclosing AskAIProvider's state, or null outside one. */
export const useAskAIOptional = () => useContext(AskAIContext)
export function useAskAI(): AskAIContextValue {
  const value = useContext(AskAIContext)
  if (!value) throw new Error('useAskAI must be used inside AskAIProvider or AskAI.')
  return value
}
