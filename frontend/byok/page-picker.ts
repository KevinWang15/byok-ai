import { addableChain, addableElements, descriptionOf } from './page-context'

// Choosing an element of the page to add to a message, as a browser's element inspector does.
// The innermost element under the pointer that can be added is highlighted, with its description
// in a label above it. Elements nest, and any level can be chosen:
// - the pointer: a click adds the highlighted element; the label's ↑ and ↓ buttons, shown when
//   there is an outer or inner element, move the highlight there (their names say which);
// - the keyboard: ↑ and ↓ do the same, Tab and Shift+Tab go through every element in page
//   order, Enter adds the highlighted one.
// Escape or a right-click cancels.
//
// The picker is plain DOM over the whole viewport, not React: it is above everything, and it
// stays while a host's modal panel is closed for the pick. It is unstyled except where it must
// be placed: style it by its data-byok attributes (`page-picker`, `page-picker-highlight`,
// `page-picker-label`, holding `page-picker-outer`, `page-picker-description` and
// `page-picker-inner`, and `page-picker-hint`).

/** The picker's hint, by how many elements can be added and whether any is inside another. */
export function pickerHint(count: number, nested: boolean): string {
  if (!count) return 'Nothing on this page can be added. Press Escape to go back.'
  return `${count === 1 ? 'One element' : count + ' elements'} on this page can be added. Click one, or press Tab to go through them.`
    + (nested ? ' ↑ and ↓ choose the outer or inner one.' : '') + ' Enter adds, Escape cancels.'
}

const placeBox = (node: HTMLElement, rect: DOMRect | undefined) => {
  node.hidden = !rect
  if (rect) Object.assign(node.style, { left: rect.left + 'px', top: rect.top + 'px', width: rect.width + 'px', height: rect.height + 'px' })
}
// The element's box, when it has one on the screen.
const boxOf = (element: Element | undefined) => {
  const rect = element?.isConnected ? element.getBoundingClientRect() : undefined
  return rect && rect.width > 0 && rect.height > 0 ? rect : undefined
}

/** Lets the user choose an element that can be added. Resolves with it, or undefined when cancelled. Browser only. */
export function pickPageElement(options: { signal?: AbortSignal } = {}): Promise<Element | undefined> {
  return new Promise(resolve => {
    if (options.signal?.aborted) return resolve(undefined)
    const focused = document.activeElement instanceof HTMLElement ? document.activeElement : undefined
    const node = <K extends keyof HTMLElementTagNameMap>(part: string, tag: K) => {
      const element = document.createElement(tag)
      element.dataset.byok = part
      return element
    }
    const root = node('page-picker', 'div')
    root.tabIndex = -1
    root.setAttribute('role', 'dialog')
    root.setAttribute('aria-label', 'Add from page')
    Object.assign(root.style, { position: 'fixed', inset: '0', zIndex: '2147483647', cursor: 'crosshair' })
    const highlight = node('page-picker-highlight', 'div')
    const label = node('page-picker-label', 'div')
    Object.assign(highlight.style, { position: 'fixed', pointerEvents: 'none' })
    Object.assign(label.style, { position: 'fixed', cursor: 'default' })
    const hint = node('page-picker-hint', 'div')
    hint.setAttribute('role', 'status')
    const addable = addableElements()
    hint.textContent = pickerHint(addable.length, addable.some(element => addableChain(element).length > 1))
    root.append(highlight, label, hint)

    // The innermost element chosen (by the pointer or Tab), the addable elements it is inside and
    // itself (outermost first), and which of those is highlighted.
    let target: Element | undefined
    let chain: Element[] = []
    let levelIndex = -1
    // Where the pointer is, while it, rather than the keyboard, chooses the target.
    let pointer: { x: number; y: number } | undefined
    const current = () => chain[levelIndex]
    const at = ({ x, y }: { x: number; y: number }) => document.elementsFromPoint(x, y).find(element => !root.contains(element))
    const retarget = (inner: Element | undefined) => {
      inner = inner && addableChain(inner).at(-1)
      if (inner === target) return
      target = inner
      chain = inner ? addableChain(inner) : []
      levelIndex = chain.length - 1
      renderLabel()
    }
    const choose = (next: number) => {
      if (next < 0 || next >= chain.length || next === levelIndex) return
      levelIndex = next
      renderLabel()
      render()
    }
    // The label: the highlighted element's description, between buttons to the outer and inner one.
    const description = node('page-picker-description', 'span')
    const levelButton = (part: 'page-picker-outer' | 'page-picker-inner', text: string, step: number) => {
      const button = node(part, 'button')
      button.type = 'button'
      button.tabIndex = -1
      button.textContent = text
      button.addEventListener('click', event => { event.stopPropagation(); choose(levelIndex + step) })
      return button
    }
    const outer = levelButton('page-picker-outer', '↑', -1)
    const inner = levelButton('page-picker-inner', '↓', 1)
    label.append(outer, description, inner)
    const renderLabel = () => {
      description.textContent = current() ? descriptionOf(current()) ?? '' : ''
      for (const [button, element, name] of [[outer, chain[levelIndex - 1], 'Outer'], [inner, chain[levelIndex + 1], 'Inner']] as const) {
        button.hidden = !element
        const text = element ? `${name}: ${descriptionOf(element)}` : ''
        button.title = text
        button.setAttribute('aria-label', text)
      }
    }
    const render = () => {
      placeBox(highlight, boxOf(current()))
      // The label stays with the innermost element, so that its buttons stay put while one is chosen.
      const anchor = boxOf(target)
      label.hidden = !anchor || !boxOf(current())
      if (!anchor || label.hidden) return
      // Right above the element when there is room, else right below it, and inside the viewport.
      // With no gap, the pointer goes from the element into the label without crossing the
      // element around it, which would choose that one instead.
      const above = anchor.top - label.offsetHeight
      const top = above >= 0 ? above : Math.min(anchor.bottom, innerHeight - label.offsetHeight)
      Object.assign(label.style, { top: Math.max(0, top) + 'px', left: Math.max(0, Math.min(anchor.left, innerWidth - label.offsetWidth)) + 'px' })
    }
    // Follows the pointer, scrolling, layout and the page's own changes, as long as the picker is open.
    let frame = requestAnimationFrame(function follow() {
      if (pointer) retarget(at(pointer))
      render()
      // The keyboard stays with the picker, though a closing dialog gives focus back to its trigger.
      if (document.activeElement !== root) root.focus({ preventScroll: true })
      frame = requestAnimationFrame(follow)
    })

    const finish = (element: Element | undefined) => {
      cancelAnimationFrame(frame)
      root.remove()
      window.removeEventListener('keydown', onKey, true)
      options.signal?.removeEventListener('abort', onAbort)
      if (focused?.isConnected) focused.focus()
      resolve(element)
    }
    const onAbort = () => finish(undefined)
    const onKey = (event: KeyboardEvent) => {
      // The picker has the keyboard: nothing under it acts on these keys.
      if (!['Escape', 'Tab', 'Enter', 'ArrowUp', 'ArrowDown'].includes(event.key)) return
      event.preventDefault()
      event.stopPropagation()
      if (event.key === 'Escape') return finish(undefined)
      if (event.key === 'Enter') { if (current()?.isConnected) finish(current()); return }
      if (event.key === 'ArrowUp') return choose(levelIndex - 1)
      if (event.key === 'ArrowDown') return choose(levelIndex + 1)
      const elements = addableElements().filter(element => element.checkVisibility?.() ?? true)
      if (!elements.length) return
      const index = current() ? elements.indexOf(current()) : -1
      const next = elements[(index + (event.shiftKey ? -1 : 1) + elements.length) % elements.length]
      pointer = undefined
      next.scrollIntoView({ block: 'nearest', inline: 'nearest' })
      retarget(next)
      render()
    }
    // Over the label, the pointer is using its buttons, not moving over the page.
    root.addEventListener('pointermove', event => { if (!label.contains(event.target as Node)) pointer = { x: event.clientX, y: event.clientY } })
    // The page under the picker gets no pointer events: they are the picker's.
    root.addEventListener('pointerdown', event => event.preventDefault())
    root.addEventListener('click', event => {
      event.preventDefault()
      // A click on the label's description adds the highlighted element, as a click on it does.
      if (label.contains(event.target as Node)) { if (event.target === description && current()) finish(current()); return }
      retarget(at({ x: event.clientX, y: event.clientY }))
      if (current()) finish(current())
    })
    root.addEventListener('contextmenu', event => { event.preventDefault(); finish(undefined) })
    window.addEventListener('keydown', onKey, true)
    options.signal?.addEventListener('abort', onAbort, { once: true })
    document.body.append(root)
    root.focus()
  })
}
