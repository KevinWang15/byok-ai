import { readFileSync } from 'node:fs'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react-swc'

// The package's entries (package.json `exports`). Code they share is one chunk, so state such as
// the connection's listeners is one instance whichever entry a host imports it from.
const entries = {
  index: 'frontend/byok/index.ts',
  agent: 'frontend/byok/entries/agent.ts',
  connection: 'frontend/byok/entries/connection.ts',
  'script-engine': 'frontend/byok/entries/script-engine.ts',
}
// The host installs the package's dependencies and peers; everything else (the script engine) is bundled.
const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as { dependencies: Record<string, string>; peerDependencies: Record<string, string> }
const installed = [...Object.keys(pkg.dependencies), ...Object.keys(pkg.peerDependencies)]

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist/lib',
    lib: { entry: entries, formats: ['es'], fileName: (_, name) => `${name}.js` },
    rolldownOptions: { external: id => installed.some(name => id === name || id.startsWith(name + '/')) },
  },
})
