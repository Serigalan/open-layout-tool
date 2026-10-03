import { useState } from 'react'
import CrossSectionPanel from './CrossSectionPanel'
import PointCloudPanel from './PointCloudPanel'
import { BackIcon, PointCloudIcon } from '../icons'
import { useI18n } from '../../locales/i18nContext'

/**
 * The cross sections: the panel opens on the cross section of a track at once,
 * and the project's point clouds are a page of their own below it, with a way
 * back. Both pick on the map, so only one is ever mounted. Leaving the cross
 * section closes its overlay, as switching to another panel does (App).
 */
export default function CrossSectionsPanel({ crossSectionAt, onShowCrossSection }) {
  const { t } = useI18n()
  const [clouds, setClouds] = useState(false)

  if (clouds) return (
    <>
      <button className="back-btn" onClick={() => setClouds(false)}>
        <BackIcon />
        {t('btn_back')}
      </button>
      <PointCloudPanel />
    </>
  )

  return (
    <>
      <CrossSectionPanel crossSectionAt={crossSectionAt} onShowCrossSection={onShowCrossSection} />
      <hr className="divider divider-wide" />
      <h2>{t('pointcloud_title')}</h2>
      <div className="create-element-options">
        <button className="create-element-btn" onClick={() => { onShowCrossSection?.(null); setClouds(true) }}>
          <PointCloudIcon />
          {t('pointcloud_menu')}
        </button>
      </div>
    </>
  )
}
