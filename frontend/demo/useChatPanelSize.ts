import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from 'react'

type Size = { width: number; height: number }
type Position = { x: number; y: number }
type Preferences = { size?: Size; position?: Position; maximized: boolean }
type Direction = 'width' | 'height' | 'both'
const storageKey = 'byok-ai:demo-panel:v1'
const clamp = (value: number) => Math.max(0, Math.min(1, value))
function positionFor(left: number, top: number, width: number, height: number): Position {
  const margin = window.innerWidth <= 640 ? 12 : 16
  return {
    x: clamp((left - margin) / Math.max(1, window.innerWidth - width - margin * 2)),
    y: clamp((top - margin) / Math.max(1, window.innerHeight - height - margin * 2)),
  }
}
function loadPreferences(): Preferences {
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey) ?? 'null')
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

/** Demo window geometry only; the headless chat runtime is independent of panel size. */
export function useChatPanelSize() {
  const [preferences, setPreferences] = useState(loadPreferences)
  const [resizing, setResizing] = useState(false)
  const [moving, setMoving] = useState(false)
  const drag = useRef<{ x: number; y: number; width: number; height: number; right: number; bottom: number; direction: Direction } | null>(null)
  const move = useRef<{ pointerId: number; x: number; y: number; left: number; top: number; width: number; height: number; original?: Position; moved: boolean } | null>(null)
  useEffect(() => {
    if (resizing || moving) return
    try { localStorage.setItem(storageKey, JSON.stringify(preferences)) } catch { /* Resizing still works when storage is unavailable. */ }
  }, [preferences, resizing, moving])

  const resize = (width: number, height: number, bounds: { right: number; bottom: number }) => {
    const maxWidth = Math.max(1, bounds.right - (window.innerWidth <= 640 ? 12 : 16))
    const maxHeight = Math.max(1, bounds.bottom - 16)
    const size = {
      width: Math.min(maxWidth, Math.max(Math.min(320, maxWidth), width)),
      height: Math.min(maxHeight, Math.max(Math.min(320, maxHeight), height)),
    }
    setPreferences(previous => ({ ...previous, size,
      position: previous.position ? positionFor(bounds.right - size.width, bounds.bottom - size.height, size.width, size.height) : undefined,
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
  const handleProps = (direction: Direction) => ({
    onPointerDown(event: PointerEvent<HTMLButtonElement>) {
      if (event.button !== 0 || !event.isPrimary) return
      const bounds = event.currentTarget.closest('.demo-chat-shell')!.getBoundingClientRect()
      event.preventDefault()
      event.currentTarget.focus()
      event.currentTarget.setPointerCapture(event.pointerId)
      drag.current = { x: event.clientX, y: event.clientY, width: bounds.width, height: bounds.height,
        right: bounds.right, bottom: bounds.bottom, direction }
      setResizing(true)
    },
    onPointerMove(event: PointerEvent<HTMLButtonElement>) {
      const start = drag.current
      if (!start || !event.currentTarget.hasPointerCapture(event.pointerId)) return
      resize(start.width + (start.direction === 'height' ? 0 : start.x - event.clientX),
        start.height + (start.direction === 'width' ? 0 : start.y - event.clientY), start)
    },
    onPointerUp(event: PointerEvent<HTMLButtonElement>) {
      if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
      finish()
    },
    onPointerCancel: finish,
    onLostPointerCapture: finish,
    onKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
      const horizontal = direction !== 'height' && ['ArrowLeft', 'ArrowRight'].includes(event.key)
      const vertical = direction !== 'width' && ['ArrowUp', 'ArrowDown'].includes(event.key)
      if (!horizontal && !vertical) return
      event.preventDefault()
      const bounds = event.currentTarget.closest('.demo-chat-shell')!.getBoundingClientRect()
      const step = event.shiftKey ? 64 : 24
      resize(bounds.width + (horizontal ? (event.key === 'ArrowLeft' ? step : -step) : 0),
        bounds.height + (vertical ? (event.key === 'ArrowUp' ? step : -step) : 0), bounds)
    },
  })
  return {
    maximized: preferences.maximized,
    positioned: Boolean(preferences.position),
    resizing,
    moving,
    toggleMaximized: () => { finish(); setPreferences(previous => ({ ...previous, maximized: !previous.maximized })) },
    style: {
      ...(preferences.size ? { '--chat-width': `${preferences.size.width}px`, '--chat-height': `${preferences.size.height}px` } : {}),
      ...(preferences.position ? { '--chat-x': preferences.position.x, '--chat-y': preferences.position.y } : {}),
    } as CSSProperties,
    handleProps,
    headerProps: {
      tabIndex: preferences.maximized ? -1 : 0,
      onPointerDown(event: PointerEvent<HTMLElement>) {
        if (preferences.maximized || event.button !== 0 || !event.isPrimary ||
          (event.target as HTMLElement).closest('button, a, input, select, textarea, [role="button"]')) return
        const bounds = event.currentTarget.closest('.demo-chat-shell')!.getBoundingClientRect()
        event.preventDefault()
        event.currentTarget.focus()
        event.currentTarget.setPointerCapture(event.pointerId)
        move.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY,
          left: bounds.left, top: bounds.top, width: bounds.width, height: bounds.height, original: preferences.position, moved: false }
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
        const bounds = event.currentTarget.closest('.demo-chat-shell')!.getBoundingClientRect()
        const step = event.shiftKey ? 64 : 24
        setPreferences(previous => ({ ...previous, position: positionFor(
          bounds.left + (event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0),
          bounds.top + (event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0), bounds.width, bounds.height,
        ) }))
      },
    },
  }
}
