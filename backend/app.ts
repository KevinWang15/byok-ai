import Fastify from 'fastify'
import staticFiles from '@fastify/static'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { z } from 'zod'

export function createMcpServer() {
  const server = new McpServer({ name: 'byok-demo', version: '1.0.0' })
  server.registerTool('get_current_time', {
    description: 'Get the current time in an IANA timezone.',
    inputSchema: { timezone: z.string().default('UTC') },
    annotations: { readOnlyHint: true },
  }, async ({ timezone }) => {
    try { return { content: [{ type: 'text', text: new Date().toLocaleString('en-US', { timeZone: timezone }) }] } }
    catch { return { isError: true, content: [{ type: 'text', text: 'Invalid IANA timezone.' }] } }
  })
  server.registerTool('search_docs', {
    description: 'Search the BYOK AI integration documentation.',
    inputSchema: { query: z.string().min(1) },
    annotations: { readOnlyHint: true },
  }, async ({ query }) => {
    const docs = [
      { title: 'Embedding', text: 'Import AskAI and render <AskAI /> in any React page. The components use unstyled Headless UI primitives. Supply your own styling and placement, or use AskAIProvider and useAskAI for a custom interface.' },
      { title: 'Providers', text: 'Pass providers with id, name, description, defaultValues, fields or a custom Form, validate, and createModel. Provider settings and API keys are saved in browser localStorage and restored on reload. Disconnect removes the saved key.' },
      { title: 'MCP', text: 'Pass mcpServers with id, name, url and optional headers. Streamable HTTP servers expose tools. The model loop runs in the browser and calls the servers\' tools.' },
      { title: 'Conversations', text: 'Conversations are saved in localStorage on this browser. No database is needed. Delete conversations from the history view.' },
    ]
    const words = query.toLowerCase().split(/\W+/).filter(Boolean)
    const matches = docs.filter(d => words.some(w => (d.title + ' ' + d.text).toLowerCase().includes(w)))
    return { content: [{ type: 'text', text: JSON.stringify(matches) }] }
  })
  return server
}

export async function createApp(options: { frontendRoot?: string; logger?: boolean } = {}) {
  const app = Fastify({ logger: options.logger ?? false, bodyLimit: 1024 * 1024 })
  app.get('/health', async () => ({ status: 'ok' }))
  app.post('/api/mcp', async (request, reply) => {
    // Same-origin by default. Configure explicit allowed origins when deploying cross-origin.
    const origin = request.headers.origin
    const allowed = (process.env.MCP_ALLOWED_ORIGINS ?? '').split(',').filter(Boolean)
    if (origin && URL.parse(origin)?.host !== request.headers.host && !allowed.includes(origin)) {
      return reply.code(403).send({ error: 'Origin not allowed' })
    }
    const server = createMcpServer()
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true })
    await server.connect(transport)
    reply.hijack()
    reply.raw.on('close', () => { void transport.close(); void server.close() })
    await transport.handleRequest(request.raw, reply.raw, request.body)
  })
  app.route({ method: ['GET', 'DELETE'], url: '/api/mcp', handler: async (_, reply) => reply.code(405).send({ error: 'Stateless MCP: use POST' }) })
  if (options.frontendRoot) await app.register(staticFiles, { root: options.frontendRoot })
  return app
}
