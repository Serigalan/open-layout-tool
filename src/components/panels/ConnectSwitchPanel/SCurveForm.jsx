import { useEffect, useMemo, useRef, useState } from 'react'
import { loadTracks, loadSwitches, commitSwitchConnection } from '../../../storage'
import { nodeUtm } from '../../../utils/elementUtils'
import { switchElementRoute } from '../../../utils/switch/route'
import { transitionCantEnds } from '../../../utils/clothoidUtils'
import { stationFromClick } from '../../../utils/platformUtils'
import { wgs84ToUTM } from '../../../utils/coordinateUtils'
import { SWITCH_TYPES, CONNECTION_SPEEDS, computeSwitchConnections } from '../../../utils/switchConnectionUtils'
import { ZOOM_LINE_WIDTH } from '../../../map/style'
import { useI18n } from '../../../locales/i18nContext'
import { REASON_MSG, buildSCurve, computeShiftBounds, isUsableStem, solveConnection, stems } from '../../../utils/commands/sCurve'
import { TRACKS_HOVER_LAYER } from '../../../map/layerIds'
import usePreview from '../../../map/usePreview'
import useMapPick from '../../../map/useMapPick'
import { PALETTE } from '../../../styles/palette'
import ReadOnlyField from '../../form/ReadOnlyField'
import { trackLabel } from '../../../utils/trackModel'

// ── Preview layers (managed by usePreview) ────────────────────────────
const SCURVE_PREVIEW_SOURCE = 'scurve-preview-source'
const SCURVE_PREVIEW_LAYER  = 'scurve-preview-layer'
const SCURVE_POINTS_SOURCE  = 'scurve-points-source'
const SCURVE_POINTS_LAYER   = 'scurve-points-layer'

const SCURVE_PREVIEW_LAYERS = [
  {
    sourceId: SCURVE_PREVIEW_SOURCE,
    layer: {
      id: SCURVE_PREVIEW_LAYER, type: 'line',
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': ['get', 'colour'], 'line-width': ZOOM_LINE_WIDTH },
    },
  },
  {
    sourceId: SCURVE_POINTS_SOURCE,
    layer: {
      id: SCURVE_POINTS_LAYER, type: 'circle', source: SCURVE_POINTS_SOURCE,
      paint: {
        'circle-radius': 4, 'circle-color': PALETTE.previewPoint,
        'circle-stroke-color': PALETTE.white, 'circle-stroke-width': 1.5,
      },
    },
  },
]

const RAD2DEG = 180 / Math.PI
const DEG2RAD = Math.PI / 180

// Default speed — the one the R = 1200 form is built for, if it is in the table.
const DEFAULT_TYPE = Math.max(0,
  CONNECTION_SPEEDS.indexOf(SWITCH_TYPES.find(s => s.R === 1200)?.speed))

// Build the green/red preview: branch arc + middle element + branch arc
function buildPreviewGeoJSON(result) {
  const colour = result.valid ? PALETTE.valid : PALETTE.invalid
  return {
    type: 'FeatureCollection',
    features: [
      { type: 'Feature', properties: { colour },
        geometry: { type: 'LineString', coordinates: result.arc1Coords ?? [] } },
      { type: 'Feature', properties: { colour: PALETTE.previewLine },
        geometry: { type: 'LineString', coordinates: result.midCoords } },
      { type: 'Feature', properties: { colour },
        geometry: { type: 'LineString', coordinates: result.arc2Coords ?? [] } },
    ],
  }
}

function buildPointsGeoJSON(result) {
  return {
    type: 'FeatureCollection',
    features: [result.tp1Wgs, result.b1eWgs, result.b2aWgs, result.tp2Wgs].map(c => ({
      type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: c },
    })),
  }
}

export default function SCurveForm({ onCommitted }) {
  const { t, fill } = useI18n()
  const [phase, setPhase]   = useState('select_first')  // select_first | select_second | config
  const [picks, setPicks]   = useState([])
  const [speedIdx, setSpeedIdx] = useState(DEFAULT_TYPE)   // selected design speed (index into CONNECTION_SPEEDS)
  const [shiftRaw, setShift] = useState(0)              // start-point offset along line 1 [m]
  const [pickStatus, setPickStatus] = useState(null)    // { msg, error } — selection phases only
  // Straight the turnouts' through routes need beside the junction [m], set
  // when the commit found too little of it (see carveThrough).
  const [carveError, setCarveError] = useState(null)

  const picksRef = useRef(picks)
  const speed    = CONNECTION_SPEEDS[speedIdx] ?? 0

  useEffect(() => { picksRef.current = picks }, [picks])

  // Hover highlight while selecting

  // Setup / cleanup preview layers
  const preview = usePreview(SCURVE_PREVIEW_LAYERS, { resetFilters: [TRACKS_HOVER_LAYER], resetCursor: true })


  // ── Click handler for the two selection phases ────────────────────────────
  useMapPick({
    active: phase === 'select_first' || phase === 'select_second', hover: 'element',
    onPick: ({ trackId, elementIndex }, e) => {
      const elIdx = elementIndex
      const track  = loadTracks().find(tr => tr.id === trackId)
      const el     = track?.elements?.[elIdx]
      if (!el) return

      if (!isUsableStem(el)) {
        setPickStatus({ msg: t('scurve_hint_no_bloss'), error: true })
        return
      }

      const coords   = el.geometry.coordinates
      const startUtm = nodeUtm(el.startNode, coords[0], track.epsg)
      const endUtm   = nodeUtm(el.endNode, coords[coords.length - 1], track.epsg)
      // The clicked point as a station along the element — along its own curve,
      // whatever kind it is.
      const clickUtm = wgs84ToUTM([e.lngLat.lng, e.lngLat.lat], track.epsg)
      const along    = Math.min(el.length, Math.max(0, stationFromClick(track, elIdx, clickUtm) ?? 0))
      // A transition carries no cant of its own; what runs over it is the ramp
      // its neighbours state (transitionCantEnds).
      const ramp     = el.elementType === 2 ? transitionCantEnds(track.elements, elIdx) : null
      const pick     = {
        trackId, elIdx, startUtm, endUtm, bearing: el.bearing,
        route: switchElementRoute(el), along,
        cantStart: ramp ? ramp.start : (el.cant ?? 0),
        cantEnd:   ramp ? ramp.end   : (el.cant ?? 0),
        zone: track.epsg, label: trackLabel(track),
      }

      if (phase === 'select_first') {
        setPicks([pick])
        setPickStatus(null)
        setPhase('select_second')
      } else {
        const first = picksRef.current[0]
        if (first && first.trackId === trackId && first.elIdx === elIdx) return
        setPicks([first, pick])
        setPickStatus(null)
        setPhase('config')
      }
    },
  })

  // ── Valid shift range: keep both turnouts on the elements they were picked on
  const shiftRange = useMemo(() => {
    const wide = { min: -200, max: 200 }
    if (phase !== 'config' || !picks[0] || !picks[1] || !speed) return wide
    return computeShiftBounds({ picks, speed })
  }, [phase, picks, speed])

  // The slider's own value, held inside the range the geometry allows.
  const shift = Math.min(shiftRange.max, Math.max(shiftRange.min, shiftRaw))

  // Which speeds these two tracks can be connected with where the slider stands
  // — the dropdown's disabled state. It follows from the picks and the shift, so
  // it is derived rather than pushed into state by an effect.
  const connections = useMemo(() => {
    if (!picks[0] || !picks[1]) return []
    const { g1, g2 } = stems(picks)
    return computeSwitchConnections(g1, g2, shift)
  }, [picks, shift])

  // ── The connection itself ─────────────────────────────────────────────────
  // Closed-form and pure, so it is derived from the picks, the speed and the
  // slider rather than pushed into state by an effect.
  const result = useMemo(() => (
    phase === 'config' && picks[0] && picks[1] && speed
      ? solveConnection({ picks, speed, shift })
      : null
  ), [phase, picks, speed, shift])

  // ── Preview (the map is the only thing outside React here) ────────────────
  useEffect(() => {
    if (result?.valid) {
      preview.set(SCURVE_PREVIEW_SOURCE, buildPreviewGeoJSON(result))
      preview.set(SCURVE_POINTS_SOURCE, buildPointsGeoJSON(result))
    } else {
      preview.clear()
    }
  }, [result, preview])

  const handleSpeedChange = (i) => {
    setSpeedIdx(i)
  }

  const handleCancel = () => {
    preview.clear()
    setPhase('select_first')
    setPicks([])
    setShift(0)
    setPickStatus(null)
    setCarveError(null)
    onCommitted?.()
  }

  const handleCommit = () => {
    const commit = buildSCurve({ result, picks, tracks: loadTracks(), switches: loadSwitches(), speed })
    if (!commit) return
    if (commit.carveError) { setCarveError(commit.carveError); return }
    commitSwitchConnection(commit)
    handleCancel()
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  if (phase === 'config') {
    const deg = (r) => (r * RAD2DEG).toFixed(3)
    return (
      <>
        <div className="element-form">
          <ReadOnlyField label={t('scurve_line1')} value={picks[0]?.label ?? ''} />
          <ReadOnlyField label={t('scurve_line2')} value={picks[1]?.label ?? ''} />

          <div className="form-field">
            <label>{t('field_speed')}</label>
            <select value={speedIdx} onChange={e => { setCarveError(null); handleSpeedChange(Number(e.target.value)) }}>
              {CONNECTION_SPEEDS.map((sp, i) => (
                <option key={sp} value={i} disabled={connections[i] && !connections[i].valid}>
                  {sp} km/h
                </option>
              ))}
            </select>
          </div>

          <ReadOnlyField label={t('scurve_gap')} value={result ? `${result.gap.toFixed(2)} m` : ''} />

          <div className="form-field">
            <label>{t('scurve_shift')}: {shift} m</label>
            <input type="range" min={shiftRange.min} max={shiftRange.max} step="1" value={shift}
              onChange={e => { setCarveError(null); setShift(Number(e.target.value)) }} />
          </div>
        </div>

        {result?.valid && (
          <div className="element-form mt-8">
            <ReadOnlyField label={t('scurve_switch_type')} value={result.switchType.label} />
            <ReadOnlyField label={t('scurve_angle')} value={`1:${result.switchType.ratio}  (${deg(result.w)}°)`} />
            <ReadOnlyField label={t('scurve_delta')} value={`${deg(result.delta)}°`} />
            <ReadOnlyField label={t('scurve_zgl')} value={`${result.Lg.toFixed(2)} m`} />
            <ReadOnlyField label={t('scurve_mid_radius')} value={result.signedRg
                ? `${Math.abs(result.signedRg).toFixed(0)} m`
                : t('scurve_mid_straight')} />
            <ReadOnlyField label={t('scurve_branch_radius')} value={[result.signedR1, result.signedR2]
                .map(r => (r ? `${Math.abs(r).toFixed(0)} m` : t('scurve_mid_straight')))
                .join('  /  ')} />
            {result.cantMid !== 0 && (
              <ReadOnlyField label={t('scurve_cant')} value={`${Math.abs(result.cantMid)} mm`} />
            )}
            <ReadOnlyField label={t('scurve_total')} value={`${result.laenge.toFixed(2)} m`} />
          </div>
        )}

        <p className={result?.valid ? 'msg-info' : 'msg-error'}>
          {result?.valid ? t('scurve_valid') : t(REASON_MSG[result?.reason] ?? 'scurve_invalid')}
        </p>
        {carveError != null && (
          <p className="form-error">
            {fill('switch_on_track_no_room', { m: carveError.toFixed(1) })}
          </p>
        )}

        <button
          className="panel-btn panel-btn-full mt-8"
          onClick={handleCommit}
          disabled={!result?.valid}
        >
          {t('btn_commit')}
        </button>
        <button
          className="panel-btn panel-btn-full mt-2 secondary"
          onClick={handleCancel}
        >
          {t('btn_cancel')}
        </button>
      </>
    )
  }

  // select_first / select_second
  return (
    <>
      <p>{phase === 'select_first' ? t('scurve_hint_first') : t('scurve_hint_second')}</p>
      {picks.length > 0 && (
        <p className="msg-info">
          {t('scurve_line1')}: {picks[0].label}
        </p>
      )}
      {pickStatus && (
        <p className={pickStatus.error ? 'msg-error' : 'msg-hint'}>
          {pickStatus.msg}
        </p>
      )}
      {phase === 'select_second' && (
        <button className="panel-btn panel-btn-full mt-8 secondary" onClick={handleCancel}>
          {t('btn_cancel')}
        </button>
      )}
    </>
  )
}
