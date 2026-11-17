# byok-ai

An embeddable AI assistant for React apps where users bring their own API key. The agent loop (AI SDK) runs in the browser: it calls the user's chosen provider directly and uses tools from your MCP servers and from the page itself. Components are unstyled Headless UI and assistant-ui primitives; the library ships no CSS.

## Run the demo

Requires Node 24+ and npm 11+.

```sh
npm ci
npm run dev          # demo MCP API on :3000 and Vite on :5173
npm run check        # lint, typecheck (incl. tests and e2e), build, unit tests
npm run test:e2e     # Playwright, Chromium (npx playwright install chromium)
npm run build:lib    # dist/lib: the package's code and type declarations (npm pack runs it)
```

Open http://127.0.0.1:5173, click Ask AI, choose a provider and paste a key. The demo MCP server offers `search_docs` and `get_current_time`, and the demo assistant has the workspace and images on. If port 3000 is taken: `PORT=3019 API_PROXY_TARGET=http://127.0.0.1:3019 npm run dev`. `npm run build && npm start` serves the built page and `/api/mcp` from one origin. Tests use simulated providers and never call a real one.

## Embed

```sh
npm install @kevinwang15/byok-ai react react-dom @assistant-ui/react @headlessui/react ai markora markora-extension-components
```

The package is an ES module for bundlers (tested with Vite). Its peer dependencies are the packages your app shares with it: React, the two UI libraries its components are built on, `ai` (whose types custom providers and page tools use), and Markora, which renders answers and whose stylesheets your app imports (see Custom UI). Install them at the versions in its `package.json`. The unscoped npm package named `byok-ai` is a different project.

```tsx
import { AskAI } from '@kevinwang15/byok-ai'

const servers = [{ id: 'docs', name: 'Docs', url: '/api/mcp' }]

export function Page() {
  return <AskAI mcpServers={servers} storageKey="my-app:assistant" />
}
```

The package has three more entries, for code that runs the assistant's parts without its React UI:

| Import | Holds |
| --- | --- |
| `@kevinwang15/byok-ai/agent` | The agent loop without React: `createBrowserAdapter`, `answerComponentInstructions`, `memoryConversationFiles` (a workspace kept in memory), the limits and the types. For a job in the page that answers without a chat, a worker, or Node (evaluations, tests). Outside a page, give MCP servers absolute URLs. |
| `@kevinwang15/byok-ai/connection` | The saved provider connection, to read and follow without loading React or the agent: `loadConnection(key)`, `subscribeConnection(key, listener)`, `sameConnection(a, b)` and `defaultConnectionKey(storageKey)`. |
| `@kevinwang15/byok-ai/script-engine` | `inProcessScriptRunner`, which runs workspace scripts in the calling thread, for Node, where there are no workers. Pass it as `workspace.run` to `createBrowserAdapter`. The engine is bundled into this entry alone. A run ends at the time limit, but Stop can't end it sooner. |

The main entry also exports the `agent` and `connection` names (not `inProcessScriptRunner`, to keep the engine out of it), and code shared between entries is loaded once: a connection change saved by an assistant reaches `subscribeConnection` from either entry.

`AskAI` renders a trigger button and a modal dialog with provider setup, chat, history and a tools list. On a page that does not otherwise use React, mount it into an element:

```ts
import { mountAskAI } from '@kevinwang15/byok-ai'

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
| `pageContext` | `false` | Lets the user add elements of the page to a message, for the model to read (see Page context). |
| `pageReaders` | `{}` | Functions page sources call by name, for data the page holds (see Page context). |
| `answerComponents` | `[]` | Components the model may place in answers, such as charts (see Answer components). |
| `componentInstructions` | `true` | Tells the model about `answerComponents`, after `systemPrompt`. |
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
import { AskAI, defaultProviders, type ProviderFormProps, type ProviderPreset } from '@kevinwang15/byok-ai'

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
import { AskAI } from '@kevinwang15/byok-ai'

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

Files live in the origin private file system (OPFS) under `<storageKey>/<conversation id>/files/`: the storage key is the top folder, so apps on one origin keep their files apart, as they do their localStorage keys. They are kept across reloads, never uploaded, and deleted with their conversation. Names are flat (letters, digits, `.`, `-`, `_`). A file holds up to 8 MB, a conversation 200 files and 64 MB (`WORKSPACE_LIMITS`). The tools page lists the open conversation's files, and `useAskAI().workspace` reads them.

Scripts run in QuickJS, a separate JavaScript engine compiled to WebAssembly, in a worker started for each run. They see only the files and `console`: no network, DOM, storage, timers or imports. A run is stopped after 10 seconds or at 256 MB of memory (`SCRIPT_LIMITS`), and Stop ends it at once. A script works on a copy, and its writes are saved only if it finishes without an error. The worker and the engine are in a chunk of their own, loaded when the first script runs. Your bundler emits it like any dynamically imported module. A Content-Security-Policy must allow three things: `worker-src blob:` (the worker starts from a `blob:` URL), `connect-src data:` (the engine's WebAssembly is fetched from a `data:` URL) and `script-src 'wasm-unsafe-eval'` (to compile it).

The tools are named `workspace__…`, so with `workspace` on, no MCP server may have the id `workspace`.

Browsers offer OPFS only in secure contexts: HTTPS, or `localhost`. On a page served over plain HTTP from another host, `workspace` and `images` have no effect: no workspace tools, no attach button. `browserFilesAvailable()` says which applies, so a system prompt can mention the workspace only when it is there.

## Images

With `images`, and a provider whose preset `acceptsImages`, the user can attach images to a message: with the attach button, by pasting into the message box, or by dropping them on the composer. A message holds up to 4 (`IMAGE_LIMITS`), of up to 20 MB each. Each is prepared when it is added: an image whose longer edge is over 1,568 px, or that is not PNG, JPEG or WebP, is scaled and encoded as PNG (PNG sources) or JPEG. A file the browser can't read, or one too many, is refused with a message where answer errors show.

Sent images are kept with their conversation in OPFS (`<storageKey>/<conversation id>/images/`), not in localStorage; the message records only each image's id, name and type. Every later turn sends them to the model again. A provider that doesn't accept images gets a note in their place, as does an image that is no longer stored. Deleting a conversation deletes its images. Images attached but not sent are not saved: they are dropped on reload or when another conversation opens.

## Page context

With `pageContext`, the user can add elements of the page to a message, and the model reads their data. **Add from page** works like a browser's element inspector. The innermost element under the pointer that can be added is highlighted, and a click adds it.

Elements can nest, and any of them can be added: the inner one, the outer one, or both, each from its own pick. The label above the highlight shows the highlighted element's description. When there is an outer or inner element, the label also has ↑ or ↓ buttons, whose names give that element's description. Choose the level in any of these ways:

- Press ↑ and ↓, or click the label's ↑ and ↓, to move to the outer or inner element. The label stays where it is, so the buttons can be clicked again.
- Press Tab and Shift+Tab to go through every addable element in page order, a parent before its children.

A click on the highlighted element or on the label's description, or Enter, adds the highlighted element. Escape or a right-click cancels. A message holds up to 8 (`PAGE_CONTEXT_LIMITS`). The composer shows "2 elements", which opens their list with remove buttons. Each one is marked on the page with a border, and a remove button at its top right, while the composer is visible.

Only elements the host describes can be added. Any framework can write the attributes (`PAGE_CONTEXT_ATTRIBUTES`); `pageContextAttributes(description, source)` and `pageContextData(description, text)` build them:

| Attribute | Holds |
| --- | --- |
| `data-ai-context` | Required. What the element is, for the user and the model: "Requests per hour, last 24 hours". |
| `data-ai-context-data` | Optional. The element's data as text. Fine for small data; it sits in the DOM. |
| `data-ai-context-source` | Optional. Where the element's data is, as JSON (`PageSource`), read when the model reads the element. |

An element has at most one of the last two. With neither, its description is all there is. An element with both can't be added: the picker passes over it, and the console says why, once. Reading an element gives only its own data, never that of the elements inside it.

A source is data, never code. It is one of:

- `{ "mcp": "serverId__toolName", "params": { … } }`: a call of one of the answer's MCP tools, through the same connection and headers as the model's calls. It gives the tool's structured content, or its text when it has none (read as JSON when the text is JSON, as tools often return it), and fails when the tool reports an error.
- `{ "reader": "name", "args": … }`: a call of one of the host's `pageReaders`, for data the page holds that no tool computes.
- An object or array of sources: a panel's parts, at any depth. Every other JSON value is kept as it is.

An object is a call when its keys are `mcp` (a string) and maybe `params`, or `reader` (a string) and maybe `args`; any other object holds parts. All of a source's calls start together. A part that fails becomes `{ "error": "…" }` in its place, so the other parts still arrive. A source that is one call fails as a whole. A read may take 60 seconds, its calls included, and Stop stops the answer from waiting for it.

```tsx
import { pageContextAttributes, pageContextData } from '@kevinwang15/byok-ai'

<section {...pageContextAttributes(`Overview, ${rangeName}`, {
  totals: { mcp: 'stats__overview', params },
  byModel: { mcp: 'stats__breakdown', params: { ...params, dimension: 'model' } },
  selection: { reader: 'selectedRows', args: { table: 'models' } },
})}>…</section>
<span {...pageContextData('Selected team', team.name)}>{team.name}</span>
```

A reader is a function in your code, passed as `pageReaders`: `(args, { element, mcp, signal }) => value`. It gets the source's `args`, the element being read, `mcp(name, params)` for tool calls of its own, and the answer's abort signal, and may return a promise. Each read uses the latest `pageReaders` given. A source naming a reader the page doesn't offer says so.

```tsx
<AskAI pageContext pageReaders={{ selectedRows: ({ table }) => selection.rows(table) }} />
```

The message tells the model which elements were added. For each one it gives the id, the description, and the descriptions of the described elements it is inside, recorded when it was picked:

```text
The user added 2 elements from the page to this message. Read the data of the ones you need with page__read_element:
- 3f…: "Overview"
- 9a…: "Requests per hour" (inside "Overview")
```

The data is read later, when the model calls `page__read_element` with an id, so an element whose description says enough costs nothing. The data is read from the page as it is at that moment. The result is saved with the conversation like any tool's, so later turns and reloads keep what was read.

A read gives the model up to 20,000 characters of JSON (`PAGE_CONTEXT_LIMITS.resultChars`). Beyond that, the model gets the start of the data and its size. With `workspace` on, it is told to save the read with `workspace__save_tool_result`, which saves all of it to a file to compute over.

An id names the element that was picked, while that element is in the document. An element that has been removed, or rendered again as a new node, is no longer on the page, and the model is told so. Keep the elements a user may add mounted while the conversation is about them. Elements not yet sent are dropped on reload or when another conversation opens, as images are.

The tools are named `page__…`, so with `pageContext` on, no MCP server may have the id `page`. The default `AskAIPanel` is a modal dialog, so it closes while the user chooses an element and opens again afterwards.

The picker and the marks ship no CSS, apart from what places them. Style them by attribute:

- `page-picker` covers the viewport. Inside it are `page-picker-highlight`, `page-picker-label` and `page-picker-hint` (a status line).
- The label holds `page-picker-outer` (↑), `page-picker-description` and `page-picker-inner` (↓). Each button is `hidden` when there is no element in its direction.
- Each `page-mark` is a fixed box over its element that lets the pointer through. It holds `page-mark-label` and `page-mark-remove`. Give marks a `z-index` below your panel's.
- A mark whose element is inside another marked element is `data-nested`. It is also `data-crowded` when its top is within its label's height of that element's top, so the two labels and remove buttons would overlap. Move a crowded mark's label and button inside its border.
- The composer's list is `page-elements`, with `page-elements-summary` and one `page-element` per element. Each holds its description, a `page-element-place` naming the elements it is inside (when it is inside any), and `page-element-remove`.

```css
[data-byok="page-picker-highlight"] { border: 2px solid #7c5cbf; background: #7c5cbf22; }
[data-byok="page-picker-label"], [data-byok="page-picker-hint"] { background: #222; color: #fff; padding: 4px 8px; }
[data-byok="page-mark"] { z-index: 40; border: 2px dashed #7c5cbf; }
[data-byok="page-mark-label"] { position: absolute; bottom: 100%; left: 0; }
[data-byok="page-mark-remove"] { position: absolute; top: -10px; right: -10px; }
[data-byok="page-mark"][data-crowded] [data-byok="page-mark-label"] { top: 4px; bottom: auto; left: 4px; }
[data-byok="page-mark"][data-crowded] [data-byok="page-mark-remove"] { top: 4px; right: 4px; }
```

## Answer components

`answerComponents` lets answers show more than Markdown: charts, cards, whatever your app defines. The model writes one as a fenced block naming it, with its props as one JSON object, and the answer renders your component in its place:

````markdown
Error rates rose this week:

```component:stat-card
{"label": "Failed requests", "value": "4.2%", "note": "Up from 1.1%"}
```
````

```tsx
import { AskAI, defineAnswerComponent } from '@kevinwang15/byok-ai'

const statCard = defineAnswerComponent<{ label: string; value: string; note?: string }>({
  name: 'stat-card',
  label: 'Figure',
  description: 'One figure that matters, with a short label and an optional note.',
  schema: { type: 'object', required: ['label', 'value'], properties: { label: { type: 'string' }, value: { type: 'string' }, note: { type: 'string' } } },
  example: { label: 'Open issues', value: '12' },
  parse: value => {
    const props = value as { label?: unknown; value?: unknown; note?: unknown }
    if (typeof props.label !== 'string' || typeof props.value !== 'string') throw new Error('label and value are text')
    return { label: props.label, value: props.value, ...(typeof props.note === 'string' ? { note: props.note } : {}) }
  },
  render: ({ props }) => <figure><figcaption>{props.label}</figcaption><strong>{props.value}</strong>{props.note && <span>{props.note}</span>}</figure>,
})

export const Page = () => <AskAI answerComponents={[statCard]} />
```

An `AnswerComponent` has a `name` (lower-case kebab case), a `label` for people, a `description`, a JSON Schema `schema` and an `example` for the model, `parse`, which checks props and returns them (or throws), and `render`, a React component that receives `props`. The system prompt gets a section that lists them with their schemas and examples (`answerComponentInstructions(components)` returns it, for a prompt you build yourself; `componentInstructions: false` leaves it out). Components render in your React tree, so they see its context.

Props are model output, and tool results can steer it: check them in `parse`, and render them as text, never as HTML or as addresses to load. A component with props that don't parse, or one the app doesn't define, shows a short note in its place. While an answer streams, a component whose block is still open shows as `label…` until it closes.

The fence is the component syntax of [Markora](https://github.com/KevinWang15/markora)'s components extension, which renders the answers (see Custom UI), so documents that embed the same components read the same way.

## Custom UI

`AskAIProvider` holds state and the assistant-ui runtime and renders no DOM. Inside it, `useAskAI()` returns `title`, `providers`, `mcpServers`, `clientTools` (names), `workspace` (the open conversation's files, when on), `images` (whether images can be attached now), `loadImage(id)`, `open`/`setOpen`, `page`/`setPage` (`'chat' | 'settings' | 'history' | 'tools'`), `connection`, `connect(provider, values)` (returns an error string or `undefined`), `disconnect()`, `conversations`, `activeConversation`, `newConversation()`, `selectConversation(id)`, `deleteConversation(id)` (immediate; confirm first), `busy`, `error`, `storageError` and `runtime`. Send with `runtime.thread.append(text)` and stop with `runtime.thread.cancelRun()`. Changing provider, page or conversation is ignored while `busy`.

Compose the parts you need: `AskAITrigger` and `AskAIPanel` (native button and div props), `AskAISetup`, `AskAIChat`, `AskAIHistory`, `AskAITools`, `AskAIMessageContent`, `AskAIMessageActions`, or `AskAIWidget` for the full default UI. For page context: `AskAIAddFromPage` (renders nothing while `pageContext` is off), `AskAIComposerElements` (the composer's elements and their marks on the page) and `AskAIMessageElements` (a user message's), each taking `summary(count)` for the "2 elements" text; `useAskAI()` also gives `pageContext`, `picking` and `pickFromPage()`. For images in a custom composer or message: `AskAIAddImage` (the attach button; renders nothing while images can't be attached), `AskAIComposerImages` (attached images with remove buttons), `AskAIMessageImages` (a user message's images), and `useAskAIImage()` for your own thumbnail; wrap the composer's input in `ComposerPrimitive.AttachmentDropzone` for dropping. `createBrowserAdapter` is the assistant-ui `ChatModelAdapter` behind the runtime, for hosts that build their own; it uses `systemPrompt` as given, so add `answerComponentInstructions(components)` to it yourself.

```tsx
import { AskAIChat, AskAIHistory, AskAIPanel, AskAIProvider, AskAISetup, AskAITrigger, useAskAI } from '@kevinwang15/byok-ai'

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

`MarkdownText` is the default `Text`. It renders the current assistant-ui text part with [Markora](https://github.com/KevinWang15/markora), read only: GitHub-flavored Markdown and the provider's `answerComponents`, with raw HTML shown as text. Images in an answer are never loaded: each shows as a placeholder with its description, since tool results can carry text other people wrote, and an answer steered into `![](https://other.site/?d=…)` would send the user's data there the moment it loaded. Links are plain anchors to the address `resolveLink(href)` returns for the one written (default: the same), or text when it returns null; the browser's own link behavior (middle-click, "Open in new tab", the status bar) goes there too, so return the address as your app serves it (under its base path, say). `onOpenLink(href, event)` is called with that address when a link is clicked, and `event.preventDefault()` lets you handle it (in-app navigation, a new tab); Ctrl/Cmd-click is Markora's, which opens it in a new tab. It also takes `components` (in place of the provider's), `className` and `label` (the accessible name, default "Answer"). `Markdown` renders any text the same way outside a chat (`markdown`, and `streaming` while it is still being written), for answers you show elsewhere. Like the rest of the library it ships no CSS, but Markora needs its stylesheets for parts of the layout (visually hidden status text, image placeholders, scrolling wide tables), so import them once in your app, with `markora` and `markora-extension-components` installed as direct dependencies (they are peer dependencies):

```ts
import 'markora/styles.css'
import 'markora-extension-components/styles.css'
```

They are scoped to Markora's element. Style the rest by `[data-byok="markdown"]` and Markora's `mdw-` classes (an answer component sits in `.mdw-component`, under a `.mdw-component-header` naming it, which you may hide).

Default components carry `data-byok` attributes for styling (`root`, `trigger`, `dialog`, `panel`, `setup`, `chat`, `messages`, `message` with `data-role`, `composer`, `tool`, `markdown`, `markdown-pending`, `message-actions`, `history`, `tools`, `image` with `data-missing`, `composer-images`, `message-images`, `add-image`, `add-from-page`, the page context parts above, and others). The dialog is portalled to `document.body`, so style it by attribute or class rather than ancestor selectors. `AskAIHistory` takes `title`, `description` and `empty` to replace its copy.

`usePanelLayout({ storageKey, margin?, minSize? })` gives a floating panel window behavior: move by dragging the header, resize from any edge or corner, arrow keys on the header or a handle (Shift for bigger steps), Escape to cancel a move, and `toggleMaximized()`. Spread `panelProps` on the panel, `headerProps` on its header and `handleProps(edge)` (`'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw'`) on focusable handles, and apply `style`. It sets `--byok-panel-width`/`--byok-panel-height` (px) once resized and `--byok-panel-x`/`--byok-panel-y` (0 to 1 of the free space) once moved; your CSS turns them into placement. It also returns `maximized`, `positioned`, `resizing` and `moving`.

```tsx
import { AskAIChat, AskAIPanel, usePanelLayout } from '@kevinwang15/byok-ai'

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
- A page source names tools and readers, and never runs code from the page: it needs nothing from a Content-Security-Policy. Still, markup from other people (comments, rendered documents) must not carry `data-ai-context*` attributes, because a source in it could call your tools with the reader's access when the user adds it. Sanitizers such as DOMPurify keep `data-*` attributes by default, so remove these. The model can read only elements the user added, and can't change their sources.
- Treat answers as untrusted: tool results can carry other people's text. Images in answers aren't loaded (see Custom UI); links need a click. A custom `img` component, or rendering answers as HTML, undoes that.
- Use one `AskAI` or `mountAskAI` per `storageKey`: two mounted with the same key overwrite each other's conversations.
- Apps on one origin (paths of a shared host) share localStorage and OPFS. Give each app's `storageKey`, `connectionKey` and `usePanelLayout` key the app's own prefix (`my-app:assistant`); the library stores nothing under any other name. The browser does not keep such apps apart from each other's scripts.

## Project layout

- `frontend/byok/`: the library (`index.ts` lists the public API).
- `frontend/App.tsx`, `frontend/demo/`, `frontend/style.css`: the demo page and its styles.
- `backend/`: the demo MCP server (Fastify, `/api/mcp`, `/health`, static files).
- `tests/`: unit tests (agent loop over a real MCP transport, storage, history, the workspace and its sandbox, images, page context, the demo backend's origin rule). `e2e/`: Playwright tests of the demo.
