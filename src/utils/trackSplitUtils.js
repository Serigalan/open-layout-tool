import { generateId, nextTrackName, rebuildCoords, recalcAbsLengths } from '../storage'
import { computeStraightValuesUtm, computeCurvedValuesUtm, arcCoordsFromRadiusUtm, nodeUtm } from './elementUtils'
import { utmToWgs84 } from './coordinateUtils'
import { SAGITTA_ELEMENT } from './mapConstants'
import { splitHeights } from './heightUtils'

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
 * curve needs the second. (A transition curve is not splittable this way: its
 * curvature runs with the station, so the halves are not transitions of the
 * same parameters. Callers reject one before they get here.)
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
 */
function splitElement(el, epsg, cut) {
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

/** Below this a carved remainder is not an element, it is the cut itself [m]. */
const CARVE_TOL = 1e-3

/**
 * Give a switch's through route its own element at the `endpoint` end of a
 * track. A turnout is two elements of fixed length — the through route and the
 * branch — and the branch is a track of its own, but the through route runs
 * inside the track the switch was laid into. The frog is no junction, the track
 * runs on through it, so this is an element boundary and not a track boundary:
 * the turnout's own dimension is cut off as one element carrying `mark`
 * (switchBranch and the switch's name), and what is left of the element stays
 * as it was.
 *
 * `cut` is the switch end in the track's plane. Returns the track with its
 * elements replaced, or null when the terminal element cannot carry the route
 * (a transition curve, or one shorter than the turnout).
 */
export function carveSwitchRoute(track, endpoint, cut, mark) {
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

export function splitElementAt(track, elIdx, junction, bearing, existingNames) {
  const el    = track.elements[elIdx]
  const epsg  = track.epsg
  const { cutWgs: junctionWgs, svA, svB, a: halfA, b: halfB } = splitElement(el, epsg, junction)
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
