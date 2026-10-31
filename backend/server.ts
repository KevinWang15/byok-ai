import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { createApp } from './app'

// Relative to dist/server/server.js, independent of the process working directory.
const frontendRoot = fileURLToPath(new URL('../client/', import.meta.url))
const app = await createApp({
  logger: true,
  ...(existsSync(frontendRoot) ? { frontendRoot } : {}),
})
await app.listen({ port: Number(process.env.PORT ?? 3000), host: process.env.HOST ?? '127.0.0.1' })

for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => void app.close())
