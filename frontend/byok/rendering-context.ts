import { createContext } from 'react'
import type { AskAIChatProps } from './types'

export const MessageRenderingContext = createContext<AskAIChatProps['components']>(undefined)
