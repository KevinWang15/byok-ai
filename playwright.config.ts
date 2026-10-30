import { defineConfig } from '@playwright/test'
export default defineConfig({
  testDir: './e2e',
  use: { baseURL: 'http://127.0.0.1:5179', headless: true },
  webServer: [
    { command: 'PORT=3019 npm run dev:server', url: 'http://127.0.0.1:3019/health', reuseExistingServer: true },
    { command: 'VITE_CACHE_DIR=node_modules/.vite-e2e API_PROXY_TARGET=http://127.0.0.1:3019 npm run dev:client -- --port 5179', url: 'http://127.0.0.1:5179', reuseExistingServer: true },
  ],
})
