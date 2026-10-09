import { useEffect, useMemo, useState } from 'react'
import { listClouds, deleteCloud, opfsAvailable, storagePersisted, storageEstimate } from '../../utils/pointCloud/cloudStore'
import { outlineFeature } from '../../utils/pointCloud/cloudOutline'
import { forgetCloud } from '../../utils/pointCloud/cloudSection'
import { cloudServerHook } from '../../utils/pointCloud/cloudServer'
import { sizeText } from '../../utils/pointCloud/cloudFormat'
import { useI18n } from '../../locales/i18nContext'
import { useProject } from '../../hooks/useStore'
import { useMayEditClouds } from '../../hooks/useCurrentUser'
import usePreview from '../../map/usePreview'
import { PALETTE } from '../../styles/palette'
import CloudImportForm from './pointCloud/CloudImportForm'
import CloudList from './pointCloud/CloudList'
import CloudCacheSetting from './pointCloud/CloudCacheSetting'
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
 * Point clouds of the project (AP 13.6): those on the server, which every
 * member sees, and those read in on this device only (Entscheidung 204) —
 * one list. Uploading is the default, reading in locally stays; both, and
 * deleting, are for the admin and whoever has the right (decision 203). Below
 * the list finding a track's axis in the clouds (AP 12.2) and the measured
 * axes. The server's half — the list there, uploading, the 3D window — is the
 * server's (`useCloudServer`, Paket L); without it the panel reads clouds in
 * on this device.
 */
export default function PointCloudPanel() {
  const { t, fill } = useI18n()
  const project = useProject()
  const mayEdit = useMayEditClouds()
  const [local, setLocal] = useState(null)
  const [storage, setStorage] = useState(null)  // { usage, quota, free, persisted }
  const [message, setMessage] = useState(null)  // { kind: 'error'|'done', text }
  const [running, setRunning] = useState(false)
  // The measured axis whose points are being taken out on the map — the
  // trace's own clicks on the map wait meanwhile.
  const [erasingId, setErasingId] = useState(null)
  // A measured axis to trace anew after a re-referencing (AP 13.15).
  const [retrace, setRetrace] = useState(null)
  const useCloudServer = cloudServerHook()
  const remote = useCloudServer(project.id, { onMessage: setMessage })

  const refreshLocal = async () => {
    setLocal(opfsAvailable() ? await listClouds(project.id).catch(() => []) : [])
    const estimate = await storageEstimate()
    setStorage(estimate && { ...estimate, persisted: await storagePersisted() })
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { refreshLocal() }, [project.id])

  // The clouds the trace reads (the server's at level 1 and this device's),
  // and those whose outline is drawn.
  const readable = useMemo(() => [...remote.readable, ...(local ?? [])], [remote.readable, local])
  const outline = usePreview(OUTLINE_LAYERS)
  useEffect(() => {
    outline.set(OUTLINE_SOURCE, { type: 'FeatureCollection', features: [...remote.outlines, ...(local ?? [])].map(outlineFeature) })
  }, [outline, remote.outlines, local])

  const removeLocal = async (cloud) => {
    try {
      await deleteCloud(project.id, cloud.id)
      forgetCloud(cloud.id)
    } catch (err) {
      setMessage({ kind: 'error', text: `${t('pointcloud_delete_failed')}: ${err.message}` })
    }
    refreshLocal()
  }

  return (
    <>
      <h2>{t('pointcloud_title')}</h2>
      <p className="selecting-hint">{t('pointcloud_hint')}</p>
      {!opfsAvailable() && <p className="form-error">{t('pointcloud_no_opfs')}</p>}
      {mayEdit
        ? <CloudImportForm storage={storage} onMessage={setMessage} onChanged={refreshLocal} onRunning={setRunning} onUpload={remote.upload}
          localAvailable={opfsAvailable()} />
        : <p className="selecting-hint">{t('pointcloud_view_only')}</p>}
      {message && <p className={message.kind === 'error' ? 'form-error' : 'selecting-hint'}>{message.text}</p>}
      <CloudList local={local} server={remote.rows} uploads={remote.uploads} mayEdit={mayEdit} busy={running}
        onDeleteLocal={removeLocal} onDeleteServer={remote.remove} onResume={remote.resume} onRetry={remote.retry}
        onOpen3d={remote.open3d} />
      {readable.length > 0 && !running && (
        <RailTraceSection clouds={readable} paused={!!erasingId} retrace={retrace} onRetraced={() => setRetrace(null)} />
      )}
      <AxisSurveyList erasingId={erasingId} onErasing={setErasingId} cloudRows={remote.rows ?? []}
        onRetrace={readable.length ? setRetrace : null} />
      {storage && (
        <p className="pointcloud-meta pointcloud-storage">
          {fill('pointcloud_storage', { used: sizeText(storage.usage), free: sizeText(storage.free) })}
          {!storage.persisted && ` ${t('pointcloud_not_persisted')}`}
        </p>
      )}
      {(remote.rows ?? []).length > 0 && <CloudCacheSetting />}
    </>
  )
}
