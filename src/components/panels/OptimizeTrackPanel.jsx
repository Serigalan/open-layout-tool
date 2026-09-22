import { useEffect, useState } from 'react'
import { loadTracks, updateTrack, recalcAbsLengths, rebuildCoords } from '../../storage'
import {
  optimizeOnServer, optimizerReachable, fetchRegelwerke, OptimizerError,
} from '../../utils/optimizerService'
import { reconstructElements } from '../../utils/elementReconstruct'
import { HIT_TOLERANCE, ZOOM_LINE_WIDTH } from '../../utils/mapConstants'
import useTrackHover from '../../hooks/useTrackHover'
import usePreviewLayers from '../../hooks/usePreviewLayers'
import { truncateHeights } from '../../utils/heightUtils'
import { grundText } from '../../utils/optimizeReport'
import { BackIcon, OptimizeTrackModeIcon, OptimizeElementModeIcon } from '../icons'

const OPTIMIZE_PREVIEW_SOURCE = 'optimize-preview-source'
const OPTIMIZE_PREVIEW_LAYER  = 'optimize-preview-layer'
const EMPTY_FC = { type: 'FeatureCollection', features: [] }

const OPTIMIZE_PREVIEW_LAYERS = [{
  sourceId: OPTIMIZE_PREVIEW_SOURCE,
  layer: {
    id: OPTIMIZE_PREVIEW_LAYER, type: 'line',
    paint: {
      'line-color': '#ff8c00',
      'line-width': ZOOM_LINE_WIDTH,
      'line-dasharray': [6, 4],
    },
  },
}]

function trackLabel(track) {
  return [track.lineNumber, track.trackNumber].filter(Boolean).join(' / ') || track.name || track.id.slice(0, 8)
}

function previewGeoJSON(elements) {
  const coords = elements.reduce((acc, el, i) => {
    const c = el.renderCoords ?? el.geometry?.coordinates ?? []
    return i === 0 ? [...c] : [...acc, ...c.slice(1)]
  }, [])
  return {
    type: 'FeatureCollection',
    features: [{ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: coords } }],
  }
}

/**
 * The vertical alignment the optimized track keeps. It is stationed along the
 * track and independent of the elements, so re-shaping them changes nothing
 * for it as long as their lengths do — where the first length moves, the
 * stations behind it move with it, and the rest is read from the terrain again
 * (see elevationFill).
 */
function reshapedHeights(track, elements) {
  const old = track.elements ?? []
  const i = elements.findIndex((el, k) => (el.length ?? 0) !== (old[k]?.length ?? 0))
  if (i === -1 && elements.length === old.length) return track.heights
  const cutAt = elements.slice(0, Math.max(0, i)).reduce((sum, el) => sum + (el.length ?? 0), 0)
  return truncateHeights(track.heights, cutAt)
}

// `initialPage`/`onExit` are what the merged splice-and-optimize panel passes:
// it opens the panel straight in a mode and takes the back button back to its
// own menu. Standalone, the panel starts in its own menu as before.
export default function OptimizeTrackPanel({ t, map, project, onTrackSaved, initialPage = 'menu', onExit }) {
  const [page, setPage]           = useState(initialPage)    // 'menu' | 'track' | 'element'
  const mode = page
  const [phase, setPhase]         = useState('select')
  const [trackId, setTrackId]     = useState(null)
  const [elementIdx, setElementIdx] = useState(null)    // nur im Element-Modus
  const [label, setLabel]         = useState('')
  const [corridorCm, setCorridorCm] = useState(50)
  const [uf, setUf]               = useState('130')
  const [vMax, setVMax]           = useState('')     // '' → kein Ziel, offen nach oben
  const [regelwerke, setRegelwerke] = useState([])   // [{id,name,version,gueltigAb}], AP R.3
  const [regelwerkId, setRegelwerkId] = useState('') // '' → Dienst-Vorgabe
  const [selectHint, setSelectHint] = useState(null)
  const [running, setRunning]     = useState(false)
  const [run, setRun]             = useState(null)    // { key, result? , error? }
  const [reachable, setReachable] = useState(null)    // null → not asked yet

  // A result only counts for the parameters it was computed with — derived
  // from the parameter key rather than through an invalidation effect.
  const runKey = [mode, trackId, elementIdx, corridorCm, uf, vMax, regelwerkId, phase].join('|')
  const result = run?.key === runKey ? run.result ?? null : null
  const runError = run?.key === runKey ? run.error ?? null : null

  useTrackHover(map, page === 'menu' ? 'menu' : phase, 'select', project)
  usePreviewLayers(map, OPTIMIZE_PREVIEW_LAYERS, { resetFilters: ['tracks-hover-layer'], resetCursor: true })

  // ── Track/element selection ────────────────────────────────────────────────
  useEffect(() => {
    if (page === 'menu' || phase !== 'select' || !map?.current) return
    const m = map.current
    const onClick = (e) => {
      const bbox = [
        [e.point.x - HIT_TOLERANCE, e.point.y - HIT_TOLERANCE],
        [e.point.x + HIT_TOLERANCE, e.point.y + HIT_TOLERANCE],
      ]
      const features = m.queryRenderedFeatures(bbox, { layers: ['tracks-layer'] })
      if (!features.length) return
      const track = loadTracks(project.id).find(tr => tr.id === features[0].properties.trackId)
      if (!track) return
      if (mode === 'element') {
        const elIdx = Number(features[0].properties.elementIndex)
        const el = track.elements?.[elIdx]
        if (!el || el.radius == null) {
          setSelectHint(t('optimize_hint_element_only'))
          return
        }
        setElementIdx(elIdx)
        setLabel(`${trackLabel(track)} · #${elIdx + 1}`)
      } else {
        setElementIdx(null)
        setLabel(trackLabel(track))
      }
      setSelectHint(null)
      setTrackId(track.id)
      setPhase('config')
    }
    m.on('click', onClick)
    return () => m.off('click', onClick)
  }, [page, phase, mode, map, project.id, t])

  // The service is asked once when the panel opens, so the panel can say there
  // is no server instead of offering a run that cannot happen. The regelwerke
  // it knows come along the same trip (AP R.3) — an empty list is not an
  // error here, `reachable` already says so; the panel just falls back to
  // sending no id, which the service reads as its own default.
  useEffect(() => {
    if (page === 'menu') return
    let cancelled = false
    optimizerReachable().then(ok => { if (!cancelled) setReachable(ok) })
    fetchRegelwerke().then(list => { if (!cancelled) setRegelwerke(list) })
    return () => { cancelled = true }
  }, [page])

  // Sync the map preview (external system) with the current result.
  useEffect(() => {
    const src = map?.current?.getSource(OPTIMIZE_PREVIEW_SOURCE)
    if (!src) return
    src.setData(result ? previewGeoJSON(result.elements) : EMPTY_FC)
  }, [result, map])

  const handleCancel = () => {
    if (map?.current) map.current.getSource(OPTIMIZE_PREVIEW_SOURCE)?.setData(EMPTY_FC)
    setPhase('select')
    setTrackId(null)
    setElementIdx(null)
    setSelectHint(null)
  }

  const backButton = (
    <button className="back-btn" onClick={() => { handleCancel(); onExit ? onExit() : setPage('menu') }}>
      <BackIcon />
      {t('btn_back')}
    </button>
  )

  const handleRun = () => {
    const track = loadTracks(project.id).find(tr => tr.id === trackId)
    if (!track || running) return
    const key = runKey
    setRun(null)
    setRunning(true)
    optimizeOnServer({
      track, corridorCm, uf: Number(uf), uebergang: 'auto', maxiter: 100,
      ...(Number(vMax) > 0 ? { vMax: Number(vMax) } : {}),
      ...(regelwerkId ? { regelwerk: regelwerkId } : {}),
      ...(mode === 'element' ? { targetElementIdx: elementIdx } : {}),
    })
      .then(res => {
        setRun({ key, result: { ...res, elements: reconstructElements(res.elements, track.epsg) } })
        setReachable(true)
      })
      .catch(err => {
        const code = err instanceof OptimizerError ? err.code : 'unavailable'
        // A topology the optimizer will not take comes back with its own
        // sentence — that names the actual element sequence, which no generic
        // key can. Everything else is translated from the key.
        const translated = t(`optimize_err_${code}`)
        setRun({
          key,
          error: err.detail
            || (translated === `optimize_err_${code}` ? t('optimize_err_internal') : translated),
        })
        if (code === 'unavailable') setReachable(false)
      })
      .finally(() => setRunning(false))
  }

  const handleCommit = () => {
    const track = loadTracks(project.id).find(tr => tr.id === trackId)
    if (!track || !result?.report.some(r => r.changed)) return
    const elements = recalcAbsLengths(result.elements)
    updateTrack(project.id, {
      ...track, elements, coordinates: rebuildCoords(elements),
      heights: reshapedHeights(track, elements),
      // The regelwerk this alignment was drawn under — without it a design a
      // few years old is not reproducible once a second regelwerk exists.
      regelwerk: result.regelwerk,
    })
    onTrackSaved?.()
    handleCancel()
  }

  if (page === 'menu') {
    return (
      <>
        <h2>{t('optimize_track')}</h2>
        <div className="create-element-options">
          <button className="create-element-btn" onClick={() => setPage('track')}>
            <OptimizeTrackModeIcon />
            {t('optimize_mode_track')}
          </button>
          <button className="create-element-btn" onClick={() => setPage('element')}>
            <OptimizeElementModeIcon />
            {t('optimize_mode_element')}
          </button>
        </div>
      </>
    )
  }

  const title = t(mode === 'element' ? 'optimize_mode_element' : 'optimize_mode_track')

  if (phase === 'select') {
    return (
      <>
        {backButton}
        <h2>{title}</h2>
        <p>{t(mode === 'element' ? 'optimize_hint_select_element' : 'optimize_hint_select')}</p>
        {selectHint && (
          <p style={{ color: '#e74c3c', fontSize: 12, marginTop: 4 }}>{selectHint}</p>
        )}
      </>
    )
  }

  const changed = result?.report.filter(r => r.changed).length ?? 0
  const canCommit = changed > 0
  return (
    <>
      {backButton}
      <h2>{title}</h2>
      <div className="element-form">
        <div className="form-field">
          <label>{mode === 'element' ? t('optimize_mode_element') : 'Track'}</label>
          <input type="text" readOnly value={label} />
        </div>
        <div className="form-field">
          <label>{t('optimize_corridor')}: {corridorCm} cm</label>
          <input type="range" min="0" max="50" step="1" value={corridorCm}
            onChange={e => setCorridorCm(Number(e.target.value))} />
        </div>
        <div className="form-field">
          <label>{t('optimize_vmax')}</label>
          <input type="number" min="0" step="10" placeholder={t('optimize_vmax_open')}
            value={vMax} onChange={e => setVMax(e.target.value)} />
        </div>
        <div className="form-field">
          <label>{t('optimize_uf')}</label>
          <select value={uf} onChange={e => setUf(e.target.value)}>
            <option value="110">110 mm ({t('optimize_uf_switches')})</option>
            <option value="130">130 mm</option>
            <option value="150">150 mm</option>
          </select>
        </div>
        {regelwerke.length > 0 && (
          <div className="form-field">
            <label>{t('optimize_regelwerk')}</label>
            {regelwerke.length > 1 ? (
              <select value={regelwerkId || regelwerke[0].id} onChange={e => setRegelwerkId(e.target.value)}>
                {regelwerke.map(rw => <option key={rw.id} value={rw.id}>{rw.name}</option>)}
              </select>
            ) : (
              <input type="text" readOnly value={regelwerke[0].name} />
            )}
          </div>
        )}
      </div>

      <div className="element-form" style={{ marginTop: 8 }}>
        {reachable === false ? (
          // The run happens on the server and nowhere else; without one the
          // panel says so rather than offering a button that cannot work.
          <p style={{ color: '#e74c3c', fontSize: 12 }}>{t('optimize_err_unavailable')}</p>
        ) : (
          <button
            className="panel-btn panel-btn-full"
            onClick={handleRun}
            disabled={running || !trackId}
            style={{ opacity: running ? 0.5 : 1 }}
          >
            {t('optimize_run')}
          </button>
        )}
        {running && (
          <p style={{ color: '#5b9bd5', fontSize: 12, marginTop: 4 }}>{t('optimize_running')}</p>
        )}
        {runError && (
          <p style={{ color: '#e74c3c', fontSize: 12, marginTop: 4 }}>{runError}</p>
        )}
        {result && (
          <div style={{ marginTop: 4 }}>
            {result.report.map((r, i) => (
              <div key={i} style={{ fontSize: 12, fontFamily: 'system-ui, sans-serif', padding: '4px 0', borderBottom: '1px solid #eee' }}>
                <strong>{t('optimize_curve')} {r.group}{r.arcs > 1 ? `.${r.arc}` : ''}{r.target ? ` (${t('optimize_target')})` : ''}</strong>{' '}
                {r.changed ? (
                  <>
                    r {Math.round(r.rAlt)} → {Math.round(r.rNeu)} m · u {r.uAlt} → {r.uNeu} mm<br />
                    v {r.vAlt.toFixed(0)} → {r.vNeu.toFixed(0)} km/h · {t('optimize_offset_used')} {r.offsetCm.toFixed(0)} cm
                    {grundText(t, r.grund) && (
                      <><br /><span style={{ color: '#888' }}>{grundText(t, r.grund)}</span></>
                    )}
                  </>
                ) : (
                  <span style={{ color: '#888' }}>{t('optimize_unchanged')}</span>
                )}
              </div>
            ))}
            {result.skipped?.length > 0 && (
              // Part of the track was left alone. Saying so beats handing back
              // half an answer in silence — and beats the refusal it used to be.
              <p style={{ fontSize: 12, color: '#c8860d', marginTop: 4 }}>
                {t('optimize_skipped')
                  .replace('{{count}}', result.skipped.length)
                  .replace('{{where}}', result.skipped
                    .map(s => s.from === s.to ? `#${s.from + 1}` : `#${s.from + 1}–${s.to + 1}`)
                    .join(', '))}
                {' '}{result.skipped[0].why}
              </p>
            )}
            <p style={{ fontSize: 12, color: changed ? '#5b9bd5' : '#e74c3c', marginTop: 4 }}>
              {changed
                ? <>{t('optimize_done')}: v {result.vBestand.toFixed(0)} → {result.vNeu.toFixed(0)} km/h
                    {' · '}{t('optimize_variant')}: {result.variant}</>
                : t('optimize_nothing')}
            </p>
          </div>
        )}
      </div>

      <button
        className="panel-btn panel-btn-full"
        style={{ marginTop: 8, opacity: canCommit ? 1 : 0.5 }}
        onClick={handleCommit}
        disabled={!canCommit}
      >
        {t('btn_commit')}
      </button>
      <button className="panel-btn panel-btn-full" style={{ marginTop: 2, background: '#888' }} onClick={handleCancel}>
        {t('btn_cancel')}
      </button>
    </>
  )
}
