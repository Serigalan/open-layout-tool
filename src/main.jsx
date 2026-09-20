import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import { initStorage } from './storage'
import { loadNtv2Grid } from './utils/ntv2Grid'

// The grid first, then the store — in that order, not side by side.
//
// Hydrating the store rebuilds every element's display geometry in WGS84
// (persistenceUtils.hydrateProjects → elementReconstruct → utmToWgs84), and for
// a DHDN track that conversion is the one thing in the app that depends on the
// grid being there. Loaded side by side, IndexedDB always won: the grid is a
// network fetch plus ~90 ms of GeoTIFF parsing, a store read is neither. Every
// DHDN track was then drawn from coordinates carrying the 7-parameter
// fallback's error — 0.94 m, for the whole session, however ready the grid
// became a moment later.
//
// The grid needs nothing from the store, so it simply goes first. Both were
// already awaited before the first render; this only makes them serial, and a
// 24 kB file is not what startup waits for.
loadNtv2Grid().then(initStorage).then(() => {
  createRoot(document.getElementById('root')).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
})
