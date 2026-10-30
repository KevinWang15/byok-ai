import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Button, Description, Dialog, DialogBackdrop, DialogPanel, DialogTitle } from '@headlessui/react'
import { useAskAI } from './context'
import { conversationDate, conversationPreview, relativeConversationTime } from './history'

/**
 * Semantic history and deletion confirmation. All visual styling belongs to the consumer.
 * `title`, `description` and `empty` replace the copy, such as to say which conversations these are
 * when a host keeps one history per page or document.
 */
export function AskAIHistory({ title = 'Conversations', description = 'Pick up where you left off. Most recently updated first.',
  empty = 'Your saved conversations will appear here.' }: { title?: ReactNode; description?: ReactNode; empty?: ReactNode } = {}) {
  const { conversations, activeConversation, selectConversation, deleteConversation, busy } = useAskAI()
  const [now, setNow] = useState(Date.now)
  const [pendingId, setPendingId] = useState<string>()
  const heading = useRef<HTMLHeadingElement>(null)
  const restoreHeading = useRef(false)
  const pending = conversations.find(c => c.id === pendingId)
  useEffect(() => {
    if (pendingId || !restoreHeading.current) return
    // Wait for the nested dialog to release its focus trap and restore the parent.
    const frame = requestAnimationFrame(() => {
      restoreHeading.current = false
      heading.current?.focus()
    })
    return () => cancelAnimationFrame(frame)
  }, [pendingId])
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(timer)
  }, [])
  const sorted = [...conversations].sort((a, b) => (conversationDate(b.updatedAt)?.getTime() ?? 0) - (conversationDate(a.updatedAt)?.getTime() ?? 0))
  return <section data-byok="history">
    <h2 ref={heading} tabIndex={-1}>{title}</h2>
    <p data-byok="history-description">{conversations.length ? description : empty}</p>
    <ul>{sorted.map(c => {
      const date = conversationDate(c.updatedAt)
      const current = c.id === activeConversation.id
      const count = c.messages.filter(m => m.role !== 'system').length
      return <li key={c.id} data-current={current || undefined}>
        <Button type="button" data-byok="history-select" aria-current={current ? 'true' : undefined} disabled={busy} onClick={() => selectConversation(c.id)}>
          <span data-byok="history-title">{c.title}</span>
          <span data-byok="history-preview">{conversationPreview(c)}</span>
          <span data-byok="history-meta">
            {date ? <time dateTime={date.toISOString()} title={date.toLocaleString()}>{relativeConversationTime(c.updatedAt, now)}</time> : <span>Unknown date</span>}
            <span>{count} {count === 1 ? 'message' : 'messages'}</span>
            {current && <span data-byok="history-current">Current</span>}
          </span>
        </Button>
        <Button type="button" data-byok="history-delete" disabled={busy} aria-label={'Delete ' + c.title} onClick={() => setPendingId(c.id)}>Delete</Button>
      </li>
    })}</ul>
    <Dialog open={Boolean(pending)} onClose={() => setPendingId(undefined)} data-byok="history-confirmation">
      <DialogBackdrop data-byok="history-confirmation-backdrop" />
      <div data-byok="history-confirmation-position">
        <DialogPanel data-byok="history-confirmation-panel">
          <DialogTitle>Delete conversation?</DialogTitle>
          <Description>“{pending?.title}” and its messages and draft will be removed from this browser. This cannot be undone.</Description>
          <div data-byok="history-confirmation-actions">
            <Button type="button" autoFocus onClick={() => setPendingId(undefined)}>Keep conversation</Button>
            <Button type="button" data-byok="history-confirm-delete" disabled={busy} onClick={() => {
              if (!pending || busy) return
              restoreHeading.current = true
              deleteConversation(pending.id)
              setPendingId(undefined)
            }}>Delete conversation</Button>
          </div>
        </DialogPanel>
      </div>
    </Dialog>
  </section>
}
