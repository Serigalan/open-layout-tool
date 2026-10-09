import { Suspense, lazy, useEffect, useState } from 'react'
import '../App.css'
import I18nProvider from '../locales/I18nProvider'
import { useI18n } from '../locales/i18nContext'
import { useProject } from '../hooks/useStore'
import { closeStoredProject } from '../storage'
import { loadSettings } from '../utils/settings'
import { PALETTE } from '../styles/palette'
import LocalStartPage from './LocalStartPage'
import { openLocalProject } from './localProjects'

// The map with MapLibre and every panel behind it is loaded when a project is
// first opened (R9.1).
const MapWorkspace = lazy(() => import('../shell/MapWorkspace'))

/** While a page's chunk is on its way. */
function Loading() {
  const { t } = useI18n()
  return <div className="collab-page collab-center"><p className="collab-muted">{t('home_loading')}</p></div>
}

export default function LocalApp() {
  return <I18nProvider><Suspense fallback={<Loading />}><LocalShell /></Suspense></I18nProvider>
}

/**
 * The local build's pages (Paket L): the start page with this browser's
 * projects, or the open project on the map. No sign-in — the one local user
 * may do everything (decision 281).
 */
function LocalShell() {
  const project = useProject()
  const [page, setPage] = useState('start')

  useEffect(() => {
    document.documentElement.style.setProperty('--color-primary', loadSettings().color ?? PALETTE.primaryDefault)
  }, [])

  if (page === 'map' && project) {
    return <MapWorkspace onHome={() => setPage('start')} beforeHome={closeStoredProject} />
  }
  return <LocalStartPage onOpen={async (id) => { await openLocalProject(id); setPage('map') }} />
}
