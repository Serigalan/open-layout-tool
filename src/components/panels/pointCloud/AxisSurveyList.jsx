import { useEffect, useState } from 'react'
import maplibregl from 'maplibre-gl'
import { deleteAxisSurvey, saveAxisSurvey } from '../../../storage'
import { surveyChanges, shiftSurvey } from '../../../utils/pointCloud/surveyShift'
import { surveyPoints, surveyStats } from '../../../utils/axisSurvey'
import { RAILS } from '../../../utils/crossSectionUtils'
import { crsName, utmToWgs84 } from '../../../utils/coordinateUtils'
import { useI18n } from '../../../locales/i18nContext'
import { formatDate } from '../../../locales/i18n'
import { useAxisSurveys } from '../../../hooks/useStore'
import { useMayEditClouds } from '../../../hooks/useCurrentUser'
import { useMap } from '../../../map/MapContext'
import usePreview from '../../../map/usePreview'
import { PALETTE } from '../../../styles/palette'
import ConfirmModal from '../../ConfirmModal'
import { SO_REFERENCES, exportAxisPoints } from './axisExport'
import useAxisPointEraser from './useAxisPointEraser'

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
 * the map, exported as a point file, deleted, or cleared of single wrong
 * points on the map (`erasingId` the survey that is, `onErasing` to change it).
 *
 * One traced in a cloud whose re-referencing changed since is marked "taken
 * before the re-referencing" (AP 13.15) and can be carried along with it or
 * traced anew (`onRetrace(survey)`). `cloudRows` the project's server clouds.
 */
export default function AxisSurveyList({ erasingId = null, onErasing, onRetrace, cloudRows = [] }) {
  const { t, fill, language } = useI18n()
  const map = useMap()
  const surveys = useAxisSurveys()
  const mayEdit = useMayEditClouds()
  const [soReference, setSoReference] = useState('lower')
  const [asking, setAsking] = useState(null)   // the survey a delete waits on

  const preview = usePreview(SURVEY_LAYERS)
  useEffect(() => {
    preview.set(SURVEY_SOURCE, {
      type: 'FeatureCollection',
      features: surveys.flatMap(s => surveyPoints(s).map((p, i) => ({
        type: 'Feature', properties: { quality: p.quality, surveyId: s.id, st: s.points.st[i] },
        geometry: { type: 'Point', coordinates: utmToWgs84(p.easting, p.northing, s.epsg) },
      }))),
    })
  }, [preview, surveys])

  useAxisPointEraser({ survey: surveys.find(s => s.id === erasingId), layer: SURVEY_LAYERS[0].layer.id })

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
        const changes = surveyChanges(s, cloudRows)
        // Carried along only where it came from one cloud alone.
        const shiftable = changes.length === 1 && (s.cloudRefs ?? []).length === 1
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
              {mayEdit && (
                <>
                  <button className={`modal-btn modal-btn-cancel${erasingId === s.id ? ' active' : ''}`}
                    onClick={() => onErasing?.(erasingId === s.id ? null : s.id)}>
                    {t(erasingId === s.id ? 'axis_survey_erase_done' : 'axis_survey_erase')}
                  </button>
                  <button className="modal-btn modal-btn-confirm" onClick={() => setAsking(s)}>{t('modal_delete')}</button>
                </>
              )}
            </div>
            {erasingId === s.id && <span className="selecting-hint">{t('axis_survey_erase_hint')}</span>}
            {changes.length > 0 && (
              <>
                <span className="form-error">{fill('axis_survey_outdated', { clouds: changes.map(c => c.name).join(', ') })}</span>
                {mayEdit && (
                  <div className="pointcloud-actions">
                    {shiftable && (
                      <button className="modal-btn modal-btn-cancel" onClick={() => saveAxisSurvey(shiftSurvey(s, changes[0]))}>
                        {t('axis_survey_shift')}
                      </button>
                    )}
                    {onRetrace && (
                      <button className="modal-btn modal-btn-cancel" onClick={() => onRetrace(s)}>{t('axis_survey_retrace')}</button>
                    )}
                  </div>
                )}
              </>
            )}
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
