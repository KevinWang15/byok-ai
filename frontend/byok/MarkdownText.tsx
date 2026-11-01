import type { ComponentProps } from 'react'
import { MarkdownTextPrimitive, type MarkdownTextPrimitiveProps } from '@assistant-ui/react-markdown'
import remarkGfm from 'remark-gfm'

// An image in an answer is never loaded, only described. Tool results can carry text other people
// wrote, so an answer could be steered into an image whose address carries the user's data to
// another site; loading it would send it, without a click. Pass `components.img` to show images.
function AnswerImage({ alt }: ComponentProps<'img'>) {
  return alt ? <span data-byok="image-placeholder">[image: {alt}]</span> : null
}

/**
 * Unstyled Markdown for an assistant-ui text-part context. No raw HTML or theme is enabled, and
 * images are not loaded: they show as "[image: alt]" unless `components.img` renders them.
 */
export function MarkdownText({ remarkPlugins = [], components, ...props }: MarkdownTextPrimitiveProps) {
  return <MarkdownTextPrimitive
    defer
    skipHtml
    containerProps={{ 'data-byok': 'markdown' } as MarkdownTextPrimitiveProps['containerProps']}
    {...props}
    components={{ img: AnswerImage, ...components }}
    remarkPlugins={[remarkGfm, ...(remarkPlugins ?? [])]}
  />
}
