# BYOK AI

An unstyled component library built with Headless UI, assistant-ui, and a Vercel AI SDK agent loop running entirely in the browser. Generated from KevinWang15/ts-fullstack-starter. React + Vite + TypeScript + Fastify, with the database/Prisma scaffolding removed.

## Run the demo

Requires Node 24+ and npm 11+.

```sh
npm ci
npm run dev
```

Open http://127.0.0.1:5173 and click **ASK AI**. Select a provider, supply your API key and model, and start chatting. The connection, history, current conversation, and unsent chat drafts are restored from localStorage on reload. The demo MCP server provides documentation search and current-time tools. Try “Search the docs for adding a provider”.

If your environment already defines PORT or has port 3000 in use:

```sh
PORT=3019 API_PROXY_TARGET=http://127.0.0.1:3019 npm run dev
```

```sh
npm run check        # lint, type checks, app/library builds, agent + MCP tests
npm run test:e2e     # Chromium: setup, streaming, history, settings, reload, deletion, mobile
npm run build
PORT=3000 npm start  # serves the built page and /api/mcp from one origin
```

Install Chromium with `npx playwright install chromium` if it isn't present.

## Embed

Inside this project:

```tsx
import { AskAI } from './byok'

const servers = [
  { id: 'workspace', name: 'Workspace', url: '/api/mcp' },
]
export function Page() {
  return <AskAI mcpServers={servers} storageKey="my-app:chats:v1" />
}
```

The library imports and emits **no CSS**. Run `npm run build:lib` to produce `dist/lib/index.js` and TypeScript declarations. For another bundled app, install this project via a local path or `npm pack`, then:

```tsx
import { AskAI } from 'byok-ai'
```

For a page that does not otherwise use React, use the exported mount helper in your JavaScript bundle:

```ts
import { mountAskAI } from 'byok-ai'
const assistant = mountAskAI(document.getElementById('assistant')!, {
  mcpServers: [{ id: 'workspace', name: 'Workspace', url: '/api/mcp' }],
})
// When the host page removes the widget:
assistant.unmount()
```

This is an ES-module library for bundlers, not a standalone CDN script. Dependencies are external in the library build. Consumers own all styling and placement. Mount once per storage namespace.

## Page tools and shared connections

MCP servers suit tools the server answers. Tools that act on the page itself, such as editing a draft the user has open, run in the browser: pass them as `clientTools`, AI SDK `tool()` definitions keyed by name. They are offered beside the MCP servers' tools, under the names given (which may not contain `__`, the MCP namespace separator), and their calls and results appear in the chat like any other tool's.

```tsx
import { tool } from 'ai'
import { z } from 'zod'

const clientTools = {
  set_title: tool({
    description: 'Rename the draft',
    inputSchema: z.object({ title: z.string() }),
    execute: async ({ title }) => { draft.rename(title); return { ok: true } },
  }),
}
<AskAIProvider clientTools={clientTools} mcpServers={servers} storageKey="my-app:editor:v1" />
```

Keep the object stable between renders: read changing state through a ref.

Several assistants on one site, each with its own prompt, tools and conversations, can share one provider connection with `connectionKey`: the connection is saved under that key instead of `storageKey`, and each assistant reads it when it mounts. Mount them one at a time, or remount the others after a connection changes.

## Headless UI and custom composition

The optional default UI uses `@headlessui/react`:

- `Dialog`, `DialogPanel`, and `DialogTitle` for the portalled assistant panel, keyboard dismissal, focus trapping and restoration.
- `Button` for the launcher, navigation and actions.
- `Fieldset`, `Legend`, `Field`, `Label`, and `Input` for provider setup.
- `Disclosure`, `DisclosureButton`, and `DisclosurePanel` for tool-call details.

The dialog is modal while open; Escape and outside clicks dismiss it. The runtime remains mounted when it closes. Headless UI supplies accessibility behavior, not a visual theme. Its own necessary accessibility/visibility attributes and inline styles may still be present.

`AskAIProvider` renders no application DOM and supplies both the BYOK context and assistant-ui runtime. Build an entirely custom interface using `useAskAI()`:

```tsx
import { Button } from '@headlessui/react'
import { AskAIProvider, useAskAI } from 'byok-ai'

function MyControls() {
  const { busy, newConversation, disconnect, runtime } = useAskAI()
  return <>
    <Button disabled={busy} onClick={newConversation}>New conversation</Button>
    <Button disabled={!busy} onClick={() => runtime.thread.cancelRun()}>Stop</Button>
    <Button disabled={busy} onClick={disconnect}>Disconnect</Button>
  </>
}

<AskAIProvider mcpServers={servers}>
  <MyControls />
  {/* Your provider form and assistant-ui thread components */}
</AskAIProvider>
```

The hook exposes `connection`, `connect(provider, values)`, `disconnect()`, `providers`, `mcpServers`, `clientTools` (names), `runtime`, `busy`, `error`, `storageError`, `open/setOpen`, `page/setPage`, `conversations`, `activeConversation`, `newConversation()`, `selectConversation(id)`, and `deleteConversation(id)`. Subscribe to messages with assistant-ui's `useAuiState(state => state.thread.messages)`. Sending messages uses `runtime.thread.append(text)`.

`connect` validates required preset fields and the preset's custom validator; it returns an error string on failure. Actions that change providers or conversations are blocked during a run. `disconnect` removes the provider/key from memory and localStorage while keeping conversation history and drafts. Changing `storageKey` restores the saved state of that separate namespace.

For partial customization, compose `AskAITrigger`, `AskAIPanel`, `AskAISetup`, `AskAIChat`, `AskAIHistory`, and `AskAITools` inside `AskAIProvider`. The trigger and panel accept native props such as `className`, `style`, and `children`. Alternatively, pass custom children to `AskAI` to replace its entire default UI.

`AskAIHistory` lists conversations by last update, with a preview, message count, current-chat marker, and relative timestamps (exact dates on hover). Dates refresh while the list is open. Deletion opens an unstyled Headless UI confirmation dialog; Escape, outside click, or “Keep conversation” cancels. Consumers building their own history UI should confirm before calling the immediate `deleteConversation(id)` action. Viewing a conversation does not count as new activity.

Default components expose `data-byok` attributes for consumer CSS. The demo's placement rules live exclusively in `frontend/style.scss`. Because Headless UI portals the dialog into the document body, style its data attributes or pass a class to the panel rather than relying on ancestor selectors.

## A styled consumer without a styled library

The demo composes its own shell in `frontend/demo/DemoAssistant.tsx`, instead of adding CSS to the default widget's full set of controls. The core still imports and emits no CSS.

| Library responsibility | Consumer responsibility |
| --- | --- |
| Provider connection, validation, and persistence | Provider branding and setup layout |
| Conversation selection, streaming, cancellation | Header navigation and visual hierarchy |
| assistant-ui message scopes, Markdown, copy and regenerate actions | Avatars, bubbles, typography, tables, action bar styling |
| Tool execution and actual status/results | Friendly tool names and progressive disclosure |
| Headless UI dialog accessibility | Panel size, responsive layout, colors, icons |

Use `AskAIProvider` for state and runtime, `AskAIPanel`/`AskAITrigger` for the accessible dialog, and `AskAIChat` to retain chat lifecycle behavior with consumer-owned layouts:

```tsx
import { MessagePrimitive } from '@assistant-ui/react'
import { AskAIChat, AskAIMessageContent } from 'byok-ai'

function MyUserMessage() {
  return <MessagePrimitive.Root className="user-message" data-role="user">
    <span>You</span>
    <div className="user-bubble"><AskAIMessageContent /></div>
  </MessagePrimitive.Root>
}

<AskAIChat components={{ UserMessage: MyUserMessage }} />
```

These optional slots work on `AskAIChat`, `AskAIWidget`, and `AskAI`:

- `Text`: replace text/Markdown rendering.
- `ToolFallback`: replace individual tool rendering.
- `UserMessage` and `AssistantMessage`: replace the entire message layout inside its assistant-ui message scope.
- `Empty`: replace the empty conversation view; suggestions can use `ThreadPrimitive.Suggestion`.
- `Composer`: replace the composer using `ComposerPrimitive.Root/Input/Send/Cancel`.

`AskAIMessageActions` is the assistant message's action bar: **Copy** (the message text) and **Regenerate** (asks the model again from the preceding user message and keeps the new answer). The default assistant message includes it. It hides while a response runs, shows on the latest answer and on earlier ones while hovered or focused, and disables Regenerate without a provider. It exposes `data-byok="message-actions"`, `message-copy` (with `data-copied` after copying) and `message-regenerate`. Pass `copy`, `copied` and `regenerate` to replace the labels, for example with icons, and native props such as `className`. Regenerating replaces the saved answer; the earlier one is not kept as a branch.

`AskAIMessageContent` renders text and tools with the enclosing chat's `Text` and `ToolFallback` overrides. Use it in custom message layouts to preserve those overrides. Default message wrappers expose `data-byok="message"` and `data-role="user|assistant|system"`. Define slot components at module scope to avoid remounting them during streaming.

For more control, custom message slots can use assistant-ui primitives directly. The demo uses `MessagePrimitive.GroupedParts` with `groupPartByType` to collapse adjacent tool calls into one disclosure, keeping their position in the response. Actual statuses determine whether a group is running, complete, or needs attention. Individual inputs/results remain available by expanding it. A slot that renders its own message parts owns its own renderer overrides.

The demo's shell keeps connection actions in settings, history on a separate view, and the composer outside the scrolling transcript. `frontend/demo/DemoProviderSetup.tsx` supplies a compact consumer-owned settings layout with save/cancel actions and password visibility controls, using the public provider contracts (including custom forms) and `connect` validation. The library’s default `AskAISetup` remains unstyled. Demo icons come from [Lucide React](https://lucide.dev/guide/react/) through `frontend/demo/DemoIcon.tsx`; the dependency is confined to the demo. Icon buttons have accessible labels and titles. Styling stays in `frontend/style.scss`; the public component APIs retain unstyled defaults for consumers that prefer a ready-made composition.

`usePanelLayout({ storageKey, margin?, minSize? })` is headless window geometry for a floating panel: move it by dragging a header, resize it from its top and left edges, and maximize it, with mouse, touch and arrow keys (Shift for larger steps; Escape cancels a move). Spread `panelProps` on the panel, `headerProps` on its header and `handleProps('width' | 'height' | 'both')` on resize handles inside it, and apply `style`. It sets `--byok-panel-width` and `--byok-panel-height` (pixels) once resized and `--byok-panel-x` and `--byok-panel-y` (0 to 1 of the free space) once moved, and saves them with the maximized state under `storageKey`. `maximized`, `positioned`, `resizing` and `moving` report its state, and `toggleMaximized()` switches. Where the panel sits, how big it is before it is resized, and how it looks when maximized are the consumer's CSS. Resizing never remounts the conversation or interrupts a response.

The demo uses it: drag the header to move the window; its controls remain independently clickable. Movement stays inside the viewport and persists alongside window size. The panel resizes from its top and left edges or top-left grip; focus a resize handle and use arrow keys (Shift for larger steps) for keyboard resizing. The maximize/restore control fills the viewport with a small margin and restores the previous size. Demo window preferences are saved under `byok-ai:demo-panel:v1`.

The demo’s floating Ask AI launcher supports mouse/touch dragging and arrow-key movement (Shift for larger steps). A short drag threshold separates movement from clicks. Its position is saved under `byok-ai:demo-launcher:v1` as a fraction of the usable viewport, so it remains reachable after resizing or changing screen orientation. Clicking or pressing Enter still opens chat; the chat panel keeps its own size and placement.

### Demo animation

The demo uses [thinking-orbs](https://github.com/Jakubantalik/thinking-orbs) through `frontend/demo/DemoOrb.tsx`. It is a development dependency used by the demo build; neither the core source nor the library output imports it.

The demo maps its `idle` state to thinking-orbs' rotating particle globe with a slower speed and its search scan disabled. The header and active response follow the actual assistant-ui runtime: working while awaiting output, searching during search tools, connecting during other tool calls, and composing while text arrives. Completion or cancellation returns to the idle globe; old message avatars are paused. Small orbs use the library’s React widget. Larger preview and welcome orbs use its drawing engine through `frontend/demo/ScaledOrb.tsx`, with a canvas sized to their display dimensions and screen pixel density to avoid bitmap upscaling. Both paths respect reduced motion and pause animation offscreen or in hidden tabs. All orb presentation stays in the demo.

## Markdown rendering

`AskAI`, `AskAIWidget`, and `AskAIChat` render Markdown by default using `@assistant-ui/react-markdown` and `remark-gfm`. Headings, lists, links, emphasis, fenced code, tables, strikethrough, and task lists work without extra configuration:

```tsx
<AskAI mcpServers={servers} />
```

This renders semantic HTML while remaining unstyled. Supply typography and code styles in your application. Fenced code is not syntax-highlighted by default. Raw HTML is skipped and the default URL filtering remains enabled.

Override the text renderer through `components.Text` on any of the three components. Define renderers outside the parent component to keep their identity stable:

```tsx
import { AskAI, MarkdownText } from 'byok-ai'

function MyMarkdown() {
  return <MarkdownText
    className="chat-markdown"
    components={{
      h2: ({ children }) => <h2 className="section-heading">{children}</h2>,
      a: ({ href, children }) => (
        <a href={href} target="_blank" rel="noopener noreferrer">{children}</a>
      ),
    }}
  />
}

<AskAI components={{ Text: MyMarkdown }} mcpServers={servers} />
// Or, inside AskAIProvider:
// <AskAIChat components={{ Text: MyMarkdown }} />
```

`MarkdownText` reads the current assistant-ui text part; it must render in that context rather than directly receiving a text string. It accepts the underlying `MarkdownTextPrimitiveProps`, including `components`, `componentsByLanguage`, `remarkPlugins`, `rehypePlugins`, and `className`. GFM is included automatically. Pass `components.SyntaxHighlighter` or language-specific overrides for highlighting; additional plugins can add math support.

For a completely custom thread, use the same renderer directly with assistant-ui:

```tsx
import { MessagePrimitive } from '@assistant-ui/react'
import { MarkdownText } from 'byok-ai'

function TextPart() { return <MarkdownText /> }
function MyMessage() {
  return <MessagePrimitive.Root>
    <MessagePrimitive.Content components={{ Text: TextPart }} />
  </MessagePrimitive.Root>
}
```

To use a different Markdown library, provide a `TextMessagePartComponent` that receives `{ text }` and renders it. `components.ToolFallback` separately overrides tool-call presentation. These renderer props are UI configuration and are not saved to localStorage. Source Markdown, rather than rendered HTML, remains in conversation history and is rendered again after reload.

## Extend provider setup

Built-in presets: OpenAI, Anthropic, Google Gemini, and an OpenAI-compatible Chat Completions endpoint. Model IDs are editable.

Pass `providers` to replace the choices, or spread `defaultProviders` to extend them:

```tsx
import { createOpenAI } from '@ai-sdk/openai'
import { AskAI, defaultProviders, type ProviderPreset } from 'byok-ai'

const company: ProviderPreset = {
  id: 'company',
  name: 'Company gateway',
  description: 'Use your company-issued key.',
  defaultValues: { model: 'company-model' },
  fields: [
    { name: 'apiKey', label: 'Company key', type: 'password', required: true },
    { name: 'model', label: 'Model', required: true },
  ],
  validate: values => values.apiKey?.trim() ? undefined : 'Enter a key.',
  createModel: values => createOpenAI({
    apiKey: values.apiKey,
    baseURL: 'https://gateway.example.com/v1',
  }).chat(values.model),
}

<AskAI providers={[...defaultProviders, company]} />
```

For a fully custom form, supply `Form: ComponentType<ProviderFormProps>` instead of `fields`. The component receives `values` and `onChange(values)`; it renders inside the setup form. Use `validate` to report a blocking message. `createModel` can return any compatible AI SDK language model.

## Connect MCP servers

`mcpServers` accepts `id`, `name`, `url`, and optional `headers` (a record or an async function). Use absolute URLs when embedding on a different origin. IDs must be unique and contain letters, numbers, underscores or hyphens.

```tsx
<AskAI
  mcpServers={[
    { id: 'docs', name: 'Documentation', url: '/api/mcp' },
    {
      id: 'account',
      name: 'Account tools',
      url: 'https://tools.example.com/mcp',
      headers: async () => ({ Authorization: 'Bearer ' + await getUserMcpToken() }),
    },
  ]}
  maxSteps={8}
  maxOutputTokens={8192}
  maxToolCalls={12}
  systemPrompt="Help the user with this application. Use tools when needed."
/>
```

`maxOutputTokens` caps each model step's output (the provider's default when omitted). `maxToolCalls` caps the tool calls in one answer (unlimited when omitted): once they are spent, and always on the last step, the model is asked to answer from what it has, with tools disabled (`FINAL_STEP_INSTRUCTION` is added to the system prompt for that step). An answer that ends unfinished is never silent: when the last step stops at the output limit, or the step limit ends the loop while tools are still being called, the chat shows a notice through `error` (`INCOMPLETE_MESSAGES.length` or `.steps`; `.empty` when the model stops without writing an answer, after it has been asked once more without tools). A network failure during a response shows `CONNECTION_LOST_MESSAGE` rather than the general failure message asking the user to continue.

MCP uses Streamable HTTP. Tool discovery happens at the start of each turn. Tools are namespaced as `serverId__toolName`; the browser executes the AI SDK tool loop, feeds results back to the model, and closes MCP clients after the turn. Stop cancels model requests and MCP fetches. MCP requests have a 60-second timeout. The loop is capped (default eight steps; component accepts 1–30).

The sample backend creates a stateless MCP server for each POST. Extend `createMcpServer()` in `backend/app.ts` to register tools. It has no inference endpoint, provider secrets, chat persistence, or database.

The demo tools are public and read-only. A real MCP backend must authenticate users and authorize tool calls before exposing private data or mutations. Tools run automatically; this version does not implement per-call user approval or MCP OAuth login. Supply authenticated headers from the host application where needed. Backend credentials stay on that backend.

## Browser constraints and persistence

- Provider inference must support browser CORS. A custom endpoint also needs to accept the provider SDK's request headers and streaming format. Providers that block browser access need a separately operated compatible gateway; this backend intentionally does not proxy inference.
- Anthropic's preset explicitly sends its direct-browser-access header. Compatibility and model access still depend on the provider and account.
- A browser cannot launch stdio MCP servers. Expose those servers behind a Streamable HTTP endpoint.
- The included server defaults to same-origin access. The Vite proxy preserves the browser host. For cross-origin MCP hosting, configure `MCP_ALLOWED_ORIGINS` and configure CORS/preflight at your reverse proxy, including Authorization, Content-Type, MCP-Protocol-Version, and MCP session headers as appropriate.
- All saved user data lives in one versioned localStorage record under `storageKey`: the connected provider ID, all provider form values (including API keys, model, base URL, and custom fields), conversation histories and tool results, the selected conversation, and unsent composer drafts. Reloading restores the connection automatically. No credentials are sent to the application backend.
- The original conversation-only array format is read automatically and upgraded on the next write. Completed responses save immediately; streaming responses save periodically and on page exit. An interrupted response is restored as cancelled, rather than resuming requests automatically.
- Provider implementations, custom form components, system prompts, and MCP configuration are supplied by the host's props/code. Functions and React components are not serialized. A saved provider is resolved by its stable ID against the current `providers` array; if unavailable, setup is shown instead. Dialog visibility, current view, and incomplete provider setup forms are transient.
- Disconnect removes saved provider credentials; deleting a conversation removes its history and draft. Storage access/quota failures show a notice, and failed writes or removals may leave the previous saved data in place.
- Keys, settings, and conversations are stored in plaintext localStorage. Scripts running on the same origin can read them; clearing the browser’s site data removes them.
- Closing the bubble keeps the conversation and active request alive; use Stop to cancel. Provider changes, new chat, and history navigation are disabled while a run is active.
- Persistence stores the current linear conversation. Cross-tab synchronization, branching, attachments, cross-device history, and resumable background agents are not included.
- No fonts, icons, themes, resets, or styling dependencies are included. Markdown is rendered as semantic HTML by default, with no bundled typography or syntax-highlighting theme.

## Structure

- `frontend/byok/AskAI.tsx`: unstyled Headless UI components and assistant-ui chat primitives.
- `frontend/byok/AskAIProvider.tsx`: headless state and runtime lifecycle.
- `frontend/byok/context.ts`: public state/actions hook.
- `frontend/byok/agent.ts`: browser-only AI SDK + MCP loop and history conversion.
- `frontend/byok/providers.ts`: provider presets.
- `frontend/byok/types.ts`: public extension contracts.
- `backend/app.ts`: MCP tools and health/static serving.
- `frontend/App.tsx`: demonstration page.
- `tests/agent.test.ts`: real MCP transport with a simulated model.
- `tests/storage.test.ts`: persisted credentials, namespace isolation, legacy migration, interrupted responses, and storage failures.
- `e2e/widget.spec.ts`: browser tests with a simulated provider response.

Live inference requires your own provider key; tests do not use or charge a real provider account.

References: [Headless UI](https://headlessui.com/react/dialog), [assistant-ui LocalRuntime](https://www.assistant-ui.com/docs/runtimes/custom/local-runtime), [AI SDK MCP](https://ai-sdk.dev/docs/ai-sdk-core/mcp-tools), [AI SDK tools and loop control](https://ai-sdk.dev/docs/ai-sdk-core/tools-and-tool-calling).
