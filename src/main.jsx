import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import { initStorage } from './storage'

// Hydrate the storage cache (IndexedDB, incl. one-time localStorage takeover)
// before the first render — all storage reads in the app are synchronous.
initStorage().then(() => {
  createRoot(document.getElementById('root')).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
})
