// The local build (Paket L): core alone — no project server, no Python
// service, no sign-in. Nothing of src/server is imported here, so nothing of
// it is in the bundle; every extension point of core stays empty but the
// projects of this browser in its storage dialog.
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './core/index.css'
import LocalApp from './core/home/LocalApp.jsx'
import { initStorage } from './core/storage'
import { extend } from './core/extensions'
import { setCurrentUser } from './core/hooks/useCurrentUser'
import { localProjectsSection } from './core/home/localProjects'
import { loadNtv2Grid } from './core/utils/ntv2Grid'

// The one local user, with every right (decision 281).
setCurrentUser({ id: 'local', name: 'local', role: 'admin', canEditClouds: true })
extend('localStoreSections', localProjectsSection)

// The grid first, then the store — in that order, not side by side: opening a
// project hydrates it, and a DHDN track's display geometry needs the grid
// (see main.jsx).
loadNtv2Grid().then(initStorage).then(() => {
  createRoot(document.getElementById('root')).render(
    <StrictMode>
      <LocalApp />
    </StrictMode>,
  )
})
