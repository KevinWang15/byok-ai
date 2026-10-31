import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react-swc'

export default defineConfig({
  plugins: [react()],
  // Concurrent browser tests must not overwrite the live demo's optimized dependencies.
  cacheDir: process.env.VITE_CACHE_DIR ?? 'node_modules/.vite',
  build: { outDir: 'dist/client' },
  server: {
    host: process.env.VITE_HOST ?? '127.0.0.1',
    // The page's Host is kept, so the MCP endpoint sees a same-origin request.
    proxy: { '/api': { target: process.env.API_PROXY_TARGET ?? 'http://127.0.0.1:3000', changeOrigin: false } },
  },
})
