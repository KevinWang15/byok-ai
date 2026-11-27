/**
 * Why the last answer stopped or failed, or why something couldn't be added to the message
 * (`useAskAI().error`). A reason, not a sentence: the default wording is `text.problem`'s, and a
 * host in another language words it itself.
 */
export type AskAIProblem =
  /** The answer stopped at the model's output limit. */
  | { reason: 'length' }
  /** The assistant used all its steps (`maxSteps`) before answering. */
  | { reason: 'steps' }
  /** The model finished without writing an answer. */
  | { reason: 'empty' }
  /** The network dropped during the response. */
  | { reason: 'connectionLost' }
  /** The provider or an MCP server failed; `mcp` says whether any are configured. */
  | { reason: 'failed'; mcp: boolean }
  /** The message already holds `limit` elements from the page. */
  | { reason: 'pageElementLimit'; limit: number }
  /** The message already holds `limit` images. */
  | { reason: 'imageLimit'; limit: number }
  /** The image `name` is larger than `megabytes`. */
  | { reason: 'imageTooLarge'; name: string; megabytes: number }
  /** The file `name` isn't an image the browser can read. */
  | { reason: 'imageUnreadable'; name: string }
  /** A file couldn't be attached for another reason (a type the composer doesn't accept, say). */
  | { reason: 'attachmentFailed' }

/** Why `connect()` didn't connect. */
export type ConnectProblem =
  /** An answer is running; stop it first. */
  | { reason: 'busy' }
  /** The field labelled `field` is required. */
  | { reason: 'required'; field: string }
  /** The provider's `validate` refused the values, in its own words. */
  | { reason: 'invalid'; message: string }

/**
 * Every word the assistant's built-in parts show or read out: the `text` option of AskAIProvider,
 * where each key given replaces its English default (`defaultText`). Pass it again when the
 * interface's language changes and every part follows, answers already shown included.
 * What the model reads (its instructions, tool descriptions) is not here: it stays English.
 */
export interface AskAIText {
  /** The locale for times and dates: history's "5 minutes ago". */
  locale: string
  problem: (problem: AskAIProblem) => string
  connectProblem: (problem: ConnectProblem) => string

  // Panel, trigger and the default widget's navigation.
  openAssistant: (title: string) => string
  closeAssistant: (title: string) => string
  assistantNavigation: string
  conversationHistory: string
  providerSettings: string
  close: string
  conversationNavigation: string
  newChat: string
  chat: string
  tools: string
  disconnect: string
  storageError: string

  // The conversation.
  empty: string
  input: string
  placeholder: string
  send: string
  stop: string
  editInput: string
  cancel: string
  sendEdit: string
  copy: string
  copied: string
  regenerate: string
  edit: string
  versions: string
  previous: string
  previousVersion: string
  next: string
  nextVersion: string
  toolRunning: string
  toolStopped: string
  toolDone: string
  toolFailed: string

  // Images and page elements.
  attachImage: string
  removeImage: (name: string) => string
  remove: string
  imageMissing: (name: string) => string
  addFromPage: string
  elementCount: (count: number) => string
  elementPlace: (inside: readonly string[]) => string
  removeElement: (name: string) => string
  removeFromMessage: string

  // Answers (Markdown).
  answer: string
  componentUnavailable: string
  componentFailed: string
  imageNotShown: string

  // Provider setup.
  chooseProvider: string
  allProviders: string
  providerConfiguration: string
  keyStorage: string
  startChatting: string
  returnToConversation: string

  // History.
  historyTitle: string
  historyDescription: string
  historyEmpty: string
  untitled: string
  imageConversation: string
  draft: (text: string) => string
  noMessages: string
  justNow: string
  messageCount: (count: number) => string
  current: string
  delete: string
  deleteConversation: (title: string) => string
  confirmDelete: string
  confirmDeleteDescription: (title: string) => string
  keepConversation: string
  confirmDeleteAction: string

  // Tools page.
  mcpServers: string
  noMcpServers: string
  pageTools: string
  workspace: string
  workspaceDescription: string
  workspaceUnreadable: string
  noFiles: string
}

const plural = (count: number, one: string, other: string) => `${count} ${count === 1 ? one : other}`

/** The English text, the default of every key. */
export const defaultText: AskAIText = {
  locale: 'en',
  problem: problem => {
    switch (problem.reason) {
      case 'length': return 'The answer stopped at the model’s output limit. Ask it to continue.'
      case 'steps': return 'The assistant used all its steps before finishing. Ask it to continue, or narrow the question.'
      case 'empty': return 'The model finished without writing an answer. Try again.'
      case 'connectionLost': return 'The connection was interrupted. Try again.'
      case 'failed': return problem.mcp
        ? 'Could not complete the response. Check your key, the model, the provider’s CORS support and the MCP servers, then try again.'
        : 'Could not complete the response. Check your key, the model and the provider’s CORS support, then try again.'
      case 'pageElementLimit': return `A message can hold at most ${problem.limit} elements from the page.`
      case 'imageLimit': return `A message can hold at most ${problem.limit} images.`
      case 'imageTooLarge': return `“${problem.name}” is larger than ${problem.megabytes} MB.`
      case 'imageUnreadable': return `“${problem.name}” could not be read as an image.`
      case 'attachmentFailed': return 'This file can’t be attached.'
    }
  },
  connectProblem: problem => {
    switch (problem.reason) {
      case 'busy': return 'Stop the current response before changing providers.'
      case 'required': return `${problem.field} is required.`
      case 'invalid': return problem.message
    }
  },

  openAssistant: title => `Open ${title}`,
  closeAssistant: title => `Close ${title}`,
  assistantNavigation: 'Assistant',
  conversationHistory: 'Conversation history',
  providerSettings: 'Provider settings',
  close: 'Close assistant',
  conversationNavigation: 'Conversation',
  newChat: 'New chat',
  chat: 'Chat',
  tools: 'Tools',
  disconnect: 'Disconnect provider',
  storageError: 'Could not read or save browser data. Keys, settings, and conversations may not be restored or removed after reload.',

  empty: 'Start a conversation.',
  input: 'Message',
  placeholder: 'Ask anything…',
  send: 'Send message',
  stop: 'Stop response',
  editInput: 'Edit message',
  cancel: 'Cancel',
  sendEdit: 'Send',
  copy: 'Copy response',
  copied: 'Copied',
  regenerate: 'Regenerate response',
  edit: 'Edit message',
  versions: 'Versions',
  previous: 'Previous',
  previousVersion: 'Previous version',
  next: 'Next',
  nextVersion: 'Next version',
  toolRunning: 'Running…',
  toolStopped: 'Stopped',
  toolDone: 'Done',
  toolFailed: 'Failed',

  attachImage: 'Attach image',
  removeImage: name => `Remove ${name}`,
  remove: 'Remove',
  imageMissing: name => `${name} (no longer stored)`,
  addFromPage: 'Add from page',
  elementCount: count => plural(count, 'element', 'elements'),
  elementPlace: inside => `in ${inside.join(' › ')}`,
  removeElement: name => `Remove “${name}”`,
  removeFromMessage: 'Remove from the message',

  answer: 'Answer',
  componentUnavailable: 'This part of the answer cannot be shown.',
  componentFailed: 'This part of the answer could not be drawn.',
  imageNotShown: 'Image not shown',

  chooseProvider: 'Choose an AI provider',
  allProviders: 'All providers',
  providerConfiguration: 'Provider configuration',
  keyStorage: 'Keys and provider settings are saved in localStorage on this browser. Disconnect to remove the saved key.',
  startChatting: 'Start chatting',
  returnToConversation: 'Return to conversation',

  historyTitle: 'Conversations',
  historyDescription: 'Pick up where you left off. Most recently updated first.',
  historyEmpty: 'Your saved conversations will appear here.',
  untitled: 'New conversation',
  imageConversation: 'Image',
  draft: text => `Draft: ${text}`,
  noMessages: 'No messages yet',
  justNow: 'Just now',
  messageCount: count => plural(count, 'message', 'messages'),
  current: 'Current',
  delete: 'Delete',
  deleteConversation: title => `Delete ${title}`,
  confirmDelete: 'Delete conversation?',
  confirmDeleteDescription: title => `“${title}” and its messages and draft will be removed from this browser. This cannot be undone.`,
  keepConversation: 'Keep conversation',
  confirmDeleteAction: 'Delete conversation',

  mcpServers: 'MCP servers',
  noMcpServers: 'No MCP servers configured.',
  pageTools: 'Page tools',
  workspace: 'Workspace',
  workspaceDescription: 'Files the assistant keeps with this conversation, in this browser only, and computes over in a sandbox.',
  workspaceUnreadable: 'The workspace could not be read.',
  noFiles: 'No files yet.',
}

/** An error that carries a problem, for code that can only throw (an attachment adapter). */
export class ProblemError extends Error {
  constructor(readonly problem: AskAIProblem) {
    super(defaultText.problem(problem))
    this.name = 'ProblemError'
  }
}
