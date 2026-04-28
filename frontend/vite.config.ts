import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  // GitHub Pages serves from /Solardataprofile/ in production
  base: process.env.NODE_ENV === 'production' ? '/Solardataprofile/' : '/',
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      '/api': 'http://localhost:8000',
      '/healthz': 'http://localhost:8000',
    },
  },
})
