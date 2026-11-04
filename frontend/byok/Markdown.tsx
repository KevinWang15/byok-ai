import { useEffect, useLayoutEffect, useMemo, useRef, useState, type MouseEvent } from 'react'
import { createPortal } from 'react-dom'
import { useAuiState } from '@assistant-ui/react'
import { createEditor, type MarkdownEditor } from 'markora'
import { createComponentRegistry, createComponentsExtension, defineComponent, type ComponentRegistry } from 'markora-extension-components'
import 'markora/styles.css'
import 'markora-extension-components/styles.css'
import { checkAnswerComponents, splitOpenComponent, type AnswerComponent } from './answer-components'
import { useAskAIOptional } from './context'

// Answers rendered by Markora (read only): GitHub-flavored Markdown plus the host's answer
// components (answer-components.ts). Raw HTML shows as text. Images are never loaded: tool results
// can carry text other people wrote, so an answer could be steered into an image whose address
// carries the user's data to another site, and loading it would send it without a click. Markora's
// own stylesheets come with it; they are scoped to its element.

export interface MarkdownProps {
  markdown: string
  /** Components the answer may contain. Default: the enclosing AskAIProvider's `answerComponents`. */
  components?: readonly AnswerComponent[]
  /** While true, a component whose fence is still open shows as pending instead of half-written. */
  streaming?: boolean
  /**
   * Called when a link in the answer is clicked, with its address as written (Markora has already
   * dropped scripts and other unsafe schemes). Call `event.preventDefault()` to handle it yourself:
   * in-app navigation, a new tab, or nothing for an address you don't trust. Default: the browser
   * follows it.
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

type Mount = { id: number; element: HTMLElement; component: AnswerComponent; props: Record<string, unknown> }

export function Markdown({ markdown, components: given, streaming = false, onOpenLink, className, label = 'Answer' }: MarkdownProps) {
  const fromProvider = useAskAIOptional()?.answerComponents
  const components = given ?? fromProvider ?? NO_COMPONENTS
  const host = useRef<HTMLDivElement>(null)
  const editor = useRef<MarkdownEditor | null>(null)
  const registry = useRef<ComponentRegistry | null>(null)
  const [mounts, setMounts] = useState<Mount[]>([])
  const mountId = useRef(0)
  const { shown, pending } = useMemo(() => streaming ? splitOpenComponent(markdown) : { shown: markdown, pending: null }, [markdown, streaming])
  const pendingLabel = pending && components.find(component => component.name === pending)?.label

  // One editor for the element's life; the text and components change through it.
  useLayoutEffect(() => {
    const created = createComponentRegistry([])
    registry.current = created
    const instance = createEditor({
      element: host.current!, markdown: '', editable: false, ariaLabel: label,
      extensions: [createComponentsExtension({ registry: created, messages: MESSAGES })],
      messages: { imageBlockedByPolicy: 'Image not shown' },
      // The image stays in the answer, as a placeholder with its description; nothing is fetched.
      resources: { resolveUrl: ({ kind, url }) => kind === 'image' ? null : url, loadImage: () => null },
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

  // Read-only links are plain anchors: the host decides where a click goes.
  const onClick = (event: MouseEvent<HTMLElement>) => {
    const anchor = (event.target as Element).closest?.('a[href]')
    if (anchor && host.current?.contains(anchor)) onOpenLink?.(anchor.getAttribute('href') ?? '', event)
  }

  return <div data-byok="markdown" className={className} onClick={onClick}>
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
