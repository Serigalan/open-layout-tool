import { Suspense, lazy, useEffect, useState } from 'react'
import '../core/App.css'
import I18nProvider from '../core/locales/I18nProvider'
import { useI18n } from '../core/locales/i18nContext'
import { useProject } from '../core/hooks/useStore'
import { loadSettings } from '../core/utils/settings'
import StartPage from './home/StartPage'
import LoginPage from './collab/LoginPage'
import PasswordForm from './collab/PasswordForm'
import useSession from './useSession'
import useWorkingCopy from './useWorkingCopy'
import useViewer from './useViewer'
import { PALETTE } from '../core/styles/palette'

// What the sign-in and the start page do not need is loaded when it is first
// opened (R9.1) — the map above all, with MapLibre and every panel behind it.
const AdminPage = lazy(() => import('./collab/AdminPage'))
const HistoryPage = lazy(() => import('./collab/HistoryPage'))
const MapWorkspace = lazy(() => import('../core/shell/MapWorkspace'))
const ViewerView = lazy(() => import('./ViewerView'))
const WorkingCopyLayer = lazy(() => import('./WorkingCopyLayer'))

/** While a page's chunk is on its way. */
function Loading() {
  const { t } = useI18n()
  return <div className="collab-page collab-center"><p className="collab-muted">{t('home_loading')}</p></div>
}

export default function App() {
  return <I18nProvider><Suspense fallback={<Loading />}><Shell /></Suspense></I18nProvider>
}

/**
 * Which page is up (R2.5): sign-in, the start page with the projects, the
 * user administration, a variant's history, a record looked at read-only, or
 * the open working copy on the map. The pages and their state live in
 * shell/; this only routes between them.
 */
function Shell() {
  const { t, fill } = useI18n()
  const session = useSession()
  const project = useProject()
  // 'start' | 'map' | 'viewer' | 'history' | 'admin'
  const [page, setPage] = useState('start')
  const [homeNote, setHomeNote] = useState(null)
  const wc = useWorkingCopy({ t })
  const viewer = useViewer({ t, fill, go: setPage, say: setHomeNote })

  useEffect(() => {
    document.documentElement.style.setProperty('--color-primary', loadSettings().color ?? PALETTE.primaryDefault)
  }, [])

  if (session.status === 'loading') {
    return <div className="collab-page collab-center"><p className="collab-muted">{t('home_loading')}</p></div>
  }
  if (session.status === 'anon') {
    return <LoginPage onSignedIn={(user) => { session.signedIn(user); setPage('start') }} />
  }
  if (session.user.mustChangePassword) {
    return (
      <div className="collab-page collab-center">
        <PasswordForm forced onDone={session.signedIn} />
      </div>
    )
  }
  if (page === 'history' && viewer.historyFor) {
    return <HistoryPage project={viewer.historyFor.project} variant={viewer.historyFor.variant}
      onBack={() => setPage('start')} onView={viewer.viewRevision} onCompareWithHead={viewer.compareWithHead} />
  }
  if (page === 'admin' && session.user.role === 'admin') {
    return <AdminPage user={session.user} onBack={() => setPage('start')} />
  }
  if (page === 'viewer' && viewer.viewer) {
    return <ViewerView viewer={viewer} />
  }
  if (page === 'map' && project) {
    return (
      <MapWorkspace onHome={() => setPage('start')} beforeHome={wc.close} resetKey={wc.replaced}
        renderExtras={(map) => <WorkingCopyLayer wc={wc} {...map} />} />
    )
  }

  const openVariant = async (serverProject, variant) => {
    setHomeNote(null)
    await wc.open(serverProject, variant)
    setPage('map')
  }
  return (
    <StartPage user={session.user} note={homeNote}
      onOpenVariant={openVariant} onViewVariant={viewer.viewVariant}
      onCompare={viewer.showComparison} onMerge={viewer.startMerge} onHistory={viewer.showHistory}
      onAdmin={() => { setHomeNote(null); setPage('admin') }}
      onSignOut={async () => { await session.signOut(); setPage('start') }} />
  )
}
