import { useAuiState, type ThreadAssistantMessagePart } from '@assistant-ui/react'

/** What the assistant is doing, from the thread's state and the answer's latest part. */
export function getActivity(running: boolean, content: readonly ThreadAssistantMessagePart[]): string {
  if (!running) return 'Assistant ready'
  const pendingTool = content.find(part => part.type === 'tool-call' && part.result === undefined)
  if (pendingTool?.type === 'tool-call') return /search|find|lookup/i.test(pendingTool.toolName) ? 'Searching connected tools' : 'Using connected tools'
  if (content.at(-1)?.type === 'text') return 'Writing a response'
  return 'Thinking'
}
export function useActivity() {
  const running = useAuiState(state => state.thread.isRunning)
  const message = useAuiState(state => state.thread.messages.at(-1))
  return getActivity(running, message?.role === 'assistant' ? message.content : [])
}
