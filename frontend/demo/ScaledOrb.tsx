import { useEffect, useRef, type ComponentPropsWithoutRef } from 'react'
import { MODE_FRAMES, paintFrame, resolvePreset, type OrbSize, type OrbState } from 'thinking-orbs/engine'

/** The React widget only supports 20/32/64px canvases. Render its engine at display resolution. */
export function ScaledOrb({ state, size, displaySize, idle, paused, ...props }: {
  state: OrbState; size: OrbSize; displaySize: number; idle: boolean; paused: boolean
} & ComponentPropsWithoutRef<'canvas'>) {
  const ref = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = ref.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return
    const preset = resolvePreset(state, size)
    const opts = idle ? { ...preset.opts, dimBase: 1, rBoost: 0 } : preset.opts
    const reduced = matchMedia('(prefers-reduced-motion: reduce)')
    let visible = false
    let animation = 0
    let density = 1
    let resolution: MediaQueryList

    const draw = () => {
      const scale = displaySize / size * density
      ctx.setTransform(scale, 0, 0, scale, 0, 0)
      ctx.clearRect(0, 0, size, size)
      const time = reduced.matches ? 0.6 : performance.now() / 1000 * preset.speed * (idle ? 0.25 : 1)
      // Keep the preset's geometry and tint; scale vector drawing, never the rendered bitmap.
      paintFrame(ctx, MODE_FRAMES[preset.mode](size, time, opts), false, { r: 141, g: 117, b: 163 })
    }
    const tick = () => { draw(); animation = requestAnimationFrame(tick) }
    const sync = () => {
      cancelAnimationFrame(animation)
      draw()
      if (visible && !paused && !reduced.matches && document.visibilityState === 'visible') {
        animation = requestAnimationFrame(tick)
      }
    }
    const resize = () => {
      density = window.devicePixelRatio || 1
      canvas.width = Math.ceil(displaySize * density)
      canvas.height = Math.ceil(displaySize * density)
      resolution?.removeEventListener('change', resize)
      resolution = matchMedia(`(resolution: ${density}dppx)`)
      resolution.addEventListener('change', resize)
      sync()
    }
    const observer = new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; sync() })
    observer.observe(canvas)
    reduced.addEventListener('change', sync)
    document.addEventListener('visibilitychange', sync)
    resize()
    return () => {
      cancelAnimationFrame(animation)
      observer.disconnect()
      reduced.removeEventListener('change', sync)
      resolution.removeEventListener('change', resize)
      document.removeEventListener('visibilitychange', sync)
    }
  }, [state, size, displaySize, idle, paused])

  return <canvas {...props} ref={ref} style={{ width: displaySize, height: displaySize }} role="img" />
}
