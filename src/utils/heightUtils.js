import { nodeUtm, endPointStraightUtm, endPointCurvedUtm } from './elementUtils'
import { portsOf } from './switchModel'
import { transitionPointAtUtm } from './clothoidUtils'
import { utmToWgs84 } from './coordinateUtils'
import { HEIGHT_POINT_SPACING, HEIGHT_SPLIT_MIN } from './heightDatums'

// The vertical alignment of a track is its own thing, independent of the
// horizontal elements it runs over: `track.heights` is [{ station, z, rv? }]
// with station the distance along the track [m] from its BEGIN, z the height
// [m] and rv the radius of the vertical curve rounding the gradient change
// there, absent where there is none. Ascending in station, the first at 0 and
// the last at the track's length — the two that meet the neighbouring tracks.
// An imported gradient can cover less than its track: then a stretch at either
// end has no heights yet, its outermost point is no joint, and the stretch is
// left to be read from the terrain on request (elevationFill).
// The heights are design values — stated by hand, or read from the terrain on
// request and edited from there; never filled in behind the user's back. A
// track without a gradient has no `heights` at all.

const STATION_TOL = 1e-6   // m — two stations this close are the same point
const JOINT_TOL = 0.01     // m — a height point this close to a track end sits on its joint

export const trackLength = (track) => (track.elements ?? []).reduce((s, el) => s + (el.length ?? 0), 0)

/**
 * Stations a track's height points sit at when they are read from the terrain:
 * begin and end, and for a track longer than HEIGHT_SPLIT_MIN evenly spaced
 * points at most HEIGHT_POINT_SPACING apart in between.
 */
export function heightStations(length) {
  if (!(length > 0)) return []
  if (length <= HEIGHT_SPLIT_MIN) return [0, length]
  const n = Math.ceil(length / HEIGHT_POINT_SPACING)
  return Array.from({ length: n + 1 }, (_, i) => (i === n ? length : length * i / n))
}

/** Point on an element at station `s` along it, in the track's plane. */
export function pointAtStationUtm(el, s, epsg) {
  const coords = el.geometry?.coordinates ?? []
  if (s >= el.length && el.endNode) return nodeUtm(el.endNode, coords[coords.length - 1], epsg)
  const start = nodeUtm(el.startNode, coords[0], epsg)
  if (s <= 0) return start
  if (el.elementType === 2 && el.r1 !== undefined) {
    return transitionPointAtUtm(start, el.bearing, el.length, el.r1, el.r2 ?? null, el.transitionType, s)
  }
  if (el.radius != null) return endPointCurvedUtm(start, el.bearing, s, el.radius)
  return endPointStraightUtm(start, el.bearing, s)
}

/** The element a track station falls in, with the station along that element. */
export function elementAtStation(elements, station) {
  let start = 0
  for (const [i, el] of (elements ?? []).entries()) {
    const length = el.length ?? 0
    if (station <= start + length + STATION_TOL) return { el, elIdx: i, s: Math.max(0, station - start) }
    start += length
  }
  const last = (elements ?? []).length - 1
  return last >= 0 ? { el: elements[last], elIdx: last, s: elements[last].length ?? 0 } : null
}

/** Where a track's height points sit on the ground, for sampling the terrain. */
export function trackSamplePoints(track, stations) {
  const epsg = track.epsg
  return stations.map(station => {
    const hit = elementAtStation(track.elements, station)
    const p = hit ? pointAtStationUtm(hit.el, hit.s, epsg) : null
    return { station, lngLat: p ? utmToWgs84(p.easting, p.northing, epsg) : null }
  })
}

/** Height at a track station, linearly between the points. */
export function heightAt(heights, station) {
  if (!heights?.length) return null
  if (station <= heights[0].station) return heights[0].z
  for (let i = 1; i < heights.length; i++) {
    const a = heights[i - 1], b = heights[i]
    if (station <= b.station) {
      const t = b.station === a.station ? 0 : (station - a.station) / (b.station - a.station)
      return a.z + (b.z - a.z) * t
    }
  }
  return heights[heights.length - 1].z
}

/**
 * The heights with a point added at `station` inside the stretch it falls in,
 * at the height of that stretch — the gradient is split there, not changed:
 * both halves keep its slope until the new point is edited. Null outside the
 * stretch the points cover and closer than `minGap` [m] to a point already
 * there. `index` is where the new point sits.
 */
export function insertHeightPoint(heights, station, minGap = 0.1) {
  if (!(heights?.length >= 2)) return null
  const i = heights.findIndex(p => p.station > station)
  if (i <= 0) return null
  if (station - heights[i - 1].station < minGap || heights[i].station - station < minGap) return null
  const z = Math.round(heightAt(heights, station) * 1000) / 1000
  return { heights: [...heights.slice(0, i), { station, z }, ...heights.slice(i)], index: i }
}

/**
 * The heights of the two halves of a track split at station `sJ`: both halves
 * meet at the interpolated height, the second one restarts its stations at 0.
 * A half is undefined when the track had no heights.
 *
 * A cut inside a vertical curve parts the curve with it (splitCurveAt): each
 * half takes its piece of the parabola, so both still run at the height the
 * track is built at, and meet there on the same gradient.
 */
export function splitHeights(heights, sJ) {
  if (!heights?.length) return [undefined, undefined]
  // A cut outside the stretch the heights cover leaves them whole on their own
  // side: the other half gets none rather than a height made up for it.
  if (sJ < heights[0].station - STATION_TOL) {
    return [undefined, heights.map(p => ({ ...p, station: p.station - sJ }))]
  }
  if (sJ > heights[heights.length - 1].station + STATION_TOL) return [heights, undefined]
  const curve = splitCurveAt(heights, sJ)
  if (curve) return curve
  // Where a point already sits on the cut it stays that point on both halves,
  // with everything it carries; otherwise the halves meet at the interpolated
  // height.
  const at = heights.find(p => Math.abs(p.station - sJ) <= STATION_TOL) ?? { z: heightAt(heights, sJ) }
  const a = [...heights.filter(p => p.station < sJ - STATION_TOL), { ...at, station: sJ }]
  const b = [{ ...at, station: 0 },
    ...heights.filter(p => p.station > sJ + STATION_TOL).map(p => ({ ...p, station: p.station - sJ }))]
  return [a, b]
}

/**
 * A cut at `sJ` inside the vertical curve of point i, as the two halves of
 * splitHeights — or null where the cut lies in no curve.
 *
 * A piece of a parabola is a vertical curve of the same radius again, between
 * the tangents at its two ends, and those meet halfway between the two in
 * station. So the half before the cut takes, in place of point i, the point
 * where the incoming gradient meets the tangent at the cut, rounded with the
 * same radius, and ends on the curve at the cut; the half after it starts there
 * and takes the point where that tangent meets the outgoing gradient. Each
 * curve then runs exactly from a tangent point to the cut, the points on
 * either side keep their gradients, and joinHeights puts point i back.
 */
function splitCurveAt(heights, sJ) {
  for (let i = 1; i < heights.length - 1; i++) {
    const t = tangentLength(heights, i)
    const p = heights[i]
    const x = sJ - p.station
    if (!t || Math.abs(x) >= t - STATION_TOL) continue
    const { before, after } = gradients(heights, i)
    const delta = after - before
    const sIn = p.station - t, sOut = p.station + t
    const zIn = p.z - before * t
    const zCut = p.z + before * x + (x + t) ** 2 * delta / (4 * t)
    const gCut = before + (x + t) * delta / (2 * t)
    const cut = { station: sJ, z: zCut }
    const a = [...heights.slice(0, i)]
    if (sJ - sIn > STATION_TOL) a.push({ station: (sIn + sJ) / 2, z: zIn + before * (sJ - sIn) / 2, rv: p.rv })
    a.push(cut)
    const b = [{ ...cut, station: 0 }]
    if (sOut - sJ > STATION_TOL) b.push({ station: (sOut - sJ) / 2, z: zCut + gCut * (sOut - sJ) / 2, rv: p.rv })
    b.push(...heights.slice(i + 1).map(q => ({ ...q, station: q.station - sJ })))
    return [a, b]
  }
  return null
}

/**
 * The inverse: the heights of a track joined from two, `b` picking up where `a`
 * ends after `aLength`. Where both state the joint — which is how splitHeights
 * leaves them — it is kept once, `a`'s, so a point's own gradient radius
 * survives the round trip. A half that carries no heights contributes none, and
 * the join then has them only over the stretch the other half had them for.
 * A vertical curve splitHeights parted at the joint is made one again.
 */
export function joinHeights(a, b, aLength) {
  const left  = a ?? []
  const right = (b ?? []).map(p => ({ ...p, station: p.station + aLength }))
  if (!left.length && !right.length) return undefined
  const last = left[left.length - 1]
  return mendCurveAt([...left, ...right.filter(p => !last || p.station > last.station + STATION_TOL)], left.length - 1)
}

/**
 * `points` with the vertical curve that splitCurveAt parted at point `j` made
 * one again: `j` a plain point on the curve between two points of the same
 * radius whose curves both end exactly on it. Those three become the point
 * where the outer gradients meet. Anything else is left as it is.
 */
function mendCurveAt(points, j) {
  const a = points[j - 1], c = points[j], b = points[j + 1]
  if (!a?.rv || c?.rv || !b?.rv || Math.abs(Math.abs(a.rv) - Math.abs(b.rv)) > 1e-9 * Math.abs(a.rv)) return points
  const ta = tangentLength(points, j - 1), tb = tangentLength(points, j + 1)
  if (!ta || !tb || Math.abs(ta - (c.station - a.station)) > STATION_TOL
    || Math.abs(tb - (b.station - c.station)) > STATION_TOL) return points
  // The tangents at the joint agree, so c lies on no gradient change of its own.
  const g = gradients(points, j)
  if (!g || Math.abs(g.after - g.before) > 1e-9) return points
  const gIn = gradients(points, j - 1)?.before, gOut = gradients(points, j + 1)?.after
  if (gIn == null || gOut == null || Math.abs(gOut - gIn) < 1e-12) return points
  // Where the line through a with gIn meets the one through b with gOut.
  const station = (b.z - a.z + gIn * a.station - gOut * b.station) / (gIn - gOut)
  const z = a.z + gIn * (station - a.station)
  return [...points.slice(0, j - 1), { station, z, rv: a.rv }, ...points.slice(j + 2)]
}

/**
 * The heights of a track whose stretch from `at` on has been re-shaped — an
 * element's length edited, a track spliced. What lies before `at` keeps its
 * points, and `at` itself gets one at the height the gradient has there (the
 * rounded one, see splitHeights), so the kept gradient reaches the element
 * boundary; the rest is dropped and the stretch stays without a gradient
 * until it is read from the terrain on request (see elevationFill).
 * Undefined when nothing is left to keep.
 */
export function truncateHeights(heights, at) {
  if (!heights?.length || !(at > 0)) return undefined
  const [kept] = splitHeights(heights, at)
  return kept?.length >= 2 ? kept : undefined
}

/**
 * The heights of the stretch [from, to] of a track, restationed to begin at 0:
 * cut at both ends the way splitHeights cuts, so where the gradient runs over
 * a cut it gets a point there. Undefined where the stretch keeps fewer than
 * two points.
 */
export function sliceHeights(heights, from, to) {
  const [head] = splitHeights(heights, to)
  const [, piece] = splitHeights(head, from)
  return piece?.length >= 2 ? piece : undefined
}

/** The heights of a track that has been reversed: mirrored about its length. */
export function reverseHeights(heights, length) {
  if (!heights?.length) return heights
  return [...heights].reverse().map(p => ({ ...p, station: length - p.station }))
}

/**
 * The profile of a track for drawing: its height points with their index, and
 * where its elements begin. Elements are only the backdrop here — the points
 * do not belong to them.
 */
export function trackProfile(track) {
  const boundaries = []
  let station = 0
  ;(track.elements ?? []).forEach((el, elIdx) => {
    boundaries.push({ station, elIdx, el })
    station += el.length ?? 0
  })
  const points = (track.heights ?? []).map((p, index) => ({ ...p, index }))
  return { points, boundaries, length: station }
}

const sameNode = (a, b) => Array.isArray(a) && Array.isArray(b) && Math.abs(a[0] - b[0]) < 0.001 && Math.abs(a[1] - b[1]) < 0.001

/**
 * Tracks joined to `track` at one of its ends: through a switch port at that
 * end, or end to end at the same node. Each comes with the end it joins with.
 * At a switch that is up to two tracks per side.
 */
export function adjacentTracks(tracks, switches, track, end) {
  const found = new Map()   // trackId → { track, endpoint }
  const add = (id, endpoint) => {
    const other = id !== track.id && tracks.find(t => t.id === id)
    if (other && !found.has(id)) found.set(id, { track: other, endpoint })
  }
  for (const sw of switches ?? []) {
    const ports = portsOf(sw)
    const here = ports.some(p => sw[p.trackKey] === track.id && sw[p.endKey] === end)
    if (!here) continue
    for (const p of ports) {
      if (sw[p.trackKey] && sw[p.trackKey] !== track.id) add(sw[p.trackKey], sw[p.endKey])
    }
  }
  const els = track.elements ?? []
  const node = end === 'BEGIN' ? els[0]?.startNode : els[els.length - 1]?.endNode
  for (const other of tracks) {
    if (other.id === track.id || Number(other.epsg) !== Number(track.epsg)) continue
    const oe = other.elements ?? []
    if (sameNode(oe[0]?.startNode, node)) add(other.id, 'BEGIN')
    else if (sameNode(oe[oe.length - 1]?.endNode, node)) add(other.id, 'END')
  }
  return [...found.values()].slice(0, 2)
}

/**
 * The first two height points of a joined track, counted from the joint: the
 * joint itself and the next one, as [{ d, z }] with d the distance from the
 * joint along that track. Empty when it has no heights there yet.
 */
export function neighbourStub({ track, endpoint }) {
  const h = track.heights
  if (!(h?.length >= 2)) return []
  if (endpoint === 'BEGIN') return [{ d: 0, z: h[0].z }, { d: h[1].station - h[0].station, z: h[1].z }]
  const a = h[h.length - 1], b = h[h.length - 2]
  return [{ d: 0, z: a.z }, { d: a.station - b.station, z: b.z }]
}

// ── Joints: the point where tracks meet carries one height ──────────────────

/**
 * The index of a track's height point at one of its ends, or null without
 * heights there — also where the heights stop short of that end.
 */
const endIndex = (track, end) => {
  const h = track?.heights ?? []
  if (!h.length) return null
  if (end === 'BEGIN') return h[0].station <= JOINT_TOL ? 0 : null
  return trackLength(track) - h[h.length - 1].station <= JOINT_TOL ? h.length - 1 : null
}

/** Which end of a track a height point index is at, or null for one in between. */
export function endOfIndex(track, index) {
  if (index === 0 && endIndex(track, 'BEGIN') === 0) return 'BEGIN'
  if (index > 0 && index === endIndex(track, 'END')) return 'END'
  return null
}

/**
 * Every height point sitting on the same joint as `ref` ({ trackId, index }),
 * the point itself included: the end points of the tracks joined there — the
 * three ends meeting in a switch are one point and must carry one height. A
 * point between the ends of its track is alone in its group.
 */
export function jointGroup(tracks, switches, ref) {
  const key = (r) => `${r.trackId}|${r.index}`
  const group = new Map()
  const first = tracks.find(t => t.id === ref.trackId)
  if (!first?.heights?.length) return []
  group.set(key(ref), { trackId: ref.trackId, index: ref.index })
  const startEnd = endOfIndex(first, ref.index)
  if (!startEnd) return [...group.values()]

  const queue = [{ track: first, end: startEnd }]
  const seen = new Set([`${first.id}|${startEnd}`])
  while (queue.length) {
    const { track, end } = queue.shift()
    for (const n of adjacentTracks(tracks, switches, track, end)) {
      const mark = `${n.track.id}|${n.endpoint}`
      if (seen.has(mark)) continue
      seen.add(mark)
      const index = endIndex(n.track, n.endpoint)
      if (index == null) continue
      group.set(key({ trackId: n.track.id, index }), { trackId: n.track.id, index })
      queue.push({ track: n.track, end: n.endpoint })
    }
  }
  return [...group.values()]
}

/** A height point with the stated fields of `entry` applied: z, and rv (null removes it). */
function patchedPoint(q, entry) {
  const out = { ...q }
  if (entry.z !== undefined) out.z = entry.z
  if (entry.rv !== undefined) {
    if (entry.rv == null) delete out.rv; else out.rv = entry.rv
  }
  return out
}

/**
 * The writes that give the points of `entries` ({ trackId, index, z?, rv? })
 * their stated height and vertical curve radius, and every point joined to
 * them the same ones, as Map(trackId → heights) for `setHeightsForTracks`. A
 * field left undefined stays as it is; rv null removes the curve. Later
 * entries build on the earlier ones, so several points of one track can move
 * at once.
 */
export function jointHeightUpdates(tracks, switches, entries) {
  const byTrack = new Map()
  for (const entry of entries) {
    for (const p of jointGroup(tracks, switches, entry)) {
      const heights = byTrack.get(p.trackId) ?? tracks.find(t => t.id === p.trackId)?.heights
      if (!heights?.[p.index]) continue
      byTrack.set(p.trackId, heights.map((q, i) => (i === p.index ? patchedPoint(q, entry) : q)))
    }
  }
  return byTrack
}

// ── Vertical curves ─────────────────────────────────────────────────────────

/** The gradients into and out of point `i`, or null where one of them is not there. */
function gradients(points, i) {
  const p = points[i], a = points[i - 1], b = points[i + 1]
  if (!p || !a || !b) return null
  const before = (p.z - a.z) / (p.station - a.station)
  const after  = (b.z - p.z) / (b.station - p.station)
  return Number.isFinite(before) && Number.isFinite(after) ? { before, after } : null
}

/**
 * Tangent length of the vertical curve at point `i` of `points` ([{ station,
 * z, rv }]): T = R·|Δi|/2 with Δi the change of gradient there. Null at the
 * ends, where there is no gradient change, and where the point has no curve.
 */
export function tangentLength(points, i) {
  const g = points[i]?.rv ? gradients(points, i) : null
  return g ? Math.abs(points[i].rv) * Math.abs(g.after - g.before) / 2 : null
}

/**
 * The vertical curve rounding the gradient change at point `i`, as
 * [{ station, z }] from one tangent point to the other.
 *
 * The height point is where the two gradients meet; the curve leaves the
 * incoming one a tangent length before it and rejoins the outgoing one a
 * tangent length after. It is drawn as the parabola of constant curvature
 * 1/R — which is what a vertical curve of radius R is at railway gradients,
 * and how R is defined for one. Null where there is no curve (see
 * tangentLength).
 */
export function verticalCurve(points, i, steps = 24) {
  const t = tangentLength(points, i)
  if (!t) return null
  const { before, after } = gradients(points, i)
  const p = points[i], delta = after - before
  return Array.from({ length: steps + 1 }, (_, k) => {
    const x = -t + 2 * t * k / steps
    return { station: p.station + x, z: p.z + before * x + (x + t) ** 2 * delta / (4 * t) }
  })
}

/**
 * Height of the rounded gradient at a station [m]: the tangent polygon of
 * `heightAt`, and inside a vertical curve the parabola `verticalCurve` draws.
 * This is the height the track is built at — the polygon is only where its
 * gradients meet. Null for a track without heights.
 */
export function gradientAt(heights, station) {
  const z = heightAt(heights, station)
  if (z == null) return null
  for (let i = 1; i < heights.length - 1; i++) {
    const t = tangentLength(heights, i)
    const p = heights[i]
    const x = station - p.station
    if (!t || Math.abs(x) >= t) continue
    const { before, after } = gradients(heights, i)
    return p.z + before * x + (x + t) ** 2 * (after - before) / (4 * t)
  }
  return z
}

/** Every vertical curve of a point list, for drawing them. */
export function verticalCurves(points, steps = 24) {
  return points.map((_, i) => verticalCurve(points, i, steps)).filter(Boolean)
}

