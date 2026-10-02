import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import StandaloneApp from './standalone/StandaloneApp.tsx'
import CustomerGate from './standalone/CustomerGate.tsx'
import { captureTemplate, readSealedEdition } from './local/customerEdition'

// Keep an untouched copy of this page so it can make customer editions,
// before React changes anything.
if (import.meta.env.MODE === 'standalone') captureTemplate()

const standaloneRoot = import.meta.env.MODE === 'standalone'
  ? (readSealedEdition() ? <CustomerGate /> : <StandaloneApp />)
  : null

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {/* The offline file is its own multi-site shell; the hosted site is unchanged. */}
    {standaloneRoot ?? <App />}
  </StrictMode>,
)
