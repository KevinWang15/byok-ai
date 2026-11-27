import { useContext, useEffect, useId, useState, type ComponentProps, type ComponentPropsWithoutRef, type ReactNode } from 'react'
import { ActionBarPrimitive, AttachmentPrimitive, ThreadPrimitive, ComposerPrimitive, MessagePrimitive, useAui, useAuiState, type ToolCallMessagePartComponent } from '@assistant-ui/react'
import { Button, Dialog, DialogPanel, DialogTitle, Disclosure, DisclosureButton, DisclosurePanel, Field, Fieldset, Input, Label, Legend } from '@headlessui/react'
import { AskAIProvider } from './AskAIProvider'
import { useAskAI } from './context'
import { MarkdownText } from './Markdown'
import { AskAIHistory } from './AskAIHistory'
import { MessageRenderingContext } from './rendering-context'
import { useAskAIImage } from './useAskAIImage'
import { AskAIAddFromPage, AskAIComposerElements, AskAIMessageElements } from './PageElements'
import type { AskAIChatProps, AskAIProps, ProviderPreset, ProviderValues } from './types'
import type { Workspace, WorkspaceFile } from './conversation-files'

const TOOL_STATUS = { running: 'Running…', 'requires-action': 'Running…', incomplete: 'Stopped', complete: 'Done' } as const
const Tool: ToolCallMessagePartComponent = ({ toolName, result, argsText, isError, status }) => (
  <Disclosure as="div" data-byok="tool"><DisclosureButton>{toolName}: {isError ? 'Failed' : TOOL_STATUS[status.type]}</DisclosureButton><DisclosurePanel>
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
 * Unstyled actions for the enclosing message. An assistant message's: copy its text and
 * regenerate it, which adds another version of it. A user message's: edit it, which sends the
 * edited message as another version of it and answers that. Hidden while a response runs; on
 * earlier messages only while hovered or focused. Regenerate and edit are disabled without a
 * provider. `copy`, `copied`, `regenerate` and `edit` replace the labels. Hidden actions keep
 * their place (`visibility: hidden`, `data-hidden`), so hovering a message never changes the
 * conversation's height or shows and hides its scrollbar.
 */
export function AskAIMessageActions({ copy = 'Copy response', copied = 'Copied', regenerate = 'Regenerate response', edit = 'Edit message', style, ...props }:
  Omit<ComponentPropsWithoutRef<typeof ActionBarPrimitive.Root>, 'children'> & { copy?: ReactNode; copied?: ReactNode; regenerate?: ReactNode; edit?: ReactNode }) {
  const { connection } = useAskAI()
  const role = useAuiState(state => state.message.role)
  const isCopied = useAuiState(state => state.message.isCopied)
  const hidden = useAuiState(state => state.thread.isRunning || (!state.message.isLast && !state.message.isHovering))
  return <ActionBarPrimitive.Root data-byok="message-actions" data-hidden={hidden || undefined} {...props}
    style={hidden ? { ...style, visibility: 'hidden' } : style}>
    {role === 'user' ? <ActionBarPrimitive.Edit data-byok="message-edit" disabled={!connection}>{edit}</ActionBarPrimitive.Edit> : <>
      <ActionBarPrimitive.Copy data-byok="message-copy">{isCopied ? copied : copy}</ActionBarPrimitive.Copy>
      <ActionBarPrimitive.Reload data-byok="message-regenerate" disabled={!connection}>{regenerate}</ActionBarPrimitive.Reload>
    </>}
  </ActionBarPrimitive.Root>
}
/**
 * The versions of the enclosing message, where a regenerated answer or an edited message added
 * another: previous and next buttons around "2 / 5". Showing one shows its branch, the
 * conversation that follows it. Renders nothing for a message with one version. `previous` and
 * `next` replace the buttons' contents; their accessible names stay "Previous version" and
 * "Next version".
 */
export function AskAIBranchPicker({ previous = 'Previous', next = 'Next', ...props }: Omit<ComponentPropsWithoutRef<'div'>, 'children'> & { previous?: ReactNode; next?: ReactNode }) {
  const aui = useAui()
  const number = useAuiState(state => state.message.branchNumber)
  const count = useAuiState(state => state.message.branchCount)
  if (count <= 1) return null
  return <div data-byok="branch-picker" role="group" aria-label="Versions" {...props}>
    <Button type="button" data-byok="branch-previous" aria-label="Previous version" disabled={number <= 1}
      onClick={() => aui.message.switchToBranch({ position: 'previous' })}>{previous}</Button>
    <span data-byok="branch-count">{number} / {count}</span>
    <Button type="button" data-byok="branch-next" aria-label="Next version" disabled={number >= count}
      onClick={() => aui.message.switchToBranch({ position: 'next' })}>{next}</Button>
  </div>
}
// An image, with a remove button in a composer (the message box, or a message being edited).
function ImageThumb({ removable }: { removable: boolean }) {
  const { src, name, missing } = useAskAIImage()
  return <AttachmentPrimitive.Root data-byok="image" data-missing={missing || undefined}>
    {src ? <img src={src} alt={name} /> : <span>{missing ? `${name} (no longer stored)` : name}</span>}
    {removable && <AttachmentPrimitive.Remove data-byok="image-remove" aria-label={`Remove ${name}`}>Remove</AttachmentPrimitive.Remove>}
  </AttachmentPrimitive.Root>
}
// Images only: a message's page elements are AskAIComposerElements' and AskAIMessageElements'.
const COMPOSER_IMAGES = { Image: () => <ImageThumb removable /> }
const MESSAGE_IMAGES = { Image: () => <ImageThumb removable={false} /> }
/** The images attached in the composer, each with a remove button. Use inside a composer. */
export function AskAIComposerImages() {
  return <div data-byok="composer-images"><ComposerPrimitive.Attachments components={COMPOSER_IMAGES} /></div>
}
/** The images sent with the enclosing user message. */
export function AskAIMessageImages() {
  return <div data-byok="message-images"><MessagePrimitive.Attachments components={MESSAGE_IMAGES} /></div>
}
/**
 * Opens the file picker for images. Renders nothing while images can't be attached (the `images`
 * option is off, or the provider doesn't accept them). Pasting into the message box and dropping
 * on `ComposerPrimitive.AttachmentDropzone` attach too.
 */
export function AskAIAddImage({ children = 'Attach image', ...props }: ComponentPropsWithoutRef<typeof ComposerPrimitive.AddAttachment>) {
  const { images, connection } = useAskAI()
  if (!images) return null
  return <ComposerPrimitive.AddAttachment data-byok="add-image" disabled={!connection} {...props}>{children}</ComposerPrimitive.AddAttachment>
}

function Message() {
  const role = useAuiState(state => state.message.role)
  return <MessagePrimitive.Root data-byok="message" data-role={role}>
    {role === 'user' && <><AskAIMessageImages /><AskAIMessageElements /></>}
    <AskAIMessageContent />
    <AskAIBranchPicker /><AskAIMessageActions />
  </MessagePrimitive.Root>
}
/**
 * The enclosing user message while it is edited: its text in a box, its images and page
 * elements (each can be removed), Cancel, and Send, which sends the edited message as another
 * version of it and answers that; the earlier version stays, a branch away. Enter sends and
 * Escape cancels. Sending waits while a response runs. The default `EditComposer`.
 */
export function AskAIEditComposer() {
  const { connection } = useAskAI()
  return <ComposerPrimitive.Root data-byok="edit-composer">
    <AskAIComposerImages />
    <AskAIComposerElements />
    <ComposerPrimitive.Input aria-label="Edit message" autoFocus addAttachmentOnPaste={false} />
    <ComposerPrimitive.Cancel data-byok="edit-cancel">Cancel</ComposerPrimitive.Cancel>
    <ThreadPrimitive.If running={false}><ComposerPrimitive.Send data-byok="edit-send" disabled={!connection}>Send</ComposerPrimitive.Send></ThreadPrimitive.If>
  </ComposerPrimitive.Root>
}
function DefaultEmpty() { return <p>Start a conversation.</p> }
/**
 * The default message box: images and page elements being added, the input, attach and
 * add-from-page buttons, and Send, or Stop while a response runs. Use inside `AskAIThread`, before
 * or after `AskAIMessages`, or replace it with your own `ComposerPrimitive.Root`.
 */
export function AskAIComposer() {
  const { connection, images } = useAskAI()
  return <ComposerPrimitive.Root data-byok="composer">
    <ComposerPrimitive.AttachmentDropzone data-byok="composer-dropzone" disabled={!images}>
      <AskAIComposerImages />
      <AskAIComposerElements />
      <ComposerPrimitive.Input placeholder="Ask anything…" aria-label="Message" disabled={!connection} />
    </ComposerPrimitive.AttachmentDropzone>
    <AskAIAddImage />
    <AskAIAddFromPage />
    <ThreadPrimitive.If running={false}><ComposerPrimitive.Send disabled={!connection}>Send message</ComposerPrimitive.Send></ThreadPrimitive.If>
    <ThreadPrimitive.If running><ComposerPrimitive.Cancel>Stop response</ComposerPrimitive.Cancel></ThreadPrimitive.If>
  </ComposerPrimitive.Root>
}
/**
 * The chat's frame, for laying out its parts yourself: put `AskAIMessages`, `AskAIError` and a
 * composer (`AskAIComposer` or your own) inside, in any order and with any markup around them. A
 * search box above its answers, say, or messages in one column and the composer in another.
 * `components` replaces message layouts and their text and tool rendering, as on `AskAIChat`.
 * Native div props go to the root.
 */
export function AskAIThread({ components, children, ...props }: AskAIChatProps & ComponentPropsWithoutRef<typeof ThreadPrimitive.Root>) {
  return <MessageRenderingContext.Provider value={components}>
    <ThreadPrimitive.Root data-byok="chat" {...props}>{children}</ThreadPrimitive.Root>
  </MessageRenderingContext.Provider>
}
/**
 * The conversation's messages, or the enclosing thread's `Empty` component while there are none.
 * Use inside `AskAIThread`; native div props, `ref` included, go to the scrolling viewport.
 */
export function AskAIMessages(props: ComponentProps<typeof ThreadPrimitive.Viewport>) {
  const components = useContext(MessageRenderingContext)
  const Empty = components?.Empty ?? DefaultEmpty
  return <ThreadPrimitive.Viewport data-byok="messages" {...props}>
    <ThreadPrimitive.Empty><Empty /></ThreadPrimitive.Empty>
    <ThreadPrimitive.Messages components={{
      UserMessage: components?.UserMessage ?? Message,
      AssistantMessage: components?.AssistantMessage ?? Message,
      UserEditComposer: components?.EditComposer ?? AskAIEditComposer,
    }} />
  </ThreadPrimitive.Viewport>
}
/** Why the last answer stopped or failed (`useAskAI().error`), as an alert; nothing while there is none. */
export function AskAIError(props: Omit<ComponentPropsWithoutRef<'p'>, 'children' | 'role'>) {
  const { error } = useAskAI()
  return error ? <p role="alert" {...props}>{error}</p> : null
}
/**
 * Unstyled chat: messages, the error and the composer, in that order, with replaceable message,
 * empty-state and composer layouts. For another order or layout, compose `AskAIThread`,
 * `AskAIMessages`, `AskAIError` and `AskAIComposer` yourself.
 */
export function AskAIChat({ components }: AskAIChatProps = {}) {
  const Composer = components?.Composer ?? AskAIComposer
  return <AskAIThread components={components}>
    <AskAIMessages />
    <AskAIError />
    <Composer />
  </AskAIThread>
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
export { AskAIAddFromPage, AskAIComposerElements, AskAIMessageElements }

export function AskAITools() {
  const { mcpServers, clientTools, workspace } = useAskAI()
  return <section data-byok="tools"><h2>MCP servers</h2>
    <ul>{mcpServers.map(server => <li key={server.id}>{server.name} <code>{server.url}</code></li>)}</ul>
    {!mcpServers.length && <p>No MCP servers configured.</p>}
    {clientTools.length > 0 && <><h2>Page tools</h2>
      <ul>{clientTools.map(name => <li key={name}><code>{name}</code></li>)}</ul></>}
    {workspace && <WorkspaceFiles workspace={workspace} />}
  </section>
}

const formatBytes = (bytes: number) => bytes < 1024 ? `${bytes} B` : bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`
// The open conversation's files, as they are when the page opens.
function WorkspaceFiles({ workspace }: { workspace: Workspace }) {
  const [files, setFiles] = useState<WorkspaceFile[] | string>()
  useEffect(() => {
    let current = true
    workspace.list().then(list => { if (current) setFiles(list) }, (error: unknown) => { if (current) setFiles(error instanceof Error ? error.message : 'The workspace could not be read.') })
    return () => { current = false }
  }, [workspace])
  return <><h2>Workspace</h2>
    <p>Files the assistant keeps with this conversation, in this browser only, and computes over in a sandbox.</p>
    {typeof files === 'string' ? <p role="alert">{files}</p>
      : files && (files.length ? <ul>{files.map(file => <li key={file.name}><code>{file.name}</code> {formatBytes(file.size)}</li>)}</ul> : <p>No files yet.</p>)}
  </>
}

/** Native button props, including className, style, children, and event handlers. */
export function AskAITrigger({ children, onClick, ...props }: ComponentPropsWithoutRef<'button'>) {
  const { open, setOpen } = useAskAI()
  return <Button type="button" data-byok="trigger" aria-expanded={open} aria-label={open ? 'Close Ask AI' : 'Open Ask AI'}
    {...props} onClick={event => { onClick?.(event); if (!event.defaultPrevented) setOpen(!open) }}>
    {children ?? 'ASK AI'}
  </Button>
}

/**
 * Headless UI dialog: portal, focus management, Escape, and outside-click dismissal. It is modal,
 * so it steps aside while the user chooses an element of the page, and comes back after.
 */
export function AskAIPanel({ children, ...props }: ComponentPropsWithoutRef<'div'>) {
  const { open, setOpen, title, picking } = useAskAI()
  return <Dialog open={open && !picking} onClose={setOpen} aria-label={title} data-byok="dialog">
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
          <Button type="button" disabled={busy} onClick={() => setPage('tools')}>Tools</Button>
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
