import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import { initStorage } from './storage'
import { loadNtv2Grid } from './utils/ntv2Grid'

// Hydrate the storage cache (IndexedDB, incl. one-time localStorage takeover)
// and the BeTA2007 grid before the first render — all storage reads and DHDN
// conversions in the app are synchronous from here on (ntv2Grid.js).
Promise.all([initStorage(), loadNtv2Grid()]).then(() => {
  createRoot(document.getElementById('root')).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
})
