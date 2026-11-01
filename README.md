# byok-ai

An embeddable AI assistant for React apps where users bring their own API key. The agent loop (AI SDK) runs in the browser: it calls the user's chosen provider directly and uses tools from your MCP servers and from the page itself. Components are unstyled Headless UI and assistant-ui primitives; the library ships no CSS.

## Run the demo

Requires Node 24+ and npm 11+.

```sh
npm ci
npm run dev          # demo MCP API on :3000 and Vite on :5173
npm run check        # lint, typecheck (incl. tests and e2e), build, unit tests
npm run test:e2e     # Playwright, Chromium (npx playwright install chromium)
npm run build:lib    # dist/lib/index.js with type declarations
```

Open http://127.0.0.1:5173, click Ask AI, choose a provider and paste a key. The demo MCP server offers `search_docs` and `get_current_time`, and the demo assistant has the workspace and images on. If port 3000 is taken: `PORT=3019 API_PROXY_TARGET=http://127.0.0.1:3019 npm run dev`. `npm run build && npm start` serves the built page and `/api/mcp` from one origin. Tests use simulated providers and never call a real one.

## Embed

Build the library with `npm run build:lib` and install the package from a path or `npm pack` tarball. Peer dependencies: `react`, `react-dom`, `@assistant-ui/react`, `@headlessui/react`. It is an ES module for bundlers.

```tsx
import { AskAI } from 'byok-ai'

const servers = [{ id: 'docs', name: 'Docs', url: '/api/mcp' }]

export function Page() {
  return <AskAI mcpServers={servers} storageKey="my-app:assistant" />
}
```

`AskAI` renders a trigger button and a modal dialog with provider setup, chat, history and a tools list. On a page that does not otherwise use React, mount it into an element:

```ts
import { mountAskAI } from 'byok-ai'

const assistant = mountAskAI(document.getElementById('assistant')!, { mcpServers: [{ id: 'docs', name: 'Docs', url: '/api/mcp' }] })
assistant.unmount() // when the host removes it
```

## Options

`AskAI`, `AskAIProvider` and `mountAskAI` take these (`AskAIOptions`):

| Option | Default | Meaning |
| --- | --- | --- |
| `providers` | `defaultProviders` | Provider presets offered in setup. |
| `mcpServers` | `[]` | MCP servers (`McpServerConfig`) whose tools the model may call. |
| `clientTools` | `{}` | AI SDK `tool()` definitions that run in the page. |
| `workspace` | `false` | Per-conversation files in the browser and sandboxed JavaScript over them (see Workspace). |
| `images` | `false` | Lets the user attach images to messages, for providers that accept them (see Images). |
| `systemPrompt` | a short built-in prompt | System prompt for every answer. |
| `storageKey` | `byok-ai:conversations` | localStorage key for conversations and the open one. |
| `connectionKey` | `${storageKey}:connection` | localStorage key for the provider connection. Must differ from `storageKey`. |
| `title` | `Ask AI` | Dialog title and accessible name. |
| `maxSteps` | `8` | Model steps per answer; each step is one model call that may call tools. |
| `maxOutputTokens` | provider default | Output token limit per step. |
| `maxToolCalls` | unlimited | Tool calls per answer; after that the model answers without tools. |

`AskAI` also takes `components` (see Custom UI) and `children`, which replace the whole default UI.

## Providers

`defaultProviders` holds four presets, each with an API key field and an editable model ID: OpenAI (`gpt-4.1-mini`), Anthropic (`claude-sonnet-4-5`, sends Anthropic's direct-browser-access header), Google Gemini (`gemini-2.5-flash`), and OpenAI compatible, which adds a base URL (HTTPS, or HTTP for localhost) and makes the key optional.

A preset (`ProviderPreset`) has `id`, `name`, `description`, `defaultValues` and `createModel(values)`, which returns any AI SDK language model, and optionally `acceptsImages` (default false; true in the four presets). Describe its form with `fields`, or render your own `Form`, which receives `values` and `onChange(values)`. `connect` rejects missing required `fields`, then calls `validate(values)`; a returned string is shown and blocks the connection. With a custom `Form`, `validate` is the only check.

```tsx
import { createOpenAI } from '@ai-sdk/openai'
import { AskAI, defaultProviders, type ProviderFormProps, type ProviderPreset } from 'byok-ai'

function GatewayForm({ values, onChange }: ProviderFormProps) {
  return <label>Gateway key
    <input type="password" value={values.apiKey ?? ''} onChange={e => onChange({ ...values, apiKey: e.target.value })} />
  </label>
}
const gateway: ProviderPreset = {
  id: 'gateway', name: 'Company gateway', description: 'Use your company-issued key.',
  defaultValues: { model: 'company-model' },
  Form: GatewayForm,
  validate: values => values.apiKey?.trim() ? undefined : 'Enter a key.',
  createModel: values => createOpenAI({ apiKey: values.apiKey, baseURL: 'https://gateway.example.com/v1' }).chat(values.model),
}

export const Page = () => <AskAI providers={[...defaultProviders, gateway]} />
```

A saved connection is matched to a preset by `id`; if no preset has that id, setup is shown.

## Tools

MCP servers are reached over Streamable HTTP. Each `McpServerConfig` has `id` (letters, digits, `_`, `-`), `name`, `url` (relative URLs resolve against the page) and optional `headers`, either a record or an async function called at the start of each answer. Tools are discovered at the start of each answer and named `serverId__toolName`. MCP requests time out after 60 seconds, and Stop cancels them.

```tsx
<AskAI mcpServers={[{
  id: 'account', name: 'Account tools', url: 'https://tools.example.com/mcp',
  headers: async () => ({ Authorization: 'Bearer ' + await getMcpToken() }),
}]} />
```

The demo backend (`backend/app.ts`) creates a stateless MCP server per POST to `/api/mcp`. It rejects requests whose `Origin` host differs from the request host unless the origin is listed in `MCP_ALLOWED_ORIGINS` (comma-separated; see `.env.example`). It sends no CORS headers, so cross-origin use needs a CORS-capable reverse proxy. Register more tools in `createMcpServer()`.

`clientTools` act on the page, such as reading or editing an open document. Names may use letters, digits, `_` and `-`, but not `__`. Pass fresh definitions as page state changes: every call runs the latest one. Adding or removing a name restarts the runtime.

```tsx
import { useState } from 'react'
import { tool } from 'ai'
import { z } from 'zod'
import { AskAI } from 'byok-ai'

export function Editor() {
  const [title, setTitle] = useState('Untitled')
  const clientTools = {
    get_title: tool({ description: 'Read the document title', inputSchema: z.object({}), execute: async () => title }),
    set_title: tool({
      description: 'Rename the document',
      inputSchema: z.object({ title: z.string() }),
      execute: async input => { setTitle(input.title); return { ok: true } },
    }),
  }
  return <AskAI clientTools={clientTools} maxSteps={6} maxToolCalls={10} />
}
```

On the last step, or once `maxToolCalls` is spent, tools are disabled and the model is told to answer from what it has. If the model stops without writing an answer, it is asked once more without tools. An unfinished answer is never silent: `error` (shown in the chat) says the answer stopped at the output limit, that the assistant used all its steps, or that the model finished without an answer. A failed request shows either "The connection was interrupted" or a general message to check key, model, CORS and MCP; raw provider errors are never shown, since some include keys.

## Workspace

With `workspace`, each conversation gets a few text files, and the model can run JavaScript over them for calculation and analysis. Large data stays out of the conversation: the model saves a tool's result straight to a file, computes over it, and reads back only the answer.

| Tool | Does |
| --- | --- |
| `workspace__list_files` | Names and sizes. |
| `workspace__read_file` | Up to 20,000 characters from an offset, with `nextOffset` when there is more. |
| `workspace__write_file`, `workspace__delete_file` | Create, replace or delete a file. |
| `workspace__save_tool_result` | Call another tool (MCP or page) and save its result to a file; returns the size and the first 600 characters. MCP results are saved as their structured content, or their text. |
| `workspace__run_javascript` | Run code as an async function body with `files.list()`, `files.read(name)`, `files.readJSON(name)`, `files.write(name, textOrValue)`, `files.delete(name)` and `console.log`; returns what it `return`s (JSON, up to 20,000 characters) and the log. |

Files live in the origin private file system (OPFS) under `byok-ai/<storageKey>/<conversation id>/files/`. They are kept across reloads, never uploaded, and deleted with their conversation. Names are flat (letters, digits, `.`, `-`, `_`). A file holds up to 8 MB, a conversation 200 files and 64 MB (`WORKSPACE_LIMITS`). The tools page lists the open conversation's files, and `useAskAI().workspace` reads them.

Scripts run in QuickJS, a separate JavaScript engine compiled to WebAssembly, in a worker started for each run. They see only the files and `console`: no network, DOM, storage, timers or imports. A run is stopped after 10 seconds or at 256 MB of memory (`SCRIPT_LIMITS`), and Stop ends it at once. A script works on a copy, and its writes are saved only if it finishes without an error. The worker and the engine's `.wasm` are separate files your bundler emits (Vite does so by default). A Content-Security-Policy must allow them: `worker-src 'self'`, `connect-src 'self'` (the worker fetches the `.wasm`) and `script-src 'wasm-unsafe-eval'`.

The tools are named `workspace__…`, so with `workspace` on, no MCP server may have the id `workspace`.

Browsers offer OPFS only in secure contexts: HTTPS, or `localhost`. On a page served over plain HTTP from another host, `workspace` and `images` have no effect: no workspace tools, no attach button. `browserFilesAvailable()` says which applies, so a system prompt can mention the workspace only when it is there.

## Images

With `images`, and a provider whose preset `acceptsImages`, the user can attach images to a message: with the attach button, by pasting into the message box, or by dropping them on the composer. A message holds up to 4 (`IMAGE_LIMITS`), of up to 20 MB each. Each is prepared when it is added: an image whose longer edge is over 1,568 px, or that is not PNG, JPEG or WebP, is scaled and encoded as PNG (PNG sources) or JPEG. A file the browser can't read, or one too many, is refused with a message where answer errors show.

Sent images are kept with their conversation in OPFS (`byok-ai/<storageKey>/<conversation id>/images/`), not in localStorage; the message records only each image's id, name and type. Every later turn sends them to the model again. A provider that doesn't accept images gets a note in their place, as does an image that is no longer stored. Deleting a conversation deletes its images. Images attached but not sent are not saved: they are dropped on reload or when another conversation opens.

## Custom UI

`AskAIProvider` holds state and the assistant-ui runtime and renders no DOM. Inside it, `useAskAI()` returns `title`, `providers`, `mcpServers`, `clientTools` (names), `workspace` (the open conversation's files, when on), `images` (whether images can be attached now), `loadImage(id)`, `open`/`setOpen`, `page`/`setPage` (`'chat' | 'settings' | 'history' | 'tools'`), `connection`, `connect(provider, values)` (returns an error string or `undefined`), `disconnect()`, `conversations`, `activeConversation`, `newConversation()`, `selectConversation(id)`, `deleteConversation(id)` (immediate; confirm first), `busy`, `error`, `storageError` and `runtime`. Send with `runtime.thread.append(text)` and stop with `runtime.thread.cancelRun()`. Changing provider, page or conversation is ignored while `busy`.

Compose the parts you need: `AskAITrigger` and `AskAIPanel` (native button and div props), `AskAISetup`, `AskAIChat`, `AskAIHistory`, `AskAITools`, `AskAIMessageContent`, `AskAIMessageActions`, or `AskAIWidget` for the full default UI. For images in a custom composer or message: `AskAIAddImage` (the attach button; renders nothing while images can't be attached), `AskAIComposerImages` (attached images with remove buttons), `AskAIMessageImages` (a user message's images), and `useAskAIImage()` for your own thumbnail; wrap the composer's input in `ComposerPrimitive.AttachmentDropzone` for dropping. `createBrowserAdapter` is the assistant-ui `ChatModelAdapter` behind the runtime, for hosts that build their own.

```tsx
import { AskAIChat, AskAIHistory, AskAIPanel, AskAIProvider, AskAISetup, AskAITrigger, useAskAI } from 'byok-ai'

function Shell() {
  const { connection, page, setPage, busy } = useAskAI()
  return <>
    <AskAITrigger className="ask-trigger">Ask</AskAITrigger>
    <AskAIPanel className="ask-panel">
      <button type="button" disabled={busy} onClick={() => setPage(page === 'history' ? 'chat' : 'history')}>History</button>
      {!connection || page === 'settings' ? <AskAISetup /> : page === 'history' ? <AskAIHistory title="Questions about this page" /> : <AskAIChat />}
    </AskAIPanel>
  </>
}

export const Page = () => <AskAIProvider storageKey="my-app:help"><Shell /></AskAIProvider>
```

`components` on `AskAIChat`, `AskAIWidget` and `AskAI` replaces parts of the chat: `Text`, `ToolFallback`, `UserMessage`, `AssistantMessage`, `Empty` and `Composer`. Message slots render inside assistant-ui's message scope; use `AskAIMessageContent` in them to keep the `Text` and `ToolFallback` overrides, and `AskAIMessageActions` for copy and regenerate (labels via `copy`, `copied`, `regenerate`). Define slot components at module scope so they don't remount while streaming.

`MarkdownText` is the default `Text`: GitHub-flavored Markdown with raw HTML skipped. It reads the current assistant-ui text part and accepts `MarkdownTextProps` (`components`, `remarkPlugins`, `className`, ...).

Default components carry `data-byok` attributes for styling (`root`, `trigger`, `dialog`, `panel`, `setup`, `chat`, `messages`, `message` with `data-role`, `composer`, `tool`, `markdown`, `message-actions`, `history`, `tools`, `image` with `data-missing`, `composer-images`, `message-images`, `add-image`, and others). The dialog is portalled to `document.body`, so style it by attribute or class rather than ancestor selectors. `AskAIHistory` takes `title`, `description` and `empty` to replace its copy.

`usePanelLayout({ storageKey, margin?, minSize? })` gives a floating panel window behavior: move by dragging the header, resize from any edge or corner, arrow keys on the header or a handle (Shift for bigger steps), Escape to cancel a move, and `toggleMaximized()`. Spread `panelProps` on the panel, `headerProps` on its header and `handleProps(edge)` (`'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw'`) on focusable handles, and apply `style`. It sets `--byok-panel-width`/`--byok-panel-height` (px) once resized and `--byok-panel-x`/`--byok-panel-y` (0 to 1 of the free space) once moved; your CSS turns them into placement. It also returns `maximized`, `positioned`, `resizing` and `moving`.

```tsx
import { AskAIChat, AskAIPanel, usePanelLayout } from 'byok-ai'

export function Window() {
  const layout = usePanelLayout({ storageKey: 'my-app:panel' })
  return <AskAIPanel {...layout.panelProps} style={layout.style}>
    <header {...layout.headerProps}>Ask AI <button type="button" onClick={layout.toggleMaximized}>Maximize</button></header>
    <AskAIChat />
    <button type="button" aria-label="Resize" {...layout.handleProps('se')} />
  </AskAIPanel>
}
```

## Persistence

Everything except workspace files and images (see Workspace and Images) is saved in the browser's localStorage:

| Key | Holds |
| --- | --- |
| `storageKey` | `{ conversations, activeConversationId }`: messages with tool calls and results, unsent drafts, titles, timestamps |
| `connectionKey` | `{ providerId, values }`: the chosen preset and its form values, API key included |
| `usePanelLayout`'s `storageKey` | panel size, position and maximized state |

A conversation is listed once it has a message or a non-blank draft. A response still running at reload comes back cancelled. Records of another shape are skipped. Read and write failures never throw; they set `storageError`. Disconnecting removes the saved connection and keeps conversations.

Assistants that pass the same `connectionKey` share one connection: connecting or disconnecting in one updates the others, in the same tab and in other tabs. A running answer finishes with the connection it started with. Conversations are not synced across tabs, so give each mounted assistant its own `storageKey`.

## Security and browser constraints

- API keys are stored in plain text in localStorage. Any script on the same origin can read them; clearing site data removes them. No key is sent to your backend.
- The provider must accept browser requests (CORS). Providers that don't need a compatible gateway you run.
- Browsers can't launch stdio MCP servers; expose them over Streamable HTTP.
- Authenticating users and authorizing tool calls is the MCP server's job. Supply credentials through `headers`.
- Tools run as soon as the model calls them; there is no approval step. Don't expose tools with effects the user hasn't agreed to.
- Use one `AskAI` or `mountAskAI` per `storageKey`: two mounted with the same key overwrite each other's conversations.

## Project layout

- `frontend/byok/`: the library (`index.ts` lists the public API).
- `frontend/App.tsx`, `frontend/demo/`, `frontend/style.css`: the demo page and its styles.
- `backend/`: the demo MCP server (Fastify, `/api/mcp`, `/health`, static files).
- `tests/`: unit tests (agent loop over a real MCP transport, storage, history, the workspace and its sandbox, images, the demo backend's origin rule). `e2e/`: Playwright tests of the demo.
