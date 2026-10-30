import { MarkdownTextPrimitive, type MarkdownTextPrimitiveProps } from '@assistant-ui/react-markdown'
import remarkGfm from 'remark-gfm'

/** Unstyled Markdown for an assistant-ui text-part context. No raw HTML or theme is enabled. */
export function MarkdownText({ remarkPlugins = [], ...props }: MarkdownTextPrimitiveProps) {
  return <MarkdownTextPrimitive
    defer
    skipHtml
    containerProps={{ 'data-byok': 'markdown' } as MarkdownTextPrimitiveProps['containerProps']}
    {...props}
    remarkPlugins={[remarkGfm, ...(remarkPlugins ?? [])]}
  />
}
