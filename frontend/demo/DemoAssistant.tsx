import { useId } from 'react'
import { Button, DialogTitle, Disclosure, DisclosureButton, DisclosurePanel } from '@headlessui/react'
import { ComposerPrimitive, MessagePrimitive, ThreadPrimitive, groupPartByType, type ToolCallMessagePartProps } from '@assistant-ui/react'
import { AskAIChat, AskAIHistory, AskAIMessageActions, AskAIMessageContent, usePanelLayout, AskAIPanel, AskAITrigger, MarkdownText, useAskAI, type ResizeEdge } from '../byok'

import { DemoIcon as Icon, type DemoIconName } from './DemoIcon'
import { useActivity } from './activity'
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
  return <Disclosure as="div">
    <DisclosureButton className="chat-tool-row">
      <Icon name={running ? 'working' : isError ? 'close' : result !== undefined ? 'check' : 'stop'} className={running ? 'chat-spin' : undefined} />
      <span>{toolLabels[toolName] ?? toolName.split('__').at(-1)?.replaceAll('_', ' ')}</span>
      <small>{running ? 'Running' : isError ? 'Failed' : result !== undefined ? 'Complete' : 'Interrupted'}</small>
      <Icon name="chevron" />
    </DisclosureButton>
    <DisclosurePanel className="chat-tool-json"><strong>Input</strong><pre>{argsText}</pre><strong>Result</strong><pre>{result === undefined ? 'No result yet.' : JSON.stringify(result, null, 2)}</pre></DisclosurePanel>
  </Disclosure>
}
function DemoAssistantMessage() {
  const activity = useActivity()
  return <MessagePrimitive.Root data-byok="message" data-role="assistant">
    <div className="chat-message-heading"><span className="chat-avatar"><Icon name="sparkle" size={13} /></span><span>Assistant</span></div>
    <div className="chat-assistant-content">
      <MessagePrimitive.GroupedParts groupBy={toolGroups}>{({ part, children }) => {
        switch (part.type) {
          case 'group-tools': {
            const active = part.counts.running > 0 || part.counts.requiresAction > 0
            const incomplete = part.counts.incomplete > 0
            return <Disclosure as="div" className="chat-tool-group">
              <DisclosureButton className="chat-tool-summary">
                <span className="chat-tool-dot"><Icon name={active ? 'working' : incomplete ? 'stop' : 'check'} className={active ? 'chat-spin' : undefined} /></span>
                <span>{active ? 'Using connected tools' : incomplete ? 'Tool activity needs attention' : 'Used connected tools'}</span>
                <span className="chat-tool-count">{part.indices.length}</span><Icon name="chevron" />
              </DisclosureButton>
              <DisclosurePanel className="chat-tool-list">{children}</DisclosurePanel>
            </Disclosure>
          }
          case 'text': return <MarkdownText />
          case 'tool-call': return <ToolDetail {...part} />
          case 'indicator': return <div className="chat-working" role="status"><Icon name="working" size={14} className="chat-spin" /><span>{activity}</span></div>
          default: return null
        }
      }}</MessagePrimitive.GroupedParts>
      <AskAIMessageActions className="chat-message-actions"
        copy={<><Icon name="copy" /><span>Copy</span></>} copied={<><Icon name="check" /><span>Copied</span></>}
        regenerate={<><Icon name="regenerate" /><span>Regenerate</span></>} />
    </div>
  </MessagePrimitive.Root>
}
function DemoEmpty() {
  return <div className="chat-empty">
    <div className="chat-empty-mark"><Icon name="sparkle" size={36} /></div>
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
const edges: [ResizeEdge, string][] = [
  ['n', 'top'], ['s', 'bottom'], ['e', 'right'], ['w', 'left'],
  ['ne', 'top right'], ['nw', 'top left'], ['se', 'bottom right'], ['sw', 'bottom left'],
]

/** Consumer-owned shell and visual hierarchy. Core handles state, tools, history, and lifecycle. */
export function DemoAssistant() {
  const { title, connection, page, setPage, setOpen, newConversation, busy, storageError } = useAskAI()
  const activity = useActivity()
  const id = useId()
  const panelSize = usePanelLayout({ storageKey: 'byok-ai:demo-panel' })
  const launcher = useDraggableLauncher()
  const secondaryPage = Boolean(connection) && page !== 'chat'
  return <div data-byok="root" style={launcher.style} data-dragging={launcher.dragging}>
    <AskAIPanel id={id} {...panelSize.panelProps} className="demo-chat-shell" style={panelSize.style}
      data-maximized={panelSize.maximized} data-resizing={panelSize.resizing}
      data-positioned={panelSize.positioned} data-moving={panelSize.moving}>
      <header className="chat-header" aria-label="Move chat window" aria-describedby={id + '-move-window-help'} {...panelSize.headerProps}>
        <span id={id + '-move-window-help'} className="demo-sr-only">Drag this header to move the window, or use arrow keys while focused. Hold Shift for larger steps.</span>
        {secondaryPage ? <IconButton label="Back to chat" icon="back" onClick={() => setPage('chat')} /> : <div className="chat-header-mark"><Icon name={busy ? 'working' : 'sparkle'} className={busy ? 'chat-spin' : undefined} /></div>}
        <div className="chat-title"><DialogTitle>{title}</DialogTitle><span><i />{busy ? activity : connection ? connection.values.model || connection.provider.name : 'Choose a provider to start'}</span></div>
        <div className="chat-header-actions">
          {connection && <IconButton label="New chat" icon="plus" disabled={busy} onClick={newConversation} />}
          <IconButton label="Conversation history" icon="history" disabled={busy} onClick={() => setPage('history')} />
          <IconButton label="Provider settings" icon="settings" disabled={busy} onClick={() => setPage('settings')} />
          <IconButton label={panelSize.maximized ? 'Restore chat size' : 'Maximize chat'} icon={panelSize.maximized ? 'restore' : 'maximize'} onClick={panelSize.toggleMaximized} />
          <IconButton label="Close assistant" icon="close" onClick={() => setOpen(false)} />
        </div>
      </header>
      {storageError && <p role="alert">Browser data could not be saved. Check your browser’s storage settings.</p>}
      {(!connection || page === 'settings') && <div className="chat-secondary-view">
        <DemoProviderSetup key={connection?.provider.id ?? 'disconnected'} />
      </div>}
      {connection && <>
        <div className="chat-conversation" hidden={page !== 'chat'}><AskAIChat components={chatComponents} /></div>
        {page === 'history' && <div className="chat-secondary-view"><AskAIHistory /></div>}
      </>}
      {!panelSize.maximized && <>
        <span id={id + '-resize-help'} className="demo-sr-only">Drag to resize, or use arrow keys. Hold Shift for larger steps.</span>
        {edges.map(([edge, side]) => <Button key={edge} type="button" className={'chat-resize-handle chat-resize-' + edge}
          aria-label={'Resize chat from the ' + side} aria-describedby={id + '-resize-help'} {...panelSize.handleProps(edge)} />)}
      </>}
    </AskAIPanel>
    <span id={id + '-move-help'} className="demo-sr-only">Drag to move, or use arrow keys while focused. Hold Shift for larger steps. Click or press Enter to open chat.</span>
    <AskAITrigger aria-controls={id} aria-describedby={id + '-move-help'} title="Ask AI — drag to move" {...launcher.triggerProps}><Icon name="sparkle" /><span>Ask AI</span></AskAITrigger>
  </div>
}
