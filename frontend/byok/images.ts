import type { AttachmentAdapter, CompleteAttachment, PendingAttachment } from '@assistant-ui/react'
import type { ImageStore } from './conversation-files'

// Images the user attaches to a message (the `images` option). An image is prepared when it is
// added (resized to what models read, in a format they all take), saved in the conversation's
// image store (conversation-files.ts) when the message is sent, and given to the model with each
// later turn. The message itself holds only the attachment: its id, name and type.

export const IMAGE_LIMITS = {
  /** Images in one message. */
  perMessage: 4,
  /** The largest file accepted before preparing it. */
  inputBytes: 20 * 1024 * 1024,
  /** Longer edges are scaled down to this: about what models read at full detail. */
  longEdge: 1568,
  /** Prepared images larger than this are re-encoded as JPEG. */
  bytes: 3.75 * 1024 * 1024,
}
/** Formats every supported provider accepts. Others (GIF, BMP, AVIF where decodable) are converted. */
const SENT_TYPES = ['image/png', 'image/jpeg', 'image/webp']
const ACCEPT = 'image/png,image/jpeg,image/webp,image/gif,image/bmp,image/avif'

// Ids from getRandomValues: crypto.randomUUID exists only in secure contexts.
const newImageId = () => Array.from(crypto.getRandomValues(new Uint8Array(16)), byte => byte.toString(16).padStart(2, '0')).join('')

/** An image attachment as saved in a message. */
export type ImageAttachment = CompleteAttachment & { type: 'image'; contentType: string }
export const isImageAttachment = (attachment: { type?: string; contentType?: string }): attachment is ImageAttachment =>
  attachment.type === 'image' && typeof attachment.contentType === 'string'

/**
 * The image as it is sent: unchanged when a model takes it as it is, else scaled so its longer
 * edge is at most `longEdge` and encoded as PNG (sources with transparency) or JPEG. Browser only.
 */
export async function prepareImage(file: File): Promise<Blob> {
  if (file.size > IMAGE_LIMITS.inputBytes) throw new Error(`"${file.name}" is larger than ${IMAGE_LIMITS.inputBytes / 1024 / 1024} MB.`)
  let bitmap: ImageBitmap
  try { bitmap = await createImageBitmap(file) } catch { throw new Error(`"${file.name}" could not be read as an image.`) }
  try {
    const scale = Math.min(1, IMAGE_LIMITS.longEdge / Math.max(bitmap.width, bitmap.height))
    if (scale === 1 && SENT_TYPES.includes(file.type) && file.size <= IMAGE_LIMITS.bytes) return file
    const width = Math.max(1, Math.round(bitmap.width * scale))
    const height = Math.max(1, Math.round(bitmap.height * scale))
    const canvas = new OffscreenCanvas(width, height)
    const context = canvas.getContext('2d')!
    // PNG keeps a source's transparency; everything else is JPEG, on white rather than black.
    const png = file.type === 'image/png'
    if (!png) { context.fillStyle = '#fff'; context.fillRect(0, 0, width, height) }
    context.drawImage(bitmap, 0, 0, width, height)
    const encoded = await canvas.convertToBlob({ type: png ? 'image/png' : 'image/jpeg', quality: 0.9 })
    if (encoded.size <= IMAGE_LIMITS.bytes) return encoded
    // A large PNG photo: as JPEG.
    context.globalCompositeOperation = 'destination-over'
    context.fillStyle = '#fff'
    context.fillRect(0, 0, width, height)
    return await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.85 })
  } finally { bitmap.close() }
}

const extension: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' }

/**
 * The composer's attachments: images only, at most `perMessage` per message, saved in the store
 * of the conversation open when the message is sent.
 */
export function imageAttachmentAdapter(options: {
  /** Attachments in the composer now. */
  attached: () => number
  images: () => ImageStore
  prepare?: (file: File) => Promise<Blob>
}): AttachmentAdapter {
  const prepare = options.prepare ?? prepareImage
  // Images being prepared: pasting several at once adds them together.
  let preparing = 0
  return {
    accept: ACCEPT,
    async add({ file }) {
      if (options.attached() + preparing >= IMAGE_LIMITS.perMessage) throw new Error(`A message can hold at most ${IMAGE_LIMITS.perMessage} images.`)
      preparing++
      try {
        const image = await prepare(file)
        // The name says what was sent: a converted image gets its new extension.
        const name = image === file ? file.name : file.name.replace(/\.[^.]*$/, '') + '.' + (extension[image.type] ?? 'img')
        const prepared = new File([image], name, { type: image.type })
        return { id: newImageId(), type: 'image', name, contentType: image.type, file: prepared, status: { type: 'requires-action', reason: 'composer-send' } } satisfies PendingAttachment
      } finally { preparing-- }
    },
    async remove() {},
    async send(attachment) {
      await options.images().save(attachment.id, attachment.file)
      return { id: attachment.id, type: 'image', name: attachment.name, contentType: attachment.contentType, status: { type: 'complete' }, content: [] }
    },
  }
}
