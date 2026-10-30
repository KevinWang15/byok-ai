import { useRef, useState, type CSSProperties, type KeyboardEvent, type MouseEvent, type PointerEvent } from 'react'

type Position = { x: number; y: number }
const storageKey = 'byok-ai:demo-launcher:v1'
const margin = 12
const clamp = (value: number) => Math.max(0, Math.min(1, value))
function loadPosition(): Position | undefined {
  try {
    const value = JSON.parse(localStorage.getItem(storageKey) ?? 'null')
    if (value && [value.x, value.y].every(n => typeof n === 'number' && Number.isFinite(n))) {
      return { x: clamp(value.x), y: clamp(value.y) }
    }
  } catch { /* The launcher also works without browser storage. */ }
}
function savePosition(position: Position) {
  try { localStorage.setItem(storageKey, JSON.stringify(position)) } catch { /* Keep the position for this session. */ }
}

/** Consumer-owned launcher movement. Coordinates are fractions of the usable viewport. */
export function useDraggableLauncher() {
  const [position, setPosition] = useState(loadPosition)
  const [dragging, setDragging] = useState(false)
  const suppressClick = useRef(false)
  const drag = useRef<{
    pointerId: number; startX: number; startY: number; left: number; top: number; width: number; height: number
    original?: Position; latest?: Position; moved: boolean
  } | null>(null)

  const normalize = (left: number, top: number, width: number, height: number): Position => ({
    x: clamp((left - margin) / Math.max(1, window.innerWidth - width - margin * 2)),
    y: clamp((top - margin) / Math.max(1, window.innerHeight - height - margin * 2)),
  })
  const cancel = () => {
    const current = drag.current
    if (!current) return
    setPosition(current.original)
    suppressClick.current = current.moved
    drag.current = null
    setDragging(false)
  }

  return {
    dragging,
    // Translate by the same fraction of the launcher's own size to retain a
    // 12px margin at either edge, even after viewport or button-size changes.
    style: position ? {
      left: `calc(${position.x * 100}vw + ${margin * (1 - 2 * position.x)}px)`,
      top: `calc(${position.y * 100}dvh + ${margin * (1 - 2 * position.y)}px)`,
      right: 'auto', bottom: 'auto',
      transform: `translate(${-position.x * 100}%, ${-position.y * 100}%)`,
    } as CSSProperties : undefined,
    triggerProps: {
      onPointerDown(event: PointerEvent<HTMLButtonElement>) {
        if (event.button !== 0 || !event.isPrimary) return
        const bounds = event.currentTarget.getBoundingClientRect()
        suppressClick.current = false
        drag.current = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY,
          left: bounds.left, top: bounds.top, width: bounds.width, height: bounds.height, original: position, moved: false }
        event.currentTarget.setPointerCapture(event.pointerId)
      },
      onPointerMove(event: PointerEvent<HTMLButtonElement>) {
        const current = drag.current
        if (!current || current.pointerId !== event.pointerId) return
        const dx = event.clientX - current.startX
        const dy = event.clientY - current.startY
        if (!current.moved && Math.hypot(dx, dy) < 6) return
        current.moved = true
        suppressClick.current = true
        current.latest = normalize(current.left + dx, current.top + dy, current.width, current.height)
        setPosition(current.latest)
        setDragging(true)
      },
      onPointerUp(event: PointerEvent<HTMLButtonElement>) {
        const current = drag.current
        if (!current || current.pointerId !== event.pointerId) return
        if (current.latest) savePosition(current.latest)
        drag.current = null
        setDragging(false)
        if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
      },
      onPointerCancel: cancel,
      onLostPointerCapture: cancel,
      onClick(event: MouseEvent<HTMLButtonElement>) {
        if (suppressClick.current && event.detail !== 0) event.preventDefault()
        suppressClick.current = false
      },
      onKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
        if (event.key === 'Escape' && drag.current) { cancel(); event.preventDefault(); return }
        if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return
        event.preventDefault()
        const bounds = event.currentTarget.getBoundingClientRect()
        const step = event.shiftKey ? 64 : 24
        const next = normalize(bounds.left + (event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0),
          bounds.top + (event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0), bounds.width, bounds.height)
        setPosition(next)
        savePosition(next)
      },
    },
  }
}
