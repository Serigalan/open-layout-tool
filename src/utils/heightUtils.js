import { nodeUtm, endPointStraightUtm, endPointCurvedUtm } from './elementUtils'
import { transitionPointAtUtm } from './clothoidUtils'
import { utmToWgs84 } from './coordinateUtils'
import { HEIGHT_POINT_SPACING, HEIGHT_SPLIT_MIN } from './mapConstants'

// The vertical alignment of a track is its own thing, independent of the
// horizontal elements it runs over: `track.heights` is [{ station, z, rv? }]
// with station the distance along the track [m] from its BEGIN, z the height
// [m] and rv the radius of the vertical curve rounding the gradient change
// there, absent where there is none. Ascending in station, the first at 0 and
// the last at the track's length — the two that meet the neighbouring tracks.
// The heights are design values — first taken from the terrain, then edited.
// A track without them yet has no `heights` at all.

const STATION_TOL = 1e-6   // m — two stations this close are the same point

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
 * The heights of the two halves of a track split at station `sJ`: both halves
 * meet at the interpolated height, the second one restarts its stations at 0.
 * A half is undefined when the track had no heights.
 */
export function splitHeights(heights, sJ) {
  if (!heights?.length) return [undefined, undefined]
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
 * The heights of a track whose stretch from `at` on has been re-shaped — an
 * element's length edited, a track spliced. What lies before `at` keeps its
 * points and the point at `at` itself is kept as the new end; the rest is
 * dropped, so the terrain reads it again (see elevationFill). Undefined when
 * nothing is left to keep.
 */
export function truncateHeights(heights, at) {
  if (!heights?.length || !(at > 0)) return undefined
  const kept = heights.filter(p => p.station <= at + STATION_TOL)
  return kept.length >= 2 ? kept : undefined
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
  const PORTS = ['portA', 'portB1', 'portB2']
  for (const sw of switches ?? []) {
    const here = PORTS.some(p => sw[`${p}_trackId`] === track.id && sw[`${p}_endpoint`] === end)
    if (!here) continue
    for (const p of PORTS) if (sw[`${p}_trackId`] && sw[`${p}_trackId`] !== track.id) add(sw[`${p}_trackId`], sw[`${p}_endpoint`])
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

/** The index of a track's height point at one of its ends, or null without heights. */
const endIndex = (track, end) => {
  const n = track?.heights?.length ?? 0
  return n ? (end === 'BEGIN' ? 0 : n - 1) : null
}

/** Which end of a track a height point index is at, or null for one in between. */
export function endOfIndex(track, index) {
  const n = track?.heights?.length ?? 0
  if (index === 0) return 'BEGIN'
  if (n && index === n - 1) return 'END'
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

/** Every vertical curve of a point list, for drawing them. */
export function verticalCurves(points, steps = 24) {
  return points.map((_, i) => verticalCurve(points, i, steps)).filter(Boolean)
}

