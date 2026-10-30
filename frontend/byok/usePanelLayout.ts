import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from 'react'

type Size = { width: number; height: number }
type Position = { x: number; y: number }
type Preferences = { size?: Size; position?: Position; maximized: boolean }
/**
 * The edge or corner a handle resizes, by compass point: `n` top, `s` bottom, `e` right, `w` left.
 * The dragged edges follow the pointer; the opposite ones stay put, as with an OS window.
 * `width`, `height` and `both` are the left edge, the top edge and the top-left corner.
 */
export type ResizeEdge = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw'
type Direction = ResizeEdge | 'width' | 'height' | 'both'
const EDGES: Record<Direction, ResizeEdge> = { n: 'n', s: 's', e: 'e', w: 'w', ne: 'ne', nw: 'nw', se: 'se', sw: 'sw', width: 'w', height: 'n', both: 'nw' }
type Rect = { left: number; top: number; right: number; bottom: number }
export interface PanelLayoutOptions {
  /** localStorage key for the size, position and maximized state. */
  storageKey: string
  /** Space kept between the panel and the viewport edge, in pixels. Default 16, or 12 at 640px wide and below. */
  margin?: () => number
  /** Smallest width and height a resize allows. Default 320. */
  minSize?: number
}
const defaultMargin = () => window.innerWidth <= 640 ? 12 : 16
const clamp = (value: number) => Math.max(0, Math.min(1, value))
function loadPreferences(key: string): Preferences {
  try {
    const saved = JSON.parse(localStorage.getItem(key) ?? 'null')
    const size = saved?.size
    const position = saved?.position
    return {
      size: size && [size.width, size.height].every(n => typeof n === 'number' && Number.isFinite(n) && n > 0 && n <= 10000) ? size : undefined,
      position: position && [position.x, position.y].every(n => typeof n === 'number' && Number.isFinite(n))
        ? { x: clamp(position.x), y: clamp(position.y) } : undefined,
      maximized: saved?.maximized === true,
    }
  } catch { return { maximized: false } }
}

/**
 * Headless geometry for a floating panel: move by dragging a header, resize from any
 * edge or corner, and maximize. Mouse, touch and arrow keys (Shift for larger
 * steps); Escape cancels a move. Saved to localStorage. Spread `panelProps` on the
 * panel (it marks it with `data-byok-panel`, which the header and handles inside it
 * measure), `headerProps` and `handleProps(direction)`, and apply `style`:
 * `--byok-panel-width/height` (px) once resized, `--byok-panel-x/y` (0–1 of the
 * free space) once moved. Placement and sizing CSS belong to the consumer.
 */
export function usePanelLayout({ storageKey, margin = defaultMargin, minSize = 320 }: PanelLayoutOptions) {
  const [preferences, setPreferences] = useState(() => loadPreferences(storageKey))
  const [resizing, setResizing] = useState(false)
  const [moving, setMoving] = useState(false)
  const drag = useRef<{ x: number; y: number; rect: Rect; edge: ResizeEdge } | null>(null)
  const move = useRef<{ pointerId: number; x: number; y: number; left: number; top: number; width: number; height: number; original?: Position; moved: boolean } | null>(null)
  useEffect(() => {
    if (resizing || moving) return
    try { localStorage.setItem(storageKey, JSON.stringify(preferences)) } catch { /* Layout still works when storage is unavailable. */ }
  }, [preferences, resizing, moving, storageKey])

  // The panel containing the header or handle the event came from.
  const bounds = (from: Element) => (from.closest('[data-byok-panel]') ?? from).getBoundingClientRect()
  const positionFor = (left: number, top: number, width: number, height: number): Position => {
    const m = margin()
    return {
      x: clamp((left - m) / Math.max(1, window.innerWidth - width - m * 2)),
      y: clamp((top - m) / Math.max(1, window.innerHeight - height - m * 2)),
    }
  }
  // The panel from `start` with the edges of `edge` moved by dx and dy, kept at least minSize and
  // within the margins. The opposite edges don't move. A panel still in its default corner stays
  // there while its own corner's edges don't move; once they do, it is placed where it now is.
  const resize = (start: Rect, edge: ResizeEdge, dx: number, dy: number) => {
    const m = margin()
    let { left, top, right, bottom } = start
    const size = (low: number, high: number) => Math.min(minSize, high - low)
    if (edge.includes('w')) left = Math.min(Math.max(m, start.left + dx), right - size(m, right))
    if (edge.includes('e')) right = Math.max(Math.min(window.innerWidth - m, start.right + dx), left + size(left, window.innerWidth - m))
    if (edge.includes('n')) top = Math.min(Math.max(m, start.top + dy), bottom - size(m, bottom))
    if (edge.includes('s')) bottom = Math.max(Math.min(window.innerHeight - m, start.bottom + dy), top + size(top, window.innerHeight - m))
    const next = { width: right - left, height: bottom - top }
    const anchorMoved = (edge.includes('e') && right !== start.right) || (edge.includes('s') && bottom !== start.bottom)
    setPreferences(previous => ({ ...previous, size: next,
      position: previous.position || anchorMoved ? positionFor(left, top, next.width, next.height) : undefined,
    }))
  }
  const finish = () => { drag.current = null; setResizing(false) }
  const cancelMove = () => {
    const start = move.current
    if (!start) return
    setPreferences(previous => ({ ...previous, position: start.original }))
    move.current = null
    setMoving(false)
  }
  const rectOf = (from: Element): Rect => { const b = bounds(from); return { left: b.left, top: b.top, right: b.right, bottom: b.bottom } }
  const handleProps = (direction: Direction) => {
    const edge = EDGES[direction]
    return {
    'data-byok-resize': edge,
    onPointerDown(event: PointerEvent<HTMLElement>) {
      if (event.button !== 0 || !event.isPrimary) return
      event.preventDefault()
      event.currentTarget.focus()
      event.currentTarget.setPointerCapture(event.pointerId)
      drag.current = { x: event.clientX, y: event.clientY, rect: rectOf(event.currentTarget), edge }
      setResizing(true)
    },
    onPointerMove(event: PointerEvent<HTMLElement>) {
      const start = drag.current
      if (!start || !event.currentTarget.hasPointerCapture(event.pointerId)) return
      resize(start.rect, start.edge, event.clientX - start.x, event.clientY - start.y)
    },
    onPointerUp(event: PointerEvent<HTMLElement>) {
      if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
      finish()
    },
    onPointerCancel: finish,
    onLostPointerCapture: finish,
    // Arrow keys move the handle's edges the same way the pointer would.
    onKeyDown(event: KeyboardEvent<HTMLElement>) {
      const horizontal = /[ew]/.test(edge) && ['ArrowLeft', 'ArrowRight'].includes(event.key)
      const vertical = /[ns]/.test(edge) && ['ArrowUp', 'ArrowDown'].includes(event.key)
      if (!horizontal && !vertical) return
      event.preventDefault()
      const step = event.shiftKey ? 64 : 24
      resize(rectOf(event.currentTarget), edge,
        horizontal ? (event.key === 'ArrowLeft' ? -step : step) : 0, vertical ? (event.key === 'ArrowUp' ? -step : step) : 0)
    },
  }
  }
  return {
    maximized: preferences.maximized,
    positioned: Boolean(preferences.position),
    resizing,
    moving,
    toggleMaximized: () => { finish(); setPreferences(previous => ({ ...previous, maximized: !previous.maximized })) },
    style: {
      ...(preferences.size ? { '--byok-panel-width': `${preferences.size.width}px`, '--byok-panel-height': `${preferences.size.height}px` } : {}),
      ...(preferences.position ? { '--byok-panel-x': preferences.position.x, '--byok-panel-y': preferences.position.y } : {}),
    } as CSSProperties,
    /** Spread on the panel element. */
    panelProps: { 'data-byok-panel': '' },
    handleProps,
    headerProps: {
      tabIndex: preferences.maximized ? -1 : 0,
      onPointerDown(event: PointerEvent<HTMLElement>) {
        if (preferences.maximized || event.button !== 0 || !event.isPrimary ||
          (event.target as HTMLElement).closest('button, a, input, select, textarea, [role="button"]')) return
        const b = bounds(event.currentTarget)
        event.preventDefault()
        event.currentTarget.focus()
        event.currentTarget.setPointerCapture(event.pointerId)
        move.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY,
          left: b.left, top: b.top, width: b.width, height: b.height, original: preferences.position, moved: false }
      },
      onPointerMove(event: PointerEvent<HTMLElement>) {
        const start = move.current
        if (!start || start.pointerId !== event.pointerId) return
        const dx = event.clientX - start.x
        const dy = event.clientY - start.y
        if (!start.moved && Math.hypot(dx, dy) < 4) return
        start.moved = true
        setMoving(true)
        setPreferences(previous => ({ ...previous, position: positionFor(start.left + dx, start.top + dy, start.width, start.height) }))
      },
      onPointerUp(event: PointerEvent<HTMLElement>) {
        if (move.current?.pointerId !== event.pointerId) return
        move.current = null
        setMoving(false)
        if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
      },
      onPointerCancel: cancelMove,
      onLostPointerCapture: cancelMove,
      onKeyDown(event: KeyboardEvent<HTMLElement>) {
        if (event.target !== event.currentTarget || preferences.maximized) return
        if (event.key === 'Escape' && move.current) { cancelMove(); event.preventDefault(); event.stopPropagation(); return }
        if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return
        event.preventDefault()
        const b = bounds(event.currentTarget)
        const step = event.shiftKey ? 64 : 24
        setPreferences(previous => ({ ...previous, position: positionFor(
          b.left + (event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0),
          b.top + (event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0), b.width, b.height,
        ) }))
      },
    },
  }
}
