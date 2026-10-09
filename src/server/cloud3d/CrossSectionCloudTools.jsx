import { useI18n } from '../../core/locales/i18nContext'
import { currentVariantId } from '../workingCopies'
import { openCloud3d } from './channel'

/**
 * Beside the cross section's point cloud, for clouds on the server
 * (`crossSectionTools`, Paket L): which level of them is read — the 2-cm
 * voxel or the original — and the 3D window.
 */
export default function CrossSectionCloudTools({ projectId, clouds, level, onLevel }) {
  const { t } = useI18n()
  if (!clouds.some(c => c.server)) return null
  return (
    <>
      <select className="cross-section-coloring" value={level} onChange={e => onLevel(Number(e.target.value))}
        title={t('cross_section_cloud_level_hint')}>
        <option value={1}>{t('cross_section_cloud_level_1')}</option>
        <option value={0}>{t('cross_section_cloud_level_0')}</option>
      </select>
      <button className="track-table-save-btn" title={t('pointcloud_open_3d_hint')}
        onClick={() => openCloud3d({ projectId, variantId: currentVariantId() })}>
        {t('cross_section_open_3d')}
      </button>
    </>
  )
}
