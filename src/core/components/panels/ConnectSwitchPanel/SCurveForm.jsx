import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import { loadTracks, loadSwitches, commitSwitchConnection } from '../../../storage'
import { elementStations, stationFromClick } from '../../../utils/track'
import { wgs84ToUTM } from '../../../utils/geometry'
import { SWITCH_TYPES, CONNECTION_SPEEDS, computeSwitchConnections, DEFAULT_MIDS } from '../../../utils/switch'
import { ZOOM_LINE_WIDTH } from '../../../map/style'
import { useI18n } from '../../../locales/i18nContext'
import {
  REASON_MSG, buildSCurve, computeShiftBounds, connectionPick, isUsableStem, preferredShift,
  settleConnection, shiftSnaps, stems, waOffset, SLIDER_REACH,
} from '../../../utils/commands'
import StationSlider from '../../form/StationSlider'
import { splitUnit } from '../../../locales/i18n'
import { TRACKS_HOVER_LAYER } from '../../../map/layerIds'
import usePreview from '../../../map/usePreview'
import useMapPick from '../../../map/useMapPick'
import { PALETTE } from '../../../styles/palette'
import ReadOnlyField from '../../form/ReadOnlyField'
import AdvancedInfo from '../../form/AdvancedInfo'
import CommitBar from '../../form/CommitBar'
import CancelButton from '../../form/CancelButton'
import MidChainFields from './MidChainFields'

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
  // The elements between the two branches (Entscheidung 305).
  const [mids, setMids] = useState(DEFAULT_MIDS)
  // A chain is solved by iteration over the whole slider range: typing goes on
  // while it runs, and the solution follows the last value typed.
  const solvedMids = useDeferredValue(mids)

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
  // picked on, the connection valid throughout. It is stated as WA's station
  // from the begin of track 1 and snaps where WA or WE of either turnout fall
  // on an element change (Entscheidungen 309–310); untouched it stands where
  // WA lies on an element change (Entscheidung 170).
  const slider = useMemo(() => {
    if (phase !== 'config' || !picks[0] || !picks[1] || !speed) return null
    // Within SLIDER_REACH of the first click either way (Entscheidung 313):
    // shift 0 is where track 1 was clicked.
    const whole = computeShiftBounds({ picks, speed, mids: solvedMids })
    // Where the connection stands nowhere near the click, the whole range.
    const near = { min: Math.max(whole.min, -SLIDER_REACH), max: Math.min(whole.max, SLIDER_REACH) }
    const bounds = near.max >= near.min ? near : whole
    const track1 = loadTracks().find(tr => tr.id === picks[0].trackId)
    const elStart = track1 ? elementStations(track1)[picks[0].elIdx]?.start ?? 0 : 0
    const dir1 = stems(picks).g1.dir ?? 1
    return {
      bounds,
      snaps: shiftSnaps({ picks, speed, mids: solvedMids }, bounds),
      preferred: preferredShift({ picks, speed, mids: solvedMids }, bounds),
      offset: waOffset(picks),
      toStation: (sh) => elStart + picks[0].along + dir1 * sh,
      toShift: (st) => (st - elStart - picks[0].along) * dir1,
    }
  }, [phase, picks, speed, solvedMids])

  // The shift asked for, held inside the range the connection stands over.
  const shift = slider
    ? Math.min(slider.bounds.max, Math.max(slider.bounds.min, shiftRaw ?? slider.preferred))
    : 0

  // Which speeds these two tracks can be connected with where the slider stands
  // — the dropdown's disabled state. It follows from the picks and the shift, so
  // it is derived rather than pushed into state by an effect.
  const connections = useMemo(() => {
    if (!picks[0] || !picks[1]) return []
    const { g1, g2 } = stems(picks)
    return computeSwitchConnections(g1, g2, shift, solvedMids)
  }, [picks, shift, solvedMids])

  // ── The connection itself ─────────────────────────────────────────────────
  // Closed-form and pure, so it is derived from the picks, the speed and the
  // slider rather than pushed into state by an effect. A turnout that would
  // leave too short a piece of its element before WA is pushed onto the
  // element's node (settleConnection, LP.EL.01).
  const settled = useMemo(() => (
    phase === 'config' && picks[0] && picks[1] && speed
      ? settleConnection({ picks, speed, shift, mids: solvedMids })
      : null
  ), [phase, picks, speed, shift, solvedMids])
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
    setMids(DEFAULT_MIDS)
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
    // Where a joint of the middle elements lies: at the start of the element
    // it comes before, the last at the end of the last one.
    const midCount = result?.midPieces?.length ?? 1
    const jointText = (k) => (k < midCount
      ? fill('scurve_joint_start', { n: String(k + 1) })
      : fill('scurve_joint_end', { n: String(midCount) }))
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

          {slider && (() => {
            const ends = [slider.toStation(slider.bounds.min), slider.toStation(slider.bounds.max)].sort((a, b) => a - b)
            const moved = settled && Math.abs(settled.shift - shift) > 1e-6
            return (
              <StationSlider label={splitUnit(t('scurve_station')).text}
                value={String(Math.round(slider.toStation(shift) * 1e4) / 1e4)}
                onChange={text => {
                  const st = Number(text)
                  if (text === '' || !Number.isFinite(st)) return
                  setCarveError(null)
                  setShift(slider.toShift(st))
                }}
                intervals={ends[1] > ends[0] ? [ends] : []}
                snaps={slider.snaps.map(slider.toStation)}
                hint={fill('scurve_wa_after_joint', { d: moved ? `${wa(shift)} → ${wa(settled.shift)}` : wa(shift) })} />
            )
          })()}

          <MidChainFields mids={mids} onChange={(next) => { setCarveError(null); setMids(next) }}
            solved={result?.midPieces?.map(p => p.route)
              ?? (result?.valid ? [{ length: result.Lg, r1: result.signedRg, r2: result.signedRg }] : null)} />

          <AdvancedInfo>
            <ReadOnlyField label={t('scurve_line1')} value={picks[0]?.name ?? ''} />
            <ReadOnlyField label={t('scurve_line2')} value={picks[1]?.name ?? ''} />
            <ReadOnlyField label={t('scurve_gap')} value={result ? `${result.gap.toFixed(2)} m` : ''} />
            {result?.valid && (<>
            <ReadOnlyField label={t('scurve_switch_type')} value={result.switchType.label} />
            <ReadOnlyField label={t('scurve_angle')} value={`1:${result.switchType.ratio}  (${deg(result.w)}°)`} />
            <ReadOnlyField label={t('scurve_delta')} value={`${deg(result.delta)}°`} />
            <ReadOnlyField label={t('scurve_zgl')} value={`${result.Lg.toFixed(2)} m`} />
            {!result.midPieces && (
              <ReadOnlyField label={t('scurve_mid_radius')} value={result.signedRg
                ? `${Math.abs(result.signedRg).toFixed(0)} m`
                : t('scurve_mid_straight')} />
            )}
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
              : result?.reason === 'mid_element_short' && result.midShort ? fill('scurve_mid_element_short_at', {
                n: String(result.midShort.index + 1), l: result.midShort.length.toFixed(2),
                lmin: result.midShort.lMin.toFixed(2), v: String(speed),
              })
              : result?.reason === 'mid_jump' && result.midJump ? fill('scurve_mid_jump_at', {
                at: jointText(result.midJump.index), rw: result.midJump.rw.toFixed(0),
                limit: result.midJump.limit.toFixed(0), v: String(speed),
              })
              : t(REASON_MSG[result?.reason] ?? 'scurve_invalid')}
        </p>
        {result?.valid && result.midJumpHints?.map(h => (
          <p key={h.index} className="msg-hint">
            {fill('scurve_mid_jump_hint', { at: jointText(h.index), rw: h.rw.toFixed(0), reg: h.reg.toFixed(0) })}
          </p>
        ))}
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
