import { useEffect, useRef, useState } from 'react'
import { updateTrack } from '../storage'
import { useProject, useSwitches, useTracks } from '../hooks/useStore'
import { trackProfile, verticalCurves, gradientAt } from '../utils/heightUtils'
import {
  curvatureBand, cantBand, speedBand, bandValueAt, bandRuns, bandRange, elementSpans,
  bandFindings, bandEditable, withBandValue,
} from '../utils/alignmentBands'
import { checkTrack } from '../utils/trassierungCheck'
import { checkVertical } from '../utils/gradientCheck'
import { ruleById, severityLabelKey, worstSeverity } from '../utils/regelkatalog'
import { maxSpeeds } from '../utils/rules/speed'
import { filterForElements, FILTER_NONE, mapIsLive } from '../map/pick'
import { useMap } from '../map/MapContext'
import { TRACKS_SELECTED_LAYER } from '../map/layerIds'
import { trackHeightAt } from '../utils/switchGradient'
import { useI18n } from '../locales/i18nContext'
import usePreview from '../map/usePreview'
import { pointAtStation } from '../utils/platformUtils'
import { utmToWgs84 } from '../utils/coordinateUtils'
import { PALETTE } from '../styles/palette'
import { clamp } from '../utils/format'
import { niceStep, stepDecimals, ticks } from '../utils/chartAxes'
import { useDrag, useElementSize, useOverlayHeight, useWheelZoom } from './chart/useChartViewport'
import CloseButton from './form/CloseButton'
import NumberInput from './form/NumberInput'

const MARGIN = { left: 60, right: 20, bottom: 34 }
const MIN_OVERLAY_PX = 260
// Each band: its title above, a little air below. The height plan gets more
// room than the others — it carries the most.
const BAND_TITLE = 16
const BAND_GAP = 6
const BAND_WEIGHTS = { curvature: 1, cant: 1, height: 1.5, speed: 1 }
// Narrower than this and a run's label is left out.
const LABEL_MIN_PX = 44
const CURSOR_SOURCE = 'bands-cursor-source'
const CURSOR_LAYERS = [{
  sourceId: CURSOR_SOURCE,
  layer: {
    id: 'bands-cursor-layer', type: 'circle',
    paint: {
      'circle-radius': 6,
      'circle-color': PALETTE.mapHover,
      'circle-stroke-width': 2,
      'circle-stroke-color': PALETTE.white,
    },
  },
}]

/** A value range padded a little, symmetric about 0 where the band is signed. */
function bandScale(range, { signed, min }) {
  if (signed) {
    const m = Math.max(min, ...(range ?? [0, 0]).map(Math.abs)) * 1.15
    return [-m, m]
  }
  const [lo, hi] = range ?? [0, min]
  const pad = Math.max((hi - lo) * 0.12, min / 2)
  return [lo - pad, hi + pad]
}

/** A polyline through the band's points, broken where a value is null. */
function bandPath(points, X, Y) {
  let d = ''
  let pen = false
  for (const p of points) {
    if (p.v == null) { pen = false; continue }
    d += `${pen ? 'L' : 'M'}${X(p.s).toFixed(1)},${Y(p.v).toFixed(1)}`
    pen = true
  }
  return d
}

const flagged = (entry) => entry?.severity && entry.severity !== 'ok'

// The bands a value can be typed in, with the unit it is typed in.
const EDIT_UNIT = { cant: 'mm', speed: 'km/h' }

const gradeLabel = (perMille) => {
  const v = Number(perMille.toFixed(1)) || 0
  return `${v > 0 ? '+' : ''}${v.toFixed(1)} ‰`
}

/**
 * The bands of one track under each other (Prüfen): its curvature, cant,
 * height plan and speed over one station axis, read from the store — every
 * write draws them again. The curvature and the cant are signed: a right
 * curve and the cant that goes with it stand above the zero line, a left one
 * below. The height plan is the built gradient, vertical curves included,
 * with the gradient of every stretch in ‰.
 *
 * The wheel zooms along the track, a drag pans, a double click shows the
 * whole track again. Where the cursor stands a line runs across all four
 * bands, their values are read out in the header, and the station is marked
 * on the map.
 *
 * The cant and the speed are set here too: a click on an element in either
 * band picks it (Ctrl/Shift-click more of them, in the same band), and the
 * header takes the value — by the element table's rules (withBandValue), one
 * undo step per change. A transition takes no cant of its own. The picked
 * elements are marked on the map.
 *
 * What the rules say can be shown over the bands: the alignment catalogue's
 * findings in the band of the quantity each rule is about (bandFindings) —
 * tinted over the element, or a line at the joint for a rule on a boundary —
 * and the Höhenplan's on the gradient, as the profile draws them. Each
 * says in its tooltip what was found.
 */
export default function BandsOverlay({ trackId, onClose }) {
  const { t, fill } = useI18n()
  const map = useMap()
  const tracks = useTracks()
  const switches = useSwitches()
  const project = useProject()
  const track = tracks.find(tr => tr.id === trackId)

  const bodyRef = useRef(null)
  const svgRef = useRef(null)
  const size = useElementSize(bodyRef)
  const overlay = useOverlayHeight(bodyRef, { min: MIN_OVERLAY_PX, fallback: 400 })
  const [view, setView] = useState(null)       // { key, x0, k }: station at the left edge, px per m
  const [cursor, setCursor] = useState(null)   // station [m] under the cursor
  const [picked, setPicked] = useState(null)   // { trackId, band, indices } being edited
  const [draft, setDraft] = useState('')
  const [note, setNote] = useState(null)       // why a click picked nothing
  const [showFindings, setShowFindings] = useState(true)

  // Recomputed on every render, like the profile: a few points per element.
  const elements = track?.elements
  const bands = {
    curvature: curvatureBand(elements),
    cant: cantBand(elements),
    speed: speedBand(elements),
    spans: elementSpans(elements),
  }
  const length = bands.spans.length ? bands.spans[bands.spans.length - 1].to : 0
  const profile = track ? trackProfile(track) : null
  const points = profile?.points ?? []

  // What the rules say: the alignment catalogue by band, the Höhenplan's on
  // the gradient.
  const found = bandFindings(checkTrack(elements ?? []))
  const vertical = track ? checkVertical(track, { project, switches }) : null
  const vStretches = (vertical?.stretches ?? []).filter(flagged)
  const vCurves = (vertical?.curves ?? []).filter(flagged)
  const allFound = [
    ...Object.values(found).flatMap(f => [...f.spans, ...f.joints]), ...vStretches, ...vCurves,
  ]
  const findingNote = (results) => results.filter(r => r.severity && r.severity !== 'ok')
    .map(r => `${r.id} · ${t(severityLabelKey(r.severity))}: ${ruleById(r.id)?.title ?? ''}`).join('\n')

  // ── Picking elements and setting their value ──────────────────────────────
  const sel = picked?.trackId === trackId ? picked : null
  const selected = new Set(sel?.indices ?? [])
  const shownValue = (band, el) => (band === 'cant' ? Math.abs(el.cant ?? 0) : el.speed ?? null)
  // The value the picked elements share, or empty where they differ.
  const common = (band, indices, els = elements) => {
    const vs = indices.map(i => shownValue(band, els[i]))
    return vs.length && vs.every(x => x === vs[0]) && vs[0] != null ? String(vs[0]) : ''
  }
  const pick = (band, i, add) => {
    if (!bandEditable(band, elements[i])) { setNote(t('bands_cant_transition')); return }
    setNote(null)
    const base = add && sel?.band === band ? sel.indices : []
    const indices = base.includes(i) ? base.filter(j => j !== i) : [...base, i]
    if (!indices.length) return unpick()
    setPicked({ trackId, band, indices })
    setDraft(common(band, indices))
  }
  const unpick = () => { setPicked(null); setDraft(''); setNote(null) }
  const write = (next) => {
    if (next.some((el, i) => el !== elements[i])) updateTrack({ ...track, elements: next })
  }
  const apply = () => {
    if (!sel) return
    const raw = draft.trim()
    const value = raw === '' ? null : Number(raw)
    if (value != null && !Number.isFinite(value)) return
    const next = withBandValue(elements, sel.indices, sel.band, value)
    write(next)
    setDraft(common(sel.band, sel.indices, next))
  }
  // The picked elements at the speed their radius and cant allow
  // (maxSpeeds, without a line speed): those the geometry does not bound keep theirs.
  const applyMaxSpeed = () => {
    if (sel?.band !== 'speed') return
    const most = maxSpeeds(elements, null)
    const next = elements.map((el, i) => (selected.has(i) && most[i].speed !== el.speed ? { ...el, speed: most[i].speed } : el))
    write(next)
    setDraft(common('speed', sel.indices, next))
  }

  // The picked elements, on the map.
  const selectedKey = [...selected].sort((a, b) => a - b).join(',')
  useEffect(() => {
    const m = map?.current
    if (!m?.getLayer(TRACKS_SELECTED_LAYER)) return
    const idx = selectedKey ? selectedKey.split(',').map(Number) : []
    m.setFilter(TRACKS_SELECTED_LAYER, idx.length ? filterForElements(trackId, idx) : FILTER_NONE)
    return () => { if (mapIsLive(map, m) && m.getLayer(TRACKS_SELECTED_LAYER)) m.setFilter(TRACKS_SELECTED_LAYER, FILTER_NONE) }
  }, [map, trackId, selectedKey])

  // ── The view along the track: the whole of it, until zoomed ──────────────
  const plotW = size ? size.w - MARGIN.left - MARGIN.right : 0
  const fitKey = `${trackId}|${plotW > 0 ? 1 : 0}`
  const fitted = { key: fitKey, x0: 0, k: plotW > 0 && length > 0 ? plotW / length : 1 }
  const v = view?.key === fitKey ? view : fitted
  const fit = () => setView(null)
  const sAt = (px) => v.x0 + (px - MARGIN.left) / v.k
  const X = (s) => MARGIN.left + (s - v.x0) * v.k

  useWheelZoom(svgRef, (f, px) => {
    const k = clamp(v.k * f, fitted.k * 0.5, 200)
    const s = sAt(px)
    setView({ key: fitKey, k, x0: s - (px - MARGIN.left) / k })
  }, !!size)
  // A drag pans; a click on an element picks it, a click beside one drops
  // the pick.
  const drag = useDrag({
    onStart: (e) => {
      const d = e.target.dataset ?? {}
      return { view: v, hit: d.band ? { band: d.band, i: Number(d.i) } : null, add: e.shiftKey || e.ctrlKey || e.metaKey }
    },
    onMove: (e, start, { dx }) => setView({ key: fitKey, k: start.view.k, x0: start.view.x0 - dx / start.view.k }),
    onEnd: (start, moved) => {
      if (moved) return
      if (start.hit) pick(start.hit.band, start.hit.i, start.add)
      else unpick()
    },
  })

  // ── The cursor's station on the map ───────────────────────────────────────
  const cursorPreview = usePreview(CURSOR_LAYERS)
  useEffect(() => {
    const point = track && cursor != null ? pointAtStation(track, cursor) : null
    if (!point) { cursorPreview.clear(); return }
    const [lng, lat] = utmToWgs84(point.utm.easting, point.utm.northing, track.epsg)
    cursorPreview.set(CURSOR_SOURCE, { type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [lng, lat] } })
  }, [track, cursor, cursorPreview])

  if (!track) return null

  const onPointerMove = (e) => {
    drag.handlers.onPointerMove(e)
    const rect = svgRef.current.getBoundingClientRect()
    const px = e.clientX - rect.left
    const s = sAt(px)
    setCursor(px >= MARGIN.left && px <= size.w - MARGIN.right && s >= 0 && s <= length ? s : null)
  }

  // What the cursor stands on, for the header.
  const readout = () => {
    if (cursor == null) return <span className="profile-hint">{t('bands_hint_view')}</span>
    const k = bandValueAt(bands.curvature, cursor)
    const u = bandValueAt(bands.cant, cursor)
    const speed = bandValueAt(bands.speed, cursor)
    const z = points.length ? trackHeightAt(tracks, switches, track, cursor) : null
    const radius = k == null || Math.abs(k) < 1e-6 ? '∞' : Math.round(1000 / k)
    return (
      <span className="bands-readout">
        {[
          `${cursor.toFixed(1)} m`,
          `R ${radius} m`,
          `u ${u == null ? '–' : Math.round(u)} mm`,
          `z ${z == null ? '–' : z.toFixed(3)} m`,
          `V ${speed == null ? '–' : speed} km/h`,
        ].join(' · ')}
      </span>
    )
  }

  const drawing = () => {
    if (!size || plotW <= 0) return null
    const right = size.w - MARGIN.right
    const bottom = size.h - MARGIN.bottom
    const order = ['curvature', 'cant', 'height', 'speed']
    const per = (bottom - order.length * (BAND_TITLE + BAND_GAP))
      / order.reduce((sum, b) => sum + BAND_WEIGHTS[b], 0)
    let y = 0
    const rows = Object.fromEntries(order.map(b => {
      const top = y + BAND_TITLE
      const h = Math.max(10, per * BAND_WEIGHTS[b])
      y = top + h + BAND_GAP
      return [b, { top, bottom: top + h }]
    }))

    // The built gradient: the tangent polygon, and the parabola where a
    // vertical curve rounds a change.
    const heightBand = points.length < 2 ? [] : [...new Set([
      ...points.map(p => p.station),
      ...verticalCurves(points).flatMap(c => c.map(p => p.station)),
    ])].sort((a, b) => a - b).map(s => ({ s, v: gradientAt(points, s) }))
    const speedRange = bandRange(bands.speed)
    // The stretch in view: the height plan is scaled to it, so a zoomed-in
    // gradient does not lie flat on a scale made for the whole track; the
    // other bands keep theirs, to compare one curve with the next.
    const inView = [v.x0, v.x0 + plotW / v.k]
    const heightInView = heightBand.length ? [
      ...heightBand.filter(p => p.s > inView[0] && p.s < inView[1]),
      ...inView.map(s => ({ s, v: bandValueAt(heightBand, clamp(s, 0, length)) })),
    ] : []

    const spec = {
      curvature: { points: bands.curvature, scale: bandScale(bandRange(bands.curvature), { signed: true, min: 0.5 }), title: t('bands_curvature'), unit: '1/km' },
      cant:      { points: bands.cant, scale: bandScale(bandRange(bands.cant), { signed: true, min: 20 }), title: t('bands_cant'), unit: 'mm' },
      height:    { points: heightBand, scale: bandScale(bandRange(heightInView), { signed: false, min: 1 }), title: t('bands_height'), unit: 'm' },
      // From 0, so a step reads as the share of the speed it is.
      speed:     { points: bands.speed, scale: [0, Math.max(40, speedRange?.[1] ?? 0) * 1.2], title: t('bands_speed'), unit: 'km/h' },
    }
    const yOf = (b) => {
      const { top, bottom: bot } = rows[b]
      const [lo, hi] = spec[b].scale
      return (val) => bot - (val - lo) / (hi - lo) * (bot - top)
    }

    const sStep = niceStep(70, v.k)
    const sTicks = ticks(Math.max(0, v.x0), Math.min(length, v.x0 + plotW / v.k), sStep)
    // Where a run's label goes: the middle of what is in view of it, or
    // nowhere when that is too narrow for one.
    const labelAt = (from, to) => {
      const a = Math.max(from, inView[0]), b = Math.min(to, inView[1])
      return X(b) - X(a) >= LABEL_MIN_PX ? (a + b) / 2 : null
    }
    const label = (from, to, text, valueAt) => {
      const s = labelAt(from, to)
      return s == null ? [] : [{ s, text, v: valueAt(s) }]
    }

    // The labels of each band: the radius of an arc and the length of a
    // transition, the cant where it holds, the gradient of every stretch, the
    // speed of each run.
    const labels = {
      curvature: bands.spans.filter(sp => sp.el.elementType === 2 || sp.el.radius).flatMap(sp => label(sp.from, sp.to,
        sp.el.elementType === 2 ? `L ${sp.el.length.toFixed(1)}` : `R ${Math.round(Math.abs(sp.el.radius))}`,
        (s) => bandValueAt(bands.curvature, s))),
      cant: bandRuns(bands.cant).filter(r => r.v !== 0)
        .flatMap(r => label(r.from, r.to, `u ${Math.round(Math.abs(r.v))}`, () => r.v)),
      height: points.slice(1).map((b, i) => ({ a: points[i], b }))
        .filter(({ a, b }) => b.station > a.station)
        .flatMap(({ a, b }) => label(a.station, b.station,
          gradeLabel((b.z - a.z) / (b.station - a.station) * 1000),
          (s) => a.z + (b.z - a.z) * (s - a.station) / (b.station - a.station))),
      speed: bandRuns(bands.speed).flatMap(r => label(r.from, r.to, `${r.v}`, () => r.v)),
    }

    // What the rules found, per band: over an element or a stretch of the
    // gradient, at a joint, at a gradient change.
    const spanOf = (i) => bands.spans[i]
    const tints = (b) => {
      if (!showFindings) return []
      if (b === 'height') {
        return vStretches.filter(st => points[st.index - 1] && points[st.index])
          .map(st => ({ key: `hs${st.index}`, from: points[st.index - 1].station, to: points[st.index].station, entry: st }))
      }
      return found[b].spans.map(f => ({ key: `s${f.index}`, from: spanOf(f.index).from, to: spanOf(f.index).to, entry: f }))
    }
    const findingsAt = (b) => new Map((showFindings && found[b] ? found[b].spans : []).map(f => [f.index, f]))

    const empty = {
      height: !heightBand.length && t('bands_no_heights'),
      speed: !speedRange && t('bands_no_speed'),
    }

    return (
      <svg ref={svgRef} className={`profile-svg${drag.dragging ? ' dragging' : ''}`} width={size.w} height={size.h}
        {...drag.handlers} onPointerMove={onPointerMove} onPointerLeave={() => setCursor(null)} onDoubleClick={fit}>
        <defs>
          <clipPath id="bands-clip"><rect x={MARGIN.left} y={0} width={plotW} height={bottom} /></clipPath>
        </defs>
        {sTicks.map(s => <line key={`gs${s}`} x1={X(s)} x2={X(s)} y1={BAND_TITLE} y2={bottom} stroke={PALETTE.gridLine} />)}
        {order.map(b => {
          const { top, bottom: bot } = rows[b]
          const Y = yOf(b)
          const [lo, hi] = spec[b].scale
          const step = niceStep(22, (bot - top) / (hi - lo))
          return (
            <g key={b}>
              <text x={MARGIN.left} y={top - 4} fontSize="11" fontWeight="600" fill={PALETTE.textDark}>
                {spec[b].title} <tspan fontWeight="400" fill={PALETTE.muted}>[{spec[b].unit}]</tspan>
                {(b === 'curvature' || b === 'cant') && <tspan fontWeight="400" fill={PALETTE.muted}> · {t('bands_right_up')}</tspan>}
              </text>
              <rect x={MARGIN.left} y={top} width={plotW} height={bot - top} fill="none" stroke={PALETTE.axis} />
              {ticks(lo, hi, step).map(val => (
                <g key={`t${val}`}>
                  <line x1={MARGIN.left - 3} x2={MARGIN.left} y1={Y(val)} y2={Y(val)} stroke={PALETTE.axis} />
                  <text x={MARGIN.left - 6} y={Y(val) + 3.5} fontSize="10" fill={PALETTE.textSoft} textAnchor="end">
                    {val.toFixed(stepDecimals(step))}
                  </text>
                </g>
              ))}
              <g clipPath="url(#bands-clip)">
                {bands.spans.slice(1).map(sp => (
                  <line key={`e${sp.elIdx}`} x1={X(sp.from)} x2={X(sp.from)} y1={top} y2={bot}
                    stroke={PALETTE.elementBoundary} strokeDasharray="3 3" />
                ))}
                {lo < 0 && hi > 0 && <line x1={MARGIN.left} x2={right} y1={Y(0)} y2={Y(0)} stroke={PALETTE.axis} />}
                {tints(b).map(({ key, from, to, entry }) => (
                  <g key={key} className={`rule-sev-${entry.severity}`} pointerEvents="none">
                    <rect x={X(from)} y={top} width={Math.max(2, X(to) - X(from))} height={bot - top}
                      fill="currentColor" fillOpacity="0.13" />
                    <rect x={X(from)} y={top} width={Math.max(2, X(to) - X(from))} height={3} fill="currentColor" />
                  </g>
                ))}
                {sel?.band === b && sel.indices.map(i => (
                  <rect key={`p${i}`} x={X(spanOf(i).from)} y={top} width={Math.max(2, X(spanOf(i).to) - X(spanOf(i).from))}
                    height={bot - top} fill={PALETTE.mapSelected} fillOpacity="0.12" stroke={PALETTE.mapSelected}
                    pointerEvents="none" />
                ))}
                {b === 'height' && points.length >= 2 && (
                  <polyline fill="none" stroke={PALETTE.verticalCurve} strokeWidth="1"
                    points={points.map(p => `${X(p.station)},${Y(p.z)}`).join(' ')} />
                )}
                <path d={bandPath(spec[b].points, X, Y)} fill="none" stroke="var(--color-primary)" strokeWidth="2"
                  strokeLinejoin="round" />
                {labels[b].map((l, i) => (
                  <text key={`l${i}`} x={X(l.s)} y={clamp(l.v >= (lo + hi) / 2 ? Y(l.v) + 13 : Y(l.v) - 5, top + 10, bot - 3)}
                    fontSize="10" fill={PALETTE.label} textAnchor="middle">{l.text}</text>
                ))}
                {cursor != null && (
                  <line x1={X(cursor)} x2={X(cursor)} y1={top} y2={bot} stroke={PALETTE.mapHover} strokeDasharray="2 2"
                    pointerEvents="none" />
                )}
                {/* every element, to be picked where a value can be set, and
                    saying what the rules found on it */}
                {b !== 'height' && (() => {
                  const at = findingsAt(b)
                  return bands.spans.map(sp => (
                    <rect key={`h${sp.elIdx}`} x={X(sp.from)} y={top} width={Math.max(1, X(sp.to) - X(sp.from))} height={bot - top}
                      fill="transparent" className={EDIT_UNIT[b] ? 'clickable' : undefined}
                      data-band={EDIT_UNIT[b] ? b : undefined} data-i={sp.elIdx}>
                      {at.has(sp.elIdx) && <title>{findingNote(at.get(sp.elIdx).results)}</title>}
                    </rect>
                  ))
                })()}
                {b === 'height' && tints(b).map(({ key, from, to, entry }) => (
                  <rect key={`t${key}`} x={X(from)} y={top} width={Math.max(2, X(to) - X(from))} height={bot - top} fill="transparent">
                    <title>{`s = ${Math.abs(entry.grade).toFixed(2)} ‰\n${findingNote(entry.results)}`}</title>
                  </rect>
                ))}
                {showFindings && b === 'height' && vCurves.filter(c => points[c.index]).map(c => (
                  <circle key={`vc${c.index}`} className={`rule-sev-${c.severity}`} cx={X(c.station)} cy={Y(points[c.index].z)}
                    r="6.5" fill="transparent" stroke="currentColor" strokeWidth="2">
                    <title>{findingNote(c.results)}</title>
                  </circle>
                ))}
                {showFindings && found[b]?.joints.map(j => (
                  <line key={`j${j.index}`} className={`rule-sev-${j.severity}`} x1={X(spanOf(j.index).to)} x2={X(spanOf(j.index).to)}
                    y1={top} y2={bot} stroke="currentColor" strokeWidth="3">
                    <title>{findingNote(j.results)}</title>
                  </line>
                ))}
              </g>
              {empty[b] && (
                <text x={MARGIN.left + plotW / 2} y={(top + bot) / 2 + 4} fontSize="11" fill={PALETTE.muted} textAnchor="middle">
                  {empty[b]}
                </text>
              )}
            </g>
          )
        })}
        {sTicks.map(s => (
          <text key={`ts${s}`} x={X(s)} y={bottom + 14} fontSize="11" fill={PALETTE.textSoft} textAnchor="middle">
            {s.toFixed(stepDecimals(sStep))}
          </text>
        ))}
        <text x={right} y={bottom + 27} fontSize="11" fill={PALETTE.muted} textAnchor="end">{t('elevation_station')} [m]</text>
      </svg>
    )
  }

  return (
    <div className="profile-overlay bands-overlay" style={overlay.style}>
      <div className="profile-resize" onPointerDown={overlay.onResizeStart} />
      <div className="track-table-header">
        <span className="track-table-title">{track.name || track.id.slice(0, 8)}</span>
        <div className="profile-controls">
          {sel ? (
            <div className="profile-edit">
              <span>
                {t(sel.band === 'cant' ? 'bands_cant' : 'bands_speed')}
                {' · '}
                {sel.indices.length === 1
                  ? `${bands.spans[sel.indices[0]].from.toFixed(1)}–${bands.spans[sel.indices[0]].to.toFixed(1)} m`
                  : fill('bands_selected', { n: sel.indices.length })}
              </span>
              <NumberInput className="track-table-input" step="5" min="0" value={draft} autoFocus
                placeholder={t('elevation_mixed')}
                onChange={e => setDraft(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') apply(); if (e.key === 'Escape') { e.preventDefault(); unpick() } }} />
              <span>{EDIT_UNIT[sel.band]}</span>
              {sel.band === 'speed' && (
                <button className="track-table-save-btn" title={t('bands_speed_max_hint')} onClick={applyMaxSpeed}>
                  {t('bands_speed_max')}
                </button>
              )}
              <button className="track-table-save-btn" onClick={apply}>{t('elevation_apply')}</button>
              <CloseButton onClick={unpick} />
            </div>
          ) : note ? (
            <span className="profile-hint">{note}</span>
          ) : readout()}
          <label className="profile-edit bands-findings-toggle">
            <input type="checkbox" checked={showFindings} onChange={e => setShowFindings(e.target.checked)} />
            <span className={`profile-rules rule-sev-${allFound.length ? worstSeverity(allFound.map(f => f.severity)) : 'ok'}`}
              title={t('bands_findings_hint')}>
              {t('bands_findings')} {allFound.length ? `(${allFound.length})` : '✓'}
            </span>
          </label>
          <CloseButton onClick={onClose} />
        </div>
      </div>
      <div className="profile-body" ref={bodyRef}>
        {drawing()}
      </div>
    </div>
  )
}
