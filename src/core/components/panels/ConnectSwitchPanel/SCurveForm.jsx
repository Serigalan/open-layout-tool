import { useEffect, useMemo, useRef, useState } from 'react'
import { loadTracks, loadSwitches, commitSwitchConnection } from '../../../storage'
import { elementStations, stationFromClick } from '../../../utils/platformUtils'
import { wgs84ToUTM } from '../../../utils/coordinateUtils'
import { SWITCH_TYPES, CONNECTION_SPEEDS, computeSwitchConnections } from '../../../utils/switchConnectionUtils'
import { ZOOM_LINE_WIDTH } from '../../../map/style'
import { useI18n } from '../../../locales/i18nContext'
import { REASON_MSG, buildSCurve, computeShiftBounds, connectionPick, isUsableStem, preferredShift, settleConnection, shiftStops, stems, waOffset } from '../../../utils/commands/sCurve'
import { TRACKS_HOVER_LAYER } from '../../../map/layerIds'
import usePreview from '../../../map/usePreview'
import useMapPick from '../../../map/useMapPick'
import { PALETTE } from '../../../styles/palette'
import ReadOnlyField from '../../form/ReadOnlyField'
import AdvancedInfo from '../../form/AdvancedInfo'
import CommitBar from '../../form/CommitBar'
import CancelButton from '../../form/CancelButton'

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

/**
 * The two cants at the ldS, for the message that they differ: as magnitudes,
 * signed only where they lean to different sides.
 */
function ldsCants({ cantLds1: a = 0, cantLds2: b = 0 }) {
  const opposite = a * b < 0
  const show = (u) => String(opposite ? Math.round(u) : Math.abs(Math.round(u)))
  return { u1: show(a), u2: show(b) }
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
  const [shiftRaw, setShift] = useState(null)           // start-point offset along line 1 [m]; null: the preferred one
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

      // The clicked point as a station along the element — along its own curve,
      // whatever kind it is. stationFromClick counts along the whole track.
      const clickUtm = wgs84ToUTM([e.lngLat.lng, e.lngLat.lat], track.epsg)
      const elStart  = elementStations(track)[elIdx]?.start ?? 0
      const along    = Math.min(el.length, Math.max(0, (stationFromClick(track, elIdx, clickUtm) ?? elStart) - elStart))
      const pick     = connectionPick(track, elIdx, along)

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

  // ── Where the slider may stand: both turnouts on the elements they were
  // picked on. It stops on whole metres of WA from the element change behind
  // it, on the exact ends of the range and where WA 2 lies on its element
  // change; untouched it stands where WA lies on an element change.
  const slider = useMemo(() => {
    if (phase !== 'config' || !picks[0] || !picks[1] || !speed) return null
    const bounds = computeShiftBounds({ picks, speed })
    return {
      stops: shiftStops({ picks, speed }, bounds),
      preferred: preferredShift({ picks, speed }, bounds),
      offset: waOffset(picks),
    }
  }, [phase, picks, speed])

  // The slider's own value: the stop nearest to the one asked for.
  const stopIdx = useMemo(() => {
    if (!slider) return 0
    const want = shiftRaw ?? slider.preferred
    let best = 0
    slider.stops.forEach((s, i) => { if (Math.abs(s - want) < Math.abs(slider.stops[best] - want)) best = i })
    return best
  }, [slider, shiftRaw])
  const shift = slider?.stops[stopIdx] ?? 0

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
  // slider rather than pushed into state by an effect. A turnout that would
  // leave too short a piece of its element before WA is pushed onto the
  // element's node (settleConnection, LP.EL.01).
  const settled = useMemo(() => (
    phase === 'config' && picks[0] && picks[1] && speed
      ? settleConnection({ picks, speed, shift })
      : null
  ), [phase, picks, speed, shift])
  const result = settled?.result ?? null

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

  const reset = () => {
    preview.clear()
    setPhase('select_first')
    setPicks([])
    setShift(null)
    setPickStatus(null)
    setCarveError(null)
  }
  const handleCancel = () => { reset(); onCommitted?.() }

  const handleCommit = () => {
    const commit = buildSCurve({ result, picks, tracks: loadTracks(), switches: loadSwitches(), speed })
    if (!commit) return
    if (commit.carveError) { setCarveError(commit.carveError); return }
    commitSwitchConnection(commit)
    // Laid in a cant, the two tracks have to be fitted to each other: the
    // panel asks next whether their heights may be changed (decision 159).
    const canted = picks.some(p => p.cantStart || p.cantEnd)
    reset()
    onCommitted?.({ switchIds: commit.addSwitches.map(sw => sw.switchId), canted })
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  if (phase === 'config') {
    const deg = (r) => (r * RAD2DEG).toFixed(3)
    // WA's distance from the element change behind it, for the slider's label.
    const wa = (s) => {
      const d = s + (slider?.offset ?? 0)
      return Math.abs(d - Math.round(d)) < 5e-3 ? String(Math.round(d)) : d.toFixed(2)
    }
    return (
      <>
        <div className="element-form">
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

          <div className="form-field">
            <label>{t('scurve_shift')}: {settled && settled.shift !== shift
              ? `${wa(shift)} → ${wa(settled.shift)}` : wa(shift)} m</label>
            <input type="range" min={0} max={(slider?.stops.length ?? 1) - 1} step="1" value={stopIdx}
              onChange={e => { setCarveError(null); setShift(slider?.stops[Number(e.target.value)] ?? null) }} />
          </div>

          <AdvancedInfo>
            <ReadOnlyField label={t('scurve_line1')} value={picks[0]?.name ?? ''} />
            <ReadOnlyField label={t('scurve_line2')} value={picks[1]?.name ?? ''} />
            <ReadOnlyField label={t('scurve_gap')} value={result ? `${result.gap.toFixed(2)} m` : ''} />
            {result?.valid && (<>
            <ReadOnlyField label={t('scurve_switch_type')} value={result.switchType.label} />
            <ReadOnlyField label={t('scurve_angle')} value={`1:${result.switchType.ratio}  (${deg(result.w)}°)`} />
            <ReadOnlyField label={t('scurve_delta')} value={`${deg(result.delta)}°`} />
            <ReadOnlyField label={t('scurve_zgl')} value={`${result.Lg.toFixed(2)} m`} />
            <ReadOnlyField label={t('scurve_mid_radius')} value={result.signedRg
                ? `${Math.abs(result.signedRg).toFixed(0)} m`
                : t('scurve_mid_straight')} />
            {/* A branch bent straight is built as the plain form with its
                routes swapped: the running track is then its branch, on the form's radius. */}
            <ReadOnlyField label={t('scurve_branch_radius')} value={[result.signedR1, result.signedR2]
                .map(r => (r ? `${Math.abs(r).toFixed(0)} m`
                  : fill('scurve_branch_swapped', { r: String(result.switchType.R) })))
                .join('  /  ')} />
            {result.cantMid !== 0 && (
              <ReadOnlyField label={t('scurve_cant')} value={`${Math.abs(result.cantMid)} mm`} />
            )}
            <ReadOnlyField label={t('scurve_total')} value={`${result.laenge.toFixed(2)} m`} />
            </>)}
          </AdvancedInfo>
        </div>

        <p className={result?.valid ? 'msg-info' : 'msg-error'}>
          {result?.valid ? t('scurve_valid')
            : result?.reason === 'cant_mismatch' ? fill('scurve_cant_mismatch', ldsCants(result))
              : t(REASON_MSG[result?.reason] ?? 'scurve_invalid')}
        </p>
        {settled?.moved.length > 0 && (
          <p className="msg-hint">
            {fill('scurve_min_element_moved', { tracks: settled.moved.map(k => picks[k]?.name ?? '').join(', ') })}
          </p>
        )}
        {result?.valid && settled.remnants.some(r => r.lMin == null) && (
          <p className="msg-hint">
            {fill('scurve_min_element_unchecked', {
              tracks: [...new Set(settled.remnants.filter(r => r.lMin == null).map(r => picks[r.track]?.name ?? ''))].join(', '),
            })}
          </p>
        )}
        {result?.short && (
          <p className="msg-error">
            {fill('scurve_min_element_short', {
              side: t(result.short.side === 'before' ? 'scurve_side_before_wa' : 'scurve_side_after_we'),
              track: picks[result.short.track]?.name ?? '',
              l: result.short.length.toFixed(2),
              lmin: result.short.lMin.toFixed(2),
              v: String(result.short.v ?? ''),
            })}
          </p>
        )}
        {carveError != null && (
          <p className="form-error">
            {fill('switch_on_track_no_room', { m: carveError.toFixed(1) })}
          </p>
        )}

        <CommitBar onCommit={handleCommit} onCancel={handleCancel} disabled={!result?.valid} />
      </>
    )
  }

  // select_first / select_second
  return (
    <>
      <p>{phase === 'select_first' ? t('scurve_hint_first') : t('scurve_hint_second')}</p>
      {picks.length > 0 && (
        <p className="msg-info">
          {t('scurve_line1')}: {picks[0].name}
        </p>
      )}
      {pickStatus && (
        <p className={pickStatus.error ? 'msg-error' : 'msg-hint'}>
          {pickStatus.msg}
        </p>
      )}
      {phase === 'select_second' && (
        <CancelButton className="panel-btn panel-btn-full mt-8 secondary" onClick={handleCancel} />
      )}
    </>
  )
}
