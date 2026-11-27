import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Button, Description, Dialog, DialogBackdrop, DialogPanel, DialogTitle } from '@headlessui/react'
import { useAskAI } from './context'
import { conversationPreview, conversationTitle, relativeConversationTime } from './history'
import { conversationBranch } from './storage'

/**
 * Semantic history and deletion confirmation. All visual styling belongs to the consumer.
 * `title`, `description` and `empty` replace the heading and copy (`text.historyTitle`…) for this
 * history only, such as to say which conversations these are when a host keeps one per page.
 */
export function AskAIHistory({ title, description, empty }: { title?: ReactNode; description?: ReactNode; empty?: ReactNode } = {}) {
  const { conversations, activeConversation, selectConversation, deleteConversation, busy, text } = useAskAI()
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
  const sorted = [...conversations].sort((a, b) => b.updatedAt - a.updatedAt)
  return <section data-byok="history">
    <h2 ref={heading} tabIndex={-1}>{title ?? text.historyTitle}</h2>
    <p data-byok="history-description">{conversations.length ? description ?? text.historyDescription : empty ?? text.historyEmpty}</p>
    <ul>{sorted.map(c => {
      const date = new Date(c.updatedAt)
      const current = c.id === activeConversation.id
      // The messages of the branch shown, as the conversation opens.
      const count = conversationBranch(c).filter(m => m.role !== 'system').length
      const name = conversationTitle(c, text)
      return <li key={c.id} data-current={current || undefined}>
        <Button type="button" data-byok="history-select" aria-current={current ? 'true' : undefined} disabled={busy} onClick={() => selectConversation(c.id)}>
          <span data-byok="history-title">{name}</span>
          <span data-byok="history-preview">{conversationPreview(c, text)}</span>
          <span data-byok="history-meta">
            <time dateTime={date.toISOString()} title={date.toLocaleString(text.locale)}>{relativeConversationTime(c.updatedAt, now, text)}</time>
            <span>{text.messageCount(count)}</span>
            {current && <span data-byok="history-current">{text.current}</span>}
          </span>
        </Button>
        <Button type="button" data-byok="history-delete" disabled={busy} aria-label={text.deleteConversation(name)} onClick={() => setPendingId(c.id)}>{text.delete}</Button>
      </li>
    })}</ul>
    <Dialog open={Boolean(pending)} onClose={() => setPendingId(undefined)} data-byok="history-confirmation">
      <DialogBackdrop data-byok="history-confirmation-backdrop" />
      <div data-byok="history-confirmation-position">
        <DialogPanel data-byok="history-confirmation-panel">
          <DialogTitle>{text.confirmDelete}</DialogTitle>
          <Description>{pending && text.confirmDeleteDescription(conversationTitle(pending, text))}</Description>
          <div data-byok="history-confirmation-actions">
            <Button type="button" autoFocus onClick={() => setPendingId(undefined)}>{text.keepConversation}</Button>
            <Button type="button" data-byok="history-confirm-delete" disabled={busy} onClick={() => {
              if (!pending || busy) return
              restoreHeading.current = true
              deleteConversation(pending.id)
              setPendingId(undefined)
            }}>{text.confirmDeleteAction}</Button>
          </div>
        </DialogPanel>
      </div>
    </Dialog>
  </section>
}
