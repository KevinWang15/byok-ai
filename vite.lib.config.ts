import { readFileSync } from 'node:fs'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react-swc'

// The package's entries (package.json `exports`). Each module is one file that every entry imports,
// so state such as the connection's listeners is one instance whichever entry a host imports.
const entries = {
  index: 'frontend/byok/index.ts',
  'entries/agent': 'frontend/byok/entries/agent.ts',
  'entries/connection': 'frontend/byok/entries/connection.ts',
  'entries/script-engine': 'frontend/byok/entries/script-engine.ts',
}
// The host installs the package's dependencies and peers; everything else (the script engine) is bundled.
const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as { dependencies: Record<string, string>; peerDependencies: Record<string, string> }
const installed = [...Object.keys(pkg.dependencies), ...Object.keys(pkg.peerDependencies)]

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist/lib',
    lib: { entry: entries, formats: ['es'] },
    rolldownOptions: {
      external: id => installed.some(name => id === name || id.startsWith(name + '/')),
      // One file per source module, as the source is laid out, so a host's bundler keeps only the
      // modules it uses (package.json declares no side effects): an app that imports one function
      // doesn't load the chat UI with it.
      output: { preserveModules: true, preserveModulesRoot: 'frontend/byok', entryFileNames: '[name].js' },
    },
  },
})
