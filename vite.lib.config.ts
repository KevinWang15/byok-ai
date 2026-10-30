import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react-swc'
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist/lib',
    lib: { entry: 'frontend/byok/index.ts', formats: ['es'], fileName: 'index' },
    rolldownOptions: { external: id => !id.startsWith('.') && !id.startsWith('/') },
  },
})
