import test from 'node:test'
import assert from 'node:assert/strict'
import type { ThreadAssistantMessagePart } from '@assistant-ui/react'
import { getActivity } from '../frontend/demo/activity'

test('the demo status follows waiting, tool calls, and streaming', () => {
  const tool: ThreadAssistantMessagePart = { type: 'tool-call', toolCallId: 'one', toolName: 'workspace__search_docs', args: {}, argsText: '{}' }
  assert.equal(getActivity(false, [tool]), 'Assistant ready')
  assert.equal(getActivity(true, []), 'Thinking')
  assert.equal(getActivity(true, [tool]), 'Searching connected tools')
  assert.equal(getActivity(true, [{ ...tool, toolName: 'workspace__get_current_time' }]), 'Using connected tools')
  assert.equal(getActivity(true, [{ ...tool, result: { content: [] } }]), 'Thinking')
  assert.equal(getActivity(true, [{ type: 'text', text: 'Hello' }]), 'Writing a response')
})
