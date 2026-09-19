import { useState } from 'react'
import PlatformPanel from './PlatformPanel'
import CrossSectionPanel from './CrossSectionPanel'
import { BackIcon, NewPlatformIcon, CrossSectionCutIcon } from '../icons'

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
 * Platforms and cross sections in one panel: the menu keeps both headings,
 * separated by the gray line. Both tools pick on the map, so only the chosen
 * one is ever mounted — the menu is what keeps their click handlers from
 * meeting.
 */
export default function PlatformCrossSectionPanel({ t, map, project, onTrackSaved, crossSectionAt, onShowCrossSection }) {
  const [page, setPage] = useState('menu')
  const back = () => setPage('menu')

  if (page === 'platform') return (
    <>
      <BackButton t={t} onBack={back} />
      <PlatformPanel t={t} map={map} project={project} onTrackSaved={onTrackSaved} />
    </>
  )

  if (page === 'cross_section') return (
    <>
      <BackButton t={t} onBack={back} />
      <CrossSectionPanel t={t} map={map} project={project} onTrackSaved={onTrackSaved}
        crossSectionAt={crossSectionAt} onShowCrossSection={onShowCrossSection} />
    </>
  )

  return (
    <>
      <h2>{t('platform_title')}</h2>
      <div className="create-element-options">
        <button className="create-element-btn" onClick={() => setPage('platform')}>
          <NewPlatformIcon />
          {t('platform_new')}
        </button>
      </div>
      <hr style={SEPARATOR} />
      <h2>{t('cross_section_title')}</h2>
      <div className="create-element-options">
        <button className="create-element-btn" onClick={() => setPage('cross_section')}>
          <CrossSectionCutIcon />
          {t('cross_section_show')}
        </button>
      </div>
    </>
  )
}
