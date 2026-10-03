import { useEffect, useState } from 'react'
import { loadTracks, updateTrack } from '../../storage'
import { trackLabel } from '../../utils/trackModel'
import {
  optimizeOnServer, optimizerReachable, fetchRegelwerke, OptimizerError,
} from '../../utils/optimizerService'
import { reconstructElements } from '../../utils/elementReconstruct'
import { ZOOM_LINE_WIDTH } from '../../map/style'
import { optimizeRequest, optimizedTrack, optimizeErrorText } from '../../utils/optimizeApply'
import { BackIcon, OptimizeTrackModeIcon, OptimizeElementModeIcon } from '../icons'
import { useI18n } from '../../locales/i18nContext'
import { useMap } from '../../map/MapContext'
import { TRACKS_HOVER_LAYER } from '../../map/layerIds'
import usePreview from '../../map/usePreview'
import useMapPick from '../../map/useMapPick'
import { PALETTE } from '../../styles/palette'
import CommitBar from '../form/CommitBar'
import OptimizeSettings from './optimize/OptimizeSettings'
import OptimizeResult from './optimize/OptimizeResult'

const OPTIMIZE_PREVIEW_SOURCE = 'optimize-preview-source'
const OPTIMIZE_PREVIEW_LAYER  = 'optimize-preview-layer'

const OPTIMIZE_PREVIEW_LAYERS = [{
  sourceId: OPTIMIZE_PREVIEW_SOURCE,
  layer: {
    id: OPTIMIZE_PREVIEW_LAYER, type: 'line',
    paint: {
      'line-color': PALETTE.mapHover,
      'line-width': ZOOM_LINE_WIDTH,
      'line-dasharray': [6, 4],
    },
  },
}]

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

// `initialPage`/`onExit` are what the merged splice-and-optimize panel passes:
// it opens the panel straight in a mode and takes the back button back to its
// own menu. Standalone, the panel starts in its own menu as before.
export default function OptimizeTrackPanel({ initialPage = 'menu', onExit, onShowRegelwerk }) {
  const { t } = useI18n()
  const map = useMap()
  const [page, setPage]           = useState(initialPage)    // 'menu' | 'track' | 'element'
  const mode = page
  const [phase, setPhase]         = useState('select')
  const [trackId, setTrackId]     = useState(null)
  const [elementIdx, setElementIdx] = useState(null)    // nur im Element-Modus
  const [label, setLabel]         = useState('')
  // What the run is held to (OptimizeSettings). vMax '' sets no target, open
  // upwards; regelwerkId '' leaves the choice to the service's default.
  const [settings, setSettings]   = useState({ corridorCm: 50, grenzwert: 'reg', vMax: '', regelwerkId: '' })
  const setSetting = (key, value) => setSettings(prev => ({ ...prev, [key]: value }))
  const [regelwerke, setRegelwerke] = useState([])   // [{id,name,version}], AP R.3
  const [catalogDrift, setCatalogDrift] = useState(null)   // R0.1
  const [selectHint, setSelectHint] = useState(null)
  const [running, setRunning]     = useState(false)
  const [run, setRun]             = useState(null)    // { key, result? , error? }
  const [reachable, setReachable] = useState(null)    // null → not asked yet

  // A result only counts for the parameters it was computed with — derived
  // from the parameter key rather than through an invalidation effect.
  const runKey = [mode, trackId, elementIdx, settings.corridorCm, settings.grenzwert, settings.vMax, settings.regelwerkId, phase].join('|')
  const result = run?.key === runKey ? run.result ?? null : null
  const runError = run?.key === runKey ? run.error ?? null : null

  const preview = usePreview(OPTIMIZE_PREVIEW_LAYERS, { resetFilters: [TRACKS_HOVER_LAYER], resetCursor: true })

  // ── Track/element selection ────────────────────────────────────────────────
  useMapPick({
    active: page !== 'menu' && phase === 'select', hover: 'element',
    onPick: ({ trackId: id, elementIndex: elIdx }) => {
      const track = loadTracks().find(tr => tr.id === id)
      if (!track) return
      if (mode === 'element') {
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
    },
  })

  // The service is asked once when the panel opens, so the panel can say there
  // is no server instead of offering a run that cannot happen. The regelwerke
  // it knows come along the same trip (AP R.3) — an empty list is not an
  // error here, `reachable` already says so; the panel just falls back to
  // sending no id, which the service reads as its own default.
  useEffect(() => {
    if (page === 'menu') return
    let cancelled = false
    optimizerReachable().then(ok => { if (!cancelled) setReachable(ok) })
    fetchRegelwerke().then(({ regelwerke: list, drift }) => {
      if (cancelled) return
      setRegelwerke(list)
      setCatalogDrift(drift)
    })
    return () => { cancelled = true }
  }, [page])

  // Sync the map preview (external system) with the current result.
  useEffect(() => {
    preview.set(OPTIMIZE_PREVIEW_SOURCE, result ? previewGeoJSON(result.elements) : null)
  }, [result, preview])

  const handleCancel = () => {
    if (map?.current) preview.set(OPTIMIZE_PREVIEW_SOURCE, null)
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
    const track = loadTracks().find(tr => tr.id === trackId)
    if (!track || running) return
    const key = runKey
    setRun(null)
    setRunning(true)
    optimizeOnServer(optimizeRequest(track, { ...settings, elementIdx: mode === 'element' ? elementIdx : null }))
      .then(res => {
        setRun({ key, result: { ...res, elements: reconstructElements(res.elements, track.epsg) } })
        setReachable(true)
      })
      .catch(err => {
        const code = err instanceof OptimizerError ? err.code : 'unavailable'
        setRun({ key, error: optimizeErrorText(t, code, err.detail) })
        if (code === 'unavailable') setReachable(false)
      })
      .finally(() => setRunning(false))
  }

  const handleCommit = () => {
    const track = loadTracks().find(tr => tr.id === trackId)
    if (!track || !result?.report.some(r => r.changed)) return
    updateTrack(optimizedTrack(track, result))
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
          <p className="msg-error">{selectHint}</p>
        )}
      </>
    )
  }

  const canCommit = (result?.report.filter(r => r.changed).length ?? 0) > 0
  return (
    <>
      {backButton}
      <h2>{title}</h2>
      <OptimizeSettings label={label} what={mode === 'element' ? t('optimize_mode_element') : 'Track'}
        s={settings} set={setSetting} regelwerke={regelwerke} onShowRegelwerk={onShowRegelwerk} />
      <div className="element-form mt-8">
        {catalogDrift && <p className="msg-error">{t('optimizer_catalog_drift')}</p>}
        {/* The run happens on the server and nowhere else; without one the
            panel says so rather than offering a button that cannot work. */}
        {reachable === false
          ? <p className="msg-error">{t('optimize_err_unavailable')}</p>
          : <button className="panel-btn panel-btn-full" onClick={handleRun} disabled={running || !trackId}>{t('optimize_run')}</button>}
        {running && <p className="msg-info">{t('optimize_running')}</p>}
        {runError && <p className="msg-error">{runError}</p>}
        {result && <OptimizeResult result={result} />}
      </div>
      <CommitBar onCommit={handleCommit} onCancel={handleCancel} disabled={!canCommit} />
    </>
  )
}
