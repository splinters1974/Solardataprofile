import path from 'node:path'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { viteSingleFile } from 'vite-plugin-singlefile'

/**
 * Standalone build: route every import of api/client to the in-browser
 * engine, so the same screens run with no server behind them.
 */
function localApi(): Plugin {
  const local = path.resolve(__dirname, 'src/local/localClient.ts')
  return {
    name: 'local-api',
    enforce: 'pre',
    resolveId(source, importer) {
      if (!importer || importer.includes(`${path.sep}local${path.sep}`)) return null
      if (/(^|\/)api\/client(\.ts)?$/.test(source)) return local
      return null
    },
  }
}

export default defineConfig(({ mode }) => {
  // `npm run build:standalone` makes one self-contained HTML file that a
  // colleague can open from their desktop, no server and no install.
  if (mode === 'standalone') {
    return {
      base: './',
      plugins: [localApi(), react(), tailwindcss(), viteSingleFile()],
      build: { outDir: 'dist-standalone', chunkSizeWarningLimit: 5000 },
    }
  }

  return {
    // GitHub Pages serves from /Solardataprofile/ in production
    base: process.env.NODE_ENV === 'production' ? '/Solardataprofile/' : '/',
    plugins: [react(), tailwindcss()],
    server: {
      proxy: {
        '/api': 'http://localhost:8000',
        '/healthz': 'http://localhost:8000',
      },
    },
  }
})
