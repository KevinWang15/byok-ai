import { ThinkingOrb, type OrbSize } from 'thinking-orbs'
import type { DemoOrbState } from './orb-state'
import { ScaledOrb } from './ScaledOrb'

const idleGlobeOptions = { dimBase: 1, rBoost: 0 }

/** Demo-only presentation. The published core never imports thinking-orbs. */
export function DemoOrb({ state = 'idle', size = 64, displaySize = size, paused = false, label = 'Assistant ready', decorative = false }: {
  state?: DemoOrbState; size?: OrbSize; displaySize?: number; paused?: boolean; label?: string; decorative?: boolean
}) {
  // Reuse the library's globe geometry at rest without its active search scan.
  const idle = state === 'idle'
  const attributes = {
    className: 'demo-thinking-orb',
    'data-orb-state': state,
    'data-orb-shape': idle ? 'globe' : undefined,
    'data-orb-paused': paused,
    'aria-label': label,
    'aria-hidden': decorative || undefined,
  }
  if (displaySize !== size) return <ScaledOrb {...attributes} state={idle ? 'searching' : state}
    size={size} displaySize={displaySize} idle={idle} paused={paused} />
  return <ThinkingOrb state={idle ? 'searching' : state} size={size}
    theme="light" color="#8d75a3" speed={idle ? 0.25 : 1}
    opts={idle ? idleGlobeOptions : undefined} paused={paused}
    {...attributes} />
}
