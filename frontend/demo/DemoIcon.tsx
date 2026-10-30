import {
  ArrowLeft, ArrowRight, ArrowUp, Check, ChevronRight, Copy, Grip, History,
  Maximize2, Minimize2, MoreHorizontal, Plug, Settings, ShieldCheck, Sparkles,
  Square, SquarePen, X, Eye, EyeOff, HardDrive, RotateCcw,
} from 'lucide-react'

const icons = {
  plus: SquarePen, history: History, settings: Settings, close: X, back: ArrowLeft,
  send: ArrowUp, stop: Square, chevron: ChevronRight, check: Check, tools: Plug,
  copy: Copy, sparkle: Sparkles, maximize: Maximize2, restore: Minimize2,
  resize: Grip, arrow: ArrowRight, shield: ShieldCheck, more: MoreHorizontal,
  eye: Eye, eyeOff: EyeOff, storage: HardDrive, regenerate: RotateCcw,
}
export type DemoIconName = keyof typeof icons

/** Demo-only icon set. Accessible names belong to the surrounding controls. */
export function DemoIcon({ name, size = 18, className }: { name: DemoIconName; size?: number; className?: string }) {
  const Icon = icons[name]
  return <Icon aria-hidden="true" size={size} strokeWidth={2} className={className} />
}
