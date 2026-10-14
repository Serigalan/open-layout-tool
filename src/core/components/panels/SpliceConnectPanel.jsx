import { Suspense, lazy, useState } from 'react'
import ConnectStraightForm from './ConnectElementPanel/ConnectStraightForm'
import ConnectCurvedForm from './ConnectElementPanel/ConnectCurvedForm'
import { ConnectStraightIcon, ConnectCurvedIcon, SpliceJoinIcon } from '../icons'
import { useI18n } from '../../locales/i18nContext'
import BackButton from './BackButton'
import PanelToolButtons from './PanelTools'
import { extensionsOf } from '../../extensions'

// Splicing is its own chunk, loaded the first time it is opened.
const SpliceElementPanel = lazy(() => import('./splice/SpliceElementPanel'))

// The gray line between the two tool groups, the same separator the layers
// panel draws between its basemap groups.
/**
 * Splicing two elements and connecting a straight or a curve to a track end in
 * one panel: the menu keeps both headings, separated by the gray line. The
 * tools pick on the map, so only the chosen one is ever mounted — the menu is
 * what keeps their click handlers from meeting. Optimizing is in the check panel.
 *
 * Splicing is computed in the browser (decision 294) and is there in both
 * builds; reconnecting runs on the optimizer service, which puts it in
 * beside it (`panelTools` of 'splice', Paket L).
 */
export default function SpliceConnectPanel() {
  const { t } = useI18n()
  const [page, setPage] = useState('menu')
  const back = () => setPage('menu')
  const tools = extensionsOf('panelTools').filter(x => x.panel === 'splice')

  if (page === 'splice') return (
    <>
      <BackButton onBack={back} />
      <Suspense fallback={<p className="selecting-hint">…</p>}><SpliceElementPanel /></Suspense>
    </>
  )

  const tool = tools.find(x => x.id === page)
  if (tool) {
    const Tool = tool.Component
    return <Tool onExit={back} />
  }

  if (page === 'connect_straight') return (
    <>
      <BackButton onBack={back} />
      <h2>{t('connect_straight')}</h2>
      <ConnectStraightForm onCommitted={back} />
    </>
  )

  if (page === 'connect_curved') return (
    <>
      <BackButton onBack={back} />
      <h2>{t('connect_curved')}</h2>
      <ConnectCurvedForm onCommitted={back} />
    </>
  )

  return (
    <>
      <h2>{t('splice_element')}</h2>
      <div className="create-element-options">
        <button className="create-element-btn" onClick={() => setPage('splice')}>
          <SpliceJoinIcon />
          {t('splice_start')}
        </button>
        <PanelToolButtons panel="splice" onPick={setPage} />
      </div>
      <hr className="divider divider-wide" />
      <h2>{t('connect_element')}</h2>
      <div className="create-element-options">
        <button className="create-element-btn" onClick={() => setPage('connect_straight')}>
          <ConnectStraightIcon />
          {t('connect_straight')}
        </button>
        <button className="create-element-btn" onClick={() => setPage('connect_curved')}>
          <ConnectCurvedIcon />
          {t('connect_curved')}
        </button>
      </div>
    </>
  )
}
