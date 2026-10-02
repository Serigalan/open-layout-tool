import { useState } from 'react'
import PlatformPanel from './PlatformPanel'
import CrossSectionPanel from './CrossSectionPanel'
import PointCloudPanel from './PointCloudPanel'
import { BackIcon, NewPlatformIcon, CrossSectionCutIcon, PointCloudIcon } from '../icons'
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
 * Platforms and cross sections in one panel: the menu keeps both headings,
 * separated by the gray line. Both tools pick on the map, so only the chosen
 * one is ever mounted — the menu is what keeps their click handlers from
 * meeting. The cross-section overlay belongs to its tool: leaving the tool
 * closes it, as switching to another panel does (App).
 */
export default function PlatformCrossSectionPanel({ crossSectionAt, onShowCrossSection }) {
  const { t } = useI18n()
  const [page, setPage] = useState('menu')
  const back = () => {
    if (page === 'cross_section') onShowCrossSection?.(null)
    setPage('menu')
  }

  if (page === 'platform') return (
    <>
      <BackButton onBack={back} />
      <PlatformPanel />
    </>
  )

  if (page === 'cross_section') return (
    <>
      <BackButton onBack={back} />
      <CrossSectionPanel
        crossSectionAt={crossSectionAt} onShowCrossSection={onShowCrossSection} />
    </>
  )

  if (page === 'point_clouds') return (
    <>
      <BackButton onBack={back} />
      <PointCloudPanel />
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
      <hr className="divider divider-wide" />
      <h2>{t('cross_section_title')}</h2>
      <div className="create-element-options">
        <button className="create-element-btn" onClick={() => setPage('cross_section')}>
          <CrossSectionCutIcon />
          {t('cross_section_show')}
        </button>
      </div>
      <hr className="divider divider-wide" />
      <h2>{t('pointcloud_title')}</h2>
      <div className="create-element-options">
        <button className="create-element-btn" onClick={() => setPage('point_clouds')}>
          <PointCloudIcon />
          {t('pointcloud_menu')}
        </button>
      </div>
    </>
  )
}
