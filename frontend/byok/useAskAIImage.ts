import { useEffect, useState } from 'react'
import { useAuiState } from '@assistant-ui/react'
import { useAskAI } from './context'

/**
 * The enclosing attachment's image, in the composer (not sent yet) or in a sent message: its object
 * URL while shown, its name, and whether it is no longer stored. For a custom thumbnail.
 */
export function useAskAIImage(): { src?: string; name: string; missing: boolean } {
  const { loadImage } = useAskAI()
  const attachment = useAuiState(state => state.attachment)
  const [image, setImage] = useState<{ src?: string; missing: boolean }>({ missing: false })
  const file = attachment.status.type === 'complete' ? undefined : attachment.file
  useEffect(() => {
    let url: string | undefined
    let current = true
    const show = (blob: Blob | undefined) => {
      if (!current) return
      url = blob && URL.createObjectURL(blob)
      setImage({ src: url, missing: !blob })
    }
    if (file) show(file)
    else loadImage(attachment.id).then(show, () => show(undefined))
    return () => { current = false; if (url) URL.revokeObjectURL(url) }
  }, [file, attachment.id, loadImage])
  return { ...image, name: attachment.name }
}
