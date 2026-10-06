import { useEffect, useMemo, useState } from 'react'
import { applyCrossoverGradient } from '../../storage'
import { useProject } from '../../hooks/useStore'
import {
  findCrossovers, crossoverFrame, crossoverCant, crossoverRanges, lineCoordinates, rangeEndFromClick,
  lineTrackAt, planCrossoverGradient,
} from '../../utils/crossoverGradient'
import { stationFromClick } from '../../utils/platformUtils'
import { utmToWgs84, wgs84ToUTM } from '../../utils/coordinateUtils'
import { trackLabel } from '../../utils/trackModel'
import { ZOOM_LINE_WIDTH } from '../../map/style'
import { useMap } from '../../map/MapContext'
import { fitToTracks } from '../../utils/mapRenderUtils'
import usePreview from '../../map/usePreview'
import useMapPick from '../../map/useMapPick'
import { PALETTE } from '../../styles/palette'
import { useI18n } from '../../locales/i18nContext'
import NumberInput from '../form/NumberInput'
import FormSection from '../form/FormSection'
import CommitBar from '../form/CommitBar'

// ── The stretches it may change, on the map ─────────────────────────────────
const RANGE_SOURCE = 'crossover-range-source'
const RANGE_LAYER  = 'crossover-range-layer'
const RANGE_LAYERS = [{
  sourceId: RANGE_SOURCE,
  layer: {
    id: RANGE_LAYER, type: 'line',
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': ['get', 'colour'], 'line-width': ZOOM_LINE_WIDTH, 'line-opacity': 0.8 },
  },
}]

const DEFAULT_LIMIT = { on: true, raise: '0.05', lower: '0.05', before: '100', after: '100' }

const num = (v) => { const x = Number(String(v).replace(',', '.')); return Number.isFinite(x) ? x : 0 }
const signed = (m) => (Math.abs(m) < 0.0005 ? '±0.000 m' : `${m > 0 ? '+' : ''}${m.toFixed(3)} m`)
// The track's own name first: two tracks of one line share their line number.
const nameOf = (track) => track?.name || trackLabel(track)

/**
 * Fitting the gradient of a crossover in cant (decisions 159–163): how far
 * each of its two tracks may be raised and lowered and over which stretch —
 * marked on the map — and whether the heights follow a wanted cant or the cant
 * follows the heights. What it would do is worked out on every change
 * (crossoverGradient) and stated before it is applied, as one undo step.
 *
 * `ask` puts the question first, as after a crossover has just been laid in a
 * curve: may the heights of the two tracks be changed at all?
 */
export default function CrossoverGradientForm({ switchIds, ask = false, onDone }) {
  const { t, fill } = useI18n()
  const project = useProject()
  const tracks = project?.tracks
  const switches = project?.switches
  const crossover = useMemo(() => findCrossovers(tracks ?? [], switches ?? [])
    .find(c => switchIds.includes(c.w1.switchId) && switchIds.includes(c.w2.switchId)) ?? null,
  [tracks, switches, switchIds])
  const frame = useMemo(() => (crossover ? crossoverFrame(tracks, switches, crossover) : null),
    [tracks, switches, crossover])

  const [asked, setAsked] = useState(!ask)
  const [mode, setMode] = useState('heights')
  const [cantDraft, setCantDraft] = useState(null)
  const [lim, setLim] = useState([DEFAULT_LIMIT, DEFAULT_LIMIT])
  const [picking, setPicking] = useState(null)   // index of the track whose range is being marked

  const limits = lim.map(l => ({
    raise: l.on ? num(l.raise) : 0, lower: l.on ? num(l.lower) : 0,
    before: num(l.before), after: num(l.after),
  }))
  const cant = cantDraft ?? (frame ? String(crossoverCant(frame)) : '')
  const plan = useMemo(() => (frame && asked
    ? planCrossoverGradient(tracks, switches, crossover, { mode, cant: num(cant), limits })
    : null),
  // `limits` is rebuilt every render from `lim`, which is what changes.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [frame, asked, tracks, switches, crossover, mode, cant, lim])

  // ── Map: the zone in red, the stretch either side in orange ───────────────
  const map = useMap()
  const preview = usePreview(RANGE_LAYERS)
  const ranges = frame ? crossoverRanges(frame, limits) : null
  const rangesKey = JSON.stringify(ranges?.map(r => [r.zone, r.range]))
  const wgs = (line, a, b) => lineCoordinates(line, a, b).map(([e, n]) => utmToWgs84(e, n, frame.line1[0].track.epsg))
  // The map goes to the crossover once, when it is opened.
  const connId = crossover?.conn.id
  useEffect(() => {
    if (!ranges) return
    fitToTracks(map?.current, ranges.map(r => ({ coordinates: wgs(r.line, r.range[0], r.range[1]) })), { maxZoom: 17 })
  // Only for another crossover — not as the ranges are edited.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connId, map])
  useEffect(() => {
    if (!ranges || !asked) { preview.clear(); return }
    const feature = (line, a, b, colour) => ({
      type: 'Feature', properties: { colour },
      geometry: { type: 'LineString', coordinates: wgs(line, a, b) },
    })
    preview.set(RANGE_SOURCE, {
      type: 'FeatureCollection',
      features: ranges.flatMap(r => [
        feature(r.line, r.range[0], r.range[1], PALETTE.mapHover),
        feature(r.line, r.zone[0], r.zone[1], PALETTE.mapSelected),
      ]),
    })
  // Drawn again when a range or the zone moves, not on every render.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rangesKey, asked, preview])

  // A click on a track of either line moves the end of that line's range on
  // the side it falls — the two lines are two tracks, and a click on the one
  // is no click on the other.
  const onLine = (trackId) => !!ranges?.some(r => r.line.some(seg => seg.track.id === trackId))
  useMapPick({
    active: picking != null, hover: 'element',
    accept: (p) => onLine(p.trackId),
    onPick: ({ trackId, elementIndex }, e) => {
      const track = tracks.find(tr => tr.id === trackId)
      if (!track) return
      // stationFromClick counts along the whole track already.
      const station = stationFromClick(track, elementIndex, wgs84ToUTM([e.lngLat.lng, e.lngLat.lat], track.epsg))
      const hit = station == null ? null : rangeEndFromClick(ranges, trackId, station)
      if (!hit) return
      setPicking(hit.index)
      setLim(ls => ls.map((l, i) => (i === hit.index ? { ...l, [hit.key]: String(Math.round(hit.length)) } : l)))
    },
  })

  if (!crossover) return <p className="form-error">{t('crossover_missing')}</p>
  if (!frame) return <p className="form-error">{t('crossover_no_frame')}</p>

  const names = [frame.line1, frame.line2].map(line => line.find(s => !s.reversed)?.track ?? line[0].track)
  const title = fill('crossover_title_switches', { a: crossover.w1.name ?? '', b: crossover.w2.name ?? '' })

  if (!asked) {
    return (
      <div className="element-form">
        <p>{title}</p>
        <p>{fill('crossover_ask', { cant: crossoverCant(frame) })}</p>
        <CommitBar onCommit={() => setAsked(true)} commitLabel={t('crossover_ask_yes')}
          onCancel={onDone} cancelLabel={t('crossover_ask_no')} />
      </div>
    )
  }

  const setL = (i, key, value) => setLim(ls => ls.map((l, k) => (k === i ? { ...l, [key]: value } : l)))
  const towards = (i, d) => nameOf(lineTrackAt(ranges[i].line, d) ?? names[i])

  const reasonText = plan && !plan.ok ? fill(`crossover_err_${plan.reason}`, {
    track: plan.track ?? '', uExact: plan.uExact != null ? plan.uExact.toFixed(1) : '',
    need: plan.e ? Math.max(...plan.e.map(Math.abs)).toFixed(3) : '',
  }) : null

  return (
    <>
      <p className="selecting-hint">{title} · {fill('crossover_frame', {
        y: Math.abs(frame.y).toFixed(2), cant: crossoverCant(frame),
      })}</p>

      <FormSection title={t('crossover_mode')}>
        <label className="crossover-option">
          <input type="radio" checked={mode === 'heights'} onChange={() => setMode('heights')} />
          {t('crossover_mode_heights')}
        </label>
        {mode === 'heights' && (
          <div className="form-field">
            <label>{t('crossover_cant')}</label>
            <NumberInput step="5" min="0" value={cant} onChange={e => setCantDraft(e.target.value)} />
          </div>
        )}
        <label className="crossover-option">
          <input type="radio" checked={mode === 'cant'} onChange={() => setMode('cant')} />
          {t('crossover_mode_cant')}
        </label>
      </FormSection>

      {[0, 1].map(i => (
        <FormSection key={i} title={fill('crossover_track', { name: nameOf(names[i]) })}>
          <label className="crossover-option">
            <input type="checkbox" checked={lim[i].on} onChange={e => setL(i, 'on', e.target.checked)} />
            {t('crossover_may_move')}
          </label>
          {lim[i].on && (
            <div className="crossover-pair">
              <div className="form-field">
                <label>{t('crossover_raise')}</label>
                <NumberInput step="0.01" min="0" value={lim[i].raise} onChange={e => setL(i, 'raise', e.target.value)} />
              </div>
              <div className="form-field">
                <label>{t('crossover_lower')}</label>
                <NumberInput step="0.01" min="0" value={lim[i].lower} onChange={e => setL(i, 'lower', e.target.value)} />
              </div>
            </div>
          )}
          <div className="crossover-pair">
            <div className="form-field">
              <label>{fill('crossover_before', { name: towards(i, ranges[i].range[0]) })}</label>
              <NumberInput step="10" min="0" value={lim[i].before} onChange={e => setL(i, 'before', e.target.value)} />
            </div>
            <div className="form-field">
              <label>{fill('crossover_after', { name: towards(i, ranges[i].range[1]) })}</label>
              <NumberInput step="10" min="0" value={lim[i].after} onChange={e => setL(i, 'after', e.target.value)} />
            </div>
          </div>
          <button type="button" className={`panel-btn panel-btn-full secondary${picking === i ? ' active' : ''}`}
            onClick={() => setPicking(p => (p === i ? null : i))}>
            {picking === i ? t('crossover_pick_done') : t('crossover_pick')}
          </button>
          {picking === i && <p className="selecting-hint">{t('crossover_pick_hint')}</p>}
        </FormSection>
      ))}

      <FormSection title={t('crossover_result')}>
        {plan?.ok && (
          <ul className="rule-findings">
            {mode === 'cant' && <li>{fill('crossover_u_from_heights', { exact: plan.uExact.toFixed(1), u: plan.u })}</li>}
            <li>{fill('crossover_target', { u: plan.u, dz: (plan.u * Math.abs(frame.y) / 1500).toFixed(3) })}</li>
            {[0, 1].map(i => (
              <li key={i}>{fill('crossover_share', {
                name: nameOf(names[i]),
                a: signed(i === 0 ? plan.shares[0].d1 : plan.shares[0].d2),
                b: signed(i === 0 ? plan.shares[1].d1 : plan.shares[1].d2),
              })}</li>
            ))}
            {plan.elements.size > 0 && <li>{fill('crossover_cant_set', { u: plan.u })}</li>}
            {plan.warnings.map(w => <li key={w} className="rule-sev-warning">{t(`crossover_warn_${w}`)}</li>)}
          </ul>
        )}
        {reasonText && <p className="form-error">{reasonText}</p>}
      </FormSection>

      <CommitBar onCommit={() => { applyCrossoverGradient(plan); onDone?.() }} onCancel={onDone}
        reason={plan?.ok ? null : (reasonText ?? t('crossover_err_no_frame'))} />
    </>
  )
}
