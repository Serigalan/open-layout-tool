import { useEffect, useMemo, useState } from 'react'
import { loadTracks, commitReconnect, currentProject } from '../../../storage'
import {
  axisPoints, buildReconnect, reconnectFromAnswer, reconnectPick, reconnectRange, reconnectRequest, replacedSpan, stretchDefaults,
} from '../../../utils/commands/reconnect'
import { neighbourAxisNear } from '../../../utils/commands/splice'
import { gaugeProfile } from '../../../utils/gaugeProfiles'
import { utmToWgs84 } from '../../../utils/coordinateUtils'
import { trackLabel } from '../../../utils/trackModel'
import { reconnectOnServer } from '../../../utils/optimizerService'
import { severityRank } from '../../../utils/regelkatalog'
import { ZOOM_LINE_WIDTH } from '../../../map/style'
import { TRACKS_HOVER_LAYER } from '../../../map/layerIds'
import usePreview from '../../../map/usePreview'
import useMapPick, { useSelectedOnMap } from '../../../map/useMapPick'
import { useI18n } from '../../../locales/i18nContext'
import { PALETTE } from '../../../styles/palette'
import CommitBar from '../../form/CommitBar'
import CancelButton from '../../form/CancelButton'
import NumberInput from '../../form/NumberInput'
import ReadOnlyField from '../../form/ReadOnlyField'
import SpliceFindings from './SpliceFindings'
import DeviationBand from '../../chart/DeviationBand'
import ClearanceFields from './ClearanceFields'
import { spacingMessage } from './spacingMessage'

const OLD_AXIS_SOURCE = 'reconnect-old-source'
const NEW_AXIS_SOURCE = 'reconnect-new-source'
const WORST_SOURCE = 'reconnect-worst-source'
// The tightest place to the neighbouring track: a line across to its axis.
const SPACING_SOURCE = 'reconnect-spacing-source'
const PREVIEW_LAYERS = [{
  sourceId: OLD_AXIS_SOURCE,
  layer: { id: 'reconnect-old-layer', type: 'line', paint: { 'line-color': PALETTE.muted, 'line-width': 2 } },
}, {
  sourceId: NEW_AXIS_SOURCE,
  layer: {
    id: 'reconnect-new-layer', type: 'line',
    paint: { 'line-color': PALETTE.mapHover, 'line-width': ZOOM_LINE_WIDTH, 'line-dasharray': [6, 4] },
  },
}, {
  sourceId: SPACING_SOURCE,
  layer: { id: 'reconnect-spacing-layer', type: 'line', paint: { 'line-color': ['get', 'colour'], 'line-width': 2 } },
}, {
  sourceId: WORST_SOURCE,
  layer: {
    id: 'reconnect-worst-layer', type: 'circle',
    paint: { 'circle-radius': 6, 'circle-color': ['get', 'colour'], 'circle-stroke-color': PALETTE.white, 'circle-stroke-width': 2 },
  },
}]

/** How long the settings must rest before the service is asked [ms] — a search takes a second or two. */
const DEBOUNCE = 400
/** The old axis on the map: one vertex in this many of the centimetre points. */
const MAP_STRIDE = 50

const DEFAULTS = {
  speed: '', tolerance: 0.1, transitionType: 'clothoid', radiusMode: 'auto', radius: 500,
  // A spacing to keep to a neighbouring track (Entscheidung 201): the minimum, free to choose.
  clearanceOn: false, clearanceDMin: 4.0,
}

const featureLine = (coordinates) => ({
  type: 'FeatureCollection',
  features: [{ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates } }],
})

/** A solution's variant in words: how its transitions came about, or the direct one between two arcs. */
function variantText(t, variant) {
  if (variant.arcJoin === 'transition') return t('splice_arc_join_transition')
  return t(`reconnect_lengths_${variant.lengths}`)
}

/**
 * "Bestehende Elemente neu verbinden" (Paket N): the first and the last
 * element of a stretch are clicked on one track, everything between is
 * chosen; its axis is held every centimetre, and the service joins the two
 * neighbours again by the splice construction — the best chain within the
 * tolerance at the speed asked for (olt_optimizer/reconnect.py). Taking it
 * out and joining again is one commit (commands/reconnect buildReconnect).
 */
export default function ReconnectPanel() {
  const { t, fill, num } = useI18n()
  const [first, setFirst] = useState(null)        // { trackId, elementIndex }
  const [range, setRange] = useState(null)        // reconnectRange + trackId
  const [pickError, setPickError] = useState(null)
  const [s, setS] = useState(DEFAULTS)
  const set = (key, value) => setS(prev => ({ ...prev, [key]: value }))
  const [answer, setAnswer] = useState(null)      // { key, read }
  const [chosen, setChosen] = useState(0)
  const preview = usePreview(PREVIEW_LAYERS, { resetFilters: [TRACKS_HOVER_LAYER], resetCursor: true })

  const track = range ? loadTracks().find(tr => tr.id === range.trackId) ?? null : null
  // The neighbouring track the spacing is kept to, and whether it is being picked.
  const [refTrackId, setRefTrackId] = useState(null)
  const [pickingRef, setPickingRef] = useState(false)
  const keeping = !!range && s.clearanceOn && refTrackId != null && Number(s.clearanceDMin) > 0

  useMapPick({
    active: !!range && pickingRef, hover: 'track',
    accept: (p) => p.trackId !== range?.trackId,
    onPick: ({ trackId }) => { setRefTrackId(trackId); setPickingRef(false) },
  })

  useMapPick({
    active: !range, hover: 'element', noSwitchBranch: true,
    accept: (p) => !p.switchId && (!first || p.trackId === first.trackId),
    onPick: ({ trackId, elementIndex }) => {
      if (!first) { setFirst({ trackId, elementIndex }); setPickError(null); return }
      const tr = loadTracks().find(x => x.id === trackId)
      const r = reconnectRange(tr, first.elementIndex, elementIndex)
      if (r.error) { setPickError(t(r.error)); setFirst(null); return }
      setRange({ ...r, trackId })
      const start = stretchDefaults(tr, r)
      setS(prev => ({ ...prev, speed: start.speed || '', transitionType: start.transitionType }))
      setChosen(0)
      setPickError(null)
    },
  })

  // The stretch on the map: the first click alone, then every element it takes out.
  const selected = range
    ? Array.from({ length: range.to - range.from + 1 }, (_, k) => ({ trackId: range.trackId, elementIndex: range.from + k }))
    : first ? [first] : []
  useSelectedOnMap(selected.length ? { elements: selected } : null)

  // The two neighbours and the old axis every centimetre, once per stretch (Entscheidung 187).
  const picks = useMemo(() => (track && range
    ? [reconnectPick(track, range.dep.idx, 'end', range.dep.fixed), reconnectPick(track, range.arr.idx, 'start', range.arr.fixed)]
    : null), [track, range])
  const points = useMemo(() => {
    if (!track || !range) return null
    const { first: a, last: b } = replacedSpan(range)
    return axisPoints(track, a, b)
  }, [track, range])

  // The neighbour's axis near the old one, read once per neighbour and stretch.
  const refTrack = keeping ? loadTracks().find(tr => tr.id === refTrackId) ?? null : null
  const axis = useMemo(() => {
    if (!refTrack || !points || !track) return null
    let e0 = Infinity, e1 = -Infinity, n0 = Infinity, n1 = -Infinity
    for (const [e, n] of points.coords) { e0 = Math.min(e0, e); e1 = Math.max(e1, e); n0 = Math.min(n0, n); n1 = Math.max(n1, n) }
    return neighbourAxisNear(refTrack, track.epsg, [{ easting: e0, northing: n0 }, { easting: e1, northing: n1 }])
    // the neighbour and the stretch are what the axis is read from
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refTrackId, points, track])

  const radius = s.radiusMode === 'fixed' ? Number(s.radius) || 0 : 0
  const ready = picks && points && Number(s.speed) > 0 && Number(s.tolerance) > 0
  // The key names the stretch rather than carrying its points.
  const requestKey = ready ? JSON.stringify({
    range, speed: Number(s.speed), tolerance: Number(s.tolerance), radius, tr: s.transitionType,
    neighbour: keeping ? [refTrackId, Number(s.clearanceDMin)] : null,
  }) : null
  useEffect(() => {
    if (!requestKey) return undefined
    const ctl = new AbortController()
    const timer = setTimeout(async () => {
      try {
        const clearance = keeping && axis
          ? { ref: axis, dMin: Number(s.clearanceDMin), profile: gaugeProfile(currentProject()?.gaugeProfile).points }
          : null
        const req = reconnectRequest(picks, points, { ...s, radius }, clearance)
        const a = await reconnectOnServer(req, { signal: ctl.signal })
        setAnswer({ key: requestKey, read: reconnectFromAnswer(a, picks) })
        setChosen(0)
      } catch (err) {
        if (err?.name !== 'AbortError') setAnswer({ key: requestKey, read: { error: 'splice_service_unavailable' } })
      }
    }, DEBOUNCE)
    return () => { clearTimeout(timer); ctl.abort() }
    // the key is made of what the request is built from
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestKey])
  const read = answer?.key === requestKey ? answer.read : null
  const solutions = read?.solutions ?? null
  const solution = solutions?.[Math.min(chosen, solutions.length - 1)] ?? null
  const info = solution?.reconnect ?? null
  const spacing = keeping ? info?.spacing ?? null : null

  useEffect(() => {
    const epsg = track?.epsg
    preview.set(OLD_AXIS_SOURCE, points && epsg
      ? featureLine(points.coords.filter((_, i) => i % MAP_STRIDE === 0 || i === points.coords.length - 1).map(p => utmToWgs84(p[0], p[1], epsg)))
      : null)
    preview.set(NEW_AXIS_SOURCE, solution ? featureLine(solution.result.previewCoords) : null)
    preview.set(SPACING_SOURCE, spacing?.at && spacing?.ref && epsg ? {
      type: 'FeatureCollection',
      features: [{
        type: 'Feature', properties: { colour: spacing.kept ? PALETTE.valid : PALETTE.invalid },
        geometry: { type: 'LineString', coordinates: [utmToWgs84(...spacing.at, epsg), utmToWgs84(...spacing.ref, epsg)] },
      }],
    } : null)
    preview.set(WORST_SOURCE, info && epsg ? {
      type: 'FeatureCollection',
      features: [{
        type: 'Feature', properties: { colour: info.within ? PALETTE.valid : PALETTE.invalid },
        geometry: { type: 'Point', coordinates: utmToWgs84(info.worstAt[0], info.worstAt[1], epsg) },
      }],
    } : null)
  }, [points, solution, info, spacing, track, preview])

  const reset = () => {
    preview.clear(); setFirst(null); setRange(null); setAnswer(null); setChosen(0); setPickError(null)
    setRefTrackId(null); setPickingRef(false)
  }

  const handleCommit = () => {
    const built = buildReconnect({ track, range, solution, speed: s.speed })
    if (!built) return
    commitReconnect(built.track, built.map)
    reset()
  }

  if (!range) {
    return (
      <>
        <h2>{t('reconnect_title')}</h2>
        <p>{first ? t('reconnect_hint_last') : t('reconnect_hint_first')}</p>
        {pickError && <p className="msg-error">{pickError}</p>}
        {first && <CancelButton className="panel-btn panel-btn-full mt-8 secondary" onClick={reset} />}
      </>
    )
  }

  const els = track?.elements ?? []
  const stretchLength = els.slice(range.from, range.to + 1).reduce((sum, el) => sum + (el.length ?? 0), 0)
  const neighbour = (side) => t(range[side].fixed ? 'reconnect_neighbour_fixed' : 'reconnect_neighbour_reshaped')
  const ruleError = (solution?.result?.findings ?? []).some(f => severityRank(f.severity) >= severityRank('error'))
  const status = !(Number(s.speed) > 0) ? { msg: t('reconnect_need_speed'), error: true }
    : !read ? { msg: t('splice_solving'), error: false }
      : read.error ? { msg: t(read.error), error: true } : null
  const refName = refTrackId ? (() => { const r = loadTracks().find(tr => tr.id === refTrackId); return r ? r.name || trackLabel(r) : '' })() : null
  const spacingMsg = keeping && solution ? spacingMessage(t, fill, spacing, refName) : null
  // Asked for, a spacing must be kept (Entscheidung 201) — and a neighbour named for it.
  const reason = !solution ? null
    : !info.within ? fill('reconnect_beyond', { tol: num(Number(s.tolerance) * 100, { digits: 1, unit: 'cm' }) })
      : s.clearanceOn && !keeping ? t('reconnect_clearance_pick')
        : keeping && !spacing?.kept ? t('reconnect_clearance_short')
          : ruleError ? t('splice_rule_error') : null
  const lengths = solution?.result?.lengths?.filter(l => l.length > 0) ?? []

  return (
    <>
      <h2>{t('reconnect_title')}</h2>
      <div className="element-form">
        <ReadOnlyField label={t('reconnect_stretch')} value={fill('reconnect_stretch_value', {
          track: track ? trackLabel(track) : '', from: String(range.from + 1), to: String(range.to + 1),
          l: num(stretchLength, { digits: 1, unit: 'm' }),
        })} />
        {range.widened.length > 0 && (
          <p className="msg-hint msg-small">{fill('reconnect_widened', { list: range.widened.map(i => i + 1).join(', ') })}</p>
        )}
        <ReadOnlyField label={t('splice_departure')} value={neighbour('dep')} />
        <ReadOnlyField label={t('splice_arrival')} value={neighbour('arr')} />
        <div className="form-field">
          <label>{t('field_speed')}</label>
          <NumberInput min={0} step={10} value={s.speed} onChange={e => set('speed', e.target.value)} />
        </div>
        <div className="form-field">
          <label>{t('reconnect_tolerance')}</label>
          <NumberInput min={0.001} step={0.01} value={s.tolerance} onChange={e => set('tolerance', e.target.value)} />
        </div>
        <div className="form-field">
          <label>{t('type')}</label>
          <select value={s.transitionType} onChange={e => set('transitionType', e.target.value)}>
            <option value="clothoid">{t('transition_type_clothoid')}</option>
            <option value="bloss">{t('transition_type_bloss')}</option>
          </select>
        </div>
        {!(picks?.[0]?.signedR != null && picks?.[1]?.signedR != null) && (
          <div className="form-field">
            <label>{t('field_radius')}</label>
            <select value={s.radiusMode} onChange={e => set('radiusMode', e.target.value)}>
              <option value="auto">{t('reconnect_radius_auto')}</option>
              <option value="fixed">{t('reconnect_radius_fixed')}</option>
            </select>
            {s.radiusMode === 'fixed' && (
              <NumberInput min={1} step={10} value={s.radius} onChange={e => set('radius', e.target.value)} />
            )}
          </div>
        )}
      </div>
      <ClearanceFields on={s.clearanceOn} onToggle={v => set('clearanceOn', v)} refName={refName}
        picking={pickingRef} onPick={() => setPickingRef(p => !p)} dMin={s.clearanceDMin} onDMin={v => set('clearanceDMin', v)} />

      {status && <p className={status.error ? 'msg-error' : 'msg-info'}>{status.msg}</p>}
      {solution && (
        <>
          {solutions.length > 1 && (
            <div className="splice-solutions">
              <button type="button" className="panel-btn" aria-label={t('splice_solution_prev')}
                onClick={() => setChosen((chosen + solutions.length - 1) % solutions.length)}>◀</button>
              <span>{fill('splice_solution', { i: String(chosen + 1), n: String(solutions.length) })}: {variantText(t, info.variant)}</span>
              <button type="button" className="panel-btn" aria-label={t('splice_solution_next')}
                onClick={() => setChosen((chosen + 1) % solutions.length)}>▶</button>
            </div>
          )}
          {solutions.length === 1 && <p className="msg-small">{variantText(t, info.variant)}</p>}
          <div className="element-form">
            {info.radius != null && <ReadOnlyField label={t('field_radius')} value={num(info.radius, { digits: 0, unit: 'm' })} />}
            {info.radius != null && <ReadOnlyField label={t('cant')} value={num(info.cant, { digits: 0, unit: 'mm' })} />}
            {lengths.length > 0 && (
              <ReadOnlyField label={t('transition_curve')}
                value={solution.result.lengths.map(l => num(l.length, { digits: 1, unit: 'm' })).join(' / ')} />
            )}
            {solution.result.transitionLength != null && (
              <ReadOnlyField label={t('transition_curve')} value={num(solution.result.transitionLength, { digits: 1, unit: 'm' })} />
            )}
          </div>
          <p className={info.within ? 'msg-info' : 'msg-error'}>
            {fill('reconnect_deviation', {
              max: num(info.max * 100, { digits: 1, unit: 'cm' }),
              at: num(info.worstStation, { digits: 1, unit: 'm' }),
              rms: num(info.rms * 100, { digits: 1, unit: 'cm' }),
            })}
          </p>
          {spacingMsg && <p className={spacingMsg.error ? 'msg-error' : 'msg-info'}>{spacingMsg.msg}</p>}
          <DeviationBand band={info.band} tolerance={Number(s.tolerance)} />
          <SpliceFindings result={solution.result} />
        </>
      )}
      <CommitBar onCommit={handleCommit} onCancel={reset} disabled={!solution || !!reason} reason={reason} />
    </>
  )
}
