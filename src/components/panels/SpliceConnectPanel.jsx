import { useState } from 'react'
import SpliceElementPanel from './SpliceElementPanel'
import ConnectStraightForm from './ConnectElementPanel/ConnectStraightForm'
import ConnectCurvedForm from './ConnectElementPanel/ConnectCurvedForm'
import { BackIcon, SpliceJoinIcon, ConnectStraightIcon, ConnectCurvedIcon } from '../icons'
import { useI18n } from '../../locales/i18nContext'

// The gray line between the two tool groups, the same separator the layers
// panel draws between its basemap groups.
function BackButton({ onBack }) {
  const { t } = useI18n()
  return (
    <button className="back-btn" onClick={onBack}>
      <BackIcon />
      {t('btn_back')}
    </button>
  )
}

/**
 * Splicing two elements and connecting a straight or a curve to a track end in
 * one panel: the menu keeps both headings, separated by the gray line. The
 * tools pick on the map, so only the chosen one is ever mounted — the menu is
 * what keeps their click handlers from meeting. Optimizing is in the check panel.
 */
export default function SpliceConnectPanel() {
  const { t } = useI18n()
  const [page, setPage] = useState('menu')
  const back = () => setPage('menu')

  if (page === 'splice') return (
    <>
      <BackButton onBack={back} />
      <SpliceElementPanel />
    </>
  )

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
