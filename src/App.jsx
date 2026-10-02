import { useEffect, useState } from 'react'
import './App.css'
import I18nProvider from './locales/I18nProvider'
import { useI18n } from './locales/i18nContext'
import { useProject } from './hooks/useStore'
import { loadSettings } from './utils/settings'
import StartPage from './components/StartPage'
import LoginPage from './components/collab/LoginPage'
import PasswordForm from './components/collab/PasswordForm'
import AdminPage from './components/collab/AdminPage'
import HistoryPage from './components/collab/HistoryPage'
import useSession from './shell/useSession'
import useWorkingCopy from './shell/useWorkingCopy'
import useViewer from './shell/useViewer'
import MapWorkspace from './shell/MapWorkspace'
import ViewerView from './shell/ViewerView'

export default function App() {
  return <I18nProvider><Shell /></I18nProvider>
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
    document.documentElement.style.setProperty('--color-primary', loadSettings().color ?? '#303383')
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
    return <MapWorkspace wc={wc} onHome={() => setPage('start')} />
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
