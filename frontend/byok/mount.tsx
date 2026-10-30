import { createRoot } from 'react-dom/client'
import { AskAI } from './AskAI'
import type { AskAIProps } from './types'
/** Mount into a host element on a page that does not otherwise use React. */
export function mountAskAI(element: HTMLElement, props: AskAIProps = {}) {
  const root = createRoot(element)
  root.render(<AskAI {...props} />)
  return { unmount: () => root.unmount() }
}
