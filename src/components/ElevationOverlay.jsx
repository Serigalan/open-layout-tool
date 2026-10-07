import { useEffect, useRef, useState } from 'react'
import { setTrackHeights, setHeightsForTracks, currentProject } from '../storage'
import { useProject, useSwitches, useTracks } from '../hooks/useStore'
import { checkVertical, regularVerticalRadius, verticalFindings } from '../utils/gradientCheck'
import { coupledPoints, trackHeightAt } from '../utils/switchGradient'
import { ruleById, severityLabelKey } from '../utils/regelkatalog'
import {
  trackProfile, adjacentTracks, neighbourStub, jointHeightUpdates, verticalCurves, elementAtStation,
  insertHeightPoint,
} from '../utils/heightUtils'
import { filterForElements, FILTER_NONE, mapIsLive } from '../map/pick'
import { fillHeights } from '../utils/elevationFill'
import { chosenTerrainSource } from '../utils/elevationSource'
import { useI18n } from '../locales/i18nContext'
import { useMap } from '../map/MapContext'
import usePreview from '../map/usePreview'
import { pointAtStation } from '../utils/platformUtils'
import { utmToWgs84 } from '../utils/coordinateUtils'
import { TRACKS_SELECTED_LAYER } from '../map/layerIds'
import { PALETTE } from '../styles/palette'
import { clamp } from '../utils/format'
import { turnoutLinePort } from '../utils/switchModel'
import { niceStep, stepDecimals, ticks } from '../utils/chartAxes'
import { useDrag, useElementSize, useOverlayHeight, useWheelZoom } from './chart/useChartViewport'
import CloseButton from './form/CloseButton'
import NumberInput from './form/NumberInput'

const EXAGGERATIONS  = [1, 2, 5, 10, 20]
const MARGIN = { left: 60, right: 20, top: 30, bottom: 32 }
const MIN_OVERLAY_PX = 140
// Narrower than this and the gradient label would not fit between its points.
const GRADE_LABEL_MIN_PX = 46
// How close to the gradient a double click splits it, and how far it has to
// stay from a point already there.
const INSERT_HIT_PX = 8
const INSERT_POINT_GAP_PX = 7
// Where the cursor stands on the profile, shown on the map: a dot on the
// track at that station.
const CURSOR_SOURCE = 'elevation-cursor-source'
const CURSOR_LAYERS = [{
  sourceId: CURSOR_SOURCE,
  layer: {
    id: 'elevation-cursor-layer', type: 'circle',
    paint: {
      'circle-radius': 6,
      'circle-color': PALETTE.mapHover,
      'circle-stroke-width': 2,
      'circle-stroke-color': PALETTE.white,
    },
  },
}]

/** A gradient in ‰, signed — a rise is written with its plus, a level stretch as 0. */
const gradeLabel = (perMille) => {
  const v = Number(perMille.toFixed(1)) || 0   // ... and never as "-0.0"
  return `${v > 0 ? '+' : ''}${v.toFixed(1)} ‰`
}

/** A finding worth drawing: something the rules said, short of "kept". */
const flagged = (entry) => entry?.severity && entry.severity !== 'ok'

/**
 * Longitudinal profile of one track: stations at 1:1, heights exaggerated
 * (10× by default), zoomable and pannable.
 *
 * The vertical alignment is the track's own — its height points are stationed
 * along the track and sit wherever the design puts them, not on the horizontal
 * elements, whose boundaries are drawn only as a backdrop. The tracks joined
 * at either end show their first stretch beyond the joint; the point where
 * they meet is one point, so it moves on every track meeting there — over a
 * switch too.
 *
 * Clicking a point opens its height for editing, Ctrl/Shift-click and
 * Shift-drag pick more of them. A point may carry the radius of the vertical
 * curve rounding the gradient change there — drawn in light grey between its
 * tangent points. Every stretch is labelled with its gradient in ‰. Any point
 * but the two ends of the track can be deleted. A double click on the
 * gradient splits it there with a new point at its height.
 *
 * Wherever the cursor stands over the profile, its station is marked on the
 * map, on the track — the dot follows the cursor.
 *
 * Where the cross section in its own window stands on this track, its station
 * is marked as on the map — the line across and the height the track is built
 * at there.
 *
 * The gradient is checked against the Höhenplan rules of DB Ril 800.0110 as it
 * is edited (gradientCheck): a stretch whose gradient a rule flags is drawn
 * over in the colour of its step, a gradient change with a finding gets a
 * ring in that colour, and the tooltip of either says what was found. The
 * list of findings stands in the panel.
 *
 * On a turnout's branch, the points between WA and the last through sleeper
 * are the main route's (switchGradient): drawn dashed, and not edited or
 * deleted here — the store would put them back.
 *
 * A track without a gradient shows none — the terrain is not read on its own.
 * The empty profile offers to compute one from the height data instead.
 */
// The profile is read from the store, through the subscription: every write
// draws it again.
export default function ElevationOverlay({ trackId, section = null, onClose }) {
  const { t, fill } = useI18n()
  const map = useMap()
  const tracks   = useTracks()
  const switches = useSwitches()
  const project  = useProject()
  const track    = tracks.find(tr => tr.id === trackId)

  const [exaggeration, setExaggeration] = useState(10)
  const [view, setView]         = useState(null)     // { k, x0, z0 }: px per m, station at the left edge, height at the bottom edge
  const [selection, setSelection] = useState([])   // indices of the height points being edited
  const [draft, setDraft]       = useState('')
  const [rvDraft, setRvDraft]   = useState('')     // vertical curve radius of the selection
  const [rvNote, setRvNote]     = useState(null)     // what setting the Regelwert left undone
  const [band, setBand]         = useState(null)     // rubber band { x0, y0, x1, y1 } while Shift-dragging
  const [hover, setHover]       = useState(null)     // { station, z } a double click would add a point at
  const [cursor, setCursor]     = useState(null)     // station [m] the cursor stands over, shown on the map
  const bodyRef = useRef(null)
  const svgRef  = useRef(null)
  const size = useElementSize(bodyRef)                // { w, h } of the drawing area
  const overlay = useOverlayHeight(bodyRef, { min: MIN_OVERLAY_PX })
  // Reading the gradient from the terrain: { trackId, state } with state
  // 'busy', 'missing' (no height data there) or 'failed'.
  const [reading, setReading] = useState(null)

  // ── Data: the track's own profile and the stubs of the joined tracks ──────
  // Recomputed on every render — it is a few hundred numbers, and the
  // subscription re-renders us after each write to the store.
  const profile = track ? trackProfile(track) : null
  const points  = profile?.points ?? []
  const stubs = track ? [['BEGIN', -1, 0], ['END', 1, profile.length]].flatMap(([end, sign, origin]) =>
    adjacentTracks(tracks, switches, track, end).map(n => ({
      name:   n.track.name || n.track.id.slice(0, 8),
      points: neighbourStub(n).map(p => ({ station: origin + sign * p.d, z: p.z })),
    })).filter(s => s.points.length === 2),
  ) : []
  const allPoints = [...points, ...stubs.flatMap(s => s.points)]
  // The curves rounding the gradient changes.
  const curves = verticalCurves(points)
  // What the Höhenplan rules say, by the point a stretch ends at and the
  // point a gradient change sits at.
  const check = track ? checkVertical(track, { project, switches }) : null
  const stretchAt = new Map((check?.stretches ?? []).map(s => [s.index, s]))
  const curveAt = new Map((check?.curves ?? []).map(c => [c.index, c]))
  // Points a turnout's main route sets on this branch, by index → switch.
  const locked = track ? coupledPoints(tracks, switches, track) : new Map()
  const mainOf = (sw) => {
    const main = tracks.find(tr => tr.id === sw[`port${turnoutLinePort(sw)}_trackId`])
    return main?.name || main?.id.slice(0, 8) || '–'
  }
  const lockedNote = (sw) => fill('elevation_coupled_point', { name: sw.name ?? sw.label ?? '', main: mainOf(sw) })

  // ── Fit the view to the data when the track or the exaggeration changes ───
  const plotW = size ? size.w - MARGIN.left - MARGIN.right : 0
  const plotH = size ? size.h - MARGIN.top - MARGIN.bottom : 0
  const [fitKey, setFitKey] = useState(null)
  // Re-fitted for another track or exaggeration, once the area is measured,
  // and when points appear or go (the terrain fill arriving, a reload) — not
  // for an edited height, which must not throw the view around — nor for a
  // point added or deleted here (`keepView`).
  const fitKeyFor = (n) => `${trackId}|${exaggeration}|${size ? 1 : 0}|${n}`
  const wantFit = fitKeyFor(allPoints.length)
  const keepView = (n) => setFitKey(fitKeyFor(allPoints.length + n))
  if (size && allPoints.length && fitKey !== wantFit) {
    const stations = allPoints.map(p => p.station), zs = allPoints.map(p => p.z)
    const sMin = Math.min(...stations), sMax = Math.max(...stations)
    const zMin = Math.min(...zs), zMax = Math.max(...zs)
    const ds = Math.max(sMax - sMin, 10), dz = Math.max(zMax - zMin, 1)
    const k = Math.min(plotW / ds, plotH / (dz * exaggeration)) * 0.85
    setView({
      k,
      x0: sMin - (plotW / k - ds) / 2,
      z0: zMin - (plotH / (k * exaggeration) - dz) / 2,
    })
    setFitKey(wantFit)
  }
  const [activeKey, setActiveKey] = useState(trackId)
  if (activeKey !== trackId) { setActiveKey(trackId); setSelection([]); setDraft(''); setRvDraft('') }

  // ── Map: the elements the selected points sit on, in red ──────────────────
  // A height point belongs to the track, not to an element; the element it
  // happens to fall in is what the map can show.
  // Kept as a string so the effect runs on a changed set, not on every render.
  const selectedElementsKey = [...new Set(selection
    .map(i => elementAtStation(track?.elements, points[i]?.station ?? 0)?.elIdx)
    .filter(i => i != null))].sort((a, b) => a - b).join(',')
  useEffect(() => {
    const m = map?.current
    if (!m?.getLayer(TRACKS_SELECTED_LAYER)) return
    const idx = selectedElementsKey ? selectedElementsKey.split(',').map(Number) : []
    m.setFilter(TRACKS_SELECTED_LAYER, idx.length ? filterForElements(trackId, idx) : FILTER_NONE)
    return () => { if (mapIsLive(map, m) && m.getLayer(TRACKS_SELECTED_LAYER)) m.setFilter(TRACKS_SELECTED_LAYER, FILTER_NONE) }
  }, [map, trackId, selectedElementsKey])

  // ── Zoom about the cursor (both axes, the exaggeration stays) ─────────────
  useWheelZoom(svgRef, (f, px, py) => setView(v => {
    if (!v) return v
    const k = clamp(v.k * f, 1e-4, 1e4)
    const s = v.x0 + (px - MARGIN.left) / v.k
    const z = v.z0 + (size.h - MARGIN.bottom - py) / (v.k * exaggeration)
    return { k, x0: s - (px - MARGIN.left) / k, z0: z - (size.h - MARGIN.bottom - py) / (k * exaggeration) }
  }), !!size)

  // ── The cursor's station on the map ──────────────────────────────────────
  const cursorPreview = usePreview(CURSOR_LAYERS)
  useEffect(() => {
    const point = track && cursor != null ? pointAtStation(track, cursor) : null
    if (!point) { cursorPreview.clear(); return }
    const [lng, lat] = utmToWgs84(point.utm.easting, point.utm.northing, track.epsg)
    cursorPreview.set(CURSOR_SOURCE, { type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [lng, lat] } })
  }, [track, cursor, cursorPreview])

  // ── Pan by dragging, pick a group of points with Shift ────────────────────
  // A drag that stays put is a click on the background: it drops the selection.
  const svgXY = (e) => {
    const rect = svgRef.current.getBoundingClientRect()
    return { x: e.clientX - rect.left, y: e.clientY - rect.top }
  }
  const drag = useDrag({
    onStart: (e) => {
      if (!view) return null
      if (e.shiftKey) { const { x, y } = svgXY(e); setBand({ x0: x, y0: y, x1: x, y1: y }) }
      return { view, band: e.shiftKey, quiet: e.shiftKey, add: e.ctrlKey || e.metaKey }
    },
    onMove: (e, start, { dx, dy }) => {
      if (start.band) { const { x, y } = svgXY(e); setBand(b => b && { ...b, x1: x, y1: y }); return }
      const { k, x0, z0 } = start.view
      setView({ k, x0: x0 - dx / k, z0: z0 + dy / (k * exaggeration) })
    },
    onEnd: (start, moved) => {
      setBand(null)
      if (start.band && band) selectInBand(band, start.add)
      else if (!start.band && !moved) select([])
    },
  })

  /** Every point of the track inside the rubber band, added to or replacing the selection. */
  const selectInBand = (b, add) => {
    const [xLo, xHi] = [Math.min(b.x0, b.x1), Math.max(b.x0, b.x1)]
    const [yLo, yHi] = [Math.min(b.y0, b.y1), Math.max(b.y0, b.y1)]
    const hit = points.filter(p => {
      const x = X(p.station), y = Y(p.z)
      return x >= xLo && x <= xHi && y >= yLo && y <= yHi
    }).map(p => p.index)
    if (!hit.length && !add) return select([])
    select(add ? [...new Set([...selection, ...hit])] : hit)
  }

  // ── Selecting points, editing and deleting them ───────────────────────────
  const isSelected = (p) => selection.includes(p.index)
  const selectedPoints = points.filter(isSelected)
  // The drafts follow the selection: the common height and curve radius, or
  // empty when they differ (and for the radius, when there is none).
  const common = (vs) => (vs.length && vs.every(v => v === vs[0]) && vs[0] != null ? String(vs[0]) : '')
  const select = (indices) => {
    setSelection(indices)
    const picked = points.filter(p => indices.includes(p.index))
    setDraft(common(picked.map(p => p.z)))
    setRvDraft(common(picked.map(p => p.rv)))
    setRvNote(null)
  }
  const rvMixed = selectedPoints.some(p => p.rv !== selectedPoints[0]?.rv)
  /** Click picks one point, Ctrl/Shift-click adds it to or drops it from the selection. */
  const pick = (p, e) => {
    if (!(e.shiftKey || e.ctrlKey || e.metaKey)) return select([p.index])
    select(isSelected(p) ? selection.filter(i => i !== p.index) : [...selection, p.index])
  }

  const commit = () => {
    if (!track || !selectedPoints.length) return
    // An empty field is the mixed values of the selection — it changes nothing.
    // A radius of 0 takes the vertical curve away.
    const patch = {}
    if (draft.trim())   { const z  = Number(draft);   if (!Number.isFinite(z))  return; patch.z  = z }
    if (rvDraft.trim()) { const rv = Number(rvDraft); if (!Number.isFinite(rv)) return; patch.rv = rv > 0 ? rv : null }
    if (!Object.keys(patch).length) return
    // Where tracks meet there is one point, whatever its index is on each of
    // them: it moves on all of them — over a switch too.
    const entries = selectedPoints.filter(p => !locked.has(p.index))
      .map(p => ({ trackId: track.id, index: p.index, ...patch }))
    if (!entries.length) return
    setHeightsForTracks(jointHeightUpdates(tracks, switches, entries))
  }

  /**
   * Every selected gradient change rounded as the rules ask at its design
   * speed (regularVerticalRadius) — or not at all where they want none. A
   * point without a known speed keeps its curve, and the panel says so.
   */
  const setRegularRadius = () => {
    if (!track || !selectedPoints.length) return
    const found = selectedPoints.filter(p => !locked.has(p.index))
      .map(p => ({ p, r: regularVerticalRadius(track, p.index, { switches }) }))
      .filter(({ r }) => r)
    const set = found.filter(({ r }) => !r.noSpeed)
    const noSpeed = found.length - set.length
    setRvNote(noSpeed ? fill('elevation_vcurve_no_speed', { n: noSpeed }) : null)
    if (!set.length) return
    setHeightsForTracks(jointHeightUpdates(tracks, switches,
      set.map(({ p, r }) => ({ trackId: track.id, index: p.index, rv: r.rv }))))
    const rvOf = new Map(set.map(({ p, r }) => [p.index, r.rv]))
    setRvDraft(common(selectedPoints.map(p => (rvOf.has(p.index) ? rvOf.get(p.index) : p.rv))))
  }

  // Only the two ends of the track have to stay: they are where its height
  // meets the tracks joined to it.
  const isInner = (p) => p.index > 0 && p.index < points.length - 1
  const deletable = selectedPoints.filter(p => isInner(p) && !locked.has(p.index))
  const remove = () => {
    if (!track || !deletable.length) return
    const drop = new Set(deletable.map(p => p.index))
    setTrackHeights(track.id, (track.heights ?? []).filter((_, i) => !drop.has(i)))
    keepView(-drop.size)
    select([])
  }

  // ── Splitting the gradient with a new point ──────────────────────────────
  /** The point a double click at (x, y) would add: on the gradient, between two points. */
  const insertAt = ({ x, y }) => {
    if (!view || !size || x < MARGIN.left || x > size.w - MARGIN.right) return null
    const station = Math.round((view.x0 + (x - MARGIN.left) / view.k) * 100) / 100
    const r = insertHeightPoint(track.heights, station)
    if (!r) return null
    const z = r.heights[r.index].z
    const [a, b] = [r.heights[r.index - 1], r.heights[r.index + 1]]
    if (Math.abs(Y(z) - y) > INSERT_HIT_PX
      || x - X(a.station) < INSERT_POINT_GAP_PX || X(b.station) - x < INSERT_POINT_GAP_PX) return null
    return { station, z, ...r }
  }
  // The station under the cursor, on the track — or null beside the plot.
  const cursorAt = ({ x, y }) => {
    if (!view || !size || x < MARGIN.left || x > size.w - MARGIN.right
      || y < MARGIN.top || y > size.h - MARGIN.bottom) return null
    const station = view.x0 + (x - MARGIN.left) / view.k
    return station >= 0 && station <= (profile?.length ?? 0) ? station : null
  }
  const showInsert = (e) => {
    const c = e.buttons ? null : insertAt(svgXY(e))
    setHover(h => (h?.station === c?.station ? h : c && { station: c.station, z: c.z }))
  }
  const insert = (e) => {
    const c = insertAt(svgXY(e))
    if (!c) return
    setTrackHeights(track.id, c.heights)
    keepView(1)
    setHover(null)
    setSelection([c.index]); setDraft(String(c.z)); setRvDraft('')
  }

  if (!track) return null

  /** The tooltip of a stretch or gradient change: its values, then each finding. */
  const findingNote = (entry, values) => [
    values,
    ...entry.results.filter(r => r.severity !== 'ok')
      .map(r => `${r.id} · ${t(severityLabelKey(r.severity))}: ${ruleById(r.id)?.title ?? ''}`),
  ].join('\n')
  const stretchNote = (s) => findingNote(s, `s = ${Math.abs(s.grade).toFixed(2)} ‰`)
  const curveNote = (c) => findingNote(c, [
    `Δs = ${Math.abs(c.gradeChange).toFixed(2)} ‰`,
    c.radius ? `ra = ${Math.round(c.radius)} m, la = ${c.length.toFixed(2)} m` : 'ra –',
    c.speed ? `v = ${c.speed} km/h` : null,
  ].filter(Boolean).join(', '))

  // ── Geometry helpers ──────────────────────────────────────────────────────
  const X = (station) => MARGIN.left + (station - view.x0) * view.k
  const Y = (z) => size.h - MARGIN.bottom - (z - view.z0) * view.k * exaggeration
  const typeLabel = (el) => {
    if (el.elementType === 2) return t(el.transitionType === 'bloss' ? 'table_type_bloss' : 'table_type_transition')
    if (el.radius != null) return `R ${Math.round(Math.abs(el.radius))}`
    return t('table_type_straight')
  }

  const readState = reading?.trackId === trackId ? reading.state : null
  const readFromTerrain = async () => {
    setReading({ trackId, state: 'busy' })
    let state = null
    try {
      const r = await fillHeights(currentProject, { force: true, trackId, source: chosenTerrainSource() })
      if (r.heights.size) setHeightsForTracks(r.heights)
      if (!r.updated) state = 'missing'
    } catch {
      state = 'failed'
    }
    setReading({ trackId, state })
  }

  // The cross section's station on this track, and the height built there.
  const sectionStation = section?.trackId === trackId && Number.isFinite(section.station)
    ? clamp(section.station, 0, profile.length) : null
  const sectionZ = sectionStation != null ? trackHeightAt(tracks, switches, track, sectionStation) : null
  const cursorZ = cursor != null ? trackHeightAt(tracks, switches, track, cursor) : null

  const drawing = () => {
    if (!size || !view) return null
    const right = size.w - MARGIN.right, bottom = size.h - MARGIN.bottom
    const sStep = niceStep(70, view.k), zStep = niceStep(26, view.k * exaggeration)
    const sTicks = ticks(view.x0, view.x0 + plotW / view.k, sStep)
    const zTicks = ticks(view.z0, view.z0 + plotH / (view.k * exaggeration), zStep)

    // Gradient of every stretch in ‰, at its middle — left out where the label
    // would not fit between the two points.
    const grades = []
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1], b = points[i]
      const run = b.station - a.station
      if (!(run > 0)) continue
      const x1 = X(a.station), x2 = X(b.station)
      if (x2 - x1 < GRADE_LABEL_MIN_PX) continue
      grades.push({ x: (x1 + x2) / 2, y: (Y(a.z) + Y(b.z)) / 2, grade: (b.z - a.z) / run * 1000, stretch: stretchAt.get(i) })
    }

    let lastLabelX = -Infinity
    const labelled = points.filter(p => {
      const x = X(p.station)
      if (x - lastLabelX < 44) return false
      lastLabelX = x
      return true
    })

    return (
      <svg ref={svgRef} className={`profile-svg${drag.dragging ? ' dragging' : ''}`} width={size.w} height={size.h}
        style={hover && !drag.dragging ? { cursor: 'copy' } : undefined}
        {...drag.handlers}
        onPointerMove={e => { drag.handlers.onPointerMove(e); showInsert(e); setCursor(cursorAt(svgXY(e))) }}
        onPointerLeave={() => { setHover(null); setCursor(null) }}
        onDoubleClick={insert}>
        <defs>
          <clipPath id="profile-clip"><rect x={MARGIN.left} y={MARGIN.top} width={plotW} height={plotH} /></clipPath>
        </defs>
        {/* grid */}
        {sTicks.map(s => <line key={`gs${s}`} x1={X(s)} x2={X(s)} y1={MARGIN.top} y2={bottom} stroke={PALETTE.gridLine} />)}
        {zTicks.map(z => <line key={`gz${z}`} x1={MARGIN.left} x2={right} y1={Y(z)} y2={Y(z)} stroke={PALETTE.gridLine} />)}
        {/* axes */}
        <line x1={MARGIN.left} x2={right} y1={bottom} y2={bottom} stroke={PALETTE.axis} />
        <line x1={MARGIN.left} x2={MARGIN.left} y1={MARGIN.top} y2={bottom} stroke={PALETTE.axis} />
        {sTicks.map(s => (
          <text key={`ts${s}`} x={X(s)} y={bottom + 16} fontSize="11" fill={PALETTE.textSoft} textAnchor="middle">{s.toFixed(stepDecimals(sStep))}</text>
        ))}
        {zTicks.map(z => (
          <text key={`tz${z}`} x={MARGIN.left - 6} y={Y(z) + 4} fontSize="11" fill={PALETTE.textSoft} textAnchor="end">{z.toFixed(stepDecimals(zStep))}</text>
        ))}
        <text x={right} y={bottom + 28} fontSize="11" fill={PALETTE.muted} textAnchor="end">{t('elevation_station')} [m]</text>
        <text x={MARGIN.left - 6} y={MARGIN.top - 12} fontSize="11" fill={PALETTE.muted} textAnchor="end">{t('elevation_height')} [m]</text>

        <g clipPath="url(#profile-clip)">
          {/* element boundaries */}
          {[...profile.boundaries, { station: profile.length }].map((b, i) => (
            <g key={`b${i}`}>
              <line x1={X(b.station)} x2={X(b.station)} y1={MARGIN.top} y2={bottom} stroke={PALETTE.elementBoundary} strokeDasharray="3 3" />
              {b.el && <text x={X(b.station) + 3} y={MARGIN.top + 11} fontSize="10" fill={PALETTE.label}>{typeLabel(b.el)}</text>}
            </g>
          ))}
          {/* joined tracks */}
          {stubs.map((s, i) => {
            const [a, b] = s.points
            return (
              <g key={`n${i}`}>
                <line x1={X(a.station)} y1={Y(a.z)} x2={X(b.station)} y2={Y(b.z)} stroke={PALETTE.axis} strokeWidth="2" strokeDasharray="6 4" />
                <circle cx={X(b.station)} cy={Y(b.z)} r="3" fill={PALETTE.white} stroke={PALETTE.axis} strokeWidth="1.5" />
                <text x={X(b.station)} y={Y(b.z) - 8} fontSize="10" fill={PALETTE.label} textAnchor="middle">{s.name}</text>
              </g>
            )
          })}
          {/* the vertical curves rounding the gradient changes */}
          {curves.map((c, i) => (
            <polyline key={`vc${i}`} fill="none" stroke={PALETTE.verticalCurve} strokeWidth="2"
              points={c.map(p => `${X(p.station)},${Y(p.z)}`).join(' ')} />
          ))}
          {/* the track */}
          <polyline fill="none" stroke="var(--color-primary)" strokeWidth="2"
            points={points.map(p => `${X(p.station)},${Y(p.z)}`).join(' ')} />
          {/* stretches a rule flags, in the colour of its step */}
          {[...stretchAt.values()].filter(flagged).map(s => (
            <line key={`sf${s.index}`} className={`rule-sev-${s.severity}`} stroke="currentColor" strokeWidth="4"
              strokeOpacity="0.75" strokeLinecap="round"
              x1={X(points[s.index - 1].station)} y1={Y(points[s.index - 1].z)}
              x2={X(points[s.index].station)} y2={Y(points[s.index].z)}>
              <title>{stretchNote(s)}</title>
            </line>
          ))}
          {grades.map((g, i) => (
            <text key={`g${i}`} x={g.x} y={g.y + 14} fontSize="10" textAnchor="middle"
              className={flagged(g.stretch) ? `rule-sev-${g.stretch.severity}` : undefined}
              fill={flagged(g.stretch) ? 'currentColor' : PALETTE.muted}>
              {g.stretch && <title>{stretchNote(g.stretch)}</title>}
              {gradeLabel(g.grade)}
            </text>
          ))}
          {/* gradient changes a rule flags: a ring in the colour of its step */}
          {[...curveAt.values()].filter(flagged).map(c => (
            <circle key={`cf${c.index}`} className={`rule-sev-${c.severity}`} cx={X(c.station)} cy={Y(points[c.index].z)}
              r="8.5" fill="none" stroke="currentColor" strokeWidth="2" pointerEvents="none" />
          ))}
          {labelled.map(p => (
            <text key={`l${p.index}`} x={X(p.station)} y={Y(p.z) - 9} fontSize="10" fill={PALETTE.textStrong} textAnchor="middle">
              {p.z.toFixed(2)}{p.rv != null && <tspan fill={PALETTE.label}> R{Math.round(p.rv)}</tspan>}
            </text>
          ))}
          {/* where the cross section is taken */}
          {sectionStation != null && (
            <g pointerEvents="none">
              <line x1={X(sectionStation)} x2={X(sectionStation)} y1={MARGIN.top} y2={bottom}
                stroke={PALETTE.mapSelected} strokeWidth="1.5" strokeDasharray="3 2" />
              {sectionZ != null && (
                <circle cx={X(sectionStation)} cy={Y(sectionZ)} r="4.5" fill={PALETTE.mapSelected} stroke={PALETTE.white} strokeWidth="1.5" />
              )}
            </g>
          )}
          {cursor != null && (
            <g pointerEvents="none">
              <line x1={X(cursor)} x2={X(cursor)} y1={MARGIN.top} y2={bottom}
                stroke={PALETTE.mapHover} strokeWidth="1" strokeDasharray="2 2" />
              {cursorZ != null && (
                <circle cx={X(cursor)} cy={Y(cursorZ)} r="3.5" fill={PALETTE.mapHover} stroke={PALETTE.white} strokeWidth="1.5" />
              )}
            </g>
          )}
          {hover && (
            <circle cx={X(hover.station)} cy={Y(hover.z)} r="4" fill={PALETTE.white}
              stroke="var(--color-primary)" strokeWidth="1.5" strokeDasharray="2 2" pointerEvents="none" />
          )}
          {points.map(p => {
            const on = isSelected(p)
            return (
              <circle className="clickable" key={`p${p.index}`} cx={X(p.station)} cy={Y(p.z)} r={on ? 5.5 : 3.5}
                fill={on ? PALETTE.mapSelected : PALETTE.white} stroke={on ? PALETTE.mapSelected : 'var(--color-primary)'} strokeWidth="2"
                strokeDasharray={locked.has(p.index) ? '2 1.5' : undefined}
                onPointerDown={e => e.stopPropagation()} onClick={e => pick(p, e)}>
                {(curveAt.has(p.index) || locked.has(p.index)) && (
                  <title>
                    {[locked.has(p.index) && lockedNote(locked.get(p.index)),
                      curveAt.has(p.index) && curveNote(curveAt.get(p.index))].filter(Boolean).join('\n')}
                  </title>
                )}
              </circle>
            )
          })}
        </g>
        {sectionStation != null && X(sectionStation) >= MARGIN.left && X(sectionStation) <= right && (
          <text x={X(sectionStation)} y={MARGIN.top - 6} fontSize="10" fill={PALETTE.mapSelected} textAnchor="middle" pointerEvents="none">
            {fill('elevation_section_marker', {
              station: sectionStation.toFixed(1),
              z: sectionZ != null ? ` · ${sectionZ.toFixed(2)} m` : '',
            })}
          </text>
        )}
        {cursor != null && sectionStation == null && (
          <text x={clamp(X(cursor), MARGIN.left + 40, right - 40)} y={MARGIN.top - 6} fontSize="10" fill={PALETTE.mapHover}
            textAnchor="middle" pointerEvents="none">
            {`${cursor.toFixed(1)} m${cursorZ != null ? ` · ${cursorZ.toFixed(3)} m` : ''}`}
          </text>
        )}
        {band && (
          <rect x={Math.min(band.x0, band.x1)} y={Math.min(band.y0, band.y1)}
            width={Math.abs(band.x1 - band.x0)} height={Math.abs(band.y1 - band.y0)}
            fill="rgba(165,42,31,0.08)" stroke={PALETTE.mapSelected} strokeDasharray="4 3" />
        )}
      </svg>
    )
  }

  return (
    <div className="profile-overlay" style={overlay.style}>
      <div className="profile-resize" onPointerDown={overlay.onResizeStart} />
      <div className="track-table-header">
        <span className="track-table-title">{track.name || track.id.slice(0, 8)}</span>
        <div className="profile-controls">
          {selectedPoints.length && selectedPoints.every(p => locked.has(p.index)) ? (
            <div className="profile-edit">
              <span className="profile-hint">{lockedNote(locked.get(selectedPoints[0].index))}</span>
              <CloseButton onClick={() => select([])} />
            </div>
          ) : selectedPoints.length ? (
            <div className="profile-edit">
              <span>{selectedPoints.length === 1
                ? `${t('elevation_station')} ${selectedPoints[0].station.toFixed(2)} m`
                : fill('elevation_selected', { n: selectedPoints.length })}</span>
              <NumberInput className="track-table-input" step="0.01" value={draft} autoFocus
                placeholder={t('elevation_mixed')}
                onChange={e => setDraft(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') { e.preventDefault(); select([]) } }} />
              <span>m</span>
              <span title={t('elevation_vcurve_hint')}>{t('elevation_vcurve')}</span>
              <NumberInput className="track-table-input" step="100" min="0" value={rvDraft}
                placeholder={rvMixed ? t('elevation_mixed') : '–'} title={t('elevation_vcurve_hint')}
                onChange={e => setRvDraft(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') { e.preventDefault(); select([]) } }} />
              <span>m</span>
              <button className="track-table-save-btn" title={t('elevation_vcurve_regular_hint')} onClick={setRegularRadius}>
                {t('elevation_vcurve_regular')}
              </button>
              {rvNote && <span className="form-error">{rvNote}</span>}
              <button className="track-table-save-btn" onClick={commit}>{t('elevation_apply')}</button>
              <button className="track-table-save-btn profile-delete-btn" disabled={!deletable.length}
                title={t('elevation_delete_hint')} onClick={remove}>
                {fill('elevation_delete', { n: deletable.length })}
              </button>
              <CloseButton onClick={() => select([])} />
            </div>
          ) : (
            <span className="profile-hint">{t('elevation_hint_edit')}</span>
          )}
          {check && points.length >= 2 && (() => {
            // The rules in a word, beside the controls: the list itself is in
            // the panel, which a long track list may have scrolled away.
            const found = verticalFindings(check)
            const n = found.reduce((sum, f) => sum + f.places, 0)
            return (
              <span className={`profile-rules rule-sev-${check.severity ?? 'none'}`}
                title={found.length
                  ? found.map(f => `${f.id} · ${t(severityLabelKey(f.severity))}: ${ruleById(f.id)?.title ?? ''}${f.places > 1 ? ` (${f.places}×)` : ''}`).join('\n')
                  : t('elevation_rules_ok')}>
                {found.length ? fill('elevation_rules_summary', { n }) : `✓ ${t('elevation_rules')}`}
              </span>
            )
          })()}
          <label className="profile-edit">
            {t('elevation_exaggeration')}
            <select className="settings-select" value={exaggeration} onChange={e => setExaggeration(Number(e.target.value))}>
              {EXAGGERATIONS.map(x => <option key={x} value={x}>{x}×</option>)}
            </select>
          </label>
          <CloseButton onClick={onClose} />
        </div>
      </div>
      <div className="profile-body" ref={bodyRef}>
        {points.length === 0
          ? (
            <div className="profile-empty">
              <span>{t('elevation_no_heights')}</span>
              <button className="panel-btn" disabled={readState === 'busy'} onClick={readFromTerrain}>
                {t('elevation_compute')}
              </button>
              {readState === 'busy' && <span>{t('elevation_loading')}</span>}
              {readState === 'missing' && <span className="form-error">{t('elevation_compute_missing')}</span>}
              {readState === 'failed' && <span className="form-error">{t('elevation_failed')}</span>}
            </div>
          )
          : drawing()}
      </div>
    </div>
  )
}
