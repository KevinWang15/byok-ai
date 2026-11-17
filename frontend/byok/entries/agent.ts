// `@kevinwang15/byok-ai/agent`: the agent loop without React, for running the assistant where no
// chat is mounted: a background job in the page, a worker, or Node (evaluations, tests). MCP
// servers resolve relative URLs against `window.location`, so outside a page give absolute ones.
export { createBrowserAdapter } from '../agent'
export { answerComponentInstructions } from '../answer-components'
export { memoryConversationFiles, WORKSPACE_LIMITS } from '../conversation-files'
export { SCRIPT_LIMITS } from '../script'
export type { AnswerComponent } from '../answer-components'
export type { ConversationFiles, ImageStore, Workspace, WorkspaceFile } from '../conversation-files'
export type { ScriptRequest, ScriptResult } from '../script'
export type { ScriptRunner } from '../script-runner'
export type { McpServerConfig, ProviderPreset, ProviderValues } from '../types'
