import { useEffect, useState, useSyncExternalStore } from 'react'
import { api } from './api/client'
import { createServerCloud, runUpload, runningUploads, sameFile, subscribeUploads } from './cloudUpload'
import { readableOnServer, serverLevel } from './cloudsOnServer'
import { currentVariantId } from './workingCopies'
import { openCloud3d } from './cloud3d/channel'
import useRegistrationSession from './cloud3d/useRegistrationSession'
import { forgetCloud } from '../core/utils/pointCloud/cloudSection'
import { useI18n } from '../core/locales/i18nContext'
import { tOr } from '../core/locales/i18n'

/** How often the list is asked again while a cloud on the server is on its way [ms]. */
const POLL = 3000

const useUploads = () => useSyncExternalStore(subscribeUploads, runningUploads, runningUploads)

/**
 * The point cloud panel's clouds on the server (AP 13.6), as core asks for
 * them (`useCloudServer`, core/components/panels/PointCloudPanel.jsx): the
 * list every member sees, asked again while a cloud is on its way and after a
 * re-referencing was kept in the 3D window (AP 13.15); uploading, resuming,
 * deleting, preparing again; and the 3D window. `onMessage` says how it went.
 *
 *   rows       the server's clouds as the API lists them, null until asked
 *   readable   the ready ones at level 1, as the trace reads them
 *   outlines   the ready ones at level 2, for their outline on the map
 */
export default function useCloudServer(projectId, { onMessage }) {
  const { t, fill } = useI18n()
  const uploads = useUploads()
  const [rows, setRows] = useState(null)
  const [readable, setReadable] = useState([])
  const [outlines, setOutlines] = useState([])

  const say = (err, key) => onMessage({ kind: 'error', text: `${t(key)}: ${tOr(t, `pointcloud_err_${err.code}`, err.message)}` })

  const refresh = async () => {
    try {
      setRows((await api.clouds(projectId)).clouds)
    } catch {
      setRows([])
    }
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { refresh() }, [projectId])
  // A re-referencing kept or put back in the 3D window: the clouds anew (AP 13.15).
  const { cloudsVersion } = useRegistrationSession(projectId)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (cloudsVersion) refresh() }, [cloudsVersion])

  // While a cloud is uploaded or prepared, its state is asked for again.
  const pending = (rows ?? []).some(c => c.status === 'queued' || c.status === 'processing'
    || (c.status === 'uploading' && uploads.some(u => u.cloudId === c.id)))
  useEffect(() => {
    if (!pending) return
    const timer = setInterval(refresh, POLL)
    return () => clearInterval(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending, projectId])

  // The clouds the trace reads, and the outlines.
  const readyKey = (rows ?? []).filter(readableOnServer).map(c => `${c.id}:${c.transform?.id ?? ''}`).join(',')
  useEffect(() => {
    let live = true
    const ready = (rows ?? []).filter(readableOnServer)
    Promise.all([
      Promise.all(ready.map(c => serverLevel(projectId, c, 1).catch(() => null))),
      Promise.all(ready.map(c => serverLevel(projectId, c, 2).catch(() => null))),
    ]).then(([l1, l2]) => {
      if (!live) return
      setReadable(l1.filter(Boolean))
      setOutlines(l2.filter(Boolean))
    })
    return () => { live = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [readyKey, projectId])

  const resume = async (cloud, file, fresh = false) => {
    if (!fresh && !sameFile(cloud, file)) {
      onMessage({ kind: 'error', text: fill('pointcloud_upload_other_file', { file: cloud.file.name }) })
      return
    }
    onMessage(null)
    try {
      const done = await runUpload({ projectId, cloud, file })
      onMessage({ kind: 'done', text: t(done ? 'pointcloud_upload_done' : 'pointcloud_upload_aborted') })
    } catch (err) {
      say(err, 'pointcloud_upload_failed')
    }
    refresh()
  }

  const upload = async ({ file, header, name, crs, heightEpsg, keepRaw }) => {
    onMessage(null)
    let cloud
    try {
      cloud = await createServerCloud({ projectId, file, header, name, crs, heightEpsg, keepRaw })
    } catch (err) {
      say(err, 'pointcloud_upload_failed')
      return
    }
    await refresh()
    resume(cloud, file, true)
  }

  const remove = async (cloud) => {
    try {
      await api.deleteCloud(projectId, cloud.id)
      forgetCloud(cloud.id)
    } catch (err) {
      say(err, 'pointcloud_delete_failed')
    }
    refresh()
  }

  const retry = async (cloud) => {
    try {
      await api.retryCloud(projectId, cloud.id)
    } catch (err) {
      say(err, 'pointcloud_retry_failed')
    }
    refresh()
  }

  const open3d = (cloud) => openCloud3d({ projectId, variantId: currentVariantId(), cloudId: cloud.id })

  return { rows, uploads, readable, outlines, refresh, upload, resume, remove, retry, open3d }
}
