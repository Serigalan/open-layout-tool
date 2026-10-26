import { useEffect, useMemo, useRef, useState } from 'react'
import {
  setTrackHeights, setHeightsForTracks, currentProject, loadTracks, loadSwitches, addDependentPoint, addHeightPoint,
  releaseDependentPoint, restoreDependentPoint, setDependencyModeAt, setToeLeadAt,
} from '../storage'
import { useProject, useReferenceAxes, useRoutes, useSwitchDesign, useSwitches, useTracks } from '../hooks/useStore'
import {
  checkVertical, regularVerticalRadius, verticalFindings, trackHeightAt,
  heightLinks, heightRoles, routeElements, routeFindings, routeProfile, routeStationOfPart, trackAsRoute, DEPENDENCY_MODES,
  fillHeights, chosenTerrainSource,
} from '../utils/elevation'
import { ruleById, severityLabelKey } from '../utils/rules'
import {
  adjacentTracks, neighbourStub, jointHeightUpdates, verticalCurves, verticalCurveOverlaps,
  elementAtStation, solveHeightPoint, pointGrades, GIVEN_MODES, partStation,
  resolveRoute, routeAt, routePointAt, reverseTrack, pointAtStation, stationOnTrack,
} from '../utils/track'
import { filterForElements, FILTER_NONE, heightPointAt, mapIsLive, pickAt, setPickingDependent } from '../map/pick'
import {
  comparedLine, heightsComparable, nearestAxis, referenceProfile, shiftValues,
} from '../utils/survey'
import { loadSettings, saveSettings, clamp } from '../utils/common'
import useReferenceAxesOnMap from '../map/useReferenceAxesOnMap'
import { useI18n } from '../locales/i18nContext'
import { useMap } from '../map/MapContext'
import usePreview from '../map/usePreview'
import useMapEvents from '../map/useMapEvents'
import { utmToWgs84, wgs84ToUTM } from '../utils/geometry'
import { ELEVATION_POINTS_LAYER, TRACKS_SELECTED_LAYER } from '../map/layerIds'
import { PALETTE } from '../styles/palette'
import { fitToTracks } from '../map/mapRenderUtils'
import { gradeLabel } from './chart/grade'
import CloseButton from './form/CloseButton'
import InfoTip from './form/InfoTip'
import NumberInput from './form/NumberInput'
import ElevationSection from './ElevationSection'
import ElevationTable from './ElevationTable'
import ElevationPointDetails from './ElevationPointDetails'
import ConfirmModal from './ConfirmModal'

const EXAGGERATIONS  = [1, 2, 5, 10, 20]
const NO_POINTS = []
// The share of the overlay above the divider, and how far it may be dragged.
const SPLIT_DEFAULT = 0.5
const SPLIT_MIN = 0.2
const SPLIT_MAX = 0.8
// Room kept around the tracks when the map is fitted to them [px].
const MAP_FIT_PAD = 30
// The reference axis (Paket V) laid over the profile: its height read every this much [m].
const REF_EVERY = 1
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

// The height points of what is on show, on the map (decision 387): blue, the
// selected one red, what it depends on yellow, what depends on it green.
const POINTS_SOURCE = 'elevation-points-source'
const POINT_LAYERS = [{
  sourceId: POINTS_SOURCE,
  layer: {
    id: ELEVATION_POINTS_LAYER, type: 'circle',
    paint: {
      'circle-radius': ['match', ['get', 'state'], 'selected', 6, 'source', 5.5, 'dependent', 5.5, 4],
      'circle-color': ['match', ['get', 'state'], 'selected', PALETTE.heightPointSelected, 'source', PALETTE.heightPointSource,
        'dependent', PALETTE.heightPointDependent, PALETTE.heightPoint],
      'circle-stroke-width': 1.5,
      'circle-stroke-color': PALETTE.white,
    },
  },
}]


/**
 * The Höhenplan of one track or route over the whole map area (decision 391):
 * a divider across the middle, dragged to share the room out (a double click
 * puts it back in the middle). Above it two tabs — the longitudinal section
 * (Längsschnitt) and the map (Lagekarte), seen through the overlay and used
 * as ever, fitted to the tracks on show when the tab is opened; below it two
 * more — the table and the selected point (ElevationPointDetails). Which tab
 * is open above and below, and where the divider stands, are kept on this
 * device.
 *
 * A point is picked the same way wherever it is shown — in the section, in
 * the table, on the map: a click picks it alone, Ctrl/Shift-click adds it to
 * or drops it from the selection. A click in the section or on the map opens
 * it in the point tab; in the table the row is picked and the table stays.
 * Everywhere the selected point is red, what it depends on yellow, what
 * depends on it green.
 *
 * The longitudinal section: stations at 1:1, heights exaggerated (10× by
 * default), zoomable and pannable.
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
 * The table (ElevationTable): station, height, the gradients either side and
 * the vertical curve of every point, two of the first four given and typed,
 * the other two following; which two is kept on this device. Drawn values
 * are rounded to what the drawing can show (heights to the mm, stations to
 * the cm), the table and the point tab give them in full.
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
export default function ElevationOverlay({ trackId, routeId = null, section = null, point = null, onShowPoint, onClose }) {
  const { t, fill, num } = useI18n()
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
  const [selection, setSelection] = useState([])   // indices of the height points being edited
  const [draft, setDraft]       = useState('')
  const [rvDraft, setRvDraft]   = useState(null)   // vertical curve radius typed for the selection, null: untouched
  const [rvNote, setRvNote]     = useState(null)     // what setting the Regelwert left undone
  const [reasonDraft, setReasonDraft] = useState(null)   // the reason typed for the selection; null: untouched
  const [cursor, setCursor]     = useState(null)     // station [m] the cursor stands over, shown on the map
  const rootRef  = useRef(null)
  const upperBarRef = useRef(null)
  const dividerRef = useRef(null)
  // Reading the gradient from the terrain: { key, state } with state
  // 'busy', 'missing' (no height data there) or 'failed'.
  const [reading, setReading] = useState(null)

  // ── The tabs above and below the divider, where it stands, and which two ──
  // values the table is given
  const [upper, setUpper] = useState(() => {
    try { return loadSettings().elevationUpper === 'map' ? 'map' : 'profile' } catch { return 'profile' }
  })
  const [lower, setLower] = useState(() => {
    // The one view of before (graphic, table or point) gave the lower tab.
    try { const s = loadSettings(); return (s.elevationLower ?? s.elevationView) === 'point' ? 'point' : 'table' } catch { return 'table' }
  })
  const [split, setSplit] = useState(() => {
    try { const v = Number(loadSettings().elevationSplit); return v >= SPLIT_MIN && v <= SPLIT_MAX ? v : SPLIT_DEFAULT } catch { return SPLIT_DEFAULT }
  })
  const [given, setGiven] = useState(() => {
    try { const g = loadSettings().elevationGiven; return GIVEN_MODES[g] ? g : 'sz' } catch { return 'sz' }
  })
  const remember = (patch) => { try { saveSettings(patch) } catch { /* kept for this session only */ } }
  const chooseUpper = (v) => { setUpper(v); remember({ elevationUpper: v }) }
  const chooseLower = (v) => { setLower(v); remember({ elevationLower: v }) }
  const chooseGiven = (v) => { setGiven(v); remember({ elevationGiven: v }) }
  /** The divider dragged: the share above it follows the pointer, kept when let go. */
  const startSplit = (e) => {
    const box = rootRef.current?.getBoundingClientRect()
    if (!box || e.button !== 0) return
    e.preventDefault()
    let last = split
    const move = (ev) => { last = clamp((ev.clientY - box.top) / box.height, SPLIT_MIN, SPLIT_MAX); setSplit(last) }
    const up = () => {
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up)
      remember({ elevationSplit: last })
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }
  const resetSplit = () => { setSplit(SPLIT_DEFAULT); remember({ elevationSplit: SPLIT_DEFAULT }) }
  const [stDraft, setStDraft]   = useState('')     // station of a single selected point
  const design = useSwitchDesign()
  // Picking on the map the point that is to depend on the one selected, and how (decision 390): the mode, or null.
  const [picking, setPicking] = useState(null)

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
  // What a point is at a turnout (decision 384), by route index: its toe and
  // its ldS follow from the points either side, and are shown only — where
  // the toe is one point of a route over the main route and the branch, as
  // the track it belongs to here.
  const roles = new Map()
  const RANK = { locked: 2, wa: 1, lds: 0 }
  const byTrack = heightRoles(project)
  for (const part of parts) {
    for (const [index, role] of byTrack.get(part.trackId) ?? []) {
      const i = profile.byRef(part.trackId, index)
      if (i == null || (roles.has(i) && RANK[roles.get(i).kind] >= RANK[role.kind])) continue
      roles.set(i, { ...role, part })
    }
  }
  /** The role the coupling gives a point, under a lock where there is one. */
  const coupled = (i) => (roles.get(i)?.kind === 'locked' ? roles.get(i).was : roles.get(i))
  /** Does the coupling hold the point's curve and reason as well (toe, ldS)? */
  const curveHeld = (i) => ['wa', 'lds'].includes(coupled(i)?.kind) && !coupled(i).free
  /** Is the point locked by hand? */
  const lockedByHand = (i) => roles.get(i)?.kind === 'locked'
  /** The track and its own station at a station of the route. */
  const onTrackAt = (s) => (resolved ? routeAt(resolved, s) : null)
  /** The height built at a station of the route — on a turnout's branch, the plane of the turnout. */
  const heightAt = (s) => {
    const a = onTrackAt(s)
    return a ? trackHeightAt(tracks, switches, a.part.track, a.station) : null
  }
  const swName = (sw) => sw.name ?? sw.label ?? ''
  const roleNote = (role) => (!role ? null
    : role.kind === 'locked' ? [t('elevation_role_locked'), roleNote(role.was)].filter(Boolean).join('\n')
      : role.kind === 'own' ? t('elevation_role_own')
        : role.free ? fill('elevation_role_freed', { what: fill(`elevation_link_${role.kind}_${role.side}`, { name: swName(role.sw) }) })
          // A toe says whether it sets the toe's one height or takes it (decision 393).
          : fill(`elevation_role_${role.kind}_${role.side}${role.kind === 'wa' ? (role.lead ? '_lead' : '_follow') : ''}`, { name: swName(role.sw) }))
  // What a point depends on and what depends on it (decision 385), by its
  // track and index; named by its role at a turnout, else by its station —
  // and its track where that is not the one on show.
  const links = useMemo(() => heightLinks(project, { design }), [project, design])
  const linksOf = (i) => (points[i] ? links.get(`${points[i].owner.trackId}|${points[i].owner.index}`) ?? null : null)
  /** The turnout whose toe point `p` is (decision 393): { sw, name, lead — whether this toe sets the height —, leading: 'main' | 'branch' }, or null. */
  const toeOf = (p) => {
    const r = p ? coupled(p.index) : null
    return r?.kind === 'wa' ? { sw: r.sw, name: swName(r.sw), lead: !!r.lead, leading: r.sw.toeLead === 'branch' ? 'branch' : 'main' } : null
  }
  /** Is point `i` the toe that sets the toe's height, held by nothing else? It is entered like a free point. */
  const leads = (i) => !!toeOf(points[i])?.lead && !linksOf(i)?.kind
  // Shown only — height, station and the point itself — what a role holds
  // and the leading toe not. A point locked by hand (Entscheidung 382) is one
  // too, but may still be deleted, after asking.
  const locked = new Map([...roles].filter(([i, r]) => !r.free && !leads(i)))
  const linkName = (r) => {
    const tr = tracks.find(x => x.id === r.trackId)
    const p = tr?.heights?.[r.index]
    const role = byTrack.get(r.trackId)?.get(r.index)
    const own = role?.kind === 'locked' ? role.was : role
    const name = own?.kind === 'wa' || own?.kind === 'lds'
      ? fill(`elevation_link_${own.kind}_${own.side}`, { name: swName(own.sw) })
      : fill('elevation_link_point', { station: num(p?.station ?? 0, { digits: 2 }) })
    return parts.some(x => x.trackId === r.trackId) ? name : `${name} · ${tr?.name || r.trackId.slice(0, 8)}`
  }
  const linksNote = (i) => {
    const l = linksOf(i)
    if (!l) return null
    return [l.from.length > 0 && fill('elevation_links_from', { list: l.from.map(linkName).join('; ') }),
      l.to.length > 0 && fill('elevation_links_to', { list: l.to.map(linkName).join('; ') })].filter(Boolean).join('\n') || null
  }
  // In the graphic as on the map: what the one selected point depends on, and what depends on it.
  const linkState = new Map()
  if (selection.length === 1 && points[selection[0]]) {
    const l = linksOf(selection[0])
    for (const [list, st] of [[l?.from ?? [], 'source'], [l?.to ?? [], 'dependent']]) {
      for (const r of list) { const i = profile.byRef(r.trackId, r.index); if (i != null) linkState.set(i, st) }
    }
  }
  const pointNote = (i) => [roleNote(roles.get(i)), linksNote(i), points[i]?.reason && fill('elevation_reason_note', { reason: points[i].reason })]
    .filter(Boolean).join('\n') || null

  // ── When the sections fit their view anew (ElevationSection) ─────────────
  // Points coming or going (the terrain fill arriving, a reload, the
  // reference axis laid over or taken away) count up `fitGen`; a point added
  // or deleted in the profile is expected (`keepView`) and does not.
  const fitCount = allPoints.length + refPoints.length
  const [fit, setFit] = useState({ n: fitCount, gen: 0, expect: null })
  if (fit.n !== fitCount) setFit(f => ({ n: fitCount, gen: f.expect === fitCount ? f.gen : f.gen + 1, expect: null }))
  const keepView = (n) => setFit(f => ({ ...f, expect: f.n + n }))

  const [activeKey, setActiveKey] = useState(viewKey)
  if (activeKey !== viewKey) { setActiveKey(viewKey); setSelection([]); setDraft(''); setRvDraft(null) }

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

  // ── The cursor's station on the map ──────────────────────────────────────
  // ── The height points on the map (decision 387) ─────────────────────────
  const pointsPreview = usePreview(POINT_LAYERS, { legend: false })
  const selectedKeys = selection.map(i => points[i]).filter(Boolean).map(p => `${p.owner.trackId}|${p.owner.index}`).join(',')
  useEffect(() => {
    if (!resolved) { pointsPreview.clear(); return }
    const sel = new Set(selectedKeys ? selectedKeys.split(',') : [])
    const only = sel.size === 1 ? links.get([...sel][0]) : null
    const state = new Map()
    for (const r of only?.from ?? []) state.set(`${r.trackId}|${r.index}`, 'source')
    for (const r of only?.to ?? []) state.set(`${r.trackId}|${r.index}`, 'dependent')
    for (const k of sel) state.set(k, 'selected')
    const feature = (track, index, st) => {
      const h = track?.heights?.[index]
      const at = h && pointAtStation(track, h.station)
      if (!at) return null
      const [lng, lat] = utmToWgs84(at.utm.easting, at.utm.northing, track.epsg)
      return { type: 'Feature', properties: { state: st, trackId: track.id, index }, geometry: { type: 'Point', coordinates: [lng, lat] } }
    }
    // While a dependent point is picked, every track's points can be clicked.
    const shown = new Set(picking ? tracks.filter(x => x.heights?.length).map(x => x.id) : parts.map(p => p.trackId))
    const out = []
    for (const id of shown) {
      const track = tracks.find(x => x.id === id)
      ;(track?.heights ?? []).forEach((_, i) => out.push(feature(track, i, state.get(`${id}|${i}`) ?? 'plain')))
    }
    // What a point is linked to on other tracks shows too.
    for (const [k, st] of state) {
      const [id, i] = k.split('|')
      if (!shown.has(id)) out.push(feature(tracks.find(x => x.id === id), Number(i), st))
    }
    // Drawn last on top: the coloured ones.
    const rank = { plain: 0, dependent: 1, source: 1, selected: 2 }
    pointsPreview.set(POINTS_SOURCE, out.filter(Boolean).sort((a, b) => rank[a.properties.state] - rank[b.properties.state]))
    // parts and points follow resolved
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resolved, tracks, selectedKeys, links, pointsPreview, picking])

  // A height point clicked on the map opens in the point tab (decision 389):
  // picked here where it is on show — with Ctrl/Shift as in the section —,
  // else in its own track's profile.
  // While picking a dependent point: a height point, or a place on a track,
  // made to depend on the point selected.
  useMapEvents(!!resolved, {
    click: (e, m) => {
      if (picking && one) {
        let target = heightPointAt(m, e.point)
        if (!target) {
          const hit = pickAt(m, e.point)
          const tr = hit?.trackId && tracks.find(x => x.id === hit.trackId)
          const foot = tr && stationOnTrack(tr, wgs84ToUTM([e.lngLat.lng, e.lngLat.lat], tr.epsg))
          if (foot) target = { trackId: tr.id, station: foot.station }
        }
        if (target) { said(addDependentPoint(refOf(one), target, picking)); setPicking(null) }
        return
      }
      const r = heightPointAt(m, e.point)
      if (!r) return
      const i = profile?.byRef(r.trackId, r.index)
      if (i != null) pick(i, e.originalEvent, { open: lower !== 'profile' })
      else onShowPoint?.(r)
    },
  })

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

  // ── Selecting points, editing and deleting them ───────────────────────────
  const isSelected = (p) => selection.includes(p.index)
  const selectedPoints = points.filter(isSelected)
  // The drafts follow the selection: the common height and curve radius, or
  // empty when they differ (and for the radius, when there is none).
  const common = (vs) => (vs.length && vs.every(v => v === vs[0]) && vs[0] != null ? String(vs[0]) : '')
  // A gradient change in a turnout's stretch asks for a reason (HP.AR.06,
  // decision 261); one that has a reason shows it wherever it lies.
  const reasonAsked = selectedPoints.length > 0 && selectedPoints.some(p => p.reason
    || curveAt.get(p.index)?.results?.some(r => r.id === 'HP.AR.06'))
  const reasonShown = reasonDraft ?? common(selectedPoints.map(p => p.reason))
  const select = (indices) => {
    setSelection(indices)
    const picked = points.filter(p => indices.includes(p.index))
    setDraft(common(picked.map(p => p.z)))
    setRvDraft(null)
    setStDraft(picked.length === 1 ? String(Math.round(picked[0].station * 1000) / 1000) : '')
    setRvNote(null)
    setReasonDraft(null)
  }
  // A point's station can move unless it is a joint or a turnout sets it.
  // A WA or ldS let go keeps its station: it is where the turnout puts it.
  const stationMovable = (p) => !roles.has(p.index) && p.trackEnd == null && !p.joint

  /**
   * Write a point solved along the route (`r`: { station, z } in route
   * stations) to the track it belongs to: a station moved within that track,
   * a height to every track meeting at it (jointHeightUpdates). `rv` a radius
   * to set with it — null takes the curve away, undefined leaves it —, `la`
   * the same for the length that counts for it (decision 266) and `reason`
   * for its reason (decision 261).
   */
  const writePoint = (p, r, fields = {}) => {
    const { part, index, trackId: id } = p.owner
    const own = part.track.heights
    const set = Object.fromEntries(['rv', 'la', 'reason'].filter(k => fields[k] !== undefined).map(k => [k, fields[k]]))
    if (Math.abs(r.station - p.station) > 1e-9) {
      const q = { ...own[index], station: Math.round(partStation(part, r.station - part.offset) * 1e6) / 1e6, z: r.z }
      for (const [k, v] of Object.entries(set)) { if (v == null) delete q[k]; else q[k] = v }
      setTrackHeights(id, own.map((h, i) => (i === index ? q : h)))
    } else if (Math.abs(r.z - p.z) > 1e-9 || Object.keys(set).length) {
      setHeightsForTracks(jointHeightUpdates(tracks, switches, [{ trackId: id, index, z: r.z, ...set }]))
    }
  }
  const rvMixed = selectedPoints.some(p => p.rv !== selectedPoints[0]?.rv)
  const rvShown = rvDraft ?? common(selectedPoints.map(p => p.rv))
  // The length that counts for the selection's curves, where they share one.
  const laShown = selectedPoints.length && selectedPoints.every(p => p.la != null && p.la === selectedPoints[0].la)
    ? selectedPoints[0].la : null
  /**
   * Point `i` picked — in the section, the table or on the map, all alike: a
   * click picks it alone, Ctrl/Shift-click adds it to or drops it from the
   * selection. `open`: a single click shows it in the point tab, where it is
   * edited (decision 387) — from the section and the map, not from the table.
   */
  const pick = (i, e, { open = false } = {}) => {
    if (e?.shiftKey || e?.ctrlKey || e?.metaKey) {
      select(selection.includes(i) ? selection.filter(x => x !== i) : [...selection, i])
      return
    }
    select([i])
    if (open) setLower('point')
  }

  // What is typed is applied on Enter or on leaving the field — there is no
  // button for it; Escape drops it and the selection.
  const escaped = useRef(false)
  const editProps = {
    onFocus: () => { escaped.current = false },
    onBlur: () => { if (escaped.current) escaped.current = false; else commit() },
    onKeyDown: (e) => {
      if (e.key === 'Enter') commit()
      if (e.key === 'Escape') { e.preventDefault(); escaped.current = true; select([]) }
    },
  }
  const commit = () => {
    if (!resolved || !selectedPoints.length) return
    // An empty field is the mixed values of the selection — it changes nothing,
    // nor does a height every selected point has already.
    // A radius typed is what counts from then on, not a length (decision
    // 266); a radius of 0 takes the vertical curve away.
    const patch = {}
    if (draft.trim()) {
      const z = Number(draft); if (!Number.isFinite(z)) return
      if (selectedPoints.some(p => Math.abs(p.z - z) > 1e-9)) patch.z = z
    }
    if (rvDraft?.trim()) {
      const rv = Number(rvDraft); if (!Number.isFinite(rv)) return
      patch.rv = rv > 0 ? rv : null; patch.la = null
    }
    // A reason typed: set on every selected point, or taken away when emptied.
    const reason = reasonDraft?.trim() || null
    if (reasonDraft != null && selectedPoints.some(p => (p.reason ?? null) !== reason)) patch.reason = reason
    // A single point's station typed anew: it moves there with its height —
    // between its neighbours, which stay.
    const one = selectedPoints.length === 1 ? selectedPoints[0] : null
    const st = one && stationMovable(one) && stDraft.trim() ? Number(stDraft) : null
    const moved = st != null && Number.isFinite(st) && Math.abs(st - one.station) > 1e-9
    if (moved) {
      const r = solveHeightPoint(points, one.index, { s: st, z: patch.z ?? one.z }, { length: profile.length })
      if (r.error) { setRvNote(fill(`elevation_table_error_${r.error}`, { n: one.index + 1 })); return }
      writePoint(one, r, patch)
      setStDraft(String(Math.round(r.station * 1000) / 1000)); setRvNote(null); setRvDraft(null); setReasonDraft(null)
      return
    }
    if (!Object.keys(patch).length) return
    // Where tracks meet there is one point, whatever its index is on each of
    // them: it moves on all of them — over a switch too. The coupling holds
    // the height of its points, and the curve and reason of toe and ldS.
    const entries = selectedPoints.map(p => {
      const q = { ...patch }
      if (locked.has(p.index)) delete q.z
      if (curveHeld(p.index)) { delete q.rv; delete q.la; delete q.reason }
      return Object.keys(q).length ? { trackId: p.owner.trackId, index: p.owner.index, ...q } : null
    }).filter(Boolean)
    if (!entries.length) return
    setHeightsForTracks(jointHeightUpdates(tracks, switches, entries))
    setRvDraft(null); setReasonDraft(null)
  }

  /**
   * Every selected gradient change rounded as the rules ask at its design
   * speed (regularVerticalRadius) — or not at all where they want none. A
   * point without a known speed keeps its curve, and the panel says so.
   * Where the 20 m length set the radius rather than the Regelwert, the point
   * notes it, and its radius follows its gradients from then on (decision 266).
   */
  const setRegularRadius = () => {
    if (!resolved || !selectedPoints.length) return
    const found = selectedPoints.filter(p => !curveHeld(p.index))
      .map(p => ({ p, r: regularVerticalRadius(p.owner.part.track, p.owner.index, { switches }) }))
      .filter(({ r }) => r)
    const set = found.filter(({ r }) => !r.noSpeed)
    const noSpeed = found.length - set.length
    setRvNote(noSpeed ? fill('elevation_vcurve_no_speed', { n: noSpeed }) : null)
    if (!set.length) return
    setHeightsForTracks(jointHeightUpdates(tracks, switches,
      set.map(({ p, r }) => ({ trackId: p.owner.trackId, index: p.owner.index, rv: r.rv, la: r.la ?? null }))))
    setRvDraft(null)
  }

  // Only the two ends of each track have to stay: they are where its height
  // meets the tracks joined to it.
  const isInner = (p) => !p.joint && p.owner.index > 0 && p.owner.index < (p.owner.part.track.heights?.length ?? 0) - 1
  // A point locked by hand goes only after asking, and its lock with it
  // (Entscheidung 382); one the coupling sets does not go at all.
  const deletable = selectedPoints.filter(p => isInner(p)
    && (!locked.has(p.index) || roles.get(p.index)?.kind === 'own' || (lockedByHand(p.index) && !['wa', 'lds'].includes(coupled(p.index)?.kind))))
  const [askDelete, setAskDelete] = useState(false)
  const remove = (confirmed = false) => {
    if (!resolved || !deletable.length) return
    const unlock = deletable.some(p => lockedByHand(p.index))
    if (unlock && !confirmed) { setAskDelete(true); return }
    setAskDelete(false)
    const drop = new Map()
    for (const p of deletable) drop.set(p.owner.trackId, new Set([...(drop.get(p.owner.trackId) ?? []), p.owner.index]))
    setHeightsForTracks(new Map([...drop].map(([id, gone]) => [id,
      (parts.find(x => x.trackId === id).track.heights ?? []).filter((_, i) => !gone.has(i))])), { unlock })
    keepView(-deletable.length)
    select([])
  }

  // ── One point in full, and its dependencies (decisions 385, 386, 390) ──
  // The point view shows the one point selected. In the design mode a point
  // gets a point depending on it, picked on the map, the way chosen; how a
  // point follows its own source is changed, and every dependency let go.
  // A linked point opens where it is: selected here, or in its own track's
  // profile.
  const one = selectedPoints.length === 1 ? selectedPoints[0] : null
  const oneKey = one ? `${one.owner.trackId}|${one.owner.index}` : null
  // Picking ends with the selection, the design mode, or Escape.
  useEffect(() => { setPicking(null) }, [oneKey, design])
  useEffect(() => {
    setPickingDependent(!!picking)
    if (!picking) return undefined
    const onKey = (e) => { if (e.key === 'Escape') setPicking(null) }
    window.addEventListener('keydown', onKey)
    return () => { window.removeEventListener('keydown', onKey); setPickingDependent(false) }
  }, [picking])
  // Opened on a point (a link from another track's profile): that point, in the point tab.
  useEffect(() => {
    const i = point && profile?.byRef(point.trackId, point.index)
    if (i == null) return
    select([i])
    setLower('point')
  }, [point]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── The map tab: the map seen between the tab bar and the divider ─────────
  /** The map and how much of it the overlay covers above and below that window [px]; null where too little is left. */
  const mapWindow = () => {
    const m = map?.current, bar = upperBarRef.current, divider = dividerRef.current
    if (!m || !bar || !divider) return null
    const c = m.getCanvas().getBoundingClientRect()
    const top = bar.getBoundingClientRect().bottom - c.top, bottom = c.bottom - divider.getBoundingClientRect().top
    return c.height - top - bottom > 4 * MAP_FIT_PAD ? { m, top, bottom, width: c.width, height: c.height } : null
  }
  // Opened, the map tab shows the tracks on show in that window.
  useEffect(() => {
    const w = upper === 'map' ? mapWindow() : null
    if (!w) return
    fitToTracks(w.m, parts.map(p => p.track), {
      padding: { top: w.top + MAP_FIT_PAD, bottom: w.bottom + MAP_FIT_PAD, left: MAP_FIT_PAD, right: MAP_FIT_PAD },
      maxZoom: 17, duration: 500,
    })
  }, [upper]) // eslint-disable-line react-hooks/exhaustive-deps
  // A point picked while the map is shown is brought into the window, where it lies outside it.
  useEffect(() => {
    const w = upper === 'map' && one ? mapWindow() : null
    const track = w && tracks.find(x => x.id === one.owner.trackId)
    const h = track?.heights?.[one.owner.index]
    const at = h && pointAtStation(track, h.station)
    if (!at) return
    const lngLat = utmToWgs84(at.utm.easting, at.utm.northing, track.epsg)
    const { x, y } = w.m.project(lngLat)
    if (x >= MAP_FIT_PAD && x <= w.width - MAP_FIT_PAD && y >= w.top + MAP_FIT_PAD && y <= w.height - w.bottom - MAP_FIT_PAD) return
    w.m.easeTo({ center: lngLat, offset: [0, (w.top - w.bottom) / 2], duration: 400 })
  }, [oneKey]) // eslint-disable-line react-hooks/exhaustive-deps
  const said = (r) => setRvNote(r.error ? t(`elevation_take_over_err_${r.error}`) : r.refused ? t('elevation_take_over_refused')
    : r.same ? t('elevation_take_over_same') : null)
  const refOf = (p) => ({ trackId: p.owner.trackId, index: p.owner.index })
  /** A linked point: selected where it is on show, else its track's profile opened on it. */
  const pickLinked = (r) => {
    const i = profile?.byRef(r.trackId, r.index)
    if (i != null) select([i])
    else onShowPoint?.(r)
  }
  // The point view's fields: station, height, curve with its Regelwert, reason —
  // written as the toolbar's are, on Enter or on leaving the field.
  const regular = one && !curveHeld(one.index) ? regularVerticalRadius(one.owner.part.track, one.owner.index, { switches }) : null
  const regularText = !regular ? t('elevation_regular_none')
    : regular.noSpeed ? t('elevation_regular_no_speed')
      : regular.rv == null ? t('elevation_regular_no_curve')
        : fill('elevation_regular_value', { rv: num(regular.rv, { digits: 0 }) })

  // ── Locking points (Entscheidung 382) ─────────────────────────────────────
  // The selection locked, or — where all of it is locked already — unlocked.
  // A lock holds the point's height and station, and where it is one the
  // coupling sets for a turnout, that turnout's gradient.
  const allLocked = selectedPoints.length > 0 && selectedPoints.every(p => lockedByHand(p.index))
  const toggleLock = () => {
    if (!resolved || !selectedPoints.length) return
    const entries = selectedPoints.map(p => ({ trackId: p.owner.trackId, index: p.owner.index, locked: allLocked ? null : true }))
    setHeightsForTracks(jointHeightUpdates(tracks, switches, entries), { unlock: allLocked })
  }
  /** One point locked or unlocked — the table's lock column. */
  const toggleLockAt = (i) => {
    const p = points[i]
    if (!resolved || !p) return
    const unlock = lockedByHand(i)
    setHeightsForTracks(jointHeightUpdates(tracks, switches,
      [{ trackId: p.owner.trackId, index: p.owner.index, locked: unlock ? null : true }]), { unlock })
  }
  const lockButton = selectedPoints.length > 0 && (
    <button className="track-table-save-btn" title={t('elevation_lock_hint')} onClick={toggleLock}>
      {t(allLocked ? 'elevation_unlock' : 'elevation_lock')}
    </button>
  )

  // Several points selected (in the graphic, by Ctrl/Shift or a frame) are
  // edited here together: one height and one curve for all, the Regelwert
  // for each; lock and delete with them.
  const many = selectedPoints.length > 1
  const pointEditor = selectedPoints.length > 0 && (
    <div className="profile-point-edit">
      {one && (
        <label>
          <span>{t('elevation_station')}</span>
          {stationMovable(one)
            ? <NumberInput className="track-table-input" step="0.1" digits={3} value={stDraft} onChange={e => setStDraft(e.target.value)} {...editProps} />
            : <span className="profile-point-value">{num(one.station, { digits: 3 })}</span>}
          <span>m</span>
        </label>
      )}
      <label>
        <span>{t('elevation_height')}</span>
        {selectedPoints.some(p => !locked.has(p.index))
          ? <NumberInput className="track-table-input" step="0.001" digits={4} value={draft} placeholder={t('elevation_mixed')}
            onChange={e => setDraft(e.target.value)} {...editProps} />
          : <span className="profile-point-value">{one ? num(one.z, { digits: 4 }) : '–'}</span>}
        <span>m</span>
      </label>
      <label title={t('elevation_vcurve_hint')}>
        <span>{t('elevation_vcurve')}</span>
        {selectedPoints.some(p => !curveHeld(p.index))
          ? <NumberInput className="track-table-input" step="100" min="0" digits={0} value={rvShown}
            placeholder={rvMixed ? t('elevation_mixed') : '–'} onChange={e => setRvDraft(e.target.value)} {...editProps} />
          : <span className="profile-point-value">–</span>}
        <span>m</span>
      </label>
      {one && !curveHeld(one.index) && (
        <div className="profile-point-regular">
          <span className="profile-hint">{regularText}</span>
          {regular && !regular.noSpeed && (regular.rv ?? null) !== (one.rv ?? null) && (
            <button className="track-table-save-btn" title={t('elevation_vcurve_regular_hint')} onClick={setRegularRadius}>
              {t('elevation_regular_take')}
            </button>
          )}
          {laShown != null && (
            <span className="profile-hint">{fill('elevation_vcurve_length_label', { la: num(laShown, { digits: 0 }) })}</span>
          )}
        </div>
      )}
      {many && (
        <div className="profile-point-regular">
          <button className="track-table-save-btn" title={t('elevation_vcurve_regular_hint')} onClick={setRegularRadius}>
            {t('elevation_vcurve_regular')}
          </button>
        </div>
      )}
      {((one && !curveHeld(one.index)) || (many && reasonAsked)) && (
        <label title={t('elevation_reason_hint')}>
          <span>{t('elevation_reason')}</span>
          <input type="text" className="track-table-input profile-reason" value={reasonShown}
            placeholder={t('elevation_reason_placeholder')} onChange={e => setReasonDraft(e.target.value)} {...editProps} />
        </label>
      )}
      <div className="profile-point-actions">
        {lockButton}
        <button className="track-table-save-btn profile-delete-btn" disabled={!deletable.length}
          title={t('elevation_delete_hint')} onClick={() => remove()}>
          {fill('elevation_delete', { n: deletable.length })}
        </button>
      </div>
    </div>
  )

  /**
   * A point a section adds with a double click (`c`: { trackId, heights,
   * index, z }), written with its twin across a turnout (decision 393) and
   * selected.
   */
  const insertPoint = (c) => {
    addHeightPoint(c.trackId, c.heights, c.index)
    keepView(1)
    // Where the new point stands in the route, read from the state just written.
    const now = loadTracks(), sw = loadSwitches()
    const next = routeRec ? resolveRoute(routeRec, now, sw) : trackAsRoute(now.find(tr => tr.id === trackId))
    const i = routeProfile(next).byRef(c.trackId, c.index)
    setSelection(i == null ? [] : [i]); setDraft(String(c.z)); setRvDraft(null)
  }

  if (!resolved) return null

  /** The tooltip of a stretch or gradient change: its values, then each finding. */
  const findingNote = (entry, values) => [
    values,
    ...entry.results.filter(r => r.severity !== 'ok')
      .map(r => `${r.id} · ${t(severityLabelKey(r.severity))}: ${ruleById(r.id)?.title ?? ''}`),
  ].join('\n')
  const stretchNote = (s) => findingNote(s, `s = ${gradeLabel(s.grade, num)}`)
  const curveNote = (c) => findingNote(c, [
    [
      `Δs = ${num(Math.abs(c.gradeChange), { digits: 2 })} ‰`,
      c.radius ? `ra = ${num(c.radius, { digits: 0 })} m, la = ${num(c.length, { digits: 2 })} m` : 'ra –',
      c.speed ? `v = ${c.speed} km/h` : null,
    ].filter(Boolean).join(', '),
    points[c.index]?.la != null ? fill('elevation_vcurve_length_governs', { la: num(points[c.index].la, { digits: 2 }) }) : null,
  ].filter(Boolean).join('\n'))

  // Drawn values to what the drawing shows: stations and lengths to the cm, heights to the mm.
  const cm = (v) => num(v, { digits: 2 })
  const overlapNote = (o) => [
    fill('elevation_vcurve_overlap', {
      a: cm(points[o.a].station), b: cm(points[o.b].station),
      length: cm(o.to - o.from), from: cm(o.from), to: cm(o.to),
    }),
    `HP.AR.04 · ${t(severityLabelKey('error'))}: ${ruleById('HP.AR.04')?.title ?? ''}`,
  ].join('\n')

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
  // The rules in a word, in the upper tab bar — the same place whatever is
  // open: the list itself is in the panel, which a long track list may have
  // scrolled away.
  const rulesSummary = check && points.length >= 2 && (() => {
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
  })()

  // A track without a gradient: offered to be read from the terrain — in the
  // section where it is open, else in the table.
  const noHeights = points.length === 0 && !refRuns.length
  const emptyState = (
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

  /** A row of tabs, `value` the open one. */
  const tabs = (keys, value, choose, label) => (
    <div className="profile-tabs" role="tablist">
      {keys.map(v => (
        <button key={v} type="button" role="tab" aria-selected={value === v}
          className={`profile-tab${value === v ? ' active' : ''}`} onClick={() => choose(v)}>
          {label(v)}
        </button>
      ))}
    </div>
  )

  /**
   * What a section draws and does (ElevationSection) — the same data, the
   * selection and the cursor for both. A click in the upper one opens the
   * point tab below, unless a section is open there too (decision 393).
   */
  const sectionOf = (where) => ({
    viewKey, exaggeration, points, profile, stubs, refRuns, refPoints, devShown, refAxis, limitZ, curves, overlaps,
    stretchAt, curveAt, linkState, selection, locked, lockedByHand, coupled, pointNote, curveNote, stretchNote,
    overlapNote, cursor, setCursor, heightAt, sectionStation, onTrackAt, select, onInsert: insertPoint, fitGen: fit.gen,
    empty: noHeights ? emptyState : null,
    onPick: (i, e) => pick(i, e, { open: where === 'upper' && lower !== 'profile' }),
  })
  // What a section is set with, in the bar of every half that shows one — the same values for both.
  const sectionTools = (
    <>
      {axes.length > 0 && (
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
      <label className="profile-edit">
        {t('elevation_exaggeration')}
        <select className="settings-select" value={exaggeration} onChange={e => setExaggeration(Number(e.target.value))}>
          {EXAGGERATIONS.map(x => <option key={x} value={x}>{x}×</option>)}
        </select>
      </label>
      <InfoTip text={t('elevation_hint_edit')} />
    </>
  )

  return (
    <div ref={rootRef} className={`elevation-overlay${upper === 'map' ? ' map-shown' : ''}`}
      style={{ gridTemplateRows: `minmax(0, ${split}fr) auto minmax(0, ${1 - split}fr)` }}>
      <section className="elevation-upper">
        <div className="elevation-bar" ref={upperBarRef}>
          <span className="track-table-title">{title}</span>
          {routeRec && !resolved.ok && <span className="profile-hint msg-warn">{t('elevation_route_gaps')}</span>}
          {tabs(['profile', 'map'], upper, chooseUpper, v => t(`elevation_view_${v}`))}
          {rulesSummary}
          <div className="elevation-bar-tools">
            {upper === 'profile' ? sectionTools : <InfoTip text={t('elevation_map_hint')} />}
            <CloseButton onClick={onClose} />
          </div>
        </div>
        {/* Kept in place under the map tab, so the section keeps its size and view. */}
        <ElevationSection s={sectionOf('upper')} />
      </section>
      <div ref={dividerRef} className="elevation-divider" role="separator" aria-orientation="horizontal"
        title={t('elevation_divider_hint')} onPointerDown={startSplit} onDoubleClick={resetSplit} />
      <section className="elevation-lower">
        <div className="elevation-bar">
          {tabs(['profile', 'table', 'point'], lower, chooseLower, v => (v === 'point' && many
            ? fill('elevation_view_points', { n: selectedPoints.length }) : t(`elevation_view_${v}`)))}
          <div className="elevation-bar-tools">
            {lower === 'profile' && sectionTools}
            {lower === 'table' && (
              <label className="profile-edit">
                {t('elevation_given')}
                <select className="settings-select" value={given} onChange={e => chooseGiven(e.target.value)}>
                  {Object.keys(GIVEN_MODES).map(m => <option key={m} value={m}>{t(`elevation_given_${m}`)}</option>)}
                </select>
                <InfoTip text={t('elevation_given_hint')} />
              </label>
            )}
          </div>
        </div>
        {lower === 'profile' ? <ElevationSection s={sectionOf('lower')} /> : (
          <div className="elevation-lower-body">
            {lower === 'point' ? (
              <ElevationPointDetails key={oneKey ?? 'none'} point={one} count={selectedPoints.length} track={one ? tracks.find(x => x.id === one.owner.trackId) : null}
                grades={one ? pointGrades(points, one.index) : null} roleText={one ? roleNote(roles.get(one.index)) : null}
                links={one ? linksOf(one.index) : null}
                nameOf={linkName} linkOf={(r) => links.get(`${r.trackId}|${r.index}`) ?? null} design={design}
                modes={DEPENDENCY_MODES} suggested={coupled(one?.index)?.kind === 'lds' ? 'lds' : 'continueBefore'}
                toe={toeOf(one)} onToeLead={(lead) => said(setToeLeadAt(toeOf(one).sw.switchId, lead))}
                picking={picking} onPickDependent={setPicking} onCancelPick={() => setPicking(null)}
                note={rvNote} onPick={pickLinked}
                editor={pointEditor} freed={!!one && !!roles.get(one.index)?.free}
                onRestore={() => said(restoreDependentPoint(refOf(one)))}
                onSetMode={(r, m) => said(setDependencyModeAt(r, m))}
                onRelease={(r) => said(releaseDependentPoint(r))} />
            ) : points.length ? (
              <ElevationTable points={points} length={profile.length} onWrite={writePoint}
                mode={given} roles={roles} noteAt={pointNote} onLock={(i) => { select([i]); toggleLockAt(i) }}
                stretchAt={stretchAt} curveAt={curveAt} stretchNote={stretchNote} curveNote={curveNote}
                selection={selection} linkState={linkState} onPick={pick} leads={leads} />
            ) : upper !== 'profile' && noHeights ? emptyState
              : <div className="profile-empty"><span>{t('elevation_no_heights')}</span></div>}
          </div>
        )}
      </section>
      {askDelete && (
        <ConfirmModal message={t('elevation_delete_locked_ask')} onConfirm={() => remove(true)} onCancel={() => setAskDelete(false)} />
      )}
    </div>
  )
}
