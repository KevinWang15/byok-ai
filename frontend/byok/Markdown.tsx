import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent } from 'react'
import { createPortal } from 'react-dom'
import { useAuiState } from '@assistant-ui/react'
import { createEditor, type MarkdownEditor } from 'markora'
import { createComponentRegistry, createComponentsExtension, defineComponent, type ComponentRegistry } from 'markora-extension-components'
import { checkAnswerComponents, splitOpenComponent, type AnswerComponent } from './answer-components'
import { useAskAIOptional } from './context'

// Answers rendered by Markora (read only): GitHub-flavored Markdown plus the host's answer
// components (answer-components.ts). Raw HTML shows as text. Images are never loaded: tool results
// can carry text other people wrote, so an answer could be steered into an image whose address
// carries the user's data to another site, and loading it would send it without a click. Like the
// rest of the library it imports no CSS: the host imports Markora's stylesheets (README).

export interface MarkdownProps {
  markdown: string
  /** Components the answer may contain. Default: the enclosing AskAIProvider's `answerComponents`. */
  components?: readonly AnswerComponent[]
  /** While true, a component whose fence is still open shows as pending instead of half-written. */
  streaming?: boolean
  /**
   * Where a link in the answer goes: given its address as written (Markora has already dropped
   * scripts and other unsafe schemes), the address it opens, or null for none (its text stays, not
   * a link). The anchor carries this address, so a click, a middle-click, "Open in new tab" and the
   * status bar all agree. Read when a link renders. Default: the address as written.
   */
  resolveLink?: (href: string) => string | null
  /**
   * Called when a link in the answer is clicked, with the address it opens (`resolveLink`). Call
   * `event.preventDefault()` to handle it yourself, such as in-app navigation. Default: the browser
   * follows it. Ctrl/Cmd-click is Markora's: it opens the address in a new tab, without this call.
   */
  onOpenLink?: (href: string, event: MouseEvent<HTMLElement>) => void
  className?: string
  /** Accessible name. Default "Answer". */
  label?: string
}

const MESSAGES = {
  unavailable: 'This part of the answer cannot be shown.',
  invalidProps: 'This part of the answer could not be drawn.',
  renderFailed: 'This part of the answer could not be drawn.',
}
const NO_COMPONENTS: readonly AnswerComponent[] = []
// Markora's defaults are an editor's: a bordered box at least 180 px tall. An answer is text
// on the page. These are Markora's own variables; hosts can set them again.
const READING = {
  '--mdw-editor-min-block-size': '0', '--mdw-editor-padding': '0', '--mdw-border-width': '0', '--mdw-editor-radius': '0',
} as CSSProperties

type Mount = { id: number; element: HTMLElement; component: AnswerComponent; props: Record<string, unknown> }

export function Markdown({ markdown, components: given, streaming = false, resolveLink, onOpenLink, className, label = 'Answer' }: MarkdownProps) {
  const fromProvider = useAskAIOptional()?.answerComponents
  const components = given ?? fromProvider ?? NO_COMPONENTS
  const host = useRef<HTMLDivElement>(null)
  const editor = useRef<MarkdownEditor | null>(null)
  const registry = useRef<ComponentRegistry | null>(null)
  const [mounts, setMounts] = useState<Mount[]>([])
  const mountId = useRef(0)
  const { shown, pending } = useMemo(() => streaming ? splitOpenComponent(markdown) : { shown: markdown, pending: null }, [markdown, streaming])
  const pendingLabel = pending && components.find(component => component.name === pending)?.label
  // The latest resolveLink, for the editor made once below (declared first, so set first).
  const linkResolver = useRef(resolveLink)
  useLayoutEffect(() => { linkResolver.current = resolveLink })

  // One editor for the element's life; the text and components change through it.
  useLayoutEffect(() => {
    const created = createComponentRegistry([])
    registry.current = created
    const instance = createEditor({
      // A finished text to read, not a text box: no tab stop of its own; links stay focusable.
      element: host.current!, markdown: '', editable: false, ariaLabel: label, attributes: { role: 'document', tabindex: '-1' },
      extensions: [createComponentsExtension({ registry: created, messages: MESSAGES })],
      messages: { imageBlockedByPolicy: 'Image not shown' },
      // The image stays in the answer, as a placeholder with its description; nothing is fetched.
      // A link goes where the host resolves it.
      resources: {
        resolveUrl: ({ kind, url }) => kind === 'image' ? null : linkResolver.current ? linkResolver.current(url) : url,
        loadImage: () => null,
      },
    })
    editor.current = instance
    return () => {
      editor.current = null
      registry.current = null
      instance.destroy()
    }
    // The label is set once; it names the answer, not its content.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Each component renders into the element Markora gives it, through a portal, so it stays in the
  // host's React tree (its context, theme, router).
  useLayoutEffect(() => {
    const current = registry.current!
    checkAnswerComponents(components)
    const unregister = components.map(component => current.register(defineComponent({
      name: component.name, label: component.label,
      parseProps: value => component.parse(value),
      render: ({ element, props }) => {
        const mount: Mount = { id: mountId.current++, element, component, props: props as Record<string, unknown> }
        setMounts(list => [...list, mount])
        return () => setMounts(list => list.filter(item => item !== mount))
      },
    })))
    return () => { for (const remove of unregister) remove() }
  }, [components])

  // Finished text is applied at once; streaming text at most once a frame. Unchanged blocks keep
  // their DOM.
  const latest = useRef(shown)
  const frame = useRef(0)
  useLayoutEffect(() => {
    latest.current = shown
    if (!streaming) {
      cancelAnimationFrame(frame.current)
      frame.current = 0
      editor.current?.commands.reconcileMarkdown(shown)
      return
    }
    if (frame.current) return
    frame.current = requestAnimationFrame(() => {
      frame.current = 0
      editor.current?.commands.reconcileMarkdown(latest.current)
    })
  }, [shown, streaming])
  useEffect(() => () => { cancelAnimationFrame(frame.current); frame.current = 0 }, [])

  // Read-only links are plain anchors to their resolved address: the host decides where a click
  // goes. A click Markora already handled (Ctrl/Cmd-click) is not the host's.
  const onClick = (event: MouseEvent<HTMLElement>) => {
    if (event.defaultPrevented) return
    const anchor = (event.target as Element).closest?.('a[href]')
    if (anchor && host.current?.contains(anchor)) onOpenLink?.(anchor.getAttribute('href') ?? '', event)
  }

  return <div data-byok="markdown" className={className} style={READING} onClick={onClick}>
    <div ref={host} />
    {pending && <p data-byok="markdown-pending" role="status">{pendingLabel ?? pending}…</p>}
    {mounts.map(({ id, element, component, props }) => {
      const Render = component.render
      return createPortal(<Render props={props} />, element, `${component.name}-${id}`)
    })}
  </div>
}

/** Markdown for the enclosing assistant-ui text part: the default `Text` of the chat. */
export function MarkdownText(props: Omit<MarkdownProps, 'markdown' | 'streaming'>) {
  const text = useAuiState(state => state.part.type === 'text' ? state.part.text : '')
  const running = useAuiState(state => state.part.status.type === 'running')
  return <Markdown {...props} markdown={text} streaming={running} />
}
