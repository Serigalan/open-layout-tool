import { useEffect, useMemo, useRef, useState } from 'react'
import { loadTracks } from '../../../storage'
import { trackLabel } from '../../../utils/trackModel'
import { RAILS, DEFAULT_RAIL, superstructureAt } from '../../../utils/crossSectionUtils'
import { wgs84ToUTM, utmToWgs84 } from '../../../utils/coordinateUtils'
import { traceTrack, trackGuide, lineGuide, TRACE_STEP } from '../../../utils/pointCloud/railTrace'
import { surveyFromTrace, surveyPoints } from '../../../utils/axisSurvey'
import { cloudRefsOf } from '../../../utils/pointCloud/surveyShift'
import { generateId } from '../../../utils/identifierUtils'
import { saveAxisSurvey } from '../../../storage'
import { useMayEditClouds } from '../../../hooks/useCurrentUser'
import useServerRun, { runIsActive, runsOnServer } from '../../../../server/useServerRun'
import { useI18n } from '../../../locales/i18nContext'
import { tOr, formatDate } from '../../../locales/i18n'
import { useProject } from '../../../hooks/useStore'
import { useMap } from '../../../map/MapContext'
import usePreview from '../../../map/usePreview'
import useMapPick from '../../../map/useMapPick'
import { TRACKS_HOVER_LAYER } from '../../../map/layerIds'
import { PALETTE } from '../../../styles/palette'
import FormSection from '../../form/FormSection'
import { SO_REFERENCES, exportAxisPoints } from './axisExport'
import ServerRunStatus from './ServerRunStatus'

// The guide drawn by hand, and the axis points found along it.
const GUIDE_SOURCE = 'railtrace-guide-source'
const POINTS_SOURCE = 'railtrace-points-source'
const TRACE_LAYERS = [
  {
    sourceId: GUIDE_SOURCE,
    layer: {
      id: 'railtrace-guide-layer', type: 'line',
      paint: { 'line-color': PALETTE.mapCandidate, 'line-width': 2, 'line-dasharray': [3, 2] },
    },
  },
  {
    sourceId: POINTS_SOURCE,
    layer: {
      id: 'railtrace-points-layer', type: 'circle',
      paint: {
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 15, 1.5, 19, 4],
        'circle-color': ['match', ['get', 'quality'], 'good', PALETTE.measuredAxis, PALETTE.mapHover],
        'circle-stroke-color': PALETTE.white,
        'circle-stroke-width': 0.5,
      },
    },
  },
]

/**
 * Finding a track's axis in the point clouds (AP 12.2): walk a guide — a
 * track of the project or a line drawn on the map (Entscheidung 129) — find
 * the rail heads every 50 cm, show the axis points on the map and hand them
 * out as a point file (Entscheidung 138) or keep them with the project as a
 * measured axis (AP 12.3). `paused` leaves the map's clicks to someone else.
 *
 * Where every cloud lies on the server and the user may start jobs there, the
 * trace runs on the server (AP 13.7, decision 237); its result waits there
 * until it is kept as a measured axis, also after the window was closed.
 *
 * `retrace` a measured axis to trace anew after a re-referencing (AP 13.15):
 * its guide, rail and name are taken over, and kept it replaces the old one.
 */
export default function RailTraceSection({ clouds, paused = false, retrace = null, onRetraced }) {
  const mayEdit = useMayEditClouds()
  const { t, fill, language } = useI18n()
  const project = useProject()
  const tracks = loadTracks()
  const [mode, setMode] = useState('track')      // 'track' | 'line'
  const [trackId, setTrackId] = useState('')
  const [line, setLine] = useState([])           // [lng, lat] vertices of a drawn guide
  const [drawing, setDrawing] = useState(false)
  const [rail, setRail] = useState(DEFAULT_RAIL)
  const [soReference, setSoReference] = useState('lower')
  const [run, setRun] = useState(null)           // { share } while tracing
  const [result, setResult] = useState(null)     // { points, gaps, epsg, name } | { error }
  const [surveyName, setSurveyName] = useState('')
  const [saved, setSaved] = useState(null)       // the name of the measured axis just kept
  const abortRef = useRef(null)
  useEffect(() => () => abortRef.current?.abort(), [])

  // A measured axis to trace anew: along its track, or along its own points.
  const [replacing, setReplacing] = useState(null)
  if (retrace && retrace !== replacing) {
    setReplacing(retrace)
    setResult(null)
    setSaved(null)
    setRail(retrace.rail ?? DEFAULT_RAIL)
    setSurveyName(retrace.name)
    if (retrace.guide?.kind === 'track' && tracks.some(tr => tr.id === retrace.guide.trackId)) {
      setMode('track')
      setTrackId(retrace.guide.trackId)
    } else {
      const pts = surveyPoints(retrace)
      const every = Math.max(1, Math.floor(pts.length / 200))
      setMode('line')
      setDrawing(false)
      setLine(pts.filter((_, i) => i % every === 0 || i === pts.length - 1).map(p => utmToWgs84(p.easting, p.northing, retrace.epsg)))
    }
  }
  const onServer = runsOnServer(clouds, mayEdit)
  const server = useServerRun(project.id, 'trace', null, clouds.some(c => c.server))
  const serverBusy = runIsActive(server.run)

  // What the browser found just now, else the last trace on the server not yet kept.
  const shown = useMemo(() => {
    if (result) return result
    const r = server.run
    if (r?.status !== 'done' || !r.result) return null
    return { ...r.result, name: r.subject?.name || t('railtrace_line_name'), run: r }
  }, [result, server.run, t])

  const track = tracks.find(tr => tr.id === trackId) ?? null
  const chooseTrack = (id) => {
    setTrackId(id)
    const tr = tracks.find(x => x.id === id)
    if (tr) setRail(superstructureAt(tr, 0).rail)
  }

  // A track is picked on the map as well as from the list; a guide line is
  // drawn click by click.
  useMapPick({
    active: mode === 'track' && !run && !paused, hover: 'track',
    onPick: (hit) => chooseTrack(hit.trackId),
  })
  const addVertex = (e) => setLine(prev => [...prev, [e.lngLat.lng, e.lngLat.lat]])
  useMapPick({ active: drawing && !paused, onPick: (_hit, e) => addVertex(e), onMiss: addVertex, cursor: false })

  // A cross hair while a guide is drawn.
  const map = useMap()
  useEffect(() => {
    const canvas = map?.current?.getCanvas()
    if (!canvas || !drawing) return undefined
    canvas.style.cursor = 'crosshair'
    return () => { canvas.style.cursor = '' }
  }, [map, drawing])

  const preview = usePreview(TRACE_LAYERS, { resetFilters: [TRACKS_HOVER_LAYER], resetCursor: true })
  useEffect(() => {
    preview.set(GUIDE_SOURCE, mode === 'line' && line.length >= 2
      ? { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: line } }
      : null)
  }, [preview, mode, line])
  useEffect(() => {
    const pts = shown?.points ?? []
    preview.set(POINTS_SOURCE, {
      type: 'FeatureCollection',
      features: pts.map(p => ({
        type: 'Feature', properties: { quality: p.quality },
        geometry: { type: 'Point', coordinates: utmToWgs84(p.easting, p.northing, shown.epsg) },
      })),
    })
  }, [preview, shown])

  // A drawn guide lies in the plane of the clouds' tiles.
  const lineEpsg = clouds.find(c => c.crs != null)?.crs
  const lineVertices = () => line.map(ll => { const p = wgs84ToUTM(ll, lineEpsg); return [p.easting, p.northing] })
  const guide = mode === 'track'
    ? (track ? trackGuide(track) : null)
    : (line.length >= 2 && !drawing && lineEpsg ? lineGuide(lineVertices(), lineEpsg) : null)
  const guideName = () => (mode === 'track' ? trackLabel(track) : t('railtrace_line_name'))

  const startOnServer = () => {
    if (!guide) return
    setResult(null)
    setSaved(null)
    const name = guideName()
    setSurveyName(name)
    server.start(
      { rail, guide: mode === 'track' ? { kind: 'track', track } : { kind: 'line', epsg: lineEpsg, vertices: lineVertices() } },
      { name, guide: mode, trackId: mode === 'track' ? trackId : '', rail },
    )
  }

  const start = async () => {
    if (!guide) return
    const ctl = new AbortController()
    abortRef.current = ctl
    setResult(null)
    setSaved(null)
    setRun({ share: 0 })
    try {
      const r = await traceTrack({
        projectId: project.id, clouds, guide, rail,
        signal: ctl.signal, onProgress: (share) => setRun({ share }),
      })
      const name = guideName()
      setResult({ ...r, name })
      setSurveyName(name)
    } catch (err) {
      if (err?.name !== 'AbortError') setResult({ error: err.message })
    }
    setRun(null)
  }

  const exportCsv = () => exportAxisPoints(shown.points, { name: shown.name, epsg: shown.epsg, soReference })

  // Kept with the project, the points show in the list of measured axes;
  // the trace's own preview gives way to it. A trace from the server says
  // itself what it followed, and is forgotten there once kept.
  const keep = () => {
    const name = surveyName.trim() || shown.name
    const about = shown.run?.subject
    const by = about
      ? { rail: about.rail, guide: about.guide === 'track' ? { kind: 'track', trackId: about.trackId } : { kind: 'line' } }
      : { rail, guide: mode === 'track' ? { kind: 'track', trackId } : { kind: 'line' } }
    saveAxisSurvey(surveyFromTrace({
      id: replacing?.id ?? generateId(), name, ...by,
      cloudNames: clouds.map(c => c.name), cloudRefs: cloudRefsOf(clouds), createdAt: new Date().toISOString(), step: TRACE_STEP,
    }, shown))
    if (shown.run) server.forget()
    setResult(null)
    setSaved(name)
    if (replacing) { setReplacing(null); onRetraced?.() }
  }

  const good = shown?.points?.filter(p => p.quality === 'good').length ?? 0

  return (
    <FormSection title={t('railtrace_title')}>
      <p className="selecting-hint">{t('railtrace_hint')}</p>
      {replacing && <p className="selecting-hint">{fill('railtrace_retrace', { name: replacing.name })}</p>}
      <div className="form-field">
        <label>{t('railtrace_guide')}</label>
        <select value={mode} disabled={!!run}
          onChange={e => { setMode(e.target.value); setDrawing(false) }}>
          <option value="track">{t('railtrace_guide_track')}</option>
          <option value="line">{t('railtrace_guide_line')}</option>
        </select>
      </div>
      {mode === 'track' && (
        <div className="form-field">
          <label>{t('railtrace_track')}</label>
          <select value={trackId} disabled={!!run} onChange={e => chooseTrack(e.target.value)}>
            <option value="">{t('pointcloud_choose')}</option>
            {tracks.map(tr => <option key={tr.id} value={tr.id}>{trackLabel(tr)}</option>)}
          </select>
          <span className="range-use">{t('railtrace_track_hint')}</span>
        </div>
      )}
      {mode === 'line' && (
        <div className="form-field">
          <p className="selecting-hint">
            {drawing ? fill('railtrace_drawing', { n: line.length }) : t('railtrace_line_hint')}
          </p>
          <div className="pointcloud-actions">
            {drawing ? (
              <button className="modal-btn modal-btn-primary" disabled={line.length < 2} onClick={() => setDrawing(false)}>
                {t('railtrace_line_done')}
              </button>
            ) : (
              <button className="modal-btn modal-btn-cancel" disabled={!!run}
                onClick={() => { setLine([]); setDrawing(true) }}>
                {line.length ? t('railtrace_line_redraw') : t('railtrace_line_draw')}
              </button>
            )}
          </div>
        </div>
      )}
      <div className="form-field">
        <label>{t('railtrace_rail')}</label>
        <select value={rail} disabled={!!run} onChange={e => setRail(e.target.value)}>
          {Object.entries(RAILS).map(([key, v]) => <option key={key} value={key}>{v.label}</option>)}
        </select>
      </div>
      {run ? (
        <>
          <progress className="full-width" max={1} value={run.share} />
          <span className="range-use">{t('pointcloud_runs_in_browser')}</span>
          <button className="panel-btn panel-btn-danger panel-btn-full" onClick={() => abortRef.current?.abort()}>
            {t('btn_cancel')}
          </button>
        </>
      ) : serverBusy ? (
        <ServerRunStatus run={server.run} mayCancel={mayEdit} onCancel={server.cancel} />
      ) : (
        <button className="panel-btn panel-btn-full" disabled={!guide} onClick={onServer ? startOnServer : start}>
          {t('railtrace_start')}
        </button>
      )}
      {server.error && <p className="form-error">{tOr(t, `pointcloud_err_${server.error.code}`, server.error.message)}</p>}
      {server.run?.status === 'failed' && !run && <p className="form-error">{fill('server_run_failed', { reason: server.run.error ?? '' })}</p>}
      {result?.error && <p className="form-error">{result.error}</p>}
      {saved && <p className="selecting-hint">{fill('axis_survey_saved', { name: saved })}</p>}
      {shown?.run && (
        <span className="range-use">
          {fill('server_run_trace_of', { name: shown.name, date: formatDate(shown.run.finishedAt, language, { time: true }) })}
        </span>
      )}
      {shown?.points && (
        <>
          <p className="selecting-hint">
            {fill('railtrace_found', { n: shown.points.length, good, doubtful: shown.points.length - good })}
          </p>
          {shown.gaps.length > 0 && (
            <p className="selecting-hint">
              {fill('railtrace_gaps', {
                list: shown.gaps.map(g => (g.from === g.to ? g.from.toFixed(1) : `${g.from.toFixed(1)}–${g.to.toFixed(1)}`)).join(', '),
              })}
            </p>
          )}
          {shown.points.length > 0 && (
            <>
              <div className="form-field">
                <label>{t('railtrace_so')}</label>
                <select value={soReference} onChange={e => setSoReference(e.target.value)}>
                  {SO_REFERENCES.map(r => <option key={r} value={r}>{t(`railtrace_so_${r}`)}</option>)}
                </select>
              </div>
              <button className="panel-btn panel-btn-full" onClick={exportCsv}>{t('railtrace_export')}</button>
              <span className="range-use">{fill('railtrace_export_hint', { epsg: String(shown.epsg) })}</span>
              {mayEdit ? (
                <>
                  <div className="form-field">
                    <label>{t('axis_survey_name')}</label>
                    <input type="text" value={surveyName} onChange={e => setSurveyName(e.target.value)} />
                  </div>
                  <button className="panel-btn panel-btn-full" onClick={keep}>{t('axis_survey_save')}</button>
                  <span className="range-use">{t('axis_survey_save_hint')}</span>
                </>
              ) : <span className="range-use">{t('pointcloud_view_only')}</span>}
            </>
          )}
        </>
      )}
    </FormSection>
  )
}
