import { useState } from 'react'
import SpliceElementPanel from './SpliceElementPanel'
import OptimizeTrackPanel from './OptimizeTrackPanel'
import {
  BackIcon, SpliceJoinIcon, OptimizeTrackModeIcon, OptimizeElementModeIcon,
} from '../icons'

// The gray line between the two tool groups, the same separator the layers
// panel draws between its basemap groups.
const SEPARATOR = { margin: '10px 0', border: 'none', borderTop: '1px solid #ddd' }

function BackButton({ t, onBack }) {
  return (
    <button className="back-btn" onClick={onBack}>
      <BackIcon />
      {t('btn_back')}
    </button>
  )
}

/**
 * Splicing and optimizing in one panel: the menu keeps both headings, separated
 * by the gray line. Both tools pick on the map, so only the chosen one is ever
 * mounted — the menu is what keeps their click handlers from meeting.
 */
export default function SpliceOptimizePanel({ t, map, project, onTrackSaved, onShowConstraints }) {
  const [page, setPage] = useState('menu')
  const back = () => setPage('menu')

  if (page === 'splice') return (
    <>
      <BackButton t={t} onBack={back} />
      <SpliceElementPanel t={t} map={map} project={project} onTrackSaved={onTrackSaved} />
    </>
  )

  if (page === 'optimize_track' || page === 'optimize_element') return (
    <OptimizeTrackPanel t={t} map={map} project={project} onTrackSaved={onTrackSaved}
      initialPage={page === 'optimize_element' ? 'element' : 'track'} onExit={back}
      onShowConstraints={onShowConstraints} />
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
      <hr style={SEPARATOR} />
      <h2>{t('optimize_track')}</h2>
      <div className="create-element-options">
        <button className="create-element-btn" onClick={() => setPage('optimize_track')}>
          <OptimizeTrackModeIcon />
          {t('optimize_mode_track')}
        </button>
        <button className="create-element-btn" onClick={() => setPage('optimize_element')}>
          <OptimizeElementModeIcon />
          {t('optimize_mode_element')}
        </button>
      </div>
    </>
  )
}
