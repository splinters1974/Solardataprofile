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

/** The offline file has no favicon.svg beside it: inline a small mark instead. */
function inlineIcon(): Plugin {
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'><rect width='32' height='32' rx='7' fill='%2310b981'/><circle cx='16' cy='16' r='6' fill='white'/><g stroke='white' stroke-width='2.4' stroke-linecap='round'><path d='M16 4v3M16 25v3M4 16h3M25 16h3M7.5 7.5l2 2M22.5 22.5l2 2M7.5 24.5l2-2M22.5 9.5l2-2'/></g></svg>`
  return {
    name: 'inline-icon',
    transformIndexHtml: (html) =>
      html.replace(/<link rel="icon"[^>]*>/, `<link rel="icon" href="data:image/svg+xml,${svg}" />`),
  }
}

export default defineConfig(({ mode }) => {
  // `npm run build:standalone` makes one self-contained HTML file that a
  // colleague can open from their desktop, no server and no install.
  if (mode === 'standalone') {
    return {
      base: './',
      plugins: [localApi(), inlineIcon(), react(), tailwindcss(), viteSingleFile()],
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
