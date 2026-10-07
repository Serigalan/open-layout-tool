import { useState } from 'react'
import maplibregl from 'maplibre-gl'
import { deleteReferenceAxis } from '../../../storage'
import { axisOutline, axisRange } from '../../../utils/referenceAxis'
import { crsName, utmToWgs84 } from '../../../utils/coordinateUtils'
import { heightDatumLabel } from '../../../utils/heightDatums'
import { formatDate } from '../../../locales/i18n'
import { useI18n } from '../../../locales/i18nContext'
import { useReferenceAxes } from '../../../hooks/useStore'
import { useMap } from '../../../map/MapContext'
import useReferenceAxesOnMap from '../../../map/useReferenceAxesOnMap'
import ConfirmModal from '../../ConfirmModal'

/**
 * The reference axes of the project (Paket V): each with the stretch of its
 * stationing it covers, how many points, whether it has heights and in which
 * system — shown on the map while the list is, zoomed to, deleted.
 */
export default function ReferenceAxisList() {
  const { t, fill, num, language } = useI18n()
  const map = useMap()
  const axes = useReferenceAxes()
  const [asking, setAsking] = useState(null)
  useReferenceAxesOnMap('reference-axis-list', axes)

  const showOnMap = (axis) => {
    const coords = axisOutline(axis, 5).map(([e, n]) => utmToWgs84(e, n, axis.epsg))
    if (!coords.length || !map?.current) return
    const box = coords.reduce((b, c) => b.extend(c), new maplibregl.LngLatBounds(coords[0], coords[0]))
    map.current.fitBounds(box, { padding: 80, maxZoom: 18 })
  }

  if (!axes.length) return null
  return (
    <>
      <h3 className="pointcloud-list-title">{t('reference_axis_list')}</h3>
      {axes.map(a => {
        const r = axisRange(a)
        return (
          <div key={a.id} className="pointcloud-item">
            <strong>{a.name}</strong>
            <span className="pointcloud-meta">{fill('reference_axis_meta', {
              from: num(r.from, { digits: 2 }), to: num(r.to, { digits: 2 }),
              n: num(a.points.de.length, { digits: 0 }),
            })}</span>
            <span className="pointcloud-meta">
              {`${crsName(a.epsg) ?? `EPSG ${a.epsg}`} · `
                + (a.points.z ? heightDatumLabel(a.heightEpsg) : t('reference_axis_no_heights'))
                + (a.source?.importedAt ? ` · ${formatDate(a.source.importedAt, language, { time: true })}` : '')}
            </span>
            <div className="pointcloud-actions">
              <button className="modal-btn modal-btn-cancel" onClick={() => showOnMap(a)}>{t('pointcloud_show')}</button>
              <button className="modal-btn modal-btn-confirm" onClick={() => setAsking(a)}>{t('modal_delete')}</button>
            </div>
          </div>
        )
      })}
      {asking && (
        <ConfirmModal message={fill('reference_axis_delete_ask', { name: asking.name })}
          onConfirm={() => { deleteReferenceAxis(asking.id); setAsking(null) }} onCancel={() => setAsking(null)} />
      )}
    </>
  )
}
