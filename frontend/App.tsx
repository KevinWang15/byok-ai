import { useState } from 'react'
import { MessagePrimitive, ThreadPrimitive } from '@assistant-ui/react'
import { AskAIProvider, MarkdownText, useAskAI } from './byok'

import { DemoAssistant } from './demo/DemoAssistant'
import { DemoIcon } from './demo/DemoIcon'

const servers = [{ id: 'docs', name: 'Docs and time', url: '/api/mcp' }]

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
function CustomMarkdownText() {
  return <MarkdownText components={{
    h2: ({ children }) => <h2 data-demo-heading="custom">{children}</h2>,
    a: ({ href, children }) => <a href={href} target="_blank" rel="noopener noreferrer">{children}</a>,
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
      <section id="how-it-works" className="demo-features" aria-label="How it works">
        <article><span className="demo-feature-number">01</span><div><h2>Choose a provider.</h2><p>Connect OpenAI, Anthropic, Gemini, or a compatible endpoint using your own credentials.</p></div></article>
        <article><span className="demo-feature-number">02</span><div><h2>Connect MCP tools.</h2><p>The browser-side agent discovers and calls tools exposed by your backend.</p></div></article>
        <article><span className="demo-feature-number">03</span><div><h2>Resume saved conversations.</h2><p>Provider settings, API keys, conversation history, and drafts are stored in localStorage.</p></div></article>
      </section>
      <section className="demo-integration" id="integration">
        <div><span className="demo-eyebrow">UNSTYLED CORE · COMPOSABLE UI</span><h2>Style and compose<br />the chat interface.</h2><p>Reuse provider setup, chat, history, and tool rendering, or supply your own components. The core ships without CSS.</p><a href="#sandbox">Try the headless example <DemoIcon name="arrow" /></a></div>
        <div className="demo-code"><div className="demo-code-header"><span><span className="demo-code-dot" /> YourPage.tsx</span><button onClick={async () => { try { await navigator.clipboard.writeText(snippet); setCopied(true); setCopyError(false) } catch { setCopyError(true) } }}>{copied ? 'Copied ✓' : 'Copy code'}</button></div><pre><code>{snippet}</code></pre>{copyError && <p role="status">Select the code above to copy it.</p>}<div className="demo-code-foot">React · assistant-ui · Vercel AI SDK · Headless UI</div></div>
      </section>
      <AskAIProvider mcpServers={servers} storageKey="byok-ai:headless-demo"><HeadlessExample /></AskAIProvider>
      <SharedConnectionExample />
    </main>
    <footer className="demo-footer"><a className="demo-logo" href="#"><DemoIcon name="sparkle" size={16} /> byok / ai</a><span>React component library</span><span>Browser-side agent · MCP backend</span></footer>
    <DemoAssistant />
  </div>
}
export default function App() {
  return <AskAIProvider mcpServers={servers} workspace images><DemoContent /></AskAIProvider>
}
