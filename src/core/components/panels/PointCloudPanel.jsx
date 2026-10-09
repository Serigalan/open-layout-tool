import { useEffect, useState, useSyncExternalStore } from 'react'
import { api } from '../../../server/api/client'
import { listClouds, deleteCloud, opfsAvailable, storagePersisted, storageEstimate } from '../../utils/pointCloud/cloudStore'
import { outlineFeature } from '../../utils/pointCloud/cloudOutline'
import { forgetCloud } from '../../utils/pointCloud/cloudSection'
import { readableOnServer, serverLevel } from '../../utils/pointCloud/projectClouds'
import { createServerCloud, runUpload, runningUploads, sameFile, subscribeUploads } from '../../../server/cloudUpload'
import { sizeText } from '../../utils/pointCloud/cloudFormat'
import { openCloud3d } from '../../../server/cloud3d/channel'
import { currentVariantId } from '../../storage'
import { useI18n } from '../../locales/i18nContext'
import { tOr } from '../../locales/i18n'
import { useProject } from '../../hooks/useStore'
import { useMayEditClouds } from '../../hooks/useCurrentUser'
import useRegistrationSession from '../../hooks/useRegistrationSession'
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

/** How often the list is asked again while a cloud on the server is on its way [ms]. */
const POLL = 3000

const useUploads = () => useSyncExternalStore(subscribeUploads, runningUploads, runningUploads)

/**
 * Point clouds of the project (AP 13.6): those on the server, which every
 * member sees, and those read in on this device only (Entscheidung 204) —
 * one list. Uploading is the default, reading in locally stays; both, and
 * deleting, are for the admin and whoever has the right (decision 203). Below
 * the list finding a track's axis in the clouds (AP 12.2) and the measured
 * axes.
 */
export default function PointCloudPanel() {
  const { t, fill } = useI18n()
  const project = useProject()
  const mayEdit = useMayEditClouds()
  const uploads = useUploads()
  const [local, setLocal] = useState(null)
  const [server, setServer] = useState(null)
  const [readable, setReadable] = useState([])  // the clouds a trace reads: server L1 and local
  const [outlines, setOutlines] = useState([])  // server L2 indexes, for the outline on the map
  const [storage, setStorage] = useState(null)  // { usage, quota, free, persisted }
  const [message, setMessage] = useState(null)  // { kind: 'error'|'done', text }
  const [running, setRunning] = useState(false)
  // The measured axis whose points are being taken out on the map — the
  // trace's own clicks on the map wait meanwhile.
  const [erasingId, setErasingId] = useState(null)
  // A measured axis to trace anew after a re-referencing (AP 13.15).
  const [retrace, setRetrace] = useState(null)

  const say = (err, key) => setMessage({ kind: 'error', text: `${t(key)}: ${tOr(t, `pointcloud_err_${err.code}`, err.message)}` })

  const refreshLocal = async () => {
    setLocal(opfsAvailable() ? await listClouds(project.id).catch(() => []) : [])
    const estimate = await storageEstimate()
    setStorage(estimate && { ...estimate, persisted: await storagePersisted() })
  }
  const refreshServer = async () => {
    try {
      setServer((await api.clouds(project.id)).clouds)
    } catch {
      setServer([])
    }
  }
  const refresh = () => Promise.all([refreshLocal(), refreshServer()])
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { refresh() }, [project.id])
  // A re-referencing kept or put back in the 3D window: the clouds anew (AP 13.15).
  const { cloudsVersion } = useRegistrationSession(project.id)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (cloudsVersion) refreshServer() }, [cloudsVersion])

  // While a cloud is uploaded or prepared, its state is asked for again.
  const pending = (server ?? []).some(c => c.status === 'queued' || c.status === 'processing'
    || (c.status === 'uploading' && uploads.some(u => u.cloudId === c.id)))
  useEffect(() => {
    if (!pending) return
    const timer = setInterval(refreshServer, POLL)
    return () => clearInterval(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending, project.id])

  // The clouds the trace reads, and the outlines of the server's.
  const readyKey = (server ?? []).filter(readableOnServer).map(c => `${c.id}:${c.transform?.id ?? ''}`).join(',')
  useEffect(() => {
    let live = true
    const ready = (server ?? []).filter(readableOnServer)
    Promise.all([
      Promise.all(ready.map(c => serverLevel(project.id, c, 1).catch(() => null))),
      Promise.all(ready.map(c => serverLevel(project.id, c, 2).catch(() => null))),
    ]).then(([l1, l2]) => {
      if (!live) return
      setReadable([...l1.filter(Boolean), ...(local ?? [])])
      setOutlines(l2.filter(Boolean))
    })
    return () => { live = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [readyKey, local, project.id])

  const outline = usePreview(OUTLINE_LAYERS)
  useEffect(() => {
    outline.set(OUTLINE_SOURCE, { type: 'FeatureCollection', features: [...outlines, ...(local ?? [])].map(outlineFeature) })
  }, [outline, outlines, local])

  const upload = async ({ file, header, name, crs, heightEpsg, keepRaw }) => {
    setMessage(null)
    let cloud
    try {
      cloud = await createServerCloud({ projectId: project.id, file, header, name, crs, heightEpsg, keepRaw })
    } catch (err) {
      say(err, 'pointcloud_upload_failed')
      return
    }
    await refreshServer()
    resume(cloud, file, true)
  }

  const resume = async (cloud, file, fresh = false) => {
    if (!fresh && !sameFile(cloud, file)) {
      setMessage({ kind: 'error', text: fill('pointcloud_upload_other_file', { file: cloud.file.name }) })
      return
    }
    setMessage(null)
    try {
      const done = await runUpload({ projectId: project.id, cloud, file })
      setMessage({ kind: 'done', text: t(done ? 'pointcloud_upload_done' : 'pointcloud_upload_aborted') })
    } catch (err) {
      say(err, 'pointcloud_upload_failed')
    }
    refreshServer()
  }

  const removeLocal = async (cloud) => {
    try {
      await deleteCloud(project.id, cloud.id)
      forgetCloud(cloud.id)
    } catch (err) {
      setMessage({ kind: 'error', text: `${t('pointcloud_delete_failed')}: ${err.message}` })
    }
    refreshLocal()
  }

  const removeServer = async (cloud) => {
    try {
      await api.deleteCloud(project.id, cloud.id)
      forgetCloud(cloud.id)
    } catch (err) {
      say(err, 'pointcloud_delete_failed')
    }
    refreshServer()
  }

  const retry = async (cloud) => {
    try {
      await api.retryCloud(project.id, cloud.id)
    } catch (err) {
      say(err, 'pointcloud_retry_failed')
    }
    refreshServer()
  }

  return (
    <>
      <h2>{t('pointcloud_title')}</h2>
      <p className="selecting-hint">{t('pointcloud_hint')}</p>
      {!opfsAvailable() && <p className="form-error">{t('pointcloud_no_opfs')}</p>}
      {mayEdit
        ? <CloudImportForm storage={storage} onMessage={setMessage} onChanged={refreshLocal} onRunning={setRunning} onUpload={upload}
          localAvailable={opfsAvailable()} />
        : <p className="selecting-hint">{t('pointcloud_view_only')}</p>}
      {message && <p className={message.kind === 'error' ? 'form-error' : 'selecting-hint'}>{message.text}</p>}
      <CloudList local={local} server={server} uploads={uploads} mayEdit={mayEdit} busy={running}
        onDeleteLocal={removeLocal} onDeleteServer={removeServer} onResume={resume} onRetry={retry}
        onOpen3d={(c) => openCloud3d({ projectId: project.id, variantId: currentVariantId(), cloudId: c.id })} />
      {readable.length > 0 && !running && (
        <RailTraceSection clouds={readable} paused={!!erasingId} retrace={retrace} onRetraced={() => setRetrace(null)} />
      )}
      <AxisSurveyList erasingId={erasingId} onErasing={setErasingId} cloudRows={server ?? []}
        onRetrace={readable.length ? setRetrace : null} />
      {storage && (
        <p className="pointcloud-meta pointcloud-storage">
          {fill('pointcloud_storage', { used: sizeText(storage.usage), free: sizeText(storage.free) })}
          {!storage.persisted && ` ${t('pointcloud_not_persisted')}`}
        </p>
      )}
      {(server ?? []).length > 0 && <CloudCacheSetting />}
    </>
  )
}
