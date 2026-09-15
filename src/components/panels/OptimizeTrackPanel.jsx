import { useEffect, useMemo, useState } from 'react'
import { loadTracks, updateTrack, recalcAbsLengths, rebuildCoords } from '../../storage'
import { optimizeTrack } from '../../utils/optimizeUtils'
import { optimizeWithPython } from '../../utils/pyodideOptimizer'
import { reconstructElements } from '../../utils/elementReconstruct'
import { HIT_TOLERANCE, ZOOM_LINE_WIDTH } from '../../utils/mapConstants'
import useTrackHover from '../../hooks/useTrackHover'
import usePreviewLayers from '../../hooks/usePreviewLayers'
import { truncateHeights } from '../../utils/heightUtils'

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

export default function OptimizeTrackPanel({ t, map, project, onTrackSaved }) {
  const [page, setPage]           = useState('menu')    // 'menu' | 'track' | 'element'
  const mode = page
  const [phase, setPhase]         = useState('select')
  const [trackId, setTrackId]     = useState(null)
  const [elementIdx, setElementIdx] = useState(null)    // nur im Element-Modus
  const [label, setLabel]         = useState('')
  const [corridorCm, setCorridorCm] = useState(50)
  const [uf, setUf]               = useState('130')
  const [selectHint, setSelectHint] = useState(null)
  const [pyStage, setPyStage]     = useState(null)    // 'runtime' | 'packages' | 'running'
  const [pyRun, setPyRun]         = useState(null)    // { key, result? , error? }

  // Ein Python-Ergebnis gilt nur für die Parameter, mit denen es gerechnet
  // wurde — abgeleitet über den Parameter-Schlüssel statt Invalidierungs-Effect.
  const pyKey = [mode, trackId, elementIdx, corridorCm, uf, phase].join('|')
  const pyResult = pyRun?.key === pyKey ? pyRun.result ?? null : null
  const pyError  = pyRun?.key === pyKey ? pyRun.error ?? null : null

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

  // Optimization result derived from the parameters (pure + fast).
  const result = useMemo(() => {
    if (phase !== 'config' || !trackId) return null
    const track = loadTracks(project.id).find(tr => tr.id === trackId)
    if (!track) return null
    return optimizeTrack(track, { corridor: corridorCm / 100, uf: Number(uf) },
      mode === 'element' ? elementIdx : null)
  }, [phase, mode, trackId, elementIdx, corridorCm, uf, project.id])

  const changedCount = result && !result.error ? result.results.filter(r => r.changed).length : 0
  const status = !result ? null
    : result.error ? { msg: t(result.error), error: true }
    : changedCount ? { msg: `${changedCount}/${result.results.length} ${t('optimize_curves_improved')}`, error: false }
    : { msg: t('optimize_nothing'), error: true }

  // Sync the map preview (external system) with the current result — a Python
  // result (explicitly computed) takes precedence over the live JS preview.
  useEffect(() => {
    const src = map?.current?.getSource(OPTIMIZE_PREVIEW_SOURCE)
    if (!src) return
    const elements = pyResult?.elements ?? (result && !result.error ? result.elements : null)
    src.setData(elements ? previewGeoJSON(elements) : EMPTY_FC)
  }, [result, pyResult, map])

  const handleCancel = () => {
    if (map?.current) map.current.getSource(OPTIMIZE_PREVIEW_SOURCE)?.setData(EMPTY_FC)
    setPhase('select')
    setTrackId(null)
    setElementIdx(null)
    setSelectHint(null)
  }

  const backButton = (
    <button className="back-btn" onClick={() => { handleCancel(); setPage('menu') }}>
      <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
        <path d="M10 3 L5 8 L10 13" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
      {t('btn_back')}
    </button>
  )

  const runPython = () => {
    const track = loadTracks(project.id).find(tr => tr.id === trackId)
    if (!track || pyStage) return
    const key = pyKey
    setPyRun(null)
    setPyStage('runtime')
    optimizeWithPython(
      {
        track, corridorCm, uf: Number(uf), uebergang: 'auto', maxiter: 100,
        ...(mode === 'element' ? { targetElementIdx: elementIdx } : {}),
      },
      (stage) => setPyStage(stage),
    )
      .then(res => {
        setPyRun({ key, result: { ...res, elements: reconstructElements(res.elements, track.epsg) } })
        setPyStage(null)
      })
      .catch(err => {
        setPyRun({ key, error: err.message })
        setPyStage(null)
      })
  }

  const handleCommit = () => {
    const track = loadTracks(project.id).find(tr => tr.id === trackId)
    if (!track) return
    let newElements = null
    if (pyResult && pyResult.report.some(r => r.changed)) {
      newElements = pyResult.elements
    } else if (result && !result.error && result.results.some(r => r.changed)) {
      newElements = result.elements
    }
    if (!newElements) return
    const elements = recalcAbsLengths(newElements)
    updateTrack(project.id, {
      ...track, elements, coordinates: rebuildCoords(elements),
      heights: reshapedHeights(track, elements),
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
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M1 15 Q2 6 8 3 Q12 1 15 1" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round"/>
              <path d="M3.5 15 Q4.5 8.5 9 5.5 Q12 3.8 15 3.8" stroke="currentColor" strokeWidth="1.2" strokeDasharray="2.5 1.5" fill="none" opacity="0.6"/>
            </svg>
            {t('optimize_mode_track')}
          </button>
          <button className="create-element-btn" onClick={() => setPage('element')}>
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <circle cx="2" cy="14" r="2" fill="currentColor"/>
              <path d="M2 14 A12 12 0 0 1 14 2" stroke="currentColor" fill="none"/>
              <circle cx="14" cy="2" r="2" fill="currentColor"/>
              <path d="M4.5 13 A10.5 10.5 0 0 1 13 4.5" stroke="currentColor" strokeDasharray="2 1.5" fill="none" opacity="0.6"/>
            </svg>
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

  const canCommit = (pyResult && pyResult.report.some(r => r.changed))
    || (result && !result.error && result.results.some(r => r.changed))
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
          <label>{t('optimize_uf')}</label>
          <select value={uf} onChange={e => setUf(e.target.value)}>
            <option value="110">110 mm ({t('optimize_uf_switches')})</option>
            <option value="130">130 mm</option>
            <option value="150">150 mm</option>
          </select>
        </div>
      </div>

      {result && !result.error && (
        <div className="element-form" style={{ marginTop: 8 }}>
          {result.results.map((r, i) => (
            <div key={i} style={{ fontSize: 12, fontFamily: 'system-ui, sans-serif', padding: '4px 0', borderBottom: '1px solid #eee' }}>
              <strong>{t('optimize_curve')} {i + 1}</strong>{' '}
              {r.changed ? (
                <>
                  r {Math.round(r.rAlt)} → {Math.round(r.rNeu)} m · u {r.uAlt} → {r.uNeu} mm<br />
                  v {r.vAlt.toFixed(0)} → {r.vNeu.toFixed(0)} km/h · {t('optimize_offset_used')} {(r.offset * 100).toFixed(0)} cm
                </>
              ) : (
                <span style={{ color: '#888' }}>{t('optimize_unchanged')}</span>
              )}
            </div>
          ))}
        </div>
      )}

      {status && (
        <p style={{ color: status.error ? '#e74c3c' : '#5b9bd5', fontSize: 12, marginTop: 4 }}>
          {status.msg}
        </p>
      )}

      <div className="element-form" style={{ marginTop: 8 }}>
        <button
          className="panel-btn panel-btn-full"
          onClick={runPython}
          disabled={!!pyStage || !trackId}
          style={{ opacity: pyStage ? 0.5 : 1 }}
        >
          {t('optimize_py_run')}
        </button>
        {pyStage && (
          <p style={{ color: '#5b9bd5', fontSize: 12, marginTop: 4 }}>
            {t(`optimize_py_${pyStage}`)}
          </p>
        )}
        {pyError && (
          <p style={{ color: '#e74c3c', fontSize: 12, marginTop: 4 }}>{pyError}</p>
        )}
        {pyResult && (
          <div style={{ marginTop: 4 }}>
            {pyResult.report.map((r, i) => (
              <div key={i} style={{ fontSize: 12, fontFamily: 'system-ui, sans-serif', padding: '4px 0', borderBottom: '1px solid #eee' }}>
                <strong>{t('optimize_curve')} {r.group}{r.arcs > 1 ? `.${r.arc}` : ''}{r.target ? ` (${t('optimize_target')})` : ''}</strong>{' '}
                {r.changed ? (
                  <>
                    r {Math.round(r.rAlt)} → {Math.round(r.rNeu)} m · u {r.uAlt} → {r.uNeu} mm<br />
                    v {r.vAlt.toFixed(0)} → {r.vNeu.toFixed(0)} km/h · {t('optimize_offset_used')} {r.offsetCm.toFixed(0)} cm
                  </>
                ) : (
                  <span style={{ color: '#888' }}>{t('optimize_unchanged')}</span>
                )}
              </div>
            ))}
            <p style={{ fontSize: 12, color: '#5b9bd5', marginTop: 4 }}>
              {t('optimize_py_done')}: v {pyResult.vBestand.toFixed(0)} → {pyResult.vNeu.toFixed(0)} km/h
              {' · '}{t('optimize_py_variant')}: {pyResult.variant}
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
