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

const EON = process.env.VITE_BRAND === 'eon'

/**
 * The offline file has no favicon.svg beside it: inline a small mark in the
 * brand's colours instead (Ameresco blue and green, or E.ON red), and give
 * the tab the product name.
 */
function inlineIcon(): Plugin {
  const svg = EON
    ? `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'><rect width='32' height='32' rx='7' fill='%23ea1c0a'/><text x='16' y='23' text-anchor='middle' font-family='Arial,sans-serif' font-weight='700' font-size='20' fill='white'>e</text></svg>`
    : `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'><rect width='32' height='32' rx='7' fill='white'/><ellipse cx='16' cy='17' rx='13' ry='6.5' fill='none' stroke='%230065a5' stroke-width='3' transform='rotate(-12 16 17)'/><ellipse cx='17' cy='16' rx='6' ry='13' fill='none' stroke='%23008540' stroke-width='3' transform='rotate(18 17 16)'/></svg>`
  return {
    name: 'inline-icon',
    transformIndexHtml: (html) => html
      .replace(/<link rel="icon"[^>]*>/, `<link rel="icon" href="data:image/svg+xml,${svg}" />`)
      .replace(/<title>[^<]*<\/title>/, `<title>${EON ? 'E.ON' : 'Ameresco'} Data Analyser ${process.env.VITE_VARIANT === 'standard' ? 'Standard' : 'Advanced'}</title>`),
  }
}

export default defineConfig(({ mode }) => {
  // `npm run build:standalone` makes one self-contained HTML file that a
  // colleague can open from their desktop, no server and no install.
  if (mode === 'standalone') {
    return {
      base: './',
      plugins: [localApi(), inlineIcon(), react(), tailwindcss(), viteSingleFile()],
      build: { outDir: EON ? 'dist-eon' : process.env.VITE_VARIANT === 'standard' ? 'dist-standard' : 'dist-standalone', chunkSizeWarningLimit: 5000 },
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
