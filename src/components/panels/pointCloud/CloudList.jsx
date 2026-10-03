import { useState } from 'react'
import maplibregl from 'maplibre-gl'
import { crsName } from '../../../utils/coordinateUtils'
import { heightDatumLabel } from '../../../utils/heightDatums'
import { outlineFeature, cloudSize } from '../../../utils/pointCloud/cloudOutline'
import { count, sizeText } from '../../../utils/pointCloud/cloudFormat'
import { useI18n } from '../../../locales/i18nContext'
import { formatDate } from '../../../locales/i18n'
import { useMap } from '../../../map/MapContext'
import ConfirmModal from '../../ConfirmModal'

const crsText = (code) => crsName(code) ?? `EPSG ${code}`

/** The clouds stored for the project on this device: where each lies, how big, and delete. */
export default function CloudList({ clouds, busy, onDelete }) {
  const { t, fill, language } = useI18n()
  const map = useMap()
  const [asking, setAsking] = useState(null)    // the cloud a delete waits on

  const showOnMap = (cloud) => {
    const coords = outlineFeature(cloud).geometry.coordinates.flat()
    if (!coords.length || !map?.current) return
    const box = coords.reduce((b, c) => b.extend(c), new maplibregl.LngLatBounds(coords[0], coords[0]))
    map.current.fitBounds(box, { padding: 80, maxZoom: 19 })
  }

  return (
    <>
      <h3 className="pointcloud-list-title">{t('pointcloud_list')}</h3>
      {clouds == null && <p className="selecting-hint">…</p>}
      {clouds?.length === 0 && <p className="selecting-hint">{t('pointcloud_none')}</p>}
      {clouds?.map(c => {
        const [w, h] = cloudSize(c)
        return (
          <div key={c.id} className="pointcloud-item">
            <strong>{c.name}</strong>
            <span className="pointcloud-meta">
              {`${t('pointcloud_crs_short')}: ${crsText(c.sourceCrs)}`
                + (c.sourceCrs !== c.crs ? ` → ${crsText(c.crs)}` : '')
                + ` · ${t('pointcloud_height_short')}: ${heightDatumLabel(c.heightEpsg)}`}
            </span>
            <span className="pointcloud-meta">
              {`${Math.round(w)} × ${Math.round(h)} m · ${c.bounds.minZ.toFixed(1)}–${c.bounds.maxZ.toFixed(1)} m · `
                + `${fill('pointcloud_points', { n: count(c.points) })} · ${sizeText(c.bytes)}`}
            </span>
            <span className="pointcloud-meta">{`${c.file?.name ?? ''} · ${formatDate(c.createdAt, language, { time: true })}`}</span>
            <div className="pointcloud-actions">
              <button className="modal-btn modal-btn-cancel" onClick={() => showOnMap(c)}>{t('pointcloud_show')}</button>
              <button className="modal-btn modal-btn-confirm" disabled={busy} onClick={() => setAsking(c)}>{t('modal_delete')}</button>
            </div>
          </div>
        )
      })}
      {asking && (
        <ConfirmModal message={fill('pointcloud_delete_ask', { name: asking.name })}
          onConfirm={() => { onDelete(asking); setAsking(null) }} onCancel={() => setAsking(null)} />
      )}
    </>
  )
}
