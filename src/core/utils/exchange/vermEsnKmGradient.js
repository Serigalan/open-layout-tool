import {
  endPointCurvedUtm, endPointStraightUtm, nodeUtm, sampleTransitionUtm,
} from '../geometry'

// A Verm.ESN gradient is often stationed along the kilometrage line (the axis
// whose file name ends in `S`, e.g. `6340S.TRA`), not along the track it
// belongs to. Its points are then carried over: the station laid off on the
// kilometrage line, a perpendicular dropped there, and where it meets the
// track the point takes its height (Entscheidung 353).

/** Spacing of the points an axis is drawn with [m]: on R 190 a chord 0.5 m long departs from the arc by 0.2 mm. */
const STEP = 0.5
/** How far the perpendicular may meet the track beyond its ends, along its end tangents [m]. */
const BEYOND = 1000
/** Gradient and track begin and end together where they differ by at most this [m]. */
export const END_TOL = 0.02

/** The points of one element in the plane, `n` equal steps from its start, its end included. */
function elementLine(el, epsg) {
  const len = el.length ?? 0
  const start = nodeUtm(el.startNode, el.geometry?.coordinates?.[0], epsg)
  const n = Math.max(1, Math.ceil(len / STEP - 1e-9))
  if (el.elementType === 2) {
    return sampleTransitionUtm(start, el.bearing, len, el.r1 ?? null, el.r2 ?? null, el.transitionType, { steps: n })
  }
  const out = []
  for (let i = 0; i <= n; i++) {
    const s = len * i / n
    const p = el.radius != null ? endPointCurvedUtm(start, el.bearing, s, el.radius) : endPointStraightUtm(start, el.bearing, s)
    out.push([p.easting, p.northing])
  }
  return out
}

/**
 * An axis (vermEsnImport buildElements) as a line in the plane with the
 * station of every point: { e, n, s } — each element from the station its
 * record names (`stations`), so a kilometrage jump between two elements is
 * kept; where none is given, counted on from `startStation`.
 */
export function axisLine(elements, epsg, { startStation = 0, stations = null } = {}) {
  const e = [], n = [], s = []
  let at = startStation
  elements.forEach((el, i) => {
    const len = el.length ?? 0
    if (!(len > 0)) return
    const s0 = Number.isFinite(stations?.[i]) ? stations[i] : at
    const pts = elementLine(el, epsg)
    const m = pts.length - 1
    pts.forEach(([pe, pn], k) => {
      if (k === 0 && e.length && Math.hypot(pe - e[e.length - 1], pn - n[n.length - 1]) < 1e-6 && Math.abs(s0 - s[s.length - 1]) < 1e-6) return
      e.push(pe); n.push(pn); s.push(s0 + len * k / m)
    })
    at = s0 + len
  })
  return { e, n, s }
}

const unit = (de, dn) => { const l = Math.hypot(de, dn) || 1; return [de / l, dn / l] }

/**
 * The point at station `station` of a line (axisLine) and the direction it
 * runs there — beyond its ends along the tangent there. Null for an empty line.
 */
function pointAtStation(line, station) {
  const { e, n, s } = line
  const last = s.length - 1
  if (last < 1) return null
  let i = 0
  while (i < last - 1 && station > s[i + 1]) i++
  const [te, tn] = unit(e[i + 1] - e[i], n[i + 1] - n[i])
  if (station < s[0]) return { e: e[0] + te * (station - s[0]), n: n[0] + tn * (station - s[0]), te, tn }
  if (station > s[last]) return { e: e[last] + te * (station - s[last]), n: n[last] + tn * (station - s[last]), te, tn }
  const t = (station - s[i]) / ((s[i + 1] - s[i]) || 1)
  return { e: e[i] + (e[i + 1] - e[i]) * t, n: n[i] + (n[i + 1] - n[i]) * t, te, tn }
}

/**
 * Where the line through (`pe`, `pn`) in direction (`de`, `dn`) meets the
 * axis `line`, nearest to that point first: the station there, the distance
 * from the point.
 */
function meetings(line, pe, pn, de, dn) {
  const { e, n, s } = line
  const last = s.length - 1
  const segs = []
  for (let i = 0; i < last; i++) segs.push([e[i], n[i], e[i + 1], n[i + 1], s[i], s[i + 1]])
  if (last >= 1) {
    const [ae, an] = unit(e[0] - e[1], n[0] - n[1])
    segs.push([e[0], n[0], e[0] + ae * BEYOND, n[0] + an * BEYOND, s[0], s[0] - BEYOND])
    const [be, bn] = unit(e[last] - e[last - 1], n[last] - n[last - 1])
    segs.push([e[last], n[last], e[last] + be * BEYOND, n[last] + bn * BEYOND, s[last], s[last] + BEYOND])
  }
  const out = []
  for (const [x1, y1, x2, y2, s1, s2] of segs) {
    const qe = x2 - x1, qn = y2 - y1
    const den = de * qn - dn * qe
    if (Math.abs(den) < 1e-12) continue
    // pe + t·d = x1 + u·q
    const t = ((x1 - pe) * qn - (y1 - pn) * qe) / den
    const u = ((x1 - pe) * dn - (y1 - pn) * de) / den
    if (u < -1e-9 || u > 1 + 1e-9) continue
    out.push({ station: s1 + (s2 - s1) * u, distance: Math.abs(t) })
  }
  return out.sort((a, b) => a.distance - b.distance)
}

/**
 * The gradient `points` ([{ station, z, rv? }], stationed along the
 * kilometrage line `km`) carried over to the track `track` (both axisLine):
 * each point laid off on the line, the perpendicular dropped there, the
 * station where it meets the track (or its tangent beyond an end) the
 * nearest. A track that runs against the kilometrage
 * takes the points in its own direction. Radii stay as they are.
 *
 * Returns { points, lost } — `points` in the track's stationing, ascending,
 * null where fewer than two meet the track or they come out of order; `lost`
 * the stations of the points whose perpendicular misses it.
 */
export function gradientOnTrack(points, km, track) {
  const out = []
  const lost = []
  for (const p of points) {
    const at = pointAtStation(km, p.station)
    const hits = at ? meetings(track, at.e, at.n, -at.tn, at.te) : []
    const hit = hits[0]
    if (!hit) { lost.push(p.station); continue }
    out.push({ ...p, station: hit.station })
  }
  if (out.length < 2) return { points: null, lost }
  const ordered = out[out.length - 1].station < out[0].station ? out.reverse() : out
  for (let i = 1; i < ordered.length; i++) {
    if (!(ordered[i].station > ordered[i - 1].station)) return { points: null, lost }
  }
  return { points: ordered, lost }
}

/** How far a gradient's ends ([{ station }], in the track's stationing) lie from the track's ends [m], summed. */
export function endMismatch(points, from, to) {
  if (!points?.length) return Infinity
  return Math.abs(points[0].station - from) + Math.abs(points[points.length - 1].station - to)
}
