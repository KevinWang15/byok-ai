import { useId } from 'react'
import { Button, DialogTitle, Disclosure, DisclosureButton, DisclosurePanel } from '@headlessui/react'
import { ActionBarPrimitive, ComposerPrimitive, MessagePrimitive, ThreadPrimitive, groupPartByType, useAuiState, type ToolCallMessagePartProps } from '@assistant-ui/react'
import { AskAIChat, AskAIHistory, AskAIMessageContent, AskAIPanel, AskAITools, AskAITrigger, MarkdownText, useAskAI } from '../byok'

import { DemoOrb } from './DemoOrb'
import { DemoIcon as Icon, type DemoIconName } from './DemoIcon'
import { getToolOrbState, useDemoOrbActivity } from './orb-state'
import { useChatPanelSize } from './useChatPanelSize'
import { useDraggableLauncher } from './useDraggableLauncher'
import { DemoProviderSetup } from './DemoProviderSetup'

function IconButton({ label, icon, disabled, onClick }: { label: string; icon: DemoIconName; disabled?: boolean; onClick: () => void }) {
  return <Button className="chat-icon-button" title={label} aria-label={label} disabled={disabled} onClick={onClick}><Icon name={icon} /></Button>
}
function DemoUserMessage() {
  return <MessagePrimitive.Root data-byok="message" data-role="user" className="chat-user-message">
    <span className="chat-message-label">You</span><div className="chat-user-bubble"><AskAIMessageContent /></div>
  </MessagePrimitive.Root>
}
const toolGroups = groupPartByType({ 'tool-call': ['group-tools'] })
const toolLabels: Record<string, string> = {
  workspace__search_docs: 'Search workspace docs',
  workspace__get_current_time: 'Check current time',
}
function ToolDetail({ toolName, argsText, result, isError, status }: ToolCallMessagePartProps) {
  const running = result === undefined && status.type === 'running'
  return <Disclosure as="div" className="chat-tool-detail">
    <DisclosureButton className="chat-tool-row">
      {running ? <DemoOrb state={getToolOrbState(toolName)} size={20} decorative /> : <Icon name={isError ? 'close' : result !== undefined ? 'check' : 'stop'} />}
      <span>{toolLabels[toolName] ?? toolName.split('__').at(-1)?.replaceAll('_', ' ')}</span>
      <small>{running ? 'Running' : isError ? 'Failed' : result !== undefined ? 'Complete' : 'Interrupted'}</small>
      <Icon name="chevron" />
    </DisclosureButton>
    <DisclosurePanel className="chat-tool-json"><strong>Input</strong><pre>{argsText}</pre><strong>Result</strong><pre>{result === undefined ? 'No result yet.' : JSON.stringify(result, null, 2)}</pre></DisclosurePanel>
  </Disclosure>
}
function DemoAssistantMessage() {
  const activity = useDemoOrbActivity()
  const running = useAuiState(state => state.message.status?.type === 'running')
  return <MessagePrimitive.Root data-byok="message" data-role="assistant" className="chat-assistant-message">
    <div className="chat-message-heading"><span className="chat-avatar"><DemoOrb state={running ? activity.state : 'idle'} size={20} paused={!running} decorative /></span><span>Assistant</span></div>
    <div className="chat-assistant-content">
      <MessagePrimitive.GroupedParts groupBy={toolGroups}>{({ part, children }) => {
        switch (part.type) {
          case 'group-tools': {
            const active = part.counts.running > 0 || part.counts.requiresAction > 0
            const incomplete = part.counts.incomplete > 0
            return <Disclosure as="div" className="chat-tool-group">
              <DisclosureButton className="chat-tool-summary">
                <span className="chat-tool-dot">{active ? <DemoOrb state={activity.state} size={20} decorative /> : <Icon name={incomplete ? 'stop' : 'check'} />}</span>
                <span>{active ? 'Using connected tools' : incomplete ? 'Tool activity needs attention' : 'Used connected tools'}</span>
                <span className="chat-tool-count">{part.indices.length}</span><Icon name="chevron" />
              </DisclosureButton>
              <DisclosurePanel className="chat-tool-list">{children}</DisclosurePanel>
            </Disclosure>
          }
          case 'text': return <MarkdownText />
          case 'tool-call': return <ToolDetail {...part} />
          case 'indicator': return <div className="chat-working" role="status"><DemoOrb state={activity.state} size={20} decorative /><span>{activity.label}</span></div>
          default: return null
        }
      }}</MessagePrimitive.GroupedParts>
      <ActionBarPrimitive.Root className="chat-message-actions">
        <ActionBarPrimitive.Copy className="chat-copy" aria-label="Copy response" title="Copy response"><Icon name="copy" /></ActionBarPrimitive.Copy>
      </ActionBarPrimitive.Root>
    </div>
  </MessagePrimitive.Root>
}
function DemoEmpty() {
  return <div className="chat-empty">
    <div className="chat-empty-orb" aria-hidden="true"><DemoOrb displaySize={88} decorative /></div>
    <span className="chat-kicker">CONNECTED TO YOUR MODEL</span>
    <h2>Ask about this demo.</h2><p>Search the integration docs or ask how to add a provider. Try a prompt below to see the tools in action.</p>
    <div className="chat-suggestions">
      <ThreadPrimitive.Suggestion prompt="Describe the tools available in this demo and what each can do." method="replace" autoSend>What tools are available? <Icon name="chevron" /></ThreadPrimitive.Suggestion>
      <ThreadPrimitive.Suggestion prompt="Search the workspace docs and summarize how to add a custom provider." method="replace" autoSend>How do I add a provider? <Icon name="chevron" /></ThreadPrimitive.Suggestion>
    </div>
  </div>
}
function DemoComposer() {
  const { connection } = useAskAI()
  return <div className="chat-compose-area">
    <ComposerPrimitive.Root className="chat-compose">
      <ComposerPrimitive.Input placeholder="Ask a question…" aria-label="Message" disabled={!connection} />
      <ThreadPrimitive.If running={false}><ComposerPrimitive.Send className="chat-send" aria-label="Send message" title="Send message" disabled={!connection}><Icon name="send" /></ComposerPrimitive.Send></ThreadPrimitive.If>
      <ThreadPrimitive.If running><ComposerPrimitive.Cancel className="chat-send" aria-label="Stop response" title="Stop response"><Icon name="stop" /></ComposerPrimitive.Cancel></ThreadPrimitive.If>
    </ComposerPrimitive.Root>
  </div>
}
const chatComponents = { UserMessage: DemoUserMessage, AssistantMessage: DemoAssistantMessage, Empty: DemoEmpty, Composer: DemoComposer }

/** Consumer-owned shell and visual hierarchy. Core handles state, tools, history, and lifecycle. */
export function DemoAssistant() {
  const { title, connection, page, setPage, setOpen, newConversation, busy, storageError } = useAskAI()
  const activity = useDemoOrbActivity()
  const id = useId()
  const panelSize = useChatPanelSize()
  const launcher = useDraggableLauncher()
  const secondaryPage = Boolean(connection) && page !== 'chat'
  return <div data-byok="root" style={launcher.style} data-dragging={launcher.dragging}>
    <AskAIPanel id={id} className="demo-chat-shell" style={panelSize.style}
      data-maximized={panelSize.maximized} data-resizing={panelSize.resizing}
      data-positioned={panelSize.positioned} data-moving={panelSize.moving}>
      <header className="chat-header" aria-label="Move chat window" aria-describedby={id + '-move-window-help'} {...panelSize.headerProps}>
        <span id={id + '-move-window-help'} className="demo-sr-only">Drag this header to move the window, or use arrow keys while focused. Hold Shift for larger steps.</span>
        {secondaryPage ? <IconButton label="Back to chat" icon="back" onClick={() => setPage('chat')} /> : <div className="chat-header-orb"><DemoOrb state={activity.state} label={activity.label} size={32} /></div>}
        <div className="chat-title"><DialogTitle>{title}</DialogTitle><span><i />{busy ? activity.label : connection ? connection.values.model || connection.provider.name : 'Choose a provider to start'}</span></div>
        <div className="chat-header-actions">
          {connection && <IconButton label="New chat" icon="plus" disabled={busy} onClick={newConversation} />}
          <IconButton label="Conversation history" icon="history" disabled={busy} onClick={() => setPage('history')} />
          <IconButton label="Provider settings" icon="settings" disabled={busy} onClick={() => setPage('settings')} />
          <IconButton label={panelSize.maximized ? 'Restore chat size' : 'Maximize chat'} icon={panelSize.maximized ? 'restore' : 'maximize'} onClick={panelSize.toggleMaximized} />
          <IconButton label="Close assistant" icon="close" onClick={() => setOpen(false)} />
        </div>
      </header>
      {storageError && <p role="alert" className="chat-error">Browser data could not be saved. Check your browser’s storage settings.</p>}
      {(!connection || page === 'settings') && <div className="chat-secondary-view chat-provider-view">
        <DemoProviderSetup key={connection?.provider.id ?? 'disconnected'} />
      </div>}
      {connection && <>
        <div className="chat-conversation" hidden={page !== 'chat'}><AskAIChat components={chatComponents} /></div>
        {page === 'history' && <div className="chat-secondary-view"><AskAIHistory /></div>}
        {page === 'tools' && <div className="chat-secondary-view"><AskAITools /></div>}
      </>}
      {!panelSize.maximized && <>
        <span id={id + '-resize-help'} className="demo-sr-only">Drag to resize, or use arrow keys. Hold Shift for larger steps.</span>
        <Button type="button" className="chat-resize-handle chat-resize-width" aria-label="Resize chat width" aria-describedby={id + '-resize-help'} {...panelSize.handleProps('width')} />
        <Button type="button" className="chat-resize-handle chat-resize-height" aria-label="Resize chat height" aria-describedby={id + '-resize-help'} {...panelSize.handleProps('height')} />
        <Button type="button" className="chat-resize-handle chat-resize-corner" aria-label="Resize chat" title="Drag to resize" aria-describedby={id + '-resize-help'} {...panelSize.handleProps('both')}>
          <Icon name="resize" size={13} />
        </Button>
      </>}
    </AskAIPanel>
    <span id={id + '-move-help'} className="demo-sr-only">Drag to move, or use arrow keys while focused. Hold Shift for larger steps. Click or press Enter to open chat.</span>
    <AskAITrigger aria-controls={id} aria-describedby={id + '-move-help'} title="Ask AI — drag to move" {...launcher.triggerProps}><Icon name="sparkle" /><span>Ask AI</span></AskAITrigger>
  </div>
}
