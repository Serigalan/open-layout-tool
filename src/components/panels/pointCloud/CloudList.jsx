import { useState } from 'react'
import maplibregl from 'maplibre-gl'
import { crsName, planeCoordsToWgs84 } from '../../../utils/coordinateUtils'
import { heightDatumLabel } from '../../../utils/heightDatums'
import { outlineFeature, cloudSize } from '../../../utils/pointCloud/cloudOutline'
import { count, duration, mb, sizeText, stepText } from '../../../utils/pointCloud/cloudFormat'
import { useI18n } from '../../../locales/i18nContext'
import { formatDate } from '../../../locales/i18n'
import { useMap } from '../../../map/MapContext'
import ConfirmModal from '../../ConfirmModal'
import FilePickButton from '../../form/FilePickButton'

const crsText = (code) => crsName(code) ?? `EPSG ${code}`

/** How far an upload of this tab has come, and the button that stops it. */
function UploadProgress({ upload }) {
  const { t, fill } = useI18n()
  const p = upload.progress
  const share = p.total ? p.sent / p.total : 0
  return (
    <div className="pointcloud-progress">
      <progress max={1} value={share} />
      <span className="pointcloud-meta">
        {fill('pointcloud_uploading', { share: Math.floor(share * 100), sent: mb(p.sent), total: mb(p.total) })
          + (p.rate ? ` · ${mb(p.rate)}/s · ${t('pointcloud_remaining')} ${duration(p.remaining)}` : '')}
      </span>
      <button className="modal-btn modal-btn-cancel" onClick={upload.abort}>{t('pointcloud_upload_abort')}</button>
    </div>
  )
}

/** What a cloud on the server is doing, and what can be done about it. */
function ServerStatus({ cloud, upload, mayEdit, onResume, onRetry }) {
  const { t, fill } = useI18n()
  if (cloud.status === 'uploading') {
    if (upload) return <UploadProgress upload={upload} />
    const share = Math.floor(100 * cloud.received / cloud.file.size)
    return (
      <>
        <span className="pointcloud-meta">{fill('pointcloud_upload_stopped', { share, file: cloud.file.name })}</span>
        {mayEdit && (
          <FilePickButton accept=".laz,.las,.e57" className="modal-btn modal-btn-cancel" onFile={(file) => onResume(cloud, file)}>
            {t('pointcloud_upload_resume')}
          </FilePickButton>
        )}
      </>
    )
  }
  if (cloud.status === 'queued') return <span className="pointcloud-meta">{t('pointcloud_status_queued')}</span>
  if (cloud.status === 'processing') {
    return (
      <div className="pointcloud-progress">
        <progress max={1} value={cloud.progress ?? 0} />
        <span className="pointcloud-meta">{fill('pointcloud_status_processing', { share: Math.floor(100 * (cloud.progress ?? 0)) })}</span>
      </div>
    )
  }
  if (cloud.status === 'failed') {
    return (
      <>
        <span className="form-error">{fill('pointcloud_status_failed', { reason: cloud.error ?? '' })}</span>
        {mayEdit && <button className="modal-btn modal-btn-cancel" onClick={() => onRetry(cloud)}>{t('pointcloud_retry')}</button>}
      </>
    )
  }
  return null
}

/** Fit the map to a box in a plane. */
function fitPlaneBox(map, bounds, crs) {
  const corners = planeCoordsToWgs84([[bounds.minE, bounds.minN], [bounds.maxE, bounds.maxN]], crs)
  map.fitBounds(new maplibregl.LngLatBounds(corners[0], corners[0]).extend(corners[1]), { padding: 80, maxZoom: 19 })
}

/**
 * The project's clouds (AP 13.6): those on the server — seen by every member,
 * with the state of their upload or preparation — and those on this device
 * only. Where each lies, how big, and, for whoever may, delete, resume an
 * upload or start a failed preparation again.
 */
export default function CloudList({ local, server, uploads, mayEdit, busy, onDeleteLocal, onDeleteServer, onResume, onRetry }) {
  const { t, fill, language } = useI18n()
  const map = useMap()
  const [asking, setAsking] = useState(null)    // { cloud, server } a delete waits on

  const showLocal = (cloud) => {
    const coords = outlineFeature(cloud).geometry.coordinates.flat()
    if (!coords.length || !map?.current) return
    const box = coords.reduce((b, c) => b.extend(c), new maplibregl.LngLatBounds(coords[0], coords[0]))
    map.current.fitBounds(box, { padding: 80, maxZoom: 19 })
  }

  const loading = local == null || server == null
  const none = !loading && !local.length && !server.length
  return (
    <>
      <h3 className="pointcloud-list-title">{t('pointcloud_list')}</h3>
      {loading && <p className="selecting-hint">…</p>}
      {none && <p className="selecting-hint">{t('pointcloud_none')}</p>}
      {(server ?? []).map(c => (
        <div key={c.id} className="pointcloud-item">
          <span><strong>{c.name}</strong> <span className="pointcloud-badge">{t('pointcloud_badge_server')}</span></span>
          <span className="pointcloud-meta">
            {`${t('pointcloud_crs_short')}: ${c.crs == null ? t('pointcloud_crs_local') : crsText(c.crs)}`
              + ` · ${t('pointcloud_height_short')}: ${heightDatumLabel(c.heightEpsg)}`
              + (c.rgb ? ` · ${t('pointcloud_rgb')}` : '')}
          </span>
          {c.status === 'ready' && (
            <span className="pointcloud-meta">
              {`${fill('pointcloud_points', { n: count(c.levels[0]?.points ?? c.sourcePoints) })} · `
                + `${fill('pointcloud_levels', { n: c.levels.length })} · ${sizeText(c.bytes)}`}
            </span>
          )}
          <span className="pointcloud-meta">{`${c.file.name} · ${sizeText(c.file.size)} · ${formatDate(c.createdAt, language, { time: true })}`}</span>
          <ServerStatus cloud={c} upload={uploads.find(u => u.cloudId === c.id)} mayEdit={mayEdit} onResume={onResume} onRetry={onRetry} />
          <div className="pointcloud-actions">
            {c.status === 'ready' && c.crs != null && c.bounds && (
              <button className="modal-btn modal-btn-cancel" onClick={() => map?.current && fitPlaneBox(map.current, c.bounds, c.crs)}>
                {t('pointcloud_show')}
              </button>
            )}
            {mayEdit && !uploads.some(u => u.cloudId === c.id) && (
              <button className="modal-btn modal-btn-confirm" onClick={() => setAsking({ cloud: c, server: true })}>{t('modal_delete')}</button>
            )}
          </div>
        </div>
      ))}
      {(local ?? []).map(c => {
        const [w, h] = cloudSize(c)
        return (
          <div key={c.id} className="pointcloud-item">
            <span><strong>{c.name}</strong> <span className="pointcloud-badge local">{t('pointcloud_badge_local')}</span></span>
            <span className="pointcloud-meta">
              {`${t('pointcloud_crs_short')}: ${crsText(c.sourceCrs)}`
                + (c.sourceCrs !== c.crs ? ` → ${crsText(c.crs)}` : '')
                + ` · ${t('pointcloud_height_short')}: ${heightDatumLabel(c.heightEpsg)}`}
            </span>
            <span className="pointcloud-meta">
              {(c.grid
                ? fill('pointcloud_resolution_original_short', { step: stepText(c.grid.scale[0]) })
                : t('pointcloud_resolution_voxel_short'))
                + (c.rgb ? ` · ${t('pointcloud_rgb')}` : '')}
            </span>
            <span className="pointcloud-meta">
              {`${Math.round(w)} × ${Math.round(h)} m · ${c.bounds.minZ.toFixed(1)}–${c.bounds.maxZ.toFixed(1)} m · `
                + `${fill('pointcloud_points', { n: count(c.points) })} · ${sizeText(c.bytes)}`}
            </span>
            <span className="pointcloud-meta">{`${c.file?.name ?? ''} · ${formatDate(c.createdAt, language, { time: true })}`}</span>
            <div className="pointcloud-actions">
              <button className="modal-btn modal-btn-cancel" onClick={() => showLocal(c)}>{t('pointcloud_show')}</button>
              {mayEdit && (
                <button className="modal-btn modal-btn-confirm" disabled={busy} onClick={() => setAsking({ cloud: c, server: false })}>
                  {t('modal_delete')}
                </button>
              )}
            </div>
          </div>
        )
      })}
      {asking && (
        <ConfirmModal
          message={fill(asking.server ? 'pointcloud_delete_ask_server' : 'pointcloud_delete_ask', { name: asking.cloud.name })}
          onConfirm={() => { (asking.server ? onDeleteServer : onDeleteLocal)(asking.cloud); setAsking(null) }}
          onCancel={() => setAsking(null)} />
      )}
    </>
  )
}
