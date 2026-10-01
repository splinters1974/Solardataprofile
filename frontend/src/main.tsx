import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import StandaloneApp from './standalone/StandaloneApp.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {/* The offline file is its own multi-site shell; the hosted site is unchanged. */}
    {import.meta.env.MODE === 'standalone' ? <StandaloneApp /> : <App />}
  </StrictMode>,
)
