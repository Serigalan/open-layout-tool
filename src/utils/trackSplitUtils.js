import { generateId, nextTrackName, rebuildCoords, recalcAbsLengths } from '../storage'
import { computeStraightValuesUtm, computeCurvedValuesUtm, arcCoordsFromRadiusUtm, nodeUtm } from './elementUtils'
import { utmToWgs84 } from './coordinateUtils'
import { SAGITTA_ELEMENT, SAGITTA_TRACK } from './mapConstants'
import { splitHeights } from './heightUtils'
import {
  computeClothoidUtm, transitionBearingAtUtm, clothoidRadiusAt, transitionCantEnds,
} from './clothoidUtils'

const DEG2RAD = Math.PI / 180

/** Clone a source track keeping its metadata but with fresh id/name/elements. */
function makeSplitTrack(srcTrack, elements, id, name, heights) {
  const elems = recalcAbsLengths(elements)
  const { elements: _e, coordinates: _c, id: _id, name: _n, heights: _h, ...rest } = srcTrack
  return {
    ...rest, id, name,
    coordinates: rebuildCoords(elems),
    elements: elems,
    ...(heights?.length ? { heights } : {}),
  }
}

/**
 * Split the element `elIdx` of `track` at `junction` into two half-tracks;
 * neighbouring elements stay on their side. A straight splits into two
 * collinear straights, an arc into two arcs of its own radius — a switch on a
 * curve needs the second — and a clothoid into two clothoids of its own
 * parameter, which a switch on a transition curve needs. A clothoid is only cut
 * where the junction states its station along the element (`junction.station`):
 * its curvature runs with the station, so the pieces follow from that and not
 * from a point. (A Bloss curve is not splittable at all — its pieces are no
 * Bloss curves. Callers reject one before they get here.)
 *
 * `junction` is a point in the track's own plane ({ easting, northing } in
 * `track.epsg`). The halves are built in that plane from the element's stored
 * nodes; WGS84 is derived for the new vertex once and never converted back.
 * (For the GK/DB_REF datum shift a WGS84 round trip is not exact — about
 * 0.6 mm — which would leave the junction beside the line and give the halves
 * two different bearings.) The element's own WGS84 end points are kept as they
 * are, so the joins with the neighbours are untouched.
 *
 * `bearing` is a grid bearing in the track's own CRS plane and defines which
 * half counts as "ahead" of the junction — compared against the tangent there,
 * so it holds for an arc of any sweep. Since trackA ends at the junction and
 * trackB starts there, the caller also gets the BEGIN/END each half meets the
 * junction with — exactly what a switch port needs to record.
 *
 * The two halves keep the source track's metadata and take fresh ids; names are
 * derived from the source name's prefix (`existingNames` is updated in place).
 * Returns { tracks: [trackA, trackB], junctionWgs, ahead, aheadEndpoint,
 * behind, behindEndpoint } with `tracks` ordered [contains original BEGIN,
 * contains original END] — the order remapSwitches relies on.
 */
/**
 * Cut one element in two at a plane point on it. A straight gives two collinear
 * straights, an arc two arcs of its own radius; both keep the element's own
 * WGS84 end points, so only the new vertex is derived. Everything else the
 * element carries stays on both halves.
 *
 * The shared machinery of the two splits below — one parts a track at a
 * junction, the other only parts an element inside a track.
 *
 * A transition with `cut.station` is cut as a clothoid (see splitClothoid);
 * `ramp` is its cant at both ends, which the pieces keep.
 */
function splitElement(el, epsg, cut, ramp = null) {
  if (el.elementType === 2 && Number.isFinite(cut.station)) return splitClothoid(el, epsg, cut, ramp)
  const radius = el.radius ?? null
  const coords = el.geometry.coordinates
  const gStart = coords[0]
  const gEnd   = coords[coords.length - 1]
  const sUtm   = nodeUtm(el.startNode, gStart, epsg)
  const eUtm   = nodeUtm(el.endNode, gEnd, epsg)
  const jUtm   = { easting: cut.easting, northing: cut.northing, zone: epsg }
  const cutWgs = utmToWgs84(jUtm.easting, jUtm.northing, epsg)
  const values = (a, b) => (radius ? computeCurvedValuesUtm(a, b, radius) : computeStraightValuesUtm(a, b))
  const halfCoords = (a, b, startWgs, endWgs) => {
    if (!radius) return [startWgs, endWgs]
    const c = arcCoordsFromRadiusUtm(a, b, radius, SAGITTA_ELEMENT)
    return c ? [startWgs, ...c.slice(1, -1), endWgs] : [startWgs, endWgs]
  }
  const mkHalf = (sv, c) => {
    const { epsg: _epsg, ...elRest } = el
    return {
      ...elRest,
      startNode: sv.startNode, endNode: sv.endNode,
      bearing: sv.bearing, length: sv.length, absLength: sv.length,
      ...(radius ? { endBearing: sv.endBearing } : {}),
      geometry: { type: 'LineString', coordinates: c }, renderCoords: undefined,
    }
  }
  const svA = values(sUtm, jUtm)
  const svB = values(jUtm, eUtm)
  return {
    cutWgs, svA, svB,
    a: mkHalf(svA, halfCoords(sUtm, jUtm, gStart, cutWgs)),
    b: mkHalf(svB, halfCoords(jUtm, eUtm, cutWgs, gEnd)),
  }
}

/**
 * Cut a clothoid at station `cut.station` into two clothoids. Its curvature runs
 * linearly, so each piece is a clothoid of the same parameter again: the first
 * from r1 to the radius at the cut, the second from there to r2, both meeting in
 * the tangent the element has at that station. The cut node is the caller's
 * plane point itself (it lies on the curve at that station), so what is built
 * from the same point — a switch toe, a switch end — joins the pieces exactly.
 * The element's own end nodes and WGS84 end points stay as they are.
 *
 * A transition carries no cant of its own; `ramp` is the cant at its two ends
 * (transitionCantEnds). Each piece keeps the ramp's value at its own ends as
 * cantStart / cantEnd, since after the cut one of the neighbours that stated it
 * is no longer beside it.
 */
function splitClothoid(el, epsg, cut, ramp) {
  if (el.transitionType === 'bloss' || el.r1 === undefined) {
    throw new Error('splitClothoid: only a clothoid can be cut into pieces of itself')
  }
  const L      = el.length
  const r1     = el.r1 ?? null
  const r2     = el.r2 ?? null
  const s      = Math.min(L, Math.max(0, cut.station))
  const coords = el.geometry.coordinates
  const gStart = coords[0]
  const gEnd   = coords[coords.length - 1]
  const sUtm   = nodeUtm(el.startNode, gStart, epsg)
  const eUtm   = nodeUtm(el.endNode, gEnd, epsg)
  const jUtm   = { easting: cut.easting, northing: cut.northing, zone: epsg }
  const cutWgs = utmToWgs84(jUtm.easting, jUtm.northing, epsg)
  const rCut   = clothoidRadiusAt(r1, r2, L, s)
  const bCut   = transitionBearingAtUtm(el.bearing, L, r1, r2, 'clothoid', s)
  const bEnd   = el.endBearing ?? transitionBearingAtUtm(el.bearing, L, r1, r2, 'clothoid', L)
  const uCut   = ramp && L > 0 ? ramp.start + (ramp.end - ramp.start) * s / L : null

  const { epsg: _epsg, ...elRest } = el
  const piece = ({ from, fromWgs, toNode, toWgs, bearing, endBearing, length, ra, rb, ua, ub }) => {
    const line = (sagitta) => (length > 0
      ? [fromWgs, ...computeClothoidUtm(from, bearing, length, ra, rb, sagitta).coords.slice(1, -1), toWgs]
      : [fromWgs, toWgs])
    return {
      ...elRest,
      r1: ra, r2: rb,
      startNode: [from.easting, from.northing], endNode: toNode,
      bearing, endBearing, length, absLength: length,
      ...(ramp ? { cantStart: ua, cantEnd: ub } : {}),
      geometry: { type: 'LineString', coordinates: line(SAGITTA_ELEMENT) },
      renderCoords: line(SAGITTA_TRACK),
    }
  }
  const a = piece({
    from: sUtm, fromWgs: gStart, toNode: [jUtm.easting, jUtm.northing], toWgs: cutWgs,
    bearing: el.bearing, endBearing: bCut, length: s, ra: r1, rb: rCut, ua: ramp?.start, ub: uCut,
  })
  const b = piece({
    from: jUtm, fromWgs: cutWgs, toNode: [eUtm.easting, eUtm.northing], toWgs: gEnd,
    bearing: bCut, endBearing: bEnd, length: L - s, ra: rCut, rb: r2, ua: uCut, ub: ramp?.end,
  })
  return {
    cutWgs, a, b,
    svA: { length: a.length, bearing: a.bearing, endBearing: a.endBearing },
    svB: { length: b.length, bearing: b.bearing, endBearing: b.endBearing },
  }
}

/** Below this a carved remainder is not an element, it is the cut itself [m]. */
const CARVE_TOL = 1e-3

/**
 * Give a switch's through route its own elements at the `endpoint` end of a
 * track. A turnout is two routes of fixed length — the through route and the
 * branch — and the branch is a track of its own, but the through route runs
 * inside the track the switch was laid into. The frog is no junction, the track
 * runs on through it, so these are element boundaries and not a track boundary:
 * the elements the turnout's own dimension covers carry `mark` (switchBranch and
 * the switch's name), the one it ends in is cut there, and what is left of that
 * one stays as it was.
 *
 * `cut` is the switch end in the track's plane, on the element the route ends
 * in. `routeLength` is the through route's length. With it the route reaches
 * over as many elements as it needs — a turnout laid into a track may lie
 * across a straight running into a transition and on into an arc — and a
 * clothoid is cut at the station that length puts the switch end at.
 * `accepts` may restrict the elements the route may lie on. Without
 * `routeLength` only the terminal element is carved, and only a straight or an
 * arc.
 *
 * Returns the track with its elements replaced, or null when the route cannot
 * be carved: the track ends first, the route runs onto a Bloss curve or an
 * element `accepts` refuses, or (without `routeLength`) the terminal element is
 * a transition.
 */
export function carveSwitchRoute(track, endpoint, cut, mark, routeLength = null, { accepts = null } = {}) {
  if (routeLength == null) return carveTerminal(track, endpoint, cut, mark)
  const els = track.elements ?? []
  const n   = els.length
  const covered = new Set()            // elements the route covers whole
  let total = 0
  for (let k = 0; k < n; k++) {
    const idx = endpoint === 'BEGIN' ? k : n - 1 - k
    const el  = els[idx]
    if (!el?.geometry) return null
    if (accepts && !accepts(el)) return null
    if (el.elementType === 2 && (el.transitionType === 'bloss' || el.r1 === undefined)) return null
    const remaining = routeLength - total
    if (el.length < remaining - CARVE_TOL) {
      covered.add(idx)
      total += el.length
      continue
    }

    // The route ends in this element — with it, where that is within CARVE_TOL
    // of its far end.
    let replacement
    if (el.length - remaining <= CARVE_TOL) {
      replacement = [{ ...el, ...mark }]
    } else {
      const station = endpoint === 'BEGIN' ? remaining : el.length - remaining
      const ramp = el.elementType === 2 ? transitionCantEnds(els, idx) : null
      const { a, b } = splitElement(el, track.epsg, el.elementType === 2 ? { ...cut, station } : cut, ramp)
      const [route, rest] = endpoint === 'BEGIN' ? [a, b] : [b, a]
      if (!(route.length > CARVE_TOL)) return null
      replacement = rest.length <= CARVE_TOL
        ? [{ ...el, ...mark }]
        : endpoint === 'BEGIN' ? [{ ...route, ...mark }, rest] : [rest, { ...route, ...mark }]
    }
    const elements = recalcAbsLengths(els.flatMap((e, i) => (
      i === idx ? replacement : covered.has(i) ? [{ ...e, ...mark }] : [e])))
    return { ...track, elements, coordinates: rebuildCoords(elements) }
  }
  return null
}

/** The through route on the terminal element alone, a straight or an arc. */
function carveTerminal(track, endpoint, cut, mark) {
  const els = track.elements ?? []
  const idx = endpoint === 'BEGIN' ? 0 : els.length - 1
  const el  = els[idx]
  if (!el || el.elementType === 2 || !el.geometry) return null

  const { a, b } = splitElement(el, track.epsg, cut)
  const [route, rest] = endpoint === 'BEGIN' ? [a, b] : [b, a]
  if (!(route.length > CARVE_TOL)) return null

  // The turnout filling the element exactly needs no cut — it is that element.
  const halves = rest.length <= CARVE_TOL
    ? [{ ...el, ...mark }]
    : endpoint === 'BEGIN' ? [{ ...route, ...mark }, rest] : [rest, { ...route, ...mark }]

  const elements = recalcAbsLengths([...els.slice(0, idx), ...halves, ...els.slice(idx + 1)])
  return { ...track, elements, coordinates: rebuildCoords(elements) }
}

/**
 * Split `track` at the joint before its element `j` (0 < j < elements.length)
 * into two half-tracks without cutting an element — what splitElementAt does
 * for a junction that falls on an element boundary, where it would leave an
 * element of no length. A transition beside the joint loses the neighbour that
 * stated its cant on that side, so it keeps the ramp's end values as its own
 * (transitionCantEnds). `bearing` decides which half is ahead, and the result
 * has splitElementAt's shape.
 */
export function splitTrackAtJoint(track, j, bearing, existingNames) {
  const els = track.elements
  const keepRamp = (el, i) => {
    if (el.elementType !== 2) return el
    const { start, end } = transitionCantEnds(els, i)
    return { ...el, cantStart: start, cantEnd: end }
  }
  const before = els.slice(0, j).map((el, i) => (i === j - 1 ? keepRamp(el, i) : el))
  const after  = els.slice(j).map((el, i) => (i === 0 ? keepRamp(el, j) : el))
  const cutAt  = before.reduce((sum, e) => sum + (e.length ?? 0), 0)
  const [heightsA, heightsB] = splitHeights(track.heights, cutAt)
  const prefix = (track.name?.split('.')[0]) || 'track'
  const nameA = nextTrackName(prefix, existingNames); existingNames.add(nameA)
  const nameB = nextTrackName(prefix, existingNames); existingNames.add(nameB)
  const trackA = makeSplitTrack(track, before, generateId(), nameA, heightsA)
  const trackB = makeSplitTrack(track, after, generateId(), nameB, heightsB)
  const aheadIsB = Math.cos((bearing - after[0].bearing) * DEG2RAD) > 0
  return {
    tracks: [trackA, trackB],
    junctionWgs:    after[0].geometry?.coordinates?.[0] ?? null,
    ahead:          aheadIsB ? trackB  : trackA,
    aheadEndpoint:  aheadIsB ? 'BEGIN' : 'END',
    behind:         aheadIsB ? trackA  : trackB,
    behindEndpoint: aheadIsB ? 'END'   : 'BEGIN',
  }
}

export function splitElementAt(track, elIdx, junction, bearing, existingNames) {
  const el    = track.elements[elIdx]
  const epsg  = track.epsg
  // A clothoid keeps the cant ramp it lies in on both pieces.
  const ramp  = el.elementType === 2 && Number.isFinite(junction.station)
    ? transitionCantEnds(track.elements, elIdx) : null
  const { cutWgs: junctionWgs, svA, svB, a: halfA, b: halfB } = splitElement(el, epsg, junction, ramp)
  const before = track.elements.slice(0, elIdx)
  const after  = track.elements.slice(elIdx + 1)
  // The vertical alignment is the track's, stationed along it: it is cut where
  // the halves part, both meeting at the interpolated height.
  const cutAt = before.reduce((sum, e) => sum + (e.length ?? 0), 0) + svA.length
  const [heightsA, heightsB] = splitHeights(track.heights, cutAt)
  const prefix = (track.name?.split('.')[0]) || 'track'
  const nameA = nextTrackName(prefix, existingNames); existingNames.add(nameA)
  const nameB = nextTrackName(prefix, existingNames); existingNames.add(nameB)
  const trackA = makeSplitTrack(track, [...before, halfA], generateId(), nameA, heightsA)
  const trackB = makeSplitTrack(track, [halfB, ...after], generateId(), nameB, heightsB)
  // Tangent at the junction, pointing along the element: the second half's own
  // start bearing, or the first half's end bearing where the second is degenerate.
  const jBearing = svB.length > 1e-9 ? svB.bearing : (svA.endBearing ?? svA.bearing)
  const aheadIsB = Math.cos((bearing - jBearing) * DEG2RAD) > 0
  return {
    tracks: [trackA, trackB],
    junctionWgs,
    ahead:          aheadIsB ? trackB  : trackA,
    aheadEndpoint:  aheadIsB ? 'BEGIN' : 'END',
    behind:         aheadIsB ? trackA  : trackB,
    behindEndpoint: aheadIsB ? 'END'   : 'BEGIN',
  }
}
