import { classifyTrackEnds, isOpenState } from './topology'
import { elementBelongsToSwitch } from './switchModel'
import { resolveEndBearing, reverseElement } from './elementUtils'
import { curvatureOf, radiusOfCurvature } from './clothoidUtils'
import { switchRouteBearingAt, switchRoutePointUtm } from './switch/route'
import { STRAIGHT_CURVATURE } from './switch/catalogue'
import { arcElement, straightElement, transitionElement } from './elementFactory'
import { joinTracks, recalcAbsLengths, rebuildCoords, reverseTrack } from './trackModel'
import { trackLength } from './heightUtils'

// Connecting a turnout's branch, or a crossing's cross leg, to an open track
// end (Entscheidungen 302–304, 307–308).
//
// The element at that end — the "connecting element" — keeps its other node
// and the tangent there, and takes a new length and radius so that its open end
// lands on the port tangentially. The port moves with the turnout or crossing,
// which slides along the track it is laid into: one station x there. For any x
// the element is fixed by position alone (an arc from a point and a tangent to
// a point is one arc), so what is left is the miss in direction at the port —
// one function of one variable, whose roots are the solutions.

const DEG = Math.PI / 180

/** A turn in degrees, wrapped into (−180, 180]. */
const wrap = (a) => {
  const r = ((a + 180) % 360 + 360) % 360 - 180
  return r === -180 ? 180 : r
}

/** Further than this from a tangent the port lies behind the fixed node: no element reaches it forwards [deg]. */
const MAX_HALF_TURN = 89

/** Below this the position miss of a fitted transition is met [m]. */
const FIT_TOL = 1e-9

/** Below this the direction miss at the port is met [deg] — the invariant checker's own limit. */
const ROOT_TOL = 1e-6

/**
 * The connecting element at an open track end: which element it is and the
 * node that stays, with the tangent there pointing towards the open end and
 * the signed radius there in that direction (a transition keeps it).
 *
 * Returns { anchor } or { error } — the key of why this end cannot be
 * connected to (Entscheidung 304).
 */
export function connectionAnchor(track, endpoint, { tracks, switches, endMarks } = {}) {
  const els = track?.elements ?? []
  if (!els.length) return { error: 'connect_end_none' }
  const end = classifyTrackEnds(tracks ?? [track], switches ?? [], endMarks ?? [])
    .find(e => e.trackId === track.id && e.endpoint === endpoint)
  if (!end || !isOpenState(end.state)) return { error: 'connect_end_not_open' }
  const atEnd = endpoint === 'END'
  const elIdx = atEnd ? els.length - 1 : 0
  const el = els[elIdx]
  if ((switches ?? []).some(sw => elementBelongsToSwitch(el, sw)) || el.switchBranch) return { error: 'connect_end_in_switch' }
  if (el.elementType === 2 && (el.transitionType ?? 'clothoid') !== 'clothoid') return { error: 'connect_end_bloss' }
  // Read from the fixed node towards the open end: at the end of the track
  // the element as it runs, at its start the element turned round.
  const run = atEnd ? el : reverseElement(el)
  const kind = run.elementType === 2 ? 'transition' : run.elementType === 1 ? 'arc' : 'straight'
  // The tangent at the fixed node is the neighbour's, where there is one: the
  // refitted element continues the track, not whatever kink it had there.
  const neighbour = els[atEnd ? elIdx - 1 : elIdx + 1]
  const bearing = !neighbour ? run.bearing
    : atEnd ? resolveEndBearing(neighbour, track.epsg) : (neighbour.bearing + 180) % 360
  return {
    anchor: {
      trackId: track.id, endpoint, elIdx, kind,
      fixedUtm: { easting: run.startNode[0], northing: run.startNode[1], zone: track.epsg },
      bearing,
      r1: kind === 'transition' ? (run.r1 ?? null) : kind === 'arc' ? run.radius : null,
      oldLength: el.length,
    },
  }
}

/**
 * The arc (or straight) that leaves `fixed` on `bearing` and ends at `port`:
 * the chord and the tangent fix it. Null where the port lies behind the
 * node — no element runs there forwards.
 */
function arcTo(fixed, bearing, port) {
  const dE = port.easting - fixed.easting, dN = port.northing - fixed.northing
  const c = Math.hypot(dE, dN)
  if (c < 1e-6) return null
  const alpha = wrap(Math.atan2(dE, dN) / DEG - bearing)
  if (Math.abs(alpha) >= MAX_HALF_TURN) return null
  const a = alpha * DEG
  const r = c / (2 * Math.sin(a))
  // Flatter than the project's straight threshold it is a straight: beyond
  // ~1e7 m a radius is numerical noise.
  if (!Number.isFinite(r) || Math.abs(1 / r) < STRAIGHT_CURVATURE) return { length: c, r1: null, r2: null }
  return { length: 2 * a * r, r1: r, r2: r }
}

/**
 * The transition that leaves `fixed` on `bearing` with the radius `r1` it has
 * there and ends at `port`: its length and the radius at its far end, by a
 * small Newton iteration from the arc to the same point. Null where none
 * converges.
 */
function transitionTo(fixed, bearing, r1, port) {
  const arc = arcTo(fixed, bearing, port)
  if (!arc) return null
  const k0 = curvatureOf(r1)
  const route = (L, k) => ({ length: L, r1, r2: radiusOfCurvature(k) })
  const miss = (L, k) => {
    const p = switchRoutePointUtm(fixed, bearing, route(L, k))
    return [p.easting - port.easting, p.northing - port.northing]
  }
  // An arc of curvature k̄ and a clothoid from k0 to 2k̄ − k0 turn alike.
  let L = arc.length
  let k = 2 * curvatureOf(arc.r1) - k0
  for (let i = 0; i < 40; i++) {
    const f = miss(L, k)
    if (Math.hypot(f[0], f[1]) < FIT_TOL) return route(L, k)
    const hL = Math.max(1e-6, 1e-7 * L), hk = 1e-9
    const fL = miss(L + hL, k), fk = miss(L, k + hk)
    const a = (fL[0] - f[0]) / hL, b = (fk[0] - f[0]) / hk
    const c = (fL[1] - f[1]) / hL, d = (fk[1] - f[1]) / hk
    const det = a * d - b * c
    if (!Number.isFinite(det) || Math.abs(det) < 1e-18) return null
    const dL = (d * f[0] - b * f[1]) / det
    const dk = (a * f[1] - c * f[0]) / det
    L -= dL; k -= dk
    if (!(L > 0) || !Number.isFinite(k)) return null
  }
  const f = miss(L, k)
  return Math.hypot(f[0], f[1]) < 1e-6 ? route(L, k) : null
}

/**
 * The connecting element refitted to end at `port`, arriving on
 * `bearingIn` — or null where no element of its kind reaches the port.
 * `{ route, endBearing, miss }`: the route from the fixed node ({ length, r1,
 * r2 }), the tangent it then has at the port and how far that misses
 * `bearingIn` [deg].
 */
export function fitConnectingElement(anchor, port, bearingIn) {
  const route = anchor.kind === 'transition'
    ? transitionTo(anchor.fixedUtm, anchor.bearing, anchor.r1, port)
    : arcTo(anchor.fixedUtm, anchor.bearing, port)
  if (!route || !(route.length > 0)) return null
  const endBearing = switchRouteBearingAt(anchor.bearing, route)
  return { route, endBearing, miss: wrap(endBearing - bearingIn) }
}

/**
 * Where along the host track the construction connects: the stations x in
 * [from, to] at which the refitted element meets the port tangentially,
 * nearest to `near` first.
 *
 * `portAt(x)` is the construction at x — `{ port, bearingIn, ... }` with the
 * port in the anchor's plane and the bearing the element has to arrive on, or
 * null where it cannot stand at x. The miss is scanned in steps of `step` and
 * every change of sign halved down; one across ±180° is a wrap, not a root.
 *
 * Returns [{ x, fit, at }], `at` being portAt's answer there.
 */
export function connectionRoots(anchor, portAt, { from, to, step = 0.5, near = (from + to) / 2 }) {
  const miss = (x) => {
    const at = portAt(x)
    const fit = at && fitConnectingElement(anchor, at.port, at.bearingIn)
    return fit ? { x, fit, at, f: fit.miss } : { x, f: NaN }
  }
  const roots = []
  const n = Math.max(1, Math.ceil((to - from) / step))
  let prev = miss(from)
  for (let i = 1; i <= n; i++) {
    const cur = miss(from + (to - from) * i / n)
    if (Number.isFinite(prev.f) && Math.abs(prev.f) < ROOT_TOL) roots.push(prev)
    else if (Number.isFinite(prev.f) && Number.isFinite(cur.f) && prev.f * cur.f < 0
      && Math.abs(prev.f - cur.f) < 90) {
      let lo = prev, hi = cur
      for (let k = 0; k < 100 && hi.x - lo.x > 1e-10; k++) {
        const mid = miss((lo.x + hi.x) / 2)
        if (!Number.isFinite(mid.f)) break
        if (mid.f === 0) { lo = hi = mid; break }
        if (lo.f * mid.f < 0) hi = mid; else lo = mid
      }
      const best = Math.abs(lo.f) <= Math.abs(hi.f) ? lo : hi
      if (Number.isFinite(best.f) && Math.abs(best.f) < ROOT_TOL) roots.push(best)
    }
    prev = cur
  }
  if (Number.isFinite(prev.f) && Math.abs(prev.f) < ROOT_TOL) roots.push(prev)
  // A root on a scan station is also the end of the interval before it: the
  // closer of the two stays.
  roots.sort((a, b) => Math.abs(a.f) - Math.abs(b.f))
  return roots
    .filter((r, i) => roots.findIndex(q => Math.abs(q.x - r.x) < 1e-3) === i)
    .map(({ x, fit, at }) => ({ x, fit, at }))
    .sort((a, b) => Math.abs(a.x - near) - Math.abs(b.x - near))
}

/** The fields of an element that say where it lies; everything else it keeps when refitted. */
const SHAPE_FIELDS = new Set([
  'elementType', 'startNode', 'endNode', 'bearing', 'endBearing', 'length', 'absLength', 'radius',
  'r1', 'r2', 'transitionType', 'geometry', 'renderCoords',
])

/**
 * The connecting element as refitted: the route from the fixed node built as
 * an element ending exactly on `port`, turned back where the open end is the
 * track's start, with everything else the old one carried (speed, cant, …) —
 * stated in the old element's own direction, which the result has again.
 */
function refittedElement(track, anchor, route, port) {
  const old = track.elements[anchor.elIdx]
  const keep = Object.fromEntries(Object.entries(old).filter(([k]) => !SHAPE_FIELDS.has(k)))
  const built = route.r1 !== route.r2
    ? transitionElement(anchor.fixedUtm, anchor.bearing, route.length, route.r1, route.r2, { endUtm: port }).element
    : route.r1
      ? arcElement(anchor.fixedUtm, port, route.r1)
      : straightElement(anchor.fixedUtm, port)
  return { ...(anchor.endpoint === 'END' ? built : reverseElement(built)), ...keep }
}

/**
 * The track with its connecting element refitted to `fit` (fitConnectingElement)
 * ending on `port`. Its heights stay with the part that does not move: at the
 * end of the track the points beyond the new length go, at its start every
 * station moves by the change of length and the points before the new start go.
 */
export function refitTrackEnd(track, anchor, fit, port) {
  const el = refittedElement(track, anchor, fit.route, port)
  const elements = recalcAbsLengths(track.elements.map((e, i) => (i === anchor.elIdx ? el : e)))
  const delta = el.length - anchor.oldLength
  const total = trackLength(track) + delta
  const heights = (track.heights ?? [])
    .map(p => (anchor.endpoint === 'BEGIN' ? { ...p, station: p.station + delta } : p))
    .filter(p => p.station >= -1e-6 && p.station <= total + 1e-6)
  const { heights: _h, ...rest } = track
  return { ...rest, elements, coordinates: rebuildCoords(elements), ...(heights.length ? { heights } : {}) }
}

/**
 * The refitted track and the new route of a turnout or crossing as one track
 * (Entscheidung 303): `route` runs from the switch's own port to the port the
 * track was connected at. The track keeps its id, metadata and direction; the
 * switch's port is now its end `anchor.endpoint`. `shift` is how far its old
 * stations moved (the route and the change of length where the track grew at
 * its start, else 0) — for whatever else is stationed along it.
 */
export function joinRouteIntoTrack(refitted, anchor, route) {
  if (anchor.endpoint === 'END') {
    return { track: joinTracks(refitted, reverseTrack(route)), shift: 0 }
  }
  const { heights: _h, ...head } = { ...route, ...meta(refitted) }
  const joined = joinTracks(head, refitted)
  return { track: { ...joined, id: refitted.id }, shift: trackLength(route) }
}

/** What names and describes a track, without its geometry. */
const meta = (track) => Object.fromEntries(Object.entries(track)
  .filter(([k]) => !['elements', 'coordinates', 'heights'].includes(k)))
