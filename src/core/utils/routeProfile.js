import { endOfIndex, trackLength } from './heightUtils'
import { partStation } from './routes'
import { worstSeverity } from './regelkatalog'

/**
 * The vertical alignment along a route (Paket RT, decision 251): the height
 * points of all its tracks over the route's stations, as one profile — and a
 * single track as the route of one part, so the height profile has one way
 * of drawing and editing both.
 *
 * Every point stays the point of its track (`owner`: { trackId, index, part
 * }). Where two parts meet, their end points are the same point and appear
 * once, `joint` and with both in `refs` — a write goes to the owner, and
 * jointHeightUpdates carries it to every track meeting there as it does
 * today. A part the route runs backwards contributes its points in reverse
 * and its stations mirrored.
 */

/** Two points closer than this along the route are the same point [m]. */
const SAME = 1e-3

/** A track-only "route": the one part, run as it is. */
export function trackAsRoute(track) {
  const length = trackLength(track)
  return { route: null, parts: [{ trackId: track.id, track, reversed: false, offset: 0, length }], length, gaps: [], ok: true }
}

/** The route station of a track's own station on one part. */
export const routeStationOfPart = (part, station) => part.offset + partStation(part, station)

/**
 * The profile of a resolved route: { length, parts, points, boundaries,
 * partStarts, byRef }.
 *
 * - `points` [{ index, station, z, rv?, la?, owner, refs, joint, trackEnd }] in the
 *   order of the route — `index` the position in this list, `trackEnd` the
 *   end of its own track the point sits on ('BEGIN' / 'END', null between).
 * - `boundaries` [{ station, el, part }] where each element begins, in route order.
 * - `partStarts` [{ station, part }] where each part begins after the first.
 * - `byRef(trackId, index)` the route index of a track's height point, or null.
 */
export function routeProfile(resolved) {
  const points = []
  const boundaries = []
  const partStarts = []
  const ref = new Map()
  for (const part of resolved?.parts ?? []) {
    const { track } = part
    if (part.offset > 0) partStarts.push({ station: part.offset, part })
    // Element boundaries: where each element begins as the route runs it.
    let s = 0
    const els = (track.elements ?? []).map(el => { const r = { el, from: s, to: s + (el.length ?? 0) }; s = r.to; return r })
    for (const r of part.reversed ? [...els].reverse() : els) {
      boundaries.push({ station: routeStationOfPart(part, part.reversed ? r.to : r.from), el: r.el, part })
    }
    const heights = track.heights ?? []
    const order = heights.map((_, i) => i)
    if (part.reversed) order.reverse()
    for (const index of order) {
      const h = heights[index]
      const station = routeStationOfPart(part, h.station)
      const trackEnd = endOfIndex(track, index)
      const owner = { trackId: track.id, index, part }
      const prev = points[points.length - 1]
      // The first point of a part on the last of the one before: one point.
      if (prev && prev.owner.part !== part && Math.abs(prev.station - station) <= SAME) {
        prev.joint = true
        prev.refs.push(owner)
        ref.set(`${track.id}|${index}`, prev.index)
        continue
      }
      const p = {
        index: points.length, station, z: h.z, ...(h.rv != null ? { rv: h.rv } : {}), ...(h.la != null ? { la: h.la } : {}), ...(h.reason ? { reason: h.reason } : {}),
        owner, refs: [owner], joint: false, trackEnd,
      }
      ref.set(`${track.id}|${index}`, p.index)
      points.push(p)
    }
  }
  return {
    length: resolved?.length ?? 0,
    parts: resolved?.parts ?? [],
    points, boundaries, partStarts,
    byRef: (trackId, index) => ref.get(`${trackId}|${index}`) ?? null,
  }
}

/**
 * What the Höhenplan rules said about each track (`checks`: trackId →
 * checkVertical result), on the route, in the shape checkVertical gives it —
 * { stretches, curves, severity } — so verticalFindings reads it as well:
 * stretches by the route index of the point they end at in the route's
 * direction, gradient changes by the route index of their point. Each track's
 * rules are its own; what the change at a joint between two tracks would
 * count is not judged here. `stretchAt` and `curveAt` index them.
 */
export function routeFindings(profile, checks) {
  const stretchAt = new Map()
  const curveAt = new Map()
  for (const part of profile.parts) {
    const check = checks.get(part.trackId)
    if (!check) continue
    for (const s of check.stretches ?? []) {
      const a = profile.byRef(part.trackId, s.index - 1), b = profile.byRef(part.trackId, s.index)
      if (a == null || b == null) continue
      stretchAt.set(Math.max(a, b), { ...s, grade: part.reversed ? -s.grade : s.grade, index: Math.max(a, b) })
    }
    for (const c of check.curves ?? []) {
      const i = profile.byRef(part.trackId, c.index)
      if (i == null) continue
      curveAt.set(i, { ...c, index: i, station: profile.points[i].station })
    }
  }
  const stretches = [...stretchAt.values()], curves = [...curveAt.values()]
  return { stretches, curves, stretchAt, curveAt, severity: worstSeverity([...stretches, ...curves].map(e => e.severity)) }
}

/** The elements of a route in its direction (`reverse` turns a track round), for reading it as one line. */
export function routeElements(resolved, reverse) {
  return (resolved?.parts ?? []).flatMap(p => (p.reversed ? reverse(p.track) : p.track).elements ?? [])
}
