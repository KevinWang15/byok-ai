import { useState } from 'react'
import { MessagePrimitive, ThreadPrimitive } from '@assistant-ui/react'
import { AskAIComposer, AskAIError, AskAIMessages, AskAIProvider, AskAIThread, MarkdownText, pageContextAttributes, pageContextData, useAskAI } from './byok'

import { DEMO_COMPONENTS } from './demo/components'
import { DemoAssistant } from './demo/DemoAssistant'
import { DemoIcon } from './demo/DemoIcon'

const servers = [{ id: 'docs', name: 'Docs and time', url: '/api/mcp' }]

// The page's readers, for what no MCP tool knows. Step 3 of "How it works" reads this one when the
// model asks: which localStorage keys this page keeps, without their values.
const pageReaders = { storedKeys: () => Object.keys(localStorage).filter(key => key.startsWith('byok-ai:')).sort() }

function HeadlessExample() {
  const { connection, providers, connect, disconnect, runtime, busy, error } = useAskAI()
  const [key, setKey] = useState('')
  const [message, setMessage] = useState('')
  const [setupError, setSetupError] = useState('')
  return <section id="sandbox" className="demo-sandbox" aria-label="Custom headless example">
    <span className="demo-eyebrow">HEADLESS API EXAMPLE</span><h2>Build a custom interface.</h2>
    <p>This OpenAI example uses custom markup and Markdown rendering. It has its own provider settings and conversation history.</p>
    {!connection ? <form onSubmit={e => {
      e.preventDefault()
      const problem = connect(providers[0], { ...providers[0].defaultValues, apiKey: key })
      setSetupError(problem ?? '')
      if (!problem) setKey('')
    }}>
      <label>OpenAI API key <input type="password" value={key} onChange={e => setKey(e.target.value)} required /></label>
      <button>Connect</button>
      {setupError && <p role="alert">{setupError}</p>}
    </form> : <>
      <p>Connected to {connection.provider.name}. Responses appear below.</p>
      <form onSubmit={e => { e.preventDefault(); runtime.thread.append(message); setMessage('') }}>
        <label>Prompt <input value={message} onChange={e => setMessage(e.target.value)} disabled={busy} required /></label>
        <button disabled={busy || !message.trim()}>Send</button>
        <button type="button" disabled={!busy} onClick={() => runtime.thread.cancelRun()}>Stop</button>
        <button type="button" disabled={busy} onClick={disconnect}>Disconnect</button>
      </form>
      {error && <p role="alert">{error}</p>}
      <HeadlessMessages />
    </>}
  </section>
}
// Two assistants, each with its own conversations, sharing one connection: connect in either and
// both are connected.
function SharedConnectionStatus({ name }: { name: string }) {
  const { connection, providers, connect, disconnect } = useAskAI()
  const [key, setKey] = useState('')
  return <article aria-label={name}>
    <h3>{name}</h3>
    {connection ? <>
      <p>Connected to {connection.provider.name}.</p>
      <button type="button" onClick={disconnect}>Disconnect</button>
    </> : <form onSubmit={e => { e.preventDefault(); if (!connect(providers[0], { ...providers[0].defaultValues, apiKey: key })) setKey('') }}>
      <label>Shared OpenAI key <input type="password" value={key} onChange={e => setKey(e.target.value)} required /></label>
      <button>Connect</button>
    </form>}
  </article>
}
function SharedConnectionExample() {
  return <section className="demo-sandbox" aria-label="Shared connection example">
    <span className="demo-eyebrow">SHARED CONNECTION</span><h2>One key for every assistant.</h2>
    <p>These two assistants keep separate conversations under their own <code>storageKey</code> and share one provider connection through <code>connectionKey</code>. Connect or disconnect in either one.</p>
    <div className="demo-shared">
      <AskAIProvider storageKey="byok-ai:shared-demo:first" connectionKey="byok-ai:shared-demo:connection"><SharedConnectionStatus name="First assistant" /></AskAIProvider>
      <AskAIProvider storageKey="byok-ai:shared-demo:second" connectionKey="byok-ai:shared-demo:connection"><SharedConnectionStatus name="Second assistant" /></AskAIProvider>
    </div>
  </section>
}
// Links in these answers go to https sites only (anything else stays text), in a new tab, so the
// conversation stays on the page.
const httpsOnly = (href: string) => href.startsWith('https://') ? href : null
function CustomMarkdownText() {
  return <MarkdownText className="demo-custom-markdown" resolveLink={httpsOnly} onOpenLink={(href, event) => {
    event.preventDefault()
    window.open(href, '_blank', 'noopener,noreferrer')
  }} />
}
function HeadlessMessage() {
  return <MessagePrimitive.Root>
    <MessagePrimitive.Content components={{ Text: CustomMarkdownText }} />
  </MessagePrimitive.Root>
}
function HeadlessMessages() {
  return <ThreadPrimitive.Root>
    <ThreadPrimitive.Messages components={{ Message: HeadlessMessage }} />
  </ThreadPrimitive.Root>
}

// The chat's parts in a layout of the page's own, inline rather than in a dialog: the message box
// on top, under suggested questions, and the answers below it.
const SUGGESTIONS = ['Which providers can I use?', 'What time is it?']
function InlineAsk() {
  const { connection, runtime, busy } = useAskAI()
  return <AskAIThread className="demo-inline" aria-label="Inline example">
    <AskAIComposer />
    <p className="demo-inline-suggestions">Try: {SUGGESTIONS.map(question => (
      <button key={question} type="button" disabled={!connection || busy} onClick={() => runtime.thread.append(question)}>{question}</button>
    ))}</p>
    <AskAIError />
    <AskAIMessages />
  </AskAIThread>
}
function InlineExample() {
  return <section className="demo-sandbox" aria-label="Inline layout example">
    <span className="demo-eyebrow">INLINE LAYOUT</span><h2>Put the chat in the page.</h2>
    <p>The same parts as the dialog's chat, arranged by the page: a search-style box first, answers below. It shares the dialog's connection and keeps its own conversations.</p>
    <AskAIProvider mcpServers={servers} storageKey="byok-ai:inline-demo" connectionKey="byok-ai:conversations:connection"><InlineAsk /></AskAIProvider>
  </section>
}

function DemoContent() {
  const { setOpen, connection } = useAskAI()
  const [copied, setCopied] = useState(false)
  const [copyError, setCopyError] = useState(false)
  const snippet = `import { AskAI } from 'byok-ai'

const servers = [{ id: 'docs', name: 'Docs and time', url: '/api/mcp' }]

export function YourPage() {
  return <AskAI mcpServers={servers} />
}`
  return <div className="demo">
    <header className="demo-nav">
      <a className="demo-logo" href="#" aria-label="BYOK AI home"><span><DemoIcon name="sparkle" size={22} /></span>byok<span className="demo-logo-suffix">/ ai</span></a>
      <nav aria-label="Demo navigation"><a href="#how-it-works">How it works</a><a href="#integration">For developers</a></nav>
      <span className="demo-nav-badge"><i /> INTERACTIVE DEMO</span>
    </header>
    <main>
      <section className="demo-hero">
        <div className="demo-hero-copy">
          <span className="demo-eyebrow"><DemoIcon name="sparkle" size={14} className="demo-tiny-star" /> EMBEDDABLE AI CHAT FOR REACT</span>
          <h1>AI chat for<br /><span>your app.</span></h1>
          <p>An embeddable React assistant with user-supplied API keys, a browser-side agent, and tools from your MCP backend.</p>
          <button className="demo-primary" onClick={() => setOpen(true)}>Try the demo <DemoIcon name="arrow" /></button>
          <div className="demo-hero-note"><DemoIcon name="shield" size={14} /> Agent runs in the browser · Backend provides MCP tools</div>
        </div>
        <div className="demo-preview-wrap">
          <div className="demo-preview-glow" />
          <div className="demo-preview">
            <div className="demo-preview-top"><span><DemoIcon name="sparkle" size={16} /> Ask AI</span><DemoIcon name="more" size={16} /></div>
            <div className="demo-preview-scene"><div className="demo-preview-mark"><DemoIcon name="sparkle" size={56} /></div></div>
            <div className="demo-preview-copy"><span className="demo-eyebrow">ASSISTANT PREVIEW</span><h2>Chat with your model.</h2><p>Connect a provider, then search the docs<br />using this demo’s MCP tools.</p></div>
            <button className="demo-preview-input" onClick={() => setOpen(true)}><span>Open chat</span><span className="demo-preview-send"><DemoIcon name="arrow" /></span></button>
            <span className="demo-preview-foot">{connection ? `Connected to ${connection.provider.name}` : 'Provider setup required'}</span>
          </div>
          <div className="demo-floating-note"><span className="demo-status-dot" /> Bring your own API key</div>
        </div>
      </section>
      {/* Page context: the section and each step in it can be added to a message, alone or together.
          The section has only its description. Of the steps, the first carries its data in the
          markup; the second's source is a call of the demo's MCP server, and the third's a reader of
          the page's: both run when the model reads them. */}
      <section id="how-it-works" className="demo-features" aria-label="How it works" {...pageContextAttributes('How it works: the three steps of using byok-ai')}>
        <article {...pageContextData('How it works, step 1: choose a provider', 'Connect OpenAI, Anthropic, Gemini, or a compatible endpoint using your own credentials.')}><span className="demo-feature-number">01</span><div><h2>Choose a provider.</h2><p>Connect OpenAI, Anthropic, Gemini, or a compatible endpoint using your own credentials.</p></div></article>
        <article {...pageContextAttributes('How it works, step 2: connect MCP tools. Its data is what the docs say about MCP.', { mcp: 'docs__search_docs', params: { query: 'MCP' } })}><span className="demo-feature-number">02</span><div><h2>Connect MCP tools.</h2><p>The browser-side agent discovers and calls tools exposed by your backend.</p></div></article>
        <article {...pageContextAttributes('How it works, step 3: resume saved conversations', { reader: 'storedKeys' })}><span className="demo-feature-number">03</span><div><h2>Resume saved conversations.</h2><p>Provider settings, API keys, conversation history, and drafts are stored in localStorage.</p></div></article>
      </section>
      <section className="demo-integration" id="integration">
        <div><span className="demo-eyebrow">UNSTYLED CORE · COMPOSABLE UI</span><h2>Style and compose<br />the chat interface.</h2><p>Reuse provider setup, chat, history, and tool rendering, or supply your own components. The core ships without CSS.</p><a href="#sandbox">Try the headless example <DemoIcon name="arrow" /></a></div>
        <div className="demo-code" {...pageContextData('The integration code example, YourPage.tsx', snippet)}><div className="demo-code-header"><span><span className="demo-code-dot" /> YourPage.tsx</span><button onClick={async () => { try { await navigator.clipboard.writeText(snippet); setCopied(true); setCopyError(false) } catch { setCopyError(true) } }}>{copied ? 'Copied ✓' : 'Copy code'}</button></div><pre><code>{snippet}</code></pre>{copyError && <p role="status">Select the code above to copy it.</p>}<div className="demo-code-foot">React · assistant-ui · Vercel AI SDK · Headless UI</div></div>
      </section>
      <AskAIProvider mcpServers={servers} storageKey="byok-ai:headless-demo"><HeadlessExample /></AskAIProvider>
      <SharedConnectionExample />
      <InlineExample />
    </main>
    <footer className="demo-footer"><a className="demo-logo" href="#"><DemoIcon name="sparkle" size={16} /> byok / ai</a><span>React component library</span><span>Browser-side agent · MCP backend</span></footer>
    <DemoAssistant />
  </div>
}
export default function App() {
  return <AskAIProvider mcpServers={servers} workspace images pageContext pageReaders={pageReaders} answerComponents={DEMO_COMPONENTS}><DemoContent /></AskAIProvider>
}
