import { useContext, useId, useState, type ComponentPropsWithoutRef, type ReactNode } from 'react'
import { ActionBarPrimitive, ThreadPrimitive, ComposerPrimitive, MessagePrimitive, useAuiState, type ToolCallMessagePartComponent } from '@assistant-ui/react'
import { Button, Dialog, DialogPanel, DialogTitle, Disclosure, DisclosureButton, DisclosurePanel, Field, Fieldset, Input, Label, Legend } from '@headlessui/react'
import { AskAIProvider } from './AskAIProvider'
import { useAskAI } from './context'
import { MarkdownText } from './MarkdownText'
import { AskAIHistory } from './AskAIHistory'
import { MessageRenderingContext } from './rendering-context'
import type { AskAIChatProps, AskAIProps, ProviderPreset, ProviderValues } from './types'

const Tool: ToolCallMessagePartComponent = ({ toolName, result, argsText, isError }) => (
  <Disclosure as="div" data-byok="tool"><DisclosureButton>{toolName}: {result === undefined ? 'Running…' : isError ? 'Failed' : 'Done'}</DisclosureButton><DisclosurePanel>
    <pre>{argsText}</pre>{result !== undefined && <pre>{JSON.stringify(result, null, 2)}</pre>}
  </DisclosurePanel></Disclosure>
)
function DefaultMarkdownText() { return <MarkdownText /> }
/** Content renderer for consumer-owned message layouts; retains the chat's Text/Tool overrides. */
export function AskAIMessageContent() {
  const components = useContext(MessageRenderingContext)
  return <MessagePrimitive.Content components={{
    Text: components?.Text ?? DefaultMarkdownText,
    tools: { Fallback: components?.ToolFallback ?? Tool },
  }} />
}
/**
 * Unstyled actions for the enclosing assistant message: copy its text and regenerate it.
 * Hidden while a response runs; on earlier messages only while hovered or focused.
 * Regenerate is disabled without a provider. `copy`, `copied` and `regenerate` replace the labels.
 * Hidden actions keep their place (`visibility: hidden`, `data-hidden`), so hovering a message
 * never changes the conversation's height or shows and hides its scrollbar.
 */
export function AskAIMessageActions({ copy = 'Copy response', copied = 'Copied', regenerate = 'Regenerate response', style, ...props }:
  Omit<ComponentPropsWithoutRef<typeof ActionBarPrimitive.Root>, 'children'> & { copy?: ReactNode; copied?: ReactNode; regenerate?: ReactNode }) {
  const { connection } = useAskAI()
  const isCopied = useAuiState(state => state.message.isCopied)
  const hidden = useAuiState(state => state.thread.isRunning || (!state.message.isLast && !state.message.isHovering))
  return <ActionBarPrimitive.Root data-byok="message-actions" data-hidden={hidden || undefined} {...props}
    style={hidden ? { ...style, visibility: 'hidden' } : style}>
    <ActionBarPrimitive.Copy data-byok="message-copy">{isCopied ? copied : copy}</ActionBarPrimitive.Copy>
    <ActionBarPrimitive.Reload data-byok="message-regenerate" disabled={!connection}>{regenerate}</ActionBarPrimitive.Reload>
  </ActionBarPrimitive.Root>
}
function Message() {
  const role = useAuiState(state => state.message.role)
  return <MessagePrimitive.Root data-byok="message" data-role={role}>
    <AskAIMessageContent />{role === 'assistant' && <AskAIMessageActions />}
  </MessagePrimitive.Root>
}
function DefaultEmpty() { return <p>Start a conversation.</p> }
function DefaultComposer() {
  const { connection } = useAskAI()
  return <ComposerPrimitive.Root data-byok="composer">
    <ComposerPrimitive.Input placeholder="Ask anything…" aria-label="Message" disabled={!connection} />
    <ThreadPrimitive.If running={false}><ComposerPrimitive.Send disabled={!connection}>Send message</ComposerPrimitive.Send></ThreadPrimitive.If>
    <ThreadPrimitive.If running><ComposerPrimitive.Cancel>Stop response</ComposerPrimitive.Cancel></ThreadPrimitive.If>
  </ComposerPrimitive.Root>
}
/** Unstyled chat orchestration with replaceable message, empty-state, and composer layouts. */
export function AskAIChat({ components }: AskAIChatProps = {}) {
  const { error } = useAskAI()
  const Empty = components?.Empty ?? DefaultEmpty
  const Composer = components?.Composer ?? DefaultComposer
  return <MessageRenderingContext.Provider value={components}><ThreadPrimitive.Root data-byok="chat">
    <ThreadPrimitive.Viewport data-byok="messages">
      <ThreadPrimitive.Empty><Empty /></ThreadPrimitive.Empty>
      <ThreadPrimitive.Messages components={{
        UserMessage: components?.UserMessage ?? Message,
        AssistantMessage: components?.AssistantMessage ?? Message,
      }} />
    </ThreadPrimitive.Viewport>
    {error && <p role="alert">{error}</p>}
    <Composer />
  </ThreadPrimitive.Root></MessageRenderingContext.Provider>
}

/** Optional provider form. Consumers may instead call useAskAI().connect(). */
export function AskAISetup() {
  const { providers, connection, connect, setPage, busy } = useAskAI()
  const [selected, setSelected] = useState<ProviderPreset | undefined>(connection?.provider)
  const [values, setValues] = useState<ProviderValues>(connection?.values ?? {})
  const [error, setError] = useState('')
  const CustomForm = selected?.Form
  return <section data-byok="setup">
    <h2>{selected ? selected.name : 'Choose an AI provider'}</h2>
    {selected ? <form onSubmit={e => {
      e.preventDefault()
      setError(connect(selected, values) ?? '')
    }}>
      <p>{selected.description}</p>
      <Button type="button" onClick={() => { setSelected(undefined); setValues({}); setError('') }}>All providers</Button>
      <Fieldset disabled={busy}>
        <Legend>Provider configuration</Legend>
        {CustomForm ? <CustomForm values={values} onChange={setValues} /> : selected.fields?.map(field => <Field key={field.name}>
          <Label>{field.label}</Label>
          <Input autoComplete="off" type={field.type ?? 'text'} required={field.required} placeholder={field.placeholder}
            value={values[field.name] ?? ''} onChange={e => setValues({ ...values, [field.name]: e.target.value })} />
        </Field>)}
      </Fieldset>
      {error && <p role="alert">{error}</p>}
      <p>Keys and provider settings are saved in localStorage on this browser. Disconnect to remove the saved key.</p>
      <Button type="submit" disabled={busy}>Start chatting</Button>
    </form> : <ul>{providers.map(provider => <li key={provider.id}>
      <Button type="button" onClick={() => { setSelected(provider); setValues({ ...provider.defaultValues }); setError('') }}>{provider.name}</Button>
      <p>{provider.description}</p>
    </li>)}</ul>}
    {connection && <Button type="button" onClick={() => setPage('chat')}>Return to conversation</Button>}
  </section>
}

export { AskAIHistory }

export function AskAITools() {
  const { mcpServers, clientTools } = useAskAI()
  return <section data-byok="tools"><h2>MCP servers</h2>
    <ul>{mcpServers.map(server => <li key={server.id}>{server.name} <code>{server.url}</code></li>)}</ul>
    {!mcpServers.length && <p>No MCP servers configured.</p>}
    {clientTools.length > 0 && <><h2>Page tools</h2>
      <ul>{clientTools.map(name => <li key={name}><code>{name}</code></li>)}</ul></>}
  </section>
}

/** Native button props, including className, style, children, and event handlers. */
export function AskAITrigger({ children, onClick, ...props }: ComponentPropsWithoutRef<'button'>) {
  const { open, setOpen } = useAskAI()
  return <Button type="button" data-byok="trigger" aria-expanded={open} aria-label={open ? 'Close Ask AI' : 'Open Ask AI'}
    {...props} onClick={event => { onClick?.(event); if (!event.defaultPrevented) setOpen(!open) }}>
    {children ?? 'ASK AI'}
  </Button>
}

/** Headless UI dialog: portal, focus management, Escape, and outside-click dismissal. */
export function AskAIPanel({ children, ...props }: ComponentPropsWithoutRef<'div'>) {
  const { open, setOpen, title } = useAskAI()
  return <Dialog open={open} onClose={setOpen} aria-label={title} data-byok="dialog">
    <DialogPanel data-byok="panel" {...props}>{children}</DialogPanel>
  </Dialog>
}

/** A complete default UI using unstyled Headless UI and assistant-ui primitives. */
export function AskAIWidget({ components }: AskAIChatProps = {}) {
  const { title, connection, page, setPage, setOpen, newConversation, disconnect, busy, storageError } = useAskAI()
  const panelId = useId()
  return <div data-byok="root">
    <AskAIPanel id={panelId}>
      <header><DialogTitle>{title}</DialogTitle>{connection && <span> — {connection.provider.name}</span>}
        <nav aria-label="Assistant">
          <Button type="button" disabled={busy} onClick={() => setPage('history')}>Conversation history</Button>
          <Button type="button" disabled={busy} onClick={() => setPage('settings')}>Provider settings</Button>
          <Button type="button" onClick={() => setOpen(false)}>Close assistant</Button>
        </nav>
      </header>
      {storageError && <p role="alert">Could not read or save browser data. Keys, settings, and conversations may not be restored or removed after reload.</p>}
      {(!connection || page === 'settings') && <AskAISetup key={connection?.provider.id ?? 'disconnected'} />}
      {connection && <>
        <nav aria-label="Conversation">
          <Button type="button" disabled={busy} onClick={newConversation}>New chat</Button>
          <Button type="button" disabled={busy} onClick={() => setPage('chat')}>Chat</Button>
          <Button type="button" disabled={busy} onClick={() => setPage('tools')}>MCP servers</Button>
          <Button type="button" disabled={busy} onClick={disconnect}>Disconnect provider</Button>
        </nav>
        <div hidden={page !== 'chat'}><AskAIChat components={components} /></div>
        {page === 'history' && <AskAIHistory />}
        {page === 'tools' && <AskAITools />}
      </>}
    </AskAIPanel>
    <AskAITrigger aria-controls={panelId} />
  </div>
}

/** Convenience composition. Pass children to replace the entire UI. No styles are imported. */
export function AskAI({ children, components, ...options }: AskAIProps) {
  return <AskAIProvider {...options}>{children ?? <AskAIWidget components={components} />}</AskAIProvider>
}
