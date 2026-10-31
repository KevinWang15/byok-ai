import test from 'node:test'
import assert from 'node:assert/strict'
import { createApp } from '../backend/app'

const initialize = { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } } }
const post = (app: Awaited<ReturnType<typeof createApp>>, origin?: string) => app.inject({
  method: 'POST', url: '/api/mcp', payload: initialize,
  headers: { host: 'app.example', accept: 'application/json, text/event-stream', ...(origin ? { origin } : {}) },
})

test('MCP serves its own origin and the listed ones, and refuses the rest', async () => {
  process.env.MCP_ALLOWED_ORIGINS = 'https://partner.example'
  const app = await createApp()
  try {
    assert.equal((await post(app)).statusCode, 200, 'no Origin: not a browser page')
    assert.equal((await post(app, 'https://app.example')).statusCode, 200)
    assert.equal((await post(app, 'https://partner.example')).statusCode, 200)
    assert.equal((await post(app, 'https://other.example')).statusCode, 403)
    assert.equal((await post(app, 'null')).statusCode, 403, 'sandboxed frames and file: pages')
    assert.equal((await app.inject({ url: '/health' })).statusCode, 200)
  } finally {
    delete process.env.MCP_ALLOWED_ORIGINS
    await app.close()
  }
})
