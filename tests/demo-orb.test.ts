import test from 'node:test'
import assert from 'node:assert/strict'
import type { ThreadAssistantMessagePart } from '@assistant-ui/react'
import { getOrbActivity } from '../frontend/demo/orb-state'

test('demo orbs follow actual waiting, tool, streaming, and stopped states', () => {
  const tool: ThreadAssistantMessagePart = { type: 'tool-call', toolCallId: 'one', toolName: 'workspace__search_docs', args: {}, argsText: '{}' }
  assert.equal(getOrbActivity(false, []).state, 'idle')
  assert.equal(getOrbActivity(true, []).state, 'working')
  assert.equal(getOrbActivity(true, [tool]).state, 'searching')
  assert.equal(getOrbActivity(true, [{ ...tool, toolName: 'workspace__get_current_time' }]).state, 'connecting')
  assert.equal(getOrbActivity(true, [{ ...tool, result: { content: [] } }]).state, 'working')
  assert.equal(getOrbActivity(true, [{ type: 'text', text: 'Hello' }]).state, 'composing')
  assert.equal(getOrbActivity(false, [tool]).state, 'idle')
})
