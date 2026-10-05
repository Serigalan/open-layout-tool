import { useEffect, useState } from 'react'
import maplibregl from 'maplibre-gl'
import { deleteAxisSurvey } from '../../../storage'
import { surveyPoints, surveyStats } from '../../../utils/axisSurvey'
import { RAILS } from '../../../utils/crossSectionUtils'
import { crsName, utmToWgs84 } from '../../../utils/coordinateUtils'
import { useI18n } from '../../../locales/i18nContext'
import { formatDate } from '../../../locales/i18n'
import { useAxisSurveys } from '../../../hooks/useStore'
import { useMap } from '../../../map/MapContext'
import usePreview from '../../../map/usePreview'
import { PALETTE } from '../../../styles/palette'
import ConfirmModal from '../../ConfirmModal'
import { SO_REFERENCES, exportAxisPoints } from './axisExport'

// The measured axes of the project, while the panel is open.
const SURVEY_SOURCE = 'axis-survey-source'
const SURVEY_LAYERS = [{
  sourceId: SURVEY_SOURCE,
  layer: {
    id: 'axis-survey-layer', type: 'circle',
    paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 15, 1.2, 19, 3.5],
      'circle-color': ['match', ['get', 'quality'], 'good', PALETTE.measuredAxis, PALETTE.mapHover],
      'circle-opacity': 0.7,
    },
  },
}]

/**
 * The measured axes kept with the project (AP 12.3, Entscheidung 132): on
 * every device, whether or not the clouds they came from are there — shown on
 * the map, exported as a point file, deleted.
 */
export default function AxisSurveyList() {
  const { t, fill, language } = useI18n()
  const map = useMap()
  const surveys = useAxisSurveys()
  const [soReference, setSoReference] = useState('lower')
  const [asking, setAsking] = useState(null)   // the survey a delete waits on

  const preview = usePreview(SURVEY_LAYERS)
  useEffect(() => {
    preview.set(SURVEY_SOURCE, {
      type: 'FeatureCollection',
      features: surveys.flatMap(s => surveyPoints(s).map(p => ({
        type: 'Feature', properties: { quality: p.quality },
        geometry: { type: 'Point', coordinates: utmToWgs84(p.easting, p.northing, s.epsg) },
      }))),
    })
  }, [preview, surveys])

  const showOnMap = (survey) => {
    const coords = surveyPoints(survey).map(p => utmToWgs84(p.easting, p.northing, survey.epsg))
    if (!coords.length || !map?.current) return
    const box = coords.reduce((b, c) => b.extend(c), new maplibregl.LngLatBounds(coords[0], coords[0]))
    map.current.fitBounds(box, { padding: 80, maxZoom: 19 })
  }

  if (!surveys.length) return null

  return (
    <>
      <h3 className="pointcloud-list-title">{t('axis_survey_list')}</h3>
      <div className="form-field">
        <label>{t('railtrace_so')}</label>
        <select value={soReference} onChange={e => setSoReference(e.target.value)}>
          {SO_REFERENCES.map(r => <option key={r} value={r}>{t(`railtrace_so_${r}`)}</option>)}
        </select>
      </div>
      {surveys.map(s => {
        const st = surveyStats(s)
        return (
          <div key={s.id} className="pointcloud-item">
            <strong>{s.name}</strong>
            <span className="pointcloud-meta">
              {fill('axis_survey_points', { n: st.points, good: st.good, from: st.from.toFixed(1), to: st.to.toFixed(1) })}
            </span>
            <span className="pointcloud-meta">
              {`${RAILS[s.rail]?.label ?? s.rail ?? ''} · ${crsName(s.epsg) ?? `EPSG ${s.epsg}`}`
                + (s.createdAt ? ` · ${formatDate(s.createdAt, language, { time: true })}` : '')}
            </span>
            <div className="pointcloud-actions">
              <button className="modal-btn modal-btn-cancel" onClick={() => showOnMap(s)}>{t('pointcloud_show')}</button>
              <button className="modal-btn modal-btn-cancel"
                onClick={() => exportAxisPoints(surveyPoints(s), { name: s.name, epsg: s.epsg, soReference })}>
                {t('axis_survey_export')}
              </button>
              <button className="modal-btn modal-btn-confirm" onClick={() => setAsking(s)}>{t('modal_delete')}</button>
            </div>
          </div>
        )
      })}
      {asking && (
        <ConfirmModal message={fill('axis_survey_delete_ask', { name: asking.name })}
          onConfirm={() => { deleteAxisSurvey(asking.id); setAsking(null) }} onCancel={() => setAsking(null)} />
      )}
    </>
  )
}
