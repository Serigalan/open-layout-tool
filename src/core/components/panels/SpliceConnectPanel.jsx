import { useState } from 'react'
import ConnectStraightForm from './ConnectElementPanel/ConnectStraightForm'
import ConnectCurvedForm from './ConnectElementPanel/ConnectCurvedForm'
import { ConnectStraightIcon, ConnectCurvedIcon } from '../icons'
import { useI18n } from '../../locales/i18nContext'
import BackButton from './BackButton'
import PanelToolButtons from './PanelTools'
import { extensionsOf } from '../../extensions'

// The gray line between the two tool groups, the same separator the layers
// panel draws between its basemap groups.
/**
 * Splicing two elements and connecting a straight or a curve to a track end in
 * one panel: the menu keeps both headings, separated by the gray line. The
 * tools pick on the map, so only the chosen one is ever mounted — the menu is
 * what keeps their click handlers from meeting. Optimizing is in the check panel.
 *
 * Splicing and reconnecting run on the optimizer service: the server puts
 * them in (`panelTools` of 'splice', Paket L). Without it the panel connects.
 */
export default function SpliceConnectPanel() {
  const { t } = useI18n()
  const [page, setPage] = useState('menu')
  const back = () => setPage('menu')
  const tools = extensionsOf('panelTools').filter(x => x.panel === 'splice')

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
      {tools.length > 0 && (
        <>
          <h2>{t('splice_element')}</h2>
          <div className="create-element-options">
            <PanelToolButtons panel="splice" onPick={setPage} />
          </div>
          <hr className="divider divider-wide" />
        </>
      )}
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
