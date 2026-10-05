import { useEffect, useMemo, useState } from 'react'
import maplibregl from 'maplibre-gl'
import { commitImport } from '../../../storage'
import {
  ALIGN_DEFAULTS, alignRequest, deleteStraight, elementReport, fittedCurvature, parseAxisPointFile,
  straightRanges, surveyAxis, trackFromFit,
} from '../../../utils/alignmentFit'
import { alignOnServer, optimizerReachable, OptimizerError } from '../../../utils/optimizerService'
import { optimizeErrorText } from '../../../utils/optimizeApply'
import { reconstructElements } from '../../../utils/elementReconstruct'
import { EPSG_OPTIONS, crsLabel, projectCrsOptions, utmToWgs84 } from '../../../utils/coordinateUtils'
import { useI18n } from '../../../locales/i18nContext'
import { useAxisSurveys, useTracks } from '../../../hooks/useStore'
import { useMap } from '../../../map/MapContext'
import usePreview from '../../../map/usePreview'
import { ZOOM_LINE_WIDTH } from '../../../map/style'
import { PALETTE } from '../../../styles/palette'
import useElapsed from '../../../hooks/useElapsed'
import CommitBar from '../../form/CommitBar'
import FilePickButton from '../../form/FilePickButton'
import NumberInput from '../../form/NumberInput'
import CurvatureChart from '../../chart/CurvatureChart'

/** How long edits must rest before the service is asked again [ms]. */
const ALIGN_DEBOUNCE = 300

const FIT_SOURCE = 'axis-fit-line'
const POINT_SOURCE = 'axis-fit-points'
const HOVER_SOURCE = 'axis-fit-hover'
const FIT_LAYERS = [
  { sourceId: FIT_SOURCE, layer: { id: 'axis-fit-line-layer', type: 'line',
    paint: { 'line-color': PALETTE.previewLine, 'line-width': ZOOM_LINE_WIDTH, 'line-dasharray': [6, 4] } } },
  { sourceId: POINT_SOURCE, layer: { id: 'axis-fit-points-layer', type: 'circle',
    paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 15, 1.2, 19, 3.5],
      'circle-color': ['case', ['get', 'over'], PALETTE.error, PALETTE.measuredAxis],
      'circle-opacity': 0.7,
    } } },
  { sourceId: HOVER_SOURCE, layer: { id: 'axis-fit-hover-layer', type: 'circle',
    paint: { 'circle-radius': 6, 'circle-color': PALETTE.mapHover, 'circle-opacity': 0.8 } } },
]

// The chord the service reads the curvature diagram with: shorter is sharper
// at the ends of a transition but noisier (κ = 8f/c²); it clamps to 2–50 m.
const SETTINGS = [
  { key: 'chord', unit: 'm', step: 1, min: 2, max: 50, hint: 'align_set_chord_hint' },
  { key: 'window', unit: 'm', step: 0.5 },
  { key: 'toleranceMm', unit: 'mm', step: 1 },
  { key: 'step', unit: 'm', step: 0.1 },
  { key: 'spacing', unit: 'm', step: 1 },
  { key: 'sagittaMm', unit: 'mm', step: 0.5 },
  { key: 'minLength', unit: 'm', step: 1 },
]

const fmt = (v, digits = 1) => (v == null ? '–' : Number(v).toFixed(digits))
const mm = (m) => (m == null ? '–' : (m * 1000).toFixed(1))

/** What one element of the fit is called in the report. */
function elementLabel(t, r) {
  if (r.elementType === 0) return t('align_el_straight')
  if (r.elementType === 1) return `${t('align_el_arc')} R ${fmt(r.radius, 1)}`
  return `${t('align_el_transition')} ${r.r1 ? fmt(r.r1, 0) : '∞'} → ${r.r2 ? fmt(r.r2, 0) : '∞'}`
}

/**
 * "Aus Messachse trassieren" (AP 12.5, stage B of phase 12): a measured axis
 * of the project or a point file in, an alignment of straights, arcs and
 * transitions out — fitted by the service, corrected by hand in the
 * curvature diagram (Entscheidung 133), taken over as a new track
 * (Entscheidung 134). The first run is asked for; after it, every change of
 * the straights or the settings asks the service again once it rests.
 */
export default function AxisFitPanel({ backButton }) {
  const { t, fill } = useI18n()
  const map = useMap()
  const surveys = useAxisSurveys()
  const tracks = useTracks()
  const [sourceId, setSourceId] = useState('')     // a survey's id, or 'file'
  const [file, setFile] = useState(null)           // { name, points, epsg } | { error }
  const [fileEpsg, setFileEpsg] = useState('')
  const [settings, setSettings] = useState(ALIGN_DEFAULTS)
  const [straights, setStraights] = useState(null)  // null: searched for; else set by hand
  const [started, setStarted] = useState(false)
  const [answer, setAnswer] = useState(null)       // { key, data } | { key, error }
  const [selected, setSelected] = useState(null)
  const [inserting, setInserting] = useState(false)
  const [reachable, setReachable] = useState(null)
  const [hover, setHover] = useState(null)
  const [done, setDone] = useState(null)

  useEffect(() => {
    let cancelled = false
    optimizerReachable().then(ok => { if (!cancelled) setReachable(ok) })
    return () => { cancelled = true }
  }, [])

  // The points in use: a survey's, or the file's in the plane chosen for it.
  const survey = surveys.find(s => s.id === sourceId)
  const source = useMemo(() => {
    if (survey) return { key: survey.id, name: survey.name, epsg: Number(survey.epsg), points: surveyAxis(survey) }
    if (sourceId === 'file' && file?.points) {
      const epsg = file.epsg ?? (Number(fileEpsg) || null)
      return epsg ? { key: `file:${file.name}:${epsg}`, name: file.name.replace(/\.[^.]*$/, ''), epsg, points: file.points } : null
    }
    return null
  }, [survey, sourceId, file, fileEpsg])

  const requestKey = started && source ? JSON.stringify([source.key, settings, straights]) : null
  useEffect(() => {
    if (!requestKey) return undefined
    const ctl = new AbortController()
    const timer = setTimeout(async () => {
      try {
        const body = alignRequest(source.points, { straights: straights && straightRanges(straights), settings })
        const data = await alignOnServer(body, { signal: ctl.signal })
        setAnswer({ key: requestKey, data, sourceKey: source.key })
        setReachable(true)
      } catch (err) {
        if (err?.name === 'AbortError') return
        const code = err instanceof OptimizerError ? err.code : 'unavailable'
        setAnswer({ key: requestKey, error: optimizeErrorText(t, code, err.detail), sourceKey: source.key })
        if (code === 'unavailable') setReachable(false)
      }
    }, ALIGN_DEBOUNCE)
    return () => { clearTimeout(timer); ctl.abort() }
    // the key is what source, settings and straights make of the request
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestKey])
  const running = !!requestKey && answer?.key !== requestKey
  const elapsed = useElapsed(running)
  // The last answer for these points stays in view while the next is computed.
  const data = answer?.sourceKey === source?.key ? answer?.data ?? null : null
  const failure = answer?.key === requestKey ? answer?.error ?? null : null
  const shownStraights = straights ?? data?.straights ?? []
  const tolerance = Number(settings.toleranceMm) / 1000

  // ── the map ──
  const preview = usePreview(FIT_LAYERS)
  const pointsWgs = useMemo(() => (source ? source.points.map(p => utmToWgs84(p.easting, p.northing, source.epsg)) : []), [source])
  const fittedLine = useMemo(() => {
    if (!data?.elements || !source) return null
    const els = reconstructElements(data.elements.map(el => ({ ...el, epsg: source.epsg })), source.epsg)
    return els.reduce((acc, el, i) => {
      const c = el.renderCoords ?? el.geometry?.coordinates ?? []
      return i === 0 ? [...c] : [...acc, ...c.slice(1)]
    }, [])
  }, [data, source])
  useEffect(() => {
    preview.set(FIT_SOURCE, fittedLine ? { type: 'FeatureCollection', features: [
      { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: fittedLine } }] } : null)
  }, [preview, fittedLine])
  useEffect(() => {
    const offsets = data?.offsets
    preview.set(POINT_SOURCE, pointsWgs.length ? { type: 'FeatureCollection', features: pointsWgs.map((c, i) => ({
      type: 'Feature', properties: { over: offsets ? Math.abs(offsets[i]) > tolerance : false },
      geometry: { type: 'Point', coordinates: c } })) } : null)
  }, [preview, pointsWgs, data, tolerance])
  useEffect(() => {
    preview.set(HOVER_SOURCE, hover != null && pointsWgs[hover] ? { type: 'FeatureCollection', features: [
      { type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: pointsWgs[hover] } }] } : null)
  }, [preview, pointsWgs, hover])

  const showOnMap = (points, epsg) => {
    const coords = points.map(p => utmToWgs84(p.easting, p.northing, epsg))
    if (!coords.length || !map?.current) return
    const box = coords.reduce((b, c) => b.extend(c), new maplibregl.LngLatBounds(coords[0], coords[0]))
    map.current.fitBounds(box, { padding: 80, maxZoom: 19 })
  }

  // ── choosing the points ──
  const reset = () => {
    setStarted(false); setStraights(null); setSelected(null); setInserting(false); setAnswer(null)
  }
  const chooseSource = (id) => {
    reset()
    setDone(null)
    setSourceId(id)
    const s = surveys.find(x => x.id === id)
    if (s) showOnMap(surveyAxis(s), s.epsg)
  }
  const readFile = async (f) => {
    reset()
    setDone(null)
    const parsed = parseAxisPointFile(await f.text(), f.name)
    setFile(parsed.error ? { error: parsed.error } : { name: f.name, points: parsed.points, epsg: parsed.epsg })
    if (!parsed.error && parsed.epsg) showOnMap(parsed.points, parsed.epsg)
  }

  // ── correcting by hand ──
  const editStraights = (next) => { setStraights(next); setSelected(null) }
  const handleCommit = () => {
    const track = trackFromFit(data, { name: fill('align_track_name', { name: source.name }), epsg: source.epsg })
    if (!track) return
    commitImport({ addTracks: [track] })
    setDone(fill('align_done', { name: track.name, count: track.elements.length }))
    reset()
  }

  const projectCrs = projectCrsOptions(tracks)
  const crsChoice = [...projectCrs, ...EPSG_OPTIONS.filter(o => !projectCrs.some(p => p.code === o.code))]
  const report = data ? elementReport(data, tolerance) : []
  const over = report.filter(r => r.over).length
  const canCommit = !!data?.elements && !running && answer?.key === requestKey

  return (
    <>
      {backButton}
      <h2>{t('optimize_mode_axis')}</h2>
      <p className="selecting-hint">{t('align_hint')}</p>
      <div className="element-form">
        <div className="form-field">
          <label>{t('align_source')}</label>
          <select value={sourceId} onChange={e => chooseSource(e.target.value)}>
            <option value="">{t('pointcloud_choose')}</option>
            {surveys.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            <option value="file">{t('align_source_file')}</option>
          </select>
          {!surveys.length && <span className="msg-hint msg-small">{t('align_no_surveys')}</span>}
        </div>
        {sourceId === 'file' && (
          <div className="form-field">
            <FilePickButton accept=".csv,.txt,.dat" onFile={readFile}>
              {file?.name ?? t('align_file_pick')}
            </FilePickButton>
            {file?.error && <span className="msg-error msg-small">{t(file.error)}</span>}
            {file?.points && (
              <span className="msg-hint msg-small">
                {fill('align_file_loaded', { n: file.points.length })}
                {file.epsg ? ` · ${crsLabel(file.epsg)}` : ''}
              </span>
            )}
            {file?.points && !file.epsg && (
              <select value={fileEpsg} onChange={e => { reset(); setFileEpsg(e.target.value) }}>
                <option value="">{t('align_file_crs')}</option>
                {crsChoice.map(o => <option key={o.code} value={o.code}>EPSG {o.code} – {o.label}</option>)}
              </select>
            )}
          </div>
        )}
        <details className="form-field">
          <summary>{t('align_settings')}</summary>
          {SETTINGS.map(({ key, unit, step, min = 0, max, hint }) => (
            <div key={key} className="form-field">
              <label>{t(`align_set_${key}`)}</label>
              <NumberInput min={min} max={max} step={step} unit={unit} value={settings[key]}
                onChange={e => setSettings(prev => ({ ...prev, [key]: e.target.value }))} />
              {hint && <span className="msg-hint msg-small">{t(hint)}</span>}
            </div>
          ))}
          <button type="button" className="link-btn msg-small" onClick={() => setSettings(ALIGN_DEFAULTS)}>
            {t('align_settings_reset')}
          </button>
        </details>
        {reachable === false
          ? <p className="msg-error">{t('align_err_unavailable')}</p>
          : !started && (
            <button className="panel-btn panel-btn-full" disabled={!source} onClick={() => { setDone(null); setStarted(true) }}>
              {t('align_run')}
            </button>
          )}
        {running && <div className="run-status"><span>{t('optimize_running')} {fill('run_elapsed', { s: elapsed })}</span></div>}
        {failure && <p className="msg-error">{failure}</p>}
        {done && <p className="msg-info">{done}</p>}
      </div>

      {data && (
        <div className="axis-fit-result mt-8">
          <CurvatureChart answer={data} fitted={fittedCurvature(data)} straights={shownStraights}
            tolerance={tolerance} selected={selected} onSelect={setSelected}
            onChange={editStraights} inserting={inserting}
            onInsert={(next) => { editStraights(next); setInserting(false) }} onHover={setHover} />
          <div className="axis-fit-tools">
            <button type="button" className={`panel-btn${inserting ? ' active' : ''}`} onClick={() => setInserting(v => !v)}>
              {t('align_insert')}
            </button>
            <button type="button" className="panel-btn" disabled={selected == null}
              onClick={() => editStraights(deleteStraight(shownStraights, selected))}>
              {t('align_delete')}
            </button>
            <button type="button" className="panel-btn" disabled={straights == null} onClick={() => editStraights(null)}>
              {t('align_auto')}
            </button>
          </div>
          <p className="msg-hint msg-small">
            {straights == null ? t('align_straights_auto') : t('align_straights_hand')}
          </p>
          {data.error && (
            <p className="msg-error">
              {fill(data.error.startsWith('align_error_') ? data.error : 'align_error_curve', data.errorParams ?? {})}
            </p>
          )}
          {data.merged?.length > 0 && (
            <p className="msg-warn">{fill('align_merged', { list: data.merged.map(s => s.toFixed(1)).join(', ') })}</p>
          )}
          {data.gaps?.length > 0 && (
            <p className="msg-warn">{fill('align_gaps', { list: data.gaps.map(g => `${g.from.toFixed(1)}–${g.to.toFixed(1)}`).join(', ') })}</p>
          )}
          {data.elements && (
            <p className={over ? 'msg-warn' : 'msg-info'}>
              {fill('align_summary', { n: data.elements.length, rms: mm(data.rms), max: mm(data.max) })}
              {over > 0 && ` ${fill('align_over', { n: over, tol: settings.toleranceMm })}`}
            </p>
          )}
          {data.curves.map((c, i) => (
            <div key={i} className="list-row">
              <strong>{t(`align_curve_${c.kind}`)} {i + 1}</strong>{' '}
              R {fmt(c.radius, 1)} m · L₁ {fmt(c.l1)} m · L₂ {fmt(c.l2)} m
              <br /><span className="text-muted">{fmt(c.from)}–{fmt(c.to)} m</span>
              {c.notes.map(n => <span key={n} className="msg-warn msg-small"><br />{t(`align_note_${n}`)}</span>)}
            </div>
          ))}
          <details className="mt-4">
            <summary>{fill('align_elements', { n: report.length })}</summary>
            {report.map(r => (
              <div key={r.index} className={`list-row${r.over ? ' msg-error' : ''}`}>
                {r.index + 1}. {elementLabel(t, r)} · {fmt(r.length)} m
                <br /><span className={r.over ? '' : 'text-muted'}>
                  {fmt(r.from)}–{fmt(r.to)} m · {r.n ? fill('align_el_offset', { max: mm(r.max), rms: mm(r.rms) }) : t('align_el_no_points')}
                </span>
              </div>
            ))}
          </details>
          <CommitBar onCommit={handleCommit} onCancel={reset} disabled={!canCommit}
            commitLabel={t('align_commit')} reason={data.elements ? null : t('align_commit_none')} />
        </div>
      )}
    </>
  )
}
