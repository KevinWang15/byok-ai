import { useEffect, useMemo, useRef, type ComponentPropsWithoutRef, type ReactNode, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { useAui, useAuiState, type Attachment } from '@assistant-ui/react'
import { Button, Disclosure, DisclosureButton, DisclosurePanel } from '@headlessui/react'
import { useAskAI } from './context'
import { elementCount, insideOf, isPageElementAttachment, setShown, type PageElementAttachment } from './page-context'

// The page context's parts (the `pageContext` option): the button that starts choosing, the
// elements a message holds, and the marks on the page around the composer's. Unstyled, like the
// rest; the marks are placed over their elements (position: fixed) and are otherwise the host's
// to style.

const pageElementsOf = (attachments: readonly Attachment[]) => attachments.filter(isPageElementAttachment)

/**
 * Starts choosing an element of the page to add to the message. Renders nothing while page
 * context is off; disabled while choosing and without a provider.
 */
export function AskAIAddFromPage({ children = 'Add from page', onClick, ...props }: ComponentPropsWithoutRef<'button'>) {
  const { pageContext, picking, pickFromPage, connection } = useAskAI()
  if (!pageContext) return null
  return <Button type="button" data-byok="add-from-page" disabled={!connection || picking} {...props}
    onClick={event => { onClick?.(event); if (!event.defaultPrevented) pickFromPage() }}>
    {children}
  </Button>
}

function ElementList({ elements, summary, remove, anchor }: {
  elements: readonly PageElementAttachment[]; summary: (count: number) => ReactNode
  remove?: (id: string) => void; anchor?: RefObject<HTMLDivElement | null>
}) {
  return <Disclosure as="div" data-byok="page-elements" ref={anchor}>
    <DisclosureButton data-byok="page-elements-summary">{summary(elements.length)}</DisclosureButton>
    <DisclosurePanel as="ul">{elements.map(element => <li key={element.id} data-byok="page-element">
      <span>{element.name}</span>
      {insideOf(element).length > 0 && <small data-byok="page-element-place">in {insideOf(element).join(' › ')}</small>}
      {remove && <Button type="button" data-byok="page-element-remove" aria-label={`Remove “${element.name}”`} onClick={() => remove(element.id)}>Remove</Button>}
    </li>)}</DisclosurePanel>
  </Disclosure>
}

/**
 * The page elements in the composer: a summary ("2 elements") that opens their list, each with a
 * remove button, and a mark on the page around each element, with a remove button at its top
 * right. Marks show while this is visible. Use inside a composer; renders nothing while it holds none.
 */
export function AskAIComposerElements({ summary = elementCount }: { summary?: (count: number) => ReactNode }) {
  // The composer this is in: the message box, or a message being edited.
  const aui = useAui()
  const attachments = useAuiState(state => state.composer.attachments)
  const elements = useMemo(() => pageElementsOf(attachments), [attachments])
  const anchor = useRef<HTMLDivElement>(null)
  if (!elements.length) return null
  const remove = (id: string) => {
    const index = aui.composer.getState().attachments.findIndex(attachment => attachment.id === id)
    if (index >= 0) void aui.composer.attachment({ index }).remove()
  }
  return <>
    <ElementList elements={elements} summary={summary} remove={remove} anchor={anchor} />
    <PageMarks elements={elements} anchor={anchor} remove={remove} />
  </>
}

/** The page elements sent with the enclosing user message: a summary that opens their list. Renders nothing for none. */
export function AskAIMessageElements({ summary = elementCount }: { summary?: (count: number) => ReactNode }) {
  const attachments = useAuiState(state => state.message.attachments)
  const elements = useMemo(() => pageElementsOf(attachments ?? []), [attachments])
  return elements.length ? <ElementList elements={elements} summary={summary} /> : null
}

// A box over each element on the page (data-byok="page-mark"), following it as the page scrolls
// and changes, while `anchor` is visible: a composer that is hidden, or a closed panel, shows none.
// The box lets the pointer through to the page; its remove button doesn't. A mark whose element is
// inside another marked one is `data-nested`; when its top is too close to that one's for both
// labels and buttons to fit above them (within its label's height), it is also `data-crowded`, so
// the host can move its label and button inside its border.
function PageMarks({ elements, anchor, remove }: {
  elements: readonly PageElementAttachment[]; anchor: RefObject<HTMLElement | null>; remove: (id: string) => void
}) {
  const { pageElement } = useAskAI()
  const marks = useRef(new Map<string, HTMLElement>())
  useEffect(() => {
    let frame = requestAnimationFrame(function follow() {
      const shown = anchor.current?.isConnected && (anchor.current.checkVisibility?.() ?? true)
      const onPage = elements.map(element => pageElement(element.id))
      elements.forEach((element, index) => {
        const mark = marks.current.get(element.id)
        const target = onPage[index]
        if (!mark) return
        const rect = shown ? target?.getBoundingClientRect() : undefined
        const visible = rect !== undefined && rect.width > 0 && rect.height > 0
        setShown(mark, visible)
        if (!visible) return
        Object.assign(mark.style, { left: rect.left + 'px', top: rect.top + 'px', width: rect.width + 'px', height: rect.height + 'px' })
        const outer = onPage.filter(other => other && other !== target && other.contains(target!))
        const room = (mark.querySelector<HTMLElement>('[data-byok="page-mark-label"]')?.offsetHeight ?? 0) + 4
        const crowded = outer.some(other => rect.top - other!.getBoundingClientRect().top < room)
        mark.toggleAttribute('data-nested', outer.length > 0)
        mark.toggleAttribute('data-crowded', crowded)
      })
      frame = requestAnimationFrame(follow)
    })
    return () => cancelAnimationFrame(frame)
  }, [elements, anchor, pageElement])
  return createPortal(elements.map(element => <div key={element.id} data-byok="page-mark" hidden
    ref={node => { if (node) marks.current.set(element.id, node); else marks.current.delete(element.id) }}
    style={{ position: 'fixed', pointerEvents: 'none' }}>
    <span data-byok="page-mark-label">{element.name}</span>
    <button type="button" data-byok="page-mark-remove" style={{ pointerEvents: 'auto' }} aria-label={`Remove “${element.name}” from the message`}
      title="Remove from the message" onClick={() => remove(element.id)}>×</button>
  </div>), document.body)
}
