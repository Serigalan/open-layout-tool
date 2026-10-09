import { useEffect, useMemo, useRef, useState } from 'react'
import { setTrackHeights, setHeightsForTracks, currentProject, loadTracks, loadSwitches } from '../storage'
import { useProject, useReferenceAxes, useRoutes, useSwitches, useTracks } from '../hooks/useStore'
import { checkVertical, regularVerticalRadius, verticalFindings } from '../utils/gradientCheck'
import { coupledPoints, trackHeightAt } from '../utils/switchGradient'
import { ruleById, severityLabelKey } from '../utils/regelkatalog'
import {
  adjacentTracks, neighbourStub, jointHeightUpdates, verticalCurves, verticalCurveOverlaps, elementAtStation,
  insertHeightPoint, solveHeightPoint, GIVEN_MODES,
} from '../utils/heightUtils'
import { partStation, resolveRoute, routeAt, routePointAt } from '../utils/routes'
import { routeElements, routeFindings, routeProfile, routeStationOfPart, trackAsRoute } from '../utils/routeProfile'
import { reverseTrack } from '../utils/trackModel'
import { filterForElements, FILTER_NONE, mapIsLive } from '../map/pick'
import { fillHeights } from '../utils/elevationFill'
import { chosenTerrainSource } from '../utils/elevationSource'
import {
  comparedLine, deviationAt, heightsComparable, nearestAxis, referenceProfile, shiftValues,
} from '../utils/shiftValues'
import { loadSettings, saveSettings } from '../utils/settings'
import useReferenceAxesOnMap from '../map/useReferenceAxesOnMap'
import { useI18n } from '../locales/i18nContext'
import { useMap } from '../map/MapContext'
import usePreview from '../map/usePreview'
import { utmToWgs84 } from '../utils/coordinateUtils'
import { TRACKS_SELECTED_LAYER } from '../map/layerIds'
import { PALETTE } from '../styles/palette'
import { clamp } from '../utils/format'
import { turnoutDivergingPort, turnoutLinePort } from '../utils/switchModel'
import { niceStep, stepDecimals, ticks } from '../utils/chartAxes'
import { useDrag, useElementSize, useOverlayHeight, useWheelZoom } from './chart/useChartViewport'
import CloseButton from './form/CloseButton'
import InfoTip from './form/InfoTip'
import NumberInput from './form/NumberInput'
import ElevationTable from './ElevationTable'

const EXAGGERATIONS  = [1, 2, 5, 10, 20]
const NO_POINTS = []
const MARGIN = { left: 60, right: 20, top: 30, bottom: 32 }
const MIN_OVERLAY_PX = 140
// Narrower than this and the gradient label would not fit between its points.
const GRADE_LABEL_MIN_PX = 46
// How close to the gradient a double click splits it, and how far it has to
// stay from a point already there.
const INSERT_HIT_PX = 8
const INSERT_POINT_GAP_PX = 7
// The reference axis (Paket V) laid over the profile: its height read every
// this much [m], and the strip below the profile that draws how far the
// gradient lies above or below it — its height and the gap above it [px].
const REF_EVERY = 1
const DEV_STRIP_PX = 64
const DEV_GAP_PX = 14
// The limit in height the shift values warn beyond [mm] (Entscheidung 200).
const DEFAULT_LIMIT_Z = 50
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
 * tangent points, each marked with a small yellow dot. Where two curves run
 * into each other (HP.AR.04), the stretch they share is framed in the colour
 * of an error. Every stretch is labelled with its gradient in ‰. Any point
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
 * Where the project has reference axes (Bestandsachsen, Paket V), one can be
 * laid over the profile — the one the track runs along the furthest unless
 * another is chosen: its heights, read where its normal meets the track
 * (shiftValues), over the track's stations as a dashed brown line; below the
 * profile a strip with the gradient minus it in mm, the height limit of the
 * shift values either side, red beyond it. Only where both are stated in one
 * height system — otherwise the header says why there is nothing to see.
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
 * The same gradient can be shown as a table instead (ElevationTable): station,
 * height, the gradients either side and the vertical curve of every point,
 * two of the first four given and typed, the other two following. Which view
 * and which two are kept on this device. In the graphic view a single point's
 * station is typed in the header, with its height given.
 *
 * A track without a gradient shows none — the terrain is not read on its own.
 * The empty profile offers to compute one from the height data instead.
 *
 * A route (Paket RT, `routeId`) is shown the same way, over its own stations:
 * the points of all its tracks, one where two meet, the curves and the
 * stretches across the joints, and where it goes over to the next track a
 * line with that track's name. Every edit lands in the track the point
 * belongs to (routeProfile, decision 251); a point moves only within its
 * track, and a double click adds a point to the track the route runs there.
 */
// The profile is read from the store, through the subscription: every write
// draws it again.
export default function ElevationOverlay({ trackId, routeId = null, section = null, onClose }) {
  const { t, fill } = useI18n()
  const map = useMap()
  const tracks   = useTracks()
  const switches = useSwitches()
  const project  = useProject()
  const routes   = useRoutes()
  // A route (Paket RT) or a single track — the track as the route of one part,
  // so both are drawn and edited the same way (decision 251).
  const routeRec = routeId ? routes.find(r => r.id === routeId) ?? null : null
  const track    = routeRec ? null : tracks.find(tr => tr.id === trackId) ?? null
  const viewKey  = routeRec ? `route:${routeRec.id}` : trackId
  const resolved = useMemo(() => {
    if (routeRec) { const r = resolveRoute(routeRec, tracks, switches); return r.parts.length ? r : null }
    return track ? trackAsRoute(track) : null
  }, [routeRec, track, tracks, switches])
  const parts = resolved?.parts ?? []
  const title = routeRec ? routeRec.name : track ? track.name || track.id.slice(0, 8) : ''

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
  // Reading the gradient from the terrain: { key, state } with state
  // 'busy', 'missing' (no height data there) or 'failed'.
  const [reading, setReading] = useState(null)

  // ── Graphic or table view, and which two values the table is given ───────
  const [viewKind, setViewKind] = useState(() => {
    try { return loadSettings().elevationView === 'table' ? 'table' : 'graphic' } catch { return 'graphic' }
  })
  const [given, setGiven] = useState(() => {
    try { const g = loadSettings().elevationGiven; return GIVEN_MODES[g] ? g : 'sz' } catch { return 'sz' }
  })
  const remember = (patch) => { try { saveSettings(patch) } catch { /* kept for this session only */ } }
  const chooseView = (v) => { setViewKind(v); remember({ elevationView: v }) }
  const chooseGiven = (v) => { setGiven(v); remember({ elevationGiven: v }) }
  const [stDraft, setStDraft]   = useState('')     // station of a single selected point

  // ── The reference axis laid over the profile ─────────────────────────────
  // '' for none, 'auto' for the one the track runs along the furthest, or an
  // axis' id; on or off is kept for this device.
  const axes = useReferenceAxes()
  const [refChoice, setRefChoice] = useState(() => {
    try { return loadSettings().elevationReference === 'auto' ? 'auto' : '' } catch { return '' }
  })
  const chooseRef = (v) => {
    setRefChoice(v)
    try { saveSettings({ elevationReference: v ? 'auto' : 'none' }) } catch { /* kept for this session only */ }
  }
  const [limitZ] = useState(() => {
    let v
    try { v = Number(loadSettings().shiftValues?.limitZ) } catch { v = NaN }
    return (Number.isFinite(v) && v > 0 ? v : DEFAULT_LIMIT_Z) / 1000
  })
  // ── Data: the profile along the route, its points the tracks' own ────────
  const profile = useMemo(() => (resolved ? routeProfile(resolved) : null), [resolved])
  const points  = profile?.points ?? NO_POINTS
  // The route as one line in one plane, for the reference axis — none where its tracks lie in different planes.
  const epsg = parts.length && parts.every(p => Number(p.track.epsg) === Number(parts[0].track.epsg)) ? parts[0].track.epsg : null
  const heightEpsg = parts[0]?.track.heightEpsg
  // A single track hands on its own elements, so an edited height does not read the axis again.
  const elements = useMemo(() => {
    if (!resolved || !epsg) return null
    const only = resolved.parts.length === 1 && !resolved.parts[0].reversed ? resolved.parts[0] : null
    return only ? only.track.elements : routeElements(resolved, reverseTrack)
  }, [resolved, epsg])
  const heights = useMemo(() => points.map(p => ({ station: p.station, z: p.z, ...(p.rv != null ? { rv: p.rv } : {}) })), [points])
  const inPlane = useMemo(() => axes.filter(a => Number(a.epsg) === Number(epsg)), [axes, epsg])
  // The track's axis as the shift values read it — its heights are added
  // where they are compared, so an edited height does not sample it again.
  const geometry = useMemo(
    () => (inPlane.length && elements ? comparedLine(elements, epsg) : null),
    [inPlane.length, elements, epsg])
  const autoAxis = useMemo(() => (geometry ? nearestAxis(inPlane, geometry, epsg) : null), [geometry, inPlane, epsg])
  const refAxis = !refChoice ? null : refChoice === 'auto' ? autoAxis : inPlane.find(a => a.id === refChoice) ?? null
  const refComparable = !!refAxis && heightsComparable(refAxis, heightEpsg)
  const refRows = useMemo(
    () => (refAxis && geometry && refComparable ? shiftValues(refAxis, geometry, { every: REF_EVERY, withHeights: false }) : []),
    [refAxis, geometry, refComparable])
  const refRuns = useMemo(() => referenceProfile(refRows, heights, REF_EVERY), [refRows, heights])
  const refShown = useMemo(() => (refAxis ? [refAxis] : []), [refAxis])
  useReferenceAxesOnMap('elevation-reference', refShown)
  const refPoints = refRuns.flat()
  const devShown = refPoints.some(p => p.dz != null)
  // Why nothing of the reference axis is drawn, where it is not.
  const refNote = !refChoice ? null
    : !refAxis ? t('shift_no_axis')
      : !refAxis.points.z ? t('elevation_ref_no_heights')
        : !refComparable ? t('elevation_ref_datum')
          : !refRuns.length ? fill('shift_no_overlap', { axis: refAxis.name })
            : null

  // The tracks joined at either end of the route — its own left out — show
  // their first stretch beyond the joint.
  const inRoute = new Set(parts.map(p => p.trackId))
  const first = parts[0], lastPart = parts[parts.length - 1]
  const stubs = resolved ? [
    [first.track, first.reversed ? 'END' : 'BEGIN', -1, 0],
    [lastPart.track, lastPart.reversed ? 'BEGIN' : 'END', 1, profile.length],
  ].flatMap(([tr, end, sign, origin]) =>
    adjacentTracks(tracks, switches, tr, end).filter(n => !inRoute.has(n.track.id)).map(n => ({
      name:   n.track.name || n.track.id.slice(0, 8),
      points: neighbourStub(n).map(p => ({ station: origin + sign * p.d, z: p.z })),
    })).filter(st => st.points.length === 2),
  ) : []
  const allPoints = [...points, ...stubs.flatMap(s => s.points)]
  // The curves rounding the gradient changes.
  const curves = verticalCurves(points)
  const overlaps = verticalCurveOverlaps(points)
  // What the Höhenplan rules say, by the point a stretch ends at and the
  // point a gradient change sits at.
  // Each track judged on its own, laid onto the route.
  const check = profile
    ? routeFindings(profile, new Map(parts.map(p => [p.trackId, checkVertical(p.track, { project, switches })])))
    : null
  const stretchAt = check?.stretchAt ?? new Map()
  const curveAt = check?.curveAt ?? new Map()
  // Points in a turnout's stretch, by route index → { sw, side, sleeper }: each
  // has a partner on the same sleeper of the other track, which follows it
  // (decision 258) — locked where the turnout's heights are (decision 260).
  const paired = new Map()
  for (const part of parts) {
    for (const [index, info] of coupledPoints(tracks, switches, part.track)) {
      const i = profile.byRef(part.trackId, index)
      if (i != null) paired.set(i, info)
    }
  }
  const locked = new Map([...paired].filter(([, v]) => v.sw.heightsLocked).map(([i, v]) => [i, v.sw]))
  /** The track and its own station at a station of the route. */
  const onTrackAt = (s) => (resolved ? routeAt(resolved, s) : null)
  /** The height built at a station of the route — on a turnout's branch, the plane of the turnout. */
  const heightAt = (s) => {
    const a = onTrackAt(s)
    return a ? trackHeightAt(tracks, switches, a.part.track, a.station) : null
  }
  const trackName = (id) => {
    const tr = tracks.find(x => x.id === id)
    return tr?.name || tr?.id.slice(0, 8) || '–'
  }
  const swName = (sw) => sw.name ?? sw.label ?? ''
  const lockedNote = (sw) => fill('elevation_locked_point', { name: swName(sw) })
  // Sleepers are counted from WA, the first being 1; the last is the ldS.
  const sleeperLabel = (sl) => (sl?.k === 'lds' ? t('elevation_lds') : String((sl?.k ?? 0) + 1))
  const pairedNote = ({ sw, side, sleeper }) => fill(side === 'main' ? 'elevation_paired_main' : 'elevation_paired_branch', {
    name: swName(sw), sleeper: sleeperLabel(sleeper),
    other: trackName(sw[`port${side === 'main' ? turnoutDivergingPort(sw) : turnoutLinePort(sw)}_trackId`]),
  })
  const pointNote = (i) => (locked.has(i) ? lockedNote(locked.get(i)) : paired.has(i) ? pairedNote(paired.get(i)) : null)

  // ── Fit the view to the data when the track or the exaggeration changes ───
  const plotW = size ? size.w - MARGIN.left - MARGIN.right : 0
  // The deviation strip, where shown, takes its share below the profile.
  const devPx = devShown ? DEV_STRIP_PX + DEV_GAP_PX : 0
  const plotBottom = size ? size.h - MARGIN.bottom - devPx : 0
  const plotH = size ? plotBottom - MARGIN.top : 0
  const [fitKey, setFitKey] = useState(null)
  // Re-fitted for another track or exaggeration, once the area is measured,
  // and when points appear or go (the terrain fill arriving, a reload) — not
  // for an edited height, which must not throw the view around — nor for a
  // point added or deleted here (`keepView`).
  // The reference axis counts as it is laid over the track or taken away.
  const fitPoints = [...allPoints, ...refPoints.map(p => ({ station: p.s, z: p.z }))]
  const fitKeyFor = (n) => `${viewKey}|${exaggeration}|${size ? 1 : 0}|${devPx}|${n}`
  const wantFit = fitKeyFor(fitPoints.length)
  const keepView = (n) => setFitKey(fitKeyFor(fitPoints.length + n))
  if (size && fitPoints.length && fitKey !== wantFit) {
    const stations = fitPoints.map(p => p.station), zs = fitPoints.map(p => p.z)
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
  const [activeKey, setActiveKey] = useState(viewKey)
  if (activeKey !== viewKey) { setActiveKey(viewKey); setSelection([]); setDraft(''); setRvDraft('') }

  // ── Map: the elements the selected points sit on, in red ──────────────────
  // A height point belongs to the track, not to an element; the element it
  // happens to fall in is what the map can show.
  // Kept as a string so the effect runs on a changed set, not on every render.
  const selectedElementsKey = [...new Set(selection.map(i => {
    const o = points[i]?.owner
    const el = o && elementAtStation(o.part.track.elements, o.part.track.heights?.[o.index]?.station ?? 0)?.elIdx
    return el != null ? `${o.trackId}:${el}` : null
  }).filter(Boolean))].sort().join(',')
  useEffect(() => {
    const m = map?.current
    if (!m?.getLayer(TRACKS_SELECTED_LAYER)) return
    const byTrack = new Map()
    for (const k of selectedElementsKey ? selectedElementsKey.split(',') : []) {
      const [id, el] = k.split(':')
      byTrack.set(id, [...(byTrack.get(id) ?? []), Number(el)])
    }
    m.setFilter(TRACKS_SELECTED_LAYER, !byTrack.size ? FILTER_NONE
      : ['any', ...[...byTrack].map(([id, idx]) => filterForElements(id, idx))])
    return () => { if (mapIsLive(map, m) && m.getLayer(TRACKS_SELECTED_LAYER)) m.setFilter(TRACKS_SELECTED_LAYER, FILTER_NONE) }
  }, [map, selectedElementsKey])

  // ── Zoom about the cursor (both axes, the exaggeration stays) ─────────────
  useWheelZoom(svgRef, (f, px, py) => setView(v => {
    if (!v) return v
    const k = clamp(v.k * f, 1e-4, 1e4)
    const s = v.x0 + (px - MARGIN.left) / v.k
    const z = v.z0 + (plotBottom - py) / (v.k * exaggeration)
    return { k, x0: s - (px - MARGIN.left) / k, z0: z - (plotBottom - py) / (k * exaggeration) }
  }), !!size)

  // ── The cursor's station on the map ──────────────────────────────────────
  const cursorPreview = usePreview(CURSOR_LAYERS)
  useEffect(() => {
    const point = resolved && cursor != null ? routePointAt(resolved, cursor) : null
    if (!point) { cursorPreview.clear(); return }
    const on = parts.find(p => p.trackId === point.trackId)
    const [lng, lat] = utmToWgs84(point.utm.easting, point.utm.northing, on.track.epsg)
    cursorPreview.set(CURSOR_SOURCE, { type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [lng, lat] } })
    // parts follow resolved
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resolved, cursor, cursorPreview])

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
    setStDraft(picked.length === 1 ? String(Math.round(picked[0].station * 1000) / 1000) : '')
    setRvNote(null)
  }
  // A point's station can move unless it is a joint or a turnout sets it.
  const stationMovable = (p) => !locked.has(p.index) && p.trackEnd == null && !p.joint

  /**
   * Write a point solved along the route (`r`: { station, z } in route
   * stations) to the track it belongs to: a station moved within that track,
   * a height to every track meeting at it (jointHeightUpdates). `rv` a radius
   * to set with it — null takes the curve away, undefined leaves it.
   */
  const writePoint = (p, r, rv) => {
    const { part, index, trackId: id } = p.owner
    const own = part.track.heights
    if (Math.abs(r.station - p.station) > 1e-9) {
      const q = { ...own[index], station: Math.round(partStation(part, r.station - part.offset) * 1e6) / 1e6, z: r.z }
      if (rv !== undefined) { if (rv == null) delete q.rv; else q.rv = rv }
      setTrackHeights(id, own.map((h, i) => (i === index ? q : h)))
    } else if (Math.abs(r.z - p.z) > 1e-9 || rv !== undefined) {
      setHeightsForTracks(jointHeightUpdates(tracks, switches, [{ trackId: id, index, z: r.z, ...(rv !== undefined ? { rv } : {}) }]))
    }
  }
  const rvMixed = selectedPoints.some(p => p.rv !== selectedPoints[0]?.rv)
  /** Click picks one point, Ctrl/Shift-click adds it to or drops it from the selection. */
  const pick = (p, e) => {
    if (!(e.shiftKey || e.ctrlKey || e.metaKey)) return select([p.index])
    select(isSelected(p) ? selection.filter(i => i !== p.index) : [...selection, p.index])
  }

  const commit = () => {
    if (!resolved || !selectedPoints.length) return
    // An empty field is the mixed values of the selection — it changes nothing.
    // A radius of 0 takes the vertical curve away.
    const patch = {}
    if (draft.trim())   { const z  = Number(draft);   if (!Number.isFinite(z))  return; patch.z  = z }
    if (rvDraft.trim()) { const rv = Number(rvDraft); if (!Number.isFinite(rv)) return; patch.rv = rv > 0 ? rv : null }
    // A single point's station typed anew: it moves there with its height —
    // between its neighbours, which stay.
    const one = selectedPoints.length === 1 ? selectedPoints[0] : null
    const st = one && stationMovable(one) && stDraft.trim() ? Number(stDraft) : null
    if (st != null && Number.isFinite(st) && Math.abs(st - one.station) > 1e-9) {
      const r = solveHeightPoint(points, one.index, { s: st, z: patch.z ?? one.z }, { length: profile.length })
      if (r.error) { setRvNote(fill(`elevation_table_error_${r.error}`, { n: one.index + 1 })); return }
      writePoint(one, r, patch.rv)
      setStDraft(String(Math.round(r.station * 1000) / 1000)); setRvNote(null)
      return
    }
    if (!Object.keys(patch).length) return
    // Where tracks meet there is one point, whatever its index is on each of
    // them: it moves on all of them — over a switch too.
    const entries = selectedPoints.filter(p => !locked.has(p.index))
      .map(p => ({ trackId: p.owner.trackId, index: p.owner.index, ...patch }))
    if (!entries.length) return
    setHeightsForTracks(jointHeightUpdates(tracks, switches, entries))
  }

  /**
   * Every selected gradient change rounded as the rules ask at its design
   * speed (regularVerticalRadius) — or not at all where they want none. A
   * point without a known speed keeps its curve, and the panel says so.
   */
  const setRegularRadius = () => {
    if (!resolved || !selectedPoints.length) return
    const found = selectedPoints.filter(p => !locked.has(p.index))
      .map(p => ({ p, r: regularVerticalRadius(p.owner.part.track, p.owner.index, { switches }) }))
      .filter(({ r }) => r)
    const set = found.filter(({ r }) => !r.noSpeed)
    const noSpeed = found.length - set.length
    setRvNote(noSpeed ? fill('elevation_vcurve_no_speed', { n: noSpeed }) : null)
    if (!set.length) return
    setHeightsForTracks(jointHeightUpdates(tracks, switches,
      set.map(({ p, r }) => ({ trackId: p.owner.trackId, index: p.owner.index, rv: r.rv }))))
    const rvOf = new Map(set.map(({ p, r }) => [p.index, r.rv]))
    setRvDraft(common(selectedPoints.map(p => (rvOf.has(p.index) ? rvOf.get(p.index) : p.rv))))
  }

  // Only the two ends of each track have to stay: they are where its height
  // meets the tracks joined to it.
  const isInner = (p) => !p.joint && p.owner.index > 0 && p.owner.index < (p.owner.part.track.heights?.length ?? 0) - 1
  const deletable = selectedPoints.filter(p => isInner(p) && !locked.has(p.index))
  const remove = () => {
    if (!resolved || !deletable.length) return
    const drop = new Map()
    for (const p of deletable) drop.set(p.owner.trackId, new Set([...(drop.get(p.owner.trackId) ?? []), p.owner.index]))
    setHeightsForTracks(new Map([...drop].map(([id, gone]) => [id,
      (parts.find(x => x.trackId === id).track.heights ?? []).filter((_, i) => !gone.has(i))])))
    keepView(-deletable.length)
    select([])
  }

  // ── Splitting the gradient with a new point ──────────────────────────────
  /**
   * The point a double click at (x, y) would add: on the gradient, between
   * two points of the track the route runs there — added to that track.
   */
  const insertAt = ({ x, y }) => {
    if (!view || !size || !points.length || x < MARGIN.left || x > size.w - MARGIN.right || y > plotBottom) return null
    const station = Math.round((view.x0 + (x - MARGIN.left) / view.k) * 100) / 100
    const on = onTrackAt(station)
    if (!on || station < 0 || station > profile.length) return null
    const r = insertHeightPoint(on.part.track.heights, on.station)
    if (!r) return null
    const z = r.heights[r.index].z
    const [a, b] = [r.heights[r.index - 1], r.heights[r.index + 1]].map(h => X(routeStationOfPart(on.part, h.station)))
    if (Math.abs(Y(z) - y) > INSERT_HIT_PX
      || Math.abs(x - a) < INSERT_POINT_GAP_PX || Math.abs(b - x) < INSERT_POINT_GAP_PX) return null
    return { station, z, trackId: on.trackId, ...r }
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
    setTrackHeights(c.trackId, c.heights)
    keepView(1)
    setHover(null)
    // Where the new point stands in the route, read from the state just written.
    const now = loadTracks(), sw = loadSwitches()
    const next = routeRec ? resolveRoute(routeRec, now, sw) : trackAsRoute(now.find(tr => tr.id === trackId))
    const i = routeProfile(next).byRef(c.trackId, c.index)
    setSelection(i == null ? [] : [i]); setDraft(String(c.z)); setRvDraft('')
  }

  if (!resolved) return null

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

  const overlapNote = (o) => [
    fill('elevation_vcurve_overlap', {
      a: points[o.a].station.toFixed(2), b: points[o.b].station.toFixed(2),
      length: (o.to - o.from).toFixed(2), from: o.from.toFixed(2), to: o.to.toFixed(2),
    }),
    `HP.AR.04 · ${t(severityLabelKey('error'))}: ${ruleById('HP.AR.04')?.title ?? ''}`,
  ].join('\n')

  // ── Geometry helpers ──────────────────────────────────────────────────────
  const X = (station) => MARGIN.left + (station - view.x0) * view.k
  const Y = (z) => plotBottom - (z - view.z0) * view.k * exaggeration
  const typeLabel = (el) => {
    if (el.elementType === 2) return t(el.transitionType === 'bloss' ? 'table_type_bloss' : 'table_type_transition')
    if (el.radius != null) return `R ${Math.round(Math.abs(el.radius))}`
    return t('table_type_straight')
  }

  // The gradient read from the terrain for every track of the route, as one step.
  const readState = reading?.key === viewKey ? reading.state : null
  const readFromTerrain = async () => {
    setReading({ key: viewKey, state: 'busy' })
    let state = null
    try {
      const all = new Map()
      let updated = 0
      for (const part of parts) {
        const r = await fillHeights(currentProject, { force: true, trackId: part.trackId, source: chosenTerrainSource() })
        for (const [id, h] of r.heights) all.set(id, h)
        updated += r.updated
      }
      if (all.size) setHeightsForTracks(all)
      if (!updated) state = 'missing'
    } catch {
      state = 'failed'
    }
    setReading({ key: viewKey, state })
  }

  // The cross section's station on the route — its own where it walks this
  // route, else where it stands on one of its tracks — and the height built there.
  const sectionStation = (() => {
    if (!section) return null
    if (routeRec && section.routeId === routeRec.id && Number.isFinite(section.routeStation)) {
      return clamp(section.routeStation, 0, profile.length)
    }
    const part = parts.find(p => p.trackId === section.trackId)
    return part && Number.isFinite(section.station) ? routeStationOfPart(part, clamp(section.station, 0, part.length)) : null
  })()
  const sectionZ = sectionStation != null ? heightAt(sectionStation) : null
  const cursorZ = cursor != null ? heightAt(cursor) : null
  const cursorDz = cursor != null && devShown ? deviationAt(refRuns, cursor) : null
  /** A lift in mm, signed. */
  const mmLabel = (v) => { const m = Math.round(v * 1000); return `${m > 0 ? '+' : m < 0 ? '−' : ''}${Math.abs(m)} mm` }

  /**
   * The points of a reference run one to a pixel column — the one furthest
   * from 0 by `value` — so a long axis read every metre stays a clean line.
   */
  const perPixel = (pts, value = () => 0) => {
    const out = []
    let px = null, best = null
    for (const p of pts) {
      const x = Math.round(X(p.s))
      if (x !== px) { if (best) out.push(best); px = x; best = p }
      else if (Math.abs(value(p)) > Math.abs(value(best))) best = p
    }
    if (best) out.push(best)
    return out
  }

  /**
   * Below the profile: the gradient minus the reference axis [mm] over the
   * same stations, the height limit dashed either side, red dots beyond it.
   */
  const deviationStrip = ({ sTicks, right, foot }) => {
    const top = foot - DEV_STRIP_PX, mid = top + DEV_STRIP_PX / 2
    const devs = refPoints.filter(p => p.dz != null)
    const peak = Math.max(limitZ, 0.005, ...devs.map(p => Math.abs(p.dz))) * 1.15
    const DY = (d) => mid - d / peak * (DEV_STRIP_PX / 2)
    const labelled = Math.abs(DY(limitZ) - mid) >= 10 ? limitZ : peak / 1.15
    return (
      <g>
        <rect x={MARGIN.left} y={top} width={plotW} height={DEV_STRIP_PX} fill="none" stroke={PALETTE.gridLine} />
        {sTicks.map(s => <line key={`ds${s}`} x1={X(s)} x2={X(s)} y1={top} y2={foot} stroke={PALETTE.gridLine} />)}
        <line x1={MARGIN.left} x2={right} y1={mid} y2={mid} stroke={PALETTE.axis} />
        {[limitZ, -limitZ].map(v => (
          <line key={`dl${v}`} x1={MARGIN.left} x2={right} y1={DY(v)} y2={DY(v)}
            stroke={PALETTE.invalid} strokeDasharray="4 3" />
        ))}
        {[labelled, -labelled].map(v => (
          <text key={`dt${v}`} x={MARGIN.left - 6} y={DY(v) + 4} fontSize="10" fill={PALETTE.textSoft} textAnchor="end">
            {mmLabel(v).replace(' mm', '')}
          </text>
        ))}
        <text x={MARGIN.left - 6} y={top - 4} fontSize="11" fill={PALETTE.muted} textAnchor="end">Δh [mm]</text>
        <text x={MARGIN.left + 4} y={top - 4} fontSize="10" fill={PALETTE.referenceAxis}>
          {fill('elevation_ref_strip', { name: refAxis.name, limit: Math.round(limitZ * 1000) })}
        </text>
        <g clipPath="url(#profile-dev-clip)" pointerEvents="none">
          {refRuns.map((run, i) => {
            // A run may lose the track's gradient on the way: draw what has one.
            const parts = []
            let part = []
            for (const p of run) {
              if (p.dz == null) { if (part.length) parts.push(part); part = []; continue }
              part.push(p)
            }
            if (part.length) parts.push(part)
            return parts.map((pts, j) => (
              <polyline key={`dv${i}-${j}`} fill="none" stroke={PALETTE.previewLine} strokeWidth="1.5"
                points={perPixel(pts, p => p.dz).map(p => `${X(p.s)},${DY(p.dz)}`).join(' ')} />
            ))
          })}
          {devs.filter(p => Math.abs(p.dz) > limitZ + 1e-9).map(p => (
            <circle key={`db${p.s}`} cx={X(p.s)} cy={DY(p.dz)} r="2" fill={PALETTE.invalid} />
          ))}
          {sectionStation != null && (
            <line x1={X(sectionStation)} x2={X(sectionStation)} y1={top} y2={foot}
              stroke={PALETTE.mapSelected} strokeWidth="1.5" strokeDasharray="3 2" />
          )}
          {cursor != null && (
            <>
              <line x1={X(cursor)} x2={X(cursor)} y1={top} y2={foot} stroke={PALETTE.mapHover} strokeWidth="1" strokeDasharray="2 2" />
              {cursorDz != null && (
                <circle cx={X(cursor)} cy={DY(cursorDz)} r="3" fill={PALETTE.mapHover} stroke={PALETTE.white} strokeWidth="1.5" />
              )}
            </>
          )}
        </g>
      </g>
    )
  }

  const drawing = () => {
    if (!size || !view) return null
    // `bottom` is the profile's, `foot` the station axis' below the strip.
    const right = size.w - MARGIN.right, bottom = plotBottom, foot = size.h - MARGIN.bottom
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
          <clipPath id="profile-dev-clip"><rect x={MARGIN.left} y={foot - DEV_STRIP_PX} width={plotW} height={DEV_STRIP_PX} /></clipPath>
        </defs>
        {/* grid */}
        {sTicks.map(s => <line key={`gs${s}`} x1={X(s)} x2={X(s)} y1={MARGIN.top} y2={bottom} stroke={PALETTE.gridLine} />)}
        {zTicks.map(z => <line key={`gz${z}`} x1={MARGIN.left} x2={right} y1={Y(z)} y2={Y(z)} stroke={PALETTE.gridLine} />)}
        {/* axes */}
        <line x1={MARGIN.left} x2={right} y1={bottom} y2={bottom} stroke={PALETTE.axis} />
        <line x1={MARGIN.left} x2={MARGIN.left} y1={MARGIN.top} y2={bottom} stroke={PALETTE.axis} />
        {sTicks.map(s => (
          <text key={`ts${s}`} x={X(s)} y={foot + 16} fontSize="11" fill={PALETTE.textSoft} textAnchor="middle">{s.toFixed(stepDecimals(sStep))}</text>
        ))}
        {zTicks.map(z => (
          <text key={`tz${z}`} x={MARGIN.left - 6} y={Y(z) + 4} fontSize="11" fill={PALETTE.textSoft} textAnchor="end">{z.toFixed(stepDecimals(zStep))}</text>
        ))}
        <text x={right} y={foot + 28} fontSize="11" fill={PALETTE.muted} textAnchor="end">{t('elevation_station')} [m]</text>
        <text x={MARGIN.left - 6} y={MARGIN.top - 12} fontSize="11" fill={PALETTE.muted} textAnchor="end">{t('elevation_height')} [m]</text>

        <g clipPath="url(#profile-clip)">
          {/* element boundaries */}
          {[...profile.boundaries, { station: profile.length }].map((b, i) => (
            <g key={`b${i}`}>
              <line x1={X(b.station)} x2={X(b.station)} y1={MARGIN.top} y2={bottom} stroke={PALETTE.elementBoundary} strokeDasharray="3 3" />
              {b.el && <text x={X(b.station) + 3} y={MARGIN.top + 11} fontSize="10" fill={PALETTE.label}>{typeLabel(b.el)}</text>}
            </g>
          ))}
          {/* where the route goes over from one track to the next, named */}
          {profile.partStarts.map(({ station, part }) => (
            <g key={`ps${part.trackId}${station}`} pointerEvents="none">
              <line x1={X(station)} x2={X(station)} y1={MARGIN.top} y2={bottom} stroke={PALETTE.axis} strokeWidth="1.5" />
              <text x={X(station) + 3} y={MARGIN.top + 23} fontSize="10" fill={PALETTE.textStrong}>
                {`▶ ${part.track.name || part.trackId.slice(0, 8)}${part.reversed ? ' ⇄' : ''}`}
              </text>
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
          {/* the reference axis, where it runs along the track */}
          {refRuns.map((run, i) => (
            <polyline key={`ref${i}`} fill="none" stroke={PALETTE.referenceAxis} strokeWidth="1.5" strokeDasharray="6 3"
              pointerEvents="none" points={perPixel(run).map(p => `${X(p.s)},${Y(p.z)}`).join(' ')} />
          ))}
          {/* the vertical curves rounding the gradient changes */}
          {curves.map((c, i) => (
            <polyline key={`vc${i}`} fill="none" stroke={PALETTE.verticalCurve} strokeWidth="2"
              points={c.map(p => `${X(p.station)},${Y(p.z)}`).join(' ')} />
          ))}
          {/* where two of them run into each other: the shared stretch, framed */}
          {overlaps.map(o => {
            const x1 = X(o.from), x2 = X(o.to), y1 = Y(o.zMax), y2 = Y(o.zMin)
            const w = Math.max(x2 - x1, 4), h = Math.max(y2 - y1, 4)
            return (
              <rect key={`vo${o.a}-${o.b}`} className="rule-sev-error" x={(x1 + x2 - w) / 2 - 4} y={(y1 + y2 - h) / 2 - 6}
                width={w + 8} height={h + 12} rx="3" fill="currentColor" fillOpacity="0.15"
                stroke="currentColor" strokeWidth="1.5" strokeDasharray="4 2">
                <title>{overlapNote(o)}</title>
              </rect>
            )
          })}
          {/* the track */}
          <polyline fill="none" stroke="var(--color-primary)" strokeWidth="2"
            points={points.map(p => `${X(p.station)},${Y(p.z)}`).join(' ')} />
          {/* the tangent points, where each vertical curve begins and ends */}
          {curves.flatMap((c, i) => [c[0], c[c.length - 1]].map((p, k) => (
            <circle key={`ve${i}-${k}`} cx={X(p.station)} cy={Y(p.z)} r="3" fill={PALETTE.verticalCurveEnd}
              stroke={PALETTE.verticalCurveEndEdge} strokeWidth="0.75">
              <title>{fill(k ? 'elevation_vcurve_end' : 'elevation_vcurve_start', { station: p.station.toFixed(2) })}</title>
            </circle>
          )))}
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
                fill={on ? PALETTE.mapSelected : paired.has(p.index) ? PALETTE.sleeper : PALETTE.white}
                stroke={on ? PALETTE.mapSelected : 'var(--color-primary)'} strokeWidth="2"
                strokeDasharray={locked.has(p.index) ? '2 1.5' : undefined}
                onPointerDown={e => e.stopPropagation()} onClick={e => pick(p, e)}>
                {(curveAt.has(p.index) || paired.has(p.index)) && (
                  <title>
                    {[pointNote(p.index), curveAt.has(p.index) && curveNote(curveAt.get(p.index))].filter(Boolean).join('\n')}
                  </title>
                )}
              </circle>
            )
          })}
        </g>
        {devShown && deviationStrip({ sTicks, right, foot })}
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
            {`${cursor.toFixed(1)} m${cursorZ != null ? ` · ${cursorZ.toFixed(3)} m` : ''}${cursorDz != null ? ` · Δh ${mmLabel(cursorDz)}` : ''}`}
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
        <div className="profile-head">
          <span className="track-table-title">{title}</span>
          {routeRec && !resolved.ok && <span className="profile-hint msg-warn">{t('elevation_route_gaps')}</span>}
          <div className="profile-tabs" role="tablist" aria-label={t('elevation_view')}>
            {['graphic', 'table'].map(v => (
              <button key={v} type="button" role="tab" aria-selected={viewKind === v}
                className={`profile-tab${viewKind === v ? ' active' : ''}`} onClick={() => chooseView(v)}>
                {t(`elevation_view_${v}`)}
              </button>
            ))}
          </div>
        </div>
        <div className="profile-controls">
          {viewKind === 'table' ? (
            <div className="profile-edit">
              <label className="profile-edit">
                {t('elevation_given')}
                <select className="settings-select" value={given} onChange={e => chooseGiven(e.target.value)}>
                  {Object.keys(GIVEN_MODES).map(m => <option key={m} value={m}>{t(`elevation_given_${m}`)}</option>)}
                </select>
              </label>
              <InfoTip text={t('elevation_given_hint')} />
            </div>
          ) : selectedPoints.length && selectedPoints.every(p => locked.has(p.index)) ? (
            <div className="profile-edit">
              <span className="profile-hint">{lockedNote(locked.get(selectedPoints[0].index))}</span>
              <CloseButton onClick={() => select([])} />
            </div>
          ) : selectedPoints.length ? (
            <div className="profile-edit">
              {selectedPoints.length === 1 && stationMovable(selectedPoints[0]) ? (
                <>
                  <span>{t('elevation_station')}</span>
                  <NumberInput className="track-table-input" step="0.1" value={stDraft}
                    onChange={e => setStDraft(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') { e.preventDefault(); select([]) } }} />
                  <span>m</span>
                </>
              ) : (
                <span>{selectedPoints.length === 1
                  ? `${t('elevation_station')} ${selectedPoints[0].station.toFixed(2)} m`
                  : fill('elevation_selected', { n: selectedPoints.length })}</span>
              )}
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
              {selectedPoints.length === 1 && paired.has(selectedPoints[0].index) && (
                <span className="profile-hint" title={pairedNote(paired.get(selectedPoints[0].index))}>
                  {fill('elevation_paired_short', {
                    sleeper: sleeperLabel(paired.get(selectedPoints[0].index).sleeper),
                    name: swName(paired.get(selectedPoints[0].index).sw),
                  })}
                </span>
              )}
              <CloseButton onClick={() => select([])} />
            </div>
          ) : (
            <InfoTip text={t('elevation_hint_edit')} />
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
          {viewKind === 'graphic' && axes.length > 0 && (
            <label className="profile-edit" title={t('elevation_ref_hint')}>
              <span className="profile-ref-swatch" aria-hidden="true" />
              {t('shift_axis')}
              <select className="settings-select" value={refChoice} onChange={e => chooseRef(e.target.value)}>
                <option value="">{t('elevation_ref_none')}</option>
                <option value="auto">{fill('shift_axis_auto', { name: autoAxis?.name ?? '–' })}</option>
                {inPlane.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
              {refNote && <span className="profile-hint">{refNote}</span>}
            </label>
          )}
          {viewKind === 'graphic' && (
            <label className="profile-edit">
              {t('elevation_exaggeration')}
              <select className="settings-select" value={exaggeration} onChange={e => setExaggeration(Number(e.target.value))}>
                {EXAGGERATIONS.map(x => <option key={x} value={x}>{x}×</option>)}
              </select>
            </label>
          )}
          <CloseButton onClick={onClose} />
        </div>
      </div>
      <div className="profile-body" ref={bodyRef}>
        {points.length === 0 && !refRuns.length
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
          : viewKind === 'table' && points.length ? (
            <ElevationTable points={points} length={profile.length} onWrite={writePoint}
              mode={given} locked={locked} noteAt={pointNote}
              stretchAt={stretchAt} curveAt={curveAt} stretchNote={stretchNote} curveNote={curveNote}
              selection={selection} onSelect={select} />
          ) : drawing()}
      </div>
    </div>
  )
}
