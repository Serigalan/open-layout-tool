import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { loadTracks, loadSwitches, commitSwitchConnection, generateId, nextTrackName, rebuildCoords, recalcAbsLengths } from '../../../storage'
import { resolveEndBearing, nodeUtm, projectOnBearingUtm, endPointStraightUtm } from '../../../utils/elementUtils'
import { wgs84ToUTM, utmToWgs84, transformGridBearing } from '../../../utils/coordinateUtils'
import { computeSwitchGeometryUtm } from '../../../utils/switchUtils'
import { newSwitchFields, switchElementMark } from '../../../utils/switchModel'
import { switchDesignation, nextSwitchNumber } from '../../../utils/identifierUtils'
import { splitElementAt, carveSwitchRoute } from '../../../utils/trackSplitUtils'
import {
  SWITCH_TYPES, computeSwitchConnections, solveSwitchConnection, buildConnectionElements,
} from '../../../utils/switchConnectionUtils'
import { HIT_TOLERANCE, ZOOM_LINE_WIDTH } from '../../../utils/mapConstants'
import useTrackHover from '../../../hooks/useTrackHover'
import usePreviewLayers from '../../../hooks/usePreviewLayers'

// ── Preview layers (managed by usePreviewLayers) ────────────────────────────
const SCURVE_PREVIEW_SOURCE = 'scurve-preview-source'
const SCURVE_PREVIEW_LAYER  = 'scurve-preview-layer'
const SCURVE_POINTS_SOURCE  = 'scurve-points-source'
const SCURVE_POINTS_LAYER   = 'scurve-points-layer'
const EMPTY_FC = { type: 'FeatureCollection', features: [] }

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
        'circle-radius': 4, 'circle-color': '#1A237E',
        'circle-stroke-color': '#fff', 'circle-stroke-width': 1.5,
      },
    },
  },
]

const RAD2DEG = 180 / Math.PI
const DEG2RAD = Math.PI / 180

// Default speed/switch (R = 1200 if present).
const DEFAULT_TYPE = Math.max(0, SWITCH_TYPES.findIndex(s => s.R === 1200))

// ── Commit helpers (split lines + build junction switches) ──────────────────

// Build a switch record at a junction. The symbol is derived from
// computeSwitchGeometry (same as connect switch); the curve side is chosen so the
// symbol's branch overlays the real connection arc (toward `branchUtm`).
// `throughEnd` comes back with it: the switch end on the running track, where
// that track has to be parted so the turnout's through route is its own element.
function buildJunctionSwitch({ jWgs, jNode, zone, tangentBearing, branchUtm, sw, speed, switchNumber,
                               identity,
                               behindTrackId, behindEndpoint, aheadTrackId, aheadEndpoint,
                               branchTrackId, branchEndpoint }) {
  const tE = Math.sin(tangentBearing * DEG2RAD), tN = Math.cos(tangentBearing * DEG2RAD)
  const crossSign = (p) => Math.sign(tE * (p.northing - jNode[1]) - tN * (p.easting - jNode[0]))
  const target = crossSign(branchUtm)
  const jUtm = { easting: jNode[0], northing: jNode[1], zone }
  let geom = computeSwitchGeometryUtm(jUtm, tangentBearing, sw, 'left', false, jWgs)
  for (const side of ['left', 'right']) {
    const g  = computeSwitchGeometryUtm(jUtm, tangentBearing, sw, side, false, jWgs)
    if (crossSign(g.curvedUtm) === target) { geom = g; break }
  }
  return {
    throughEnd: geom.straightUtm,
    throughLength: geom.straightLen,
    record: {
      ...identity,
      number: switchNumber, trailing: false, speed,
      portA_trackId:  behindTrackId,  portA_endpoint:  behindEndpoint,
      portB1_trackId: branchTrackId,  portB1_endpoint: branchEndpoint,
      portB2_trackId: aheadTrackId,   portB2_endpoint: aheadEndpoint,
      fillCoords: geom.fillCoords, lcsCoords: geom.lcsCoords,
      labelCoords: geom.labelCoords, bauform: geom.bauform,
    },
  }
}

// A connection joins straights, and its turnouts' through routes are straight:
// they may lie on straights only, however many the running track is made of.
const isPlainStraight = (el) => el.elementType !== 2 && el.radius == null

// Put the switch's through route into its own elements in the half-track it runs
// into, and hand back the split's tracks with that one replaced — same id, so
// the remap is untouched.
//
// Null where the half-track cannot carry it: too little straight ahead of the
// junction, or a curve where the route would have to lie. That is not a
// cosmetic miss. The through route would then exist only as a port on the
// record, with no element boundary at the switch end and nothing marked, so the
// symbol would fall back on the stem radii and the delete rules would find a
// route with no elements. The caller refuses the connection instead.
function carveThrough(split, cutUtm, mark, length) {
  const carved = carveSwitchRoute(split.ahead, split.aheadEndpoint, cutUtm, mark, length, { accepts: isPlainStraight })
  return carved ? split.tracks.map(tr => (tr.id === carved.id ? carved : tr)) : null
}

// Orient line 1 towards line 2 (the connection's initial tangent at S1).
function orientB1(g1, p1, p2) {
  const toward = (p2.easting - p1.easting) * Math.sin(g1.bearing * DEG2RAD) +
                 (p2.northing - p1.northing) * Math.cos(g1.bearing * DEG2RAD)
  return toward < 0 ? (g1.bearing + 180) % 360 : g1.bearing
}

// A plane point expressed in another CRS plane (as it is when already there).
function toPlane(p, crs) {
  if (Number(p.zone) === Number(crs)) return p
  return wgs84ToUTM(utmToWgs84(p.easting, p.northing, p.zone), crs)
}

// Project pick 2 into pick 1's native plane (point + grid bearing). All solver
// math runs in line 1's CRS; a second track in another CRS gets converted.
function pick2InPlane(g1, g2) {
  const p2 = toPlane(g2.pointUtm, g1.zone)
  let b2 = g2.bearing
  if (Number(g2.zone) !== Number(g1.zone)) {
    b2 = transformGridBearing(g2.pointUtm.easting, g2.pointUtm.northing, g2.bearing, g2.zone, g1.zone)
  }
  return { p2, b2 }
}

// Solve the connection geometry for a given shift (pure — no React state).
function solveConnection({ picks, speed, shift }) {
  const [g1, g2] = picks
  if (!g1 || !g2 || !speed) return null
  const p1 = g1.pointUtm
  const { p2, b2 } = pick2InPlane(g1, g2)
  return solveSwitchConnection(p1, orientB1(g1, p1, p2), p2, b2, speed, shift)
}

// Why a shift has no connection, in the words the panel shows.
const REASON_MSG = {
  no_solution: 'scurve_no_solution',
  too_short:   'scurve_too_short',
  too_sharp:   'scurve_too_sharp',
}

// Endpoints of a track's clicked element, projected into the given CRS plane.
function segmentEndsUtm(track, elIdx, crs) {
  const el     = track.elements[elIdx]
  const coords = el.geometry.coordinates
  return {
    a: toPlane(nodeUtm(el.startNode, coords[0], track.epsg), crs),
    b: toPlane(nodeUtm(el.endNode, coords[coords.length - 1], track.epsg), crs),
  }
}

// Is the UTM point within the segment [a, b] (projection parameter in [0, 1])?
function inSegment(pt, a, b) {
  const dE = b.easting - a.easting, dN = b.northing - a.northing
  const denom = dE * dE + dN * dN
  if (denom === 0) return false
  const tt = ((pt.easting - a.easting) * dE + (pt.northing - a.northing) * dN) / denom
  return tt >= -1e-9 && tt <= 1 + 1e-9
}

// Shift range [min, max] (metres) for which S1 stays on segment 1 AND the
// resulting S2 stays on segment 2. S1 is analytic; S2 follows the geometry, so we
// walk the solver outward from shift 0 until S2 leaves its segment (or the
// geometry stops being valid). The valid region is a single interval around 0.
function computeShiftBounds({ picks, speed, t1Track, t2Track }) {
  const [g1, g2] = picks
  const p1 = g1.pointUtm
  const { p2 } = pick2InPlane(g1, g2)
  const b1 = orientB1(g1, p1, p2)
  const b1E = Math.sin(b1 * DEG2RAD), b1N = Math.cos(b1 * DEG2RAD)
  const seg1 = segmentEndsUtm(t1Track, g1.elIdx, g1.zone)
  const seg2 = segmentEndsUtm(t2Track, g2.elIdx, g1.zone)

  // S1 bounds: the shift that lands S1 on each segment-1 endpoint.
  const sA = (seg1.a.easting - p1.easting) * b1E + (seg1.a.northing - p1.northing) * b1N
  const sB = (seg1.b.easting - p1.easting) * b1E + (seg1.b.northing - p1.northing) * b1N
  const lo1 = Math.min(sA, sB), hi1 = Math.max(sA, sB)
  const span = hi1 - lo1
  if (!(span > 0)) return { min: 0, max: 0 }
  const step = Math.max(0.5, span / 400)

  const probe = (s) => {
    const res = solveConnection({ picks, speed, shift: s })
    return !!res?.valid && inSegment(res.TP2, seg2.a, seg2.b)
  }

  const c = Math.min(hi1, Math.max(lo1, 0))
  let hi = c
  for (let s = c; s <= hi1 + 1e-9; s += step) { if (!probe(s)) break; hi = s }
  let lo = c
  for (let s = c; s >= lo1 - 1e-9; s -= step) { if (!probe(s)) break; lo = s }
  const min = Math.ceil(lo), max = Math.floor(hi)
  if (min > max) { const m = Math.round(c); return { min: m, max: m } }
  return { min, max }
}

function trackLabel(track) {
  return [track.lineNumber, track.trackNumber].filter(Boolean).join(' / ') || track.name || track.id.slice(0, 8)
}

// Build the green/red preview: branch arc + middle element + branch arc
function buildPreviewGeoJSON(result) {
  const colour = result.valid ? '#2E7D32' : '#C62828'
  return {
    type: 'FeatureCollection',
    features: [
      { type: 'Feature', properties: { colour },
        geometry: { type: 'LineString', coordinates: result.arc1Coords ?? [] } },
      { type: 'Feature', properties: { colour: '#1565C0' },
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

export default function SCurveForm({ t, map, project, onTrackSaved, onCommitted }) {
  const [phase, setPhase]   = useState('select_first')  // select_first | select_second | config
  const [picks, setPicks]   = useState([])
  const [speedIdx, setSpeedIdx] = useState(DEFAULT_TYPE)   // selected design speed (index into SWITCH_TYPES)
  const [shiftRaw, setShift] = useState(0)              // start-point offset along line 1 [m]
  const [pickStatus, setPickStatus] = useState(null)    // { msg, error } — selection phases only
  // Straight the turnouts' through routes need beside the junction [m], set
  // when the commit found too little of it (see carveThrough).
  const [carveError, setCarveError] = useState(null)

  const picksRef = useRef(picks)
  const speed    = SWITCH_TYPES[speedIdx]?.speed ?? 0

  useEffect(() => { picksRef.current = picks }, [picks])

  // Hover highlight while selecting
  useTrackHover(map, phase, 'select_first', project)
  useTrackHover(map, phase, 'select_second', project)

  // Setup / cleanup preview layers
  usePreviewLayers(map, SCURVE_PREVIEW_LAYERS, { resetFilters: ['tracks-hover-layer'], resetCursor: true })

  const clearPreview = useCallback(() => {
    if (!map?.current) return
    map.current.getSource(SCURVE_PREVIEW_SOURCE)?.setData(EMPTY_FC)
    map.current.getSource(SCURVE_POINTS_SOURCE)?.setData(EMPTY_FC)
  }, [map])

  const drawPreview = useCallback((res) => {
    if (!map?.current) return
    map.current.getSource(SCURVE_PREVIEW_SOURCE)?.setData(buildPreviewGeoJSON(res))
    map.current.getSource(SCURVE_POINTS_SOURCE)?.setData(buildPointsGeoJSON(res))
  }, [map])

  // ── Click handler for the two selection phases ────────────────────────────
  useEffect(() => {
    if ((phase !== 'select_first' && phase !== 'select_second') || !map?.current) return
    const m = map.current

    const onClick = (e) => {
      const bbox = [
        [e.point.x - HIT_TOLERANCE, e.point.y - HIT_TOLERANCE],
        [e.point.x + HIT_TOLERANCE, e.point.y + HIT_TOLERANCE],
      ]
      const features = m.queryRenderedFeatures(bbox, { layers: ['tracks-layer'] })
      if (!features.length) return

      const { trackId, elementIndex } = features[0].properties
      const elIdx  = Number(elementIndex)
      const track  = loadTracks(project.id).find(tr => tr.id === trackId)
      const el     = track?.elements?.[elIdx]
      if (!el) return

      // The connection joins two straight elements
      if (el.radius != null) {
        setPickStatus({ msg: t('scurve_hint_straight_only'), error: true })
        return
      }

      const coords   = el.geometry.coordinates
      const startUtm = nodeUtm(el.startNode, coords[0], track.epsg)
      const endUtm   = nodeUtm(el.endNode, coords[coords.length - 1], track.epsg)
      const bearing  = resolveEndBearing(el, track.epsg)
      // The clicked point, projected onto the element's line in the track's
      // plane, drives start (line 1) / target (line 2).
      const { along } = projectOnBearingUtm(startUtm, wgs84ToUTM([e.lngLat.lng, e.lngLat.lat], track.epsg), bearing)
      const pointUtm = endPointStraightUtm(startUtm, bearing, along)
      const pick     = { trackId, elIdx, startUtm, endUtm, pointUtm, bearing, zone: track.epsg, label: trackLabel(track) }

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
    }

    m.on('click', onClick)
    return () => m.off('click', onClick)
  }, [phase, map, project.id, t])

  // ── Valid shift range: keep S1 on segment 1 and S2 on segment 2 ───────────
  const shiftRange = useMemo(() => {
    const wide = { min: -200, max: 200 }
    if (phase !== 'config' || !picks[0] || !picks[1] || !speed) return wide
    const tracks  = loadTracks(project.id)
    const t1Track = tracks.find(tr => tr.id === picks[0].trackId)
    const t2Track = tracks.find(tr => tr.id === picks[1].trackId)
    if (!t1Track || !t2Track) return wide
    return computeShiftBounds({ picks, speed, t1Track, t2Track })
  }, [phase, picks, speed, project.id])

  // The slider's own value, held inside the range the geometry allows.
  const shift = Math.min(shiftRange.max, Math.max(shiftRange.min, shiftRaw))

  // Which speeds these two tracks can be connected with where the slider stands
  // — the dropdown's disabled state. It follows from the picks and the shift, so
  // it is derived rather than pushed into state by an effect.
  const connections = useMemo(() => {
    const [g1, g2] = picks
    if (!g1 || !g2) return []
    const p1 = g1.pointUtm
    const { p2, b2 } = pick2InPlane(g1, g2)
    return computeSwitchConnections(p1, orientB1(g1, p1, p2), p2, b2, shift)
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
    if (!map?.current) return
    if (result?.valid) drawPreview(result)
    else clearPreview()
  }, [result, map, clearPreview, drawPreview])

  const handleSpeedChange = (i) => {
    setSpeedIdx(i)
  }

  const handleCancel = () => {
    clearPreview()
    setPhase('select_first')
    setPicks([])
    setShift(0)
    setPickStatus(null)
    onCommitted?.()
  }

  const handleCommit = () => {
    const res = result
    if (!res || !res.valid) return

    const [g1, g2] = picks
    const tracks = loadTracks(project.id)
    const t1 = tracks.find(tr => tr.id === g1?.trackId)
    const t2 = tracks.find(tr => tr.id === g2?.trackId)
    if (!t1 || !t2 || t1.id === t2.id) return   // needs two distinct line tracks

    const zone   = res.zone
    const swType = res.switchType   // the form the solver settled on (primary or fallback)

    // Connection's initial tangent at S1 (line 1 oriented towards line 2).
    const p1 = g1.pointUtm
    const { p2, b2: b2Grid } = pick2InPlane(g1, g2)
    const d1E = Math.sin(g1.bearing * DEG2RAD), d1N = Math.cos(g1.bearing * DEG2RAD)
    const b1 = ((p2.easting - p1.easting) * d1E + (p2.northing - p1.northing) * d1N) < 0
      ? (g1.bearing + 180) % 360 : g1.bearing
    // Line-2 tangent at S2 oriented towards the connection (B2A side), in line 1's plane.
    const dotB2 = (deg) => (res.B2A.easting  - res.TP2.easting)  * Math.sin(deg * DEG2RAD) +
                           (res.B2A.northing - res.TP2.northing) * Math.cos(deg * DEG2RAD)
    const b2 = dotB2(b2Grid) >= dotB2((b2Grid + 180) % 360) ? b2Grid : (b2Grid + 180) % 360
    // The same tangent expressed in track 2's own CRS plane (for the split).
    const b2Track = Number(t2.epsg) !== Number(g1.zone)
      ? transformGridBearing(res.TP2.easting, res.TP2.northing, b2, g1.zone, t2.epsg)
      : b2

    const existingNames = new Set(tracks.map(tr => tr.name))

    // Four split half-tracks (S1 on line 1, S2 on line 2). The junctions go in
    // as plane points in each track's own CRS.
    const s1 = splitElementAt(t1, g1.elIdx, toPlane(res.TP1, t1.epsg), b1, existingNames)
    const s2 = splitElementAt(t2, g2.elIdx, toPlane(res.TP2, t2.epsg), b2Track, existingNames)

    // Two junction switches at S1 and S2.
    const existing = loadSwitches(project.id)
    const no1 = nextSwitchNumber(existing)
    const no2 = nextSwitchNumber(existing, [no1])
    // The identity each record shares with the elements of its two routes: the
    // id ties them together, and it has to exist before the first element is
    // marked — which here is before either record is built.
    const id1 = { ...newSwitchFields(), name: switchDesignation(no1), label: swType.label }
    const id2 = { ...newSwitchFields(), name: switchDesignation(no2), label: swType.label }

    // Connection track (S1 → S2): branch arc + middle element + branch arc. The
    // two arcs are the turnouts' own branches — fixed length, marked as such —
    // while the element between them is ordinary track.
    const { arc1El, midEl, arc2El } = buildConnectionElements(res, speed)
    const connElements = recalcAbsLengths([
      { ...arc1El, ...switchElementMark(id1, 'branch') },
      midEl,
      { ...arc2El, ...switchElementMark(id2, 'branch') },
    ])
    const connTrack = {
      id:          generateId(),
      name:        nextTrackName('connection', existingNames),
      epsg:     zone,
      coordinates: rebuildCoords(connElements),
      elements:    connElements,
    }

    // The connection track runs S1 → S2, so it begins at switch 1 and ends at switch 2.
    const j1 = buildJunctionSwitch({
      jWgs: res.tp1Wgs, jNode: [res.TP1.easting, res.TP1.northing], zone,
      tangentBearing: b1, branchUtm: res.B1E, sw: swType, speed, switchNumber: no1, identity: id1,
      behindTrackId: s1.behind.id, behindEndpoint: s1.behindEndpoint,
      aheadTrackId:  s1.ahead.id,  aheadEndpoint:  s1.aheadEndpoint,
      branchTrackId: connTrack.id, branchEndpoint: 'BEGIN',
    })
    const j2 = buildJunctionSwitch({
      jWgs: res.tp2Wgs, jNode: [res.TP2.easting, res.TP2.northing], zone,
      tangentBearing: b2, branchUtm: res.B2A, sw: swType, speed, switchNumber: no2, identity: id2,
      behindTrackId: s2.behind.id, behindEndpoint: s2.behindEndpoint,
      aheadTrackId:  s2.ahead.id,  aheadEndpoint:  s2.aheadEndpoint,
      branchTrackId: connTrack.id, branchEndpoint: 'END',
    })

    // Each running track gets the turnout's through route as its own element —
    // the element boundary at the switch end both turnouts are built on.
    const s1Tracks = carveThrough(s1, toPlane(j1.throughEnd, t1.epsg), switchElementMark(id1, 'main'), j1.throughLength)
    const s2Tracks = carveThrough(s2, toPlane(j2.throughEnd, t2.epsg), switchElementMark(id2, 'main'), j2.throughLength)
    if (!s1Tracks || !s2Tracks) {
      setCarveError(Math.max(j1.throughLength, j2.throughLength))
      return
    }

    commitSwitchConnection(project.id, {
      removeTrackIds: [t1.id, t2.id],
      addTracks:      [...s1Tracks, ...s2Tracks, connTrack],
      addSwitches:    [j1.record, j2.record],
      remap: [
        { oldId: t1.id, newId: s1Tracks.map(tr => tr.id) },
        { oldId: t2.id, newId: s2Tracks.map(tr => tr.id) },
      ],
    })

    onTrackSaved?.()
    handleCancel()
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  if (phase === 'config') {
    const deg = (r) => (r * RAD2DEG).toFixed(3)
    return (
      <>
        <div className="element-form">
          <div className="form-field">
            <label>{t('scurve_line1')}</label>
            <input type="text" readOnly value={picks[0]?.label ?? ''} />
          </div>
          <div className="form-field">
            <label>{t('scurve_line2')}</label>
            <input type="text" readOnly value={picks[1]?.label ?? ''} />
          </div>

          <div className="form-field">
            <label>{t('field_speed')}</label>
            <select value={speedIdx} onChange={e => { setCarveError(null); handleSpeedChange(Number(e.target.value)) }}>
              {SWITCH_TYPES.map((s, i) => (
                <option key={i} value={i} disabled={connections[i] && !connections[i].valid}>
                  {s.speed} km/h
                </option>
              ))}
            </select>
          </div>

          <div className="form-field">
            <label>{t('scurve_gap')}</label>
            <input type="text" readOnly value={result ? `${result.gap.toFixed(2)} m` : ''} />
          </div>

          <div className="form-field">
            <label>{t('scurve_shift')}: {shift} m</label>
            <input type="range" min={shiftRange.min} max={shiftRange.max} step="1" value={shift}
              onChange={e => { setCarveError(null); setShift(Number(e.target.value)) }} />
          </div>
        </div>

        {result?.valid && (
          <div className="element-form" style={{ marginTop: 8 }}>
            <div className="form-field">
              <label>{t('scurve_switch_type')}</label>
              <input type="text" readOnly value={result.switchType.label} />
            </div>
            <div className="form-field">
              <label>{t('scurve_angle')}</label>
              <input type="text" readOnly value={`1:${result.switchType.ratio}  (${deg(result.w)}°)`} />
            </div>
            <div className="form-field">
              <label>{t('scurve_delta')}</label>
              <input type="text" readOnly value={`${deg(result.delta)}°`} />
            </div>
            <div className="form-field">
              <label>{t('scurve_zgl')}</label>
              <input type="text" readOnly value={`${result.Lg.toFixed(2)} m`} />
            </div>
            <div className="form-field">
              <label>{t('scurve_mid_radius')}</label>
              <input type="text" readOnly value={result.signedRg
                ? `${Math.abs(result.signedRg).toFixed(0)} m`
                : t('scurve_mid_straight')} />
            </div>
            <div className="form-field">
              <label>{t('scurve_total')}</label>
              <input type="text" readOnly value={`${result.laenge.toFixed(2)} m`} />
            </div>
          </div>
        )}

        <p style={{ color: result?.valid ? '#5b9bd5' : '#e74c3c', fontSize: 12, marginTop: 4 }}>
          {result?.valid ? t('scurve_valid') : t(REASON_MSG[result?.reason] ?? 'scurve_invalid')}
        </p>
        {carveError != null && (
          <p className="form-error">
            {t('switch_on_track_no_room').replace('{{m}}', carveError.toFixed(1))}
          </p>
        )}

        <button
          className="panel-btn panel-btn-full"
          style={{ marginTop: 8, opacity: result?.valid ? 1 : 0.5 }}
          onClick={handleCommit}
          disabled={!result?.valid}
        >
          {t('btn_commit')}
        </button>
        <button
          className="panel-btn panel-btn-full"
          style={{ marginTop: 2, background: '#888' }}
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
        <p style={{ fontSize: 12, color: '#5b9bd5', marginTop: 4 }}>
          {t('scurve_line1')}: {picks[0].label}
        </p>
      )}
      {pickStatus && (
        <p style={{ color: pickStatus.error ? '#e74c3c' : '#888', fontSize: 12, marginTop: 4 }}>
          {pickStatus.msg}
        </p>
      )}
      {phase === 'select_second' && (
        <button className="panel-btn panel-btn-full" style={{ marginTop: 8, background: '#888' }} onClick={handleCancel}>
          {t('btn_cancel')}
        </button>
      )}
    </>
  )
}
