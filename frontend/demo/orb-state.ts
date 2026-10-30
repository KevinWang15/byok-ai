import { useAuiState, type ThreadAssistantMessagePart } from '@assistant-ui/react'

export type DemoOrbState = 'idle' | 'working' | 'searching' | 'connecting' | 'composing'

export function getToolOrbState(toolName: string): 'searching' | 'connecting' {
  return /search|find|lookup/i.test(toolName) ? 'searching' : 'connecting'
}

export function getOrbActivity(running: boolean, content: readonly ThreadAssistantMessagePart[]): { state: DemoOrbState; label: string } {
  if (!running) return { state: 'idle', label: 'Assistant ready' }
  const pendingTool = content.find(part => part.type === 'tool-call' && part.result === undefined)
  if (pendingTool?.type === 'tool-call') {
    const state = getToolOrbState(pendingTool.toolName)
    return { state, label: state === 'searching' ? 'Searching connected tools' : 'Using connected tools' }
  }
  if (content.at(-1)?.type === 'text') return { state: 'composing', label: 'Writing a response' }
  return { state: 'working', label: 'Thinking' }
}
export function useDemoOrbActivity() {
  const running = useAuiState(state => state.thread.isRunning)
  const message = useAuiState(state => state.thread.messages.at(-1))
  return getOrbActivity(running, message?.role === 'assistant' ? message.content : [])
}
