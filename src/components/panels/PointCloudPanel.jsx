import { useEffect, useState } from 'react'
import { listClouds, deleteCloud, opfsAvailable, storagePersisted, storageEstimate } from '../../utils/pointCloud/cloudStore'
import { outlineFeature } from '../../utils/pointCloud/cloudOutline'
import { forgetCloud } from '../../utils/pointCloud/cloudSection'
import { sizeText } from '../../utils/pointCloud/cloudFormat'
import { useI18n } from '../../locales/i18nContext'
import { useProject } from '../../hooks/useStore'
import usePreview from '../../map/usePreview'
import { PALETTE } from '../../styles/palette'
import CloudImportForm from './pointCloud/CloudImportForm'
import CloudList from './pointCloud/CloudList'
import RailTraceSection from './pointCloud/RailTraceSection'
import AxisSurveyList from './pointCloud/AxisSurveyList'

// Where each cloud lies, while the panel is open.
const OUTLINE_SOURCE = 'pointcloud-outline-source'
const OUTLINE_LAYERS = [{
  sourceId: OUTLINE_SOURCE,
  layer: {
    id: 'pointcloud-outline-layer', type: 'line',
    paint: { 'line-color': PALETTE.cloudOutline, 'line-width': 1.5, 'line-dasharray': [2, 1.5] },
  },
}]

/**
 * Point clouds of the project, on this device only (Entscheidung 119): the
 * import of a LAS/LAZ file into tiles, the list of what is there (R5.5:
 * both are components of their own), and finding a track's axis in them
 * (AP 12.2).
 */
export default function PointCloudPanel() {
  const { t, fill } = useI18n()
  const project = useProject()
  const [clouds, setClouds] = useState(null)
  const [storage, setStorage] = useState(null)  // { usage, quota, free, persisted }
  const [message, setMessage] = useState(null)  // { kind: 'error'|'done', text }
  const [running, setRunning] = useState(false)

  const refresh = async () => {
    setClouds(await listClouds(project.id).catch(() => []))
    const estimate = await storageEstimate()
    setStorage(estimate && { ...estimate, persisted: await storagePersisted() })
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { refresh() }, [project.id])

  const outline = usePreview(OUTLINE_LAYERS)
  useEffect(() => {
    outline.set(OUTLINE_SOURCE, { type: 'FeatureCollection', features: (clouds ?? []).map(outlineFeature) })
  }, [outline, clouds])

  const remove = async (cloud) => {
    try {
      await deleteCloud(project.id, cloud.id)
      forgetCloud(cloud.id)
    } catch (err) {
      setMessage({ kind: 'error', text: `${t('pointcloud_delete_failed')}: ${err.message}` })
    }
    refresh()
  }

  // The measured axes are the project's, not the device's: they show without
  // a cloud here, and even where the browser cannot hold one.
  if (!opfsAvailable()) {
    return (
      <>
        <p className="form-error">{t('pointcloud_no_opfs')}</p>
        <AxisSurveyList />
      </>
    )
  }

  return (
    <>
      <h2>{t('pointcloud_title')}</h2>
      <p className="selecting-hint">{t('pointcloud_hint')}</p>
      <CloudImportForm storage={storage} onMessage={setMessage} onChanged={refresh} onRunning={setRunning} />
      {message && <p className={message.kind === 'error' ? 'form-error' : 'selecting-hint'}>{message.text}</p>}
      <CloudList clouds={clouds} busy={running} onDelete={remove} />
      {clouds?.length > 0 && !running && <RailTraceSection clouds={clouds} />}
      <AxisSurveyList />
      {storage && (
        <p className="pointcloud-meta pointcloud-storage">
          {fill('pointcloud_storage', { used: sizeText(storage.usage), free: sizeText(storage.free) })}
          {!storage.persisted && ` ${t('pointcloud_not_persisted')}`}
        </p>
      )}
    </>
  )
}
