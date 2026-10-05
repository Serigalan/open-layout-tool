import { cloudSectionPoints } from './cloudSection'
import { detectTrack } from './railDetect'
import { sectionOrigin } from '../crossSectionUtils'
import { trackLength } from '../heightUtils'

/**
 * Finding a track's rail heads in the point clouds of a project (phase 12):
 * the slice is read here, the heads are found by railDetect. A trace walks a
 * guide — a track of the project or a line drawn by hand (Entscheidung 129) —
 * and keeps the axis point of every step; the points are what is exported
 * (Entscheidung 138).
 */

/** Thickness of the slice the heads are looked for in [m] — the step of a trace. */
export const DETECT_THICKNESS = 0.5
/** Step of a trace along its guide [m]. */
export const TRACE_STEP = 0.5
/**
 * How far off its guide the track may be [m] — a line drawn by hand, and a
 * track of the project too: measured against the cloud of line 5550 (km 0.5),
 * the track lay 0.53–0.84 m beside the axis of its own Verm.ESN alignment.
 * Neighbouring tracks stand 3.5 m and more apart.
 */
export const GUIDE_WINDOW = 1.5
/** How far off the axis foreseen from the last points the next one may be [m]. */
const FOLLOW_WINDOW = 0.1
/** The points that foresee the next one: within this distance back [m], at least this many. */
const FOLLOW_REACH = 4
const FOLLOW_MIN = 3
/**
 * Turns of the slice against the guide tried while nothing foresees the
 * track [degrees]: a line drawn by hand may be some degrees off, and a slice
 * 0.5 m thick at 5° smears a head across 4 cm — too much to find it.
 */
const SEARCH_TURNS = [0, 3, -3, 6, -6]

/**
 * The points of all `clouds` in one slice, as one set `{ count, y, z }` —
 * where clouds overlap, a head is seen by both.
 */
async function slicePoints(projectId, clouds, frame) {
  const parts = await Promise.all(clouds.map(cloud => cloudSectionPoints(projectId, cloud, frame)))
  if (parts.length === 1) return parts[0]
  const count = parts.reduce((n, p) => n + p.count, 0)
  const y = new Float32Array(count), z = new Float64Array(count)
  let at = 0
  for (const p of parts) {
    y.set(p.y.subarray(0, p.count), at)
    z.set(p.z.subarray(0, p.count), at)
    at += p.count
  }
  return { count, y, z }
}

/**
 * The track's heads in the clouds at one station: the slice square to
 * `bearing` through `origin` (in plane `crs`), searched `window` either side
 * of `around` [m across]. What detectTrack returns.
 */
export async function detectInClouds(projectId, clouds, { origin, bearing, crs, around = 0, window = GUIDE_WINDOW, rail }) {
  const halfWidth = Math.abs(around) + window + 1.2
  const points = await slicePoints(projectId, clouds, {
    origin, bearing, crs, halfWidth, thickness: DETECT_THICKNESS,
  })
  return detectTrack(points, { around, window, rail })
}

/**
 * A guide along a track of the project: `{ epsg, length, window, at(s) }`,
 * at(s) the point `{ easting, northing, bearing }` at station s.
 */
export function trackGuide(track) {
  return {
    epsg: track.epsg,
    length: trackLength(track),
    window: GUIDE_WINDOW,
    at: (s) => {
      const o = sectionOrigin(track, s)
      return o && { easting: o.utm.easting, northing: o.utm.northing, bearing: o.bearing }
    },
  }
}

/** A guide along a polyline drawn by hand, `vertices` [[E, N]] in plane `epsg`. */
export function lineGuide(vertices, epsg) {
  const pts = vertices.filter((v, i) => i === 0 || Math.hypot(v[0] - vertices[i - 1][0], v[1] - vertices[i - 1][1]) > 1e-6)
  const cum = [0]
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]))
  return {
    epsg,
    length: cum[cum.length - 1],
    window: GUIDE_WINDOW,
    at: (s) => {
      if (pts.length < 2) return null
      let i = 1
      while (i < pts.length - 1 && cum[i] < s) i++
      const [a, b] = [pts[i - 1], pts[i]]
      const t = Math.min(1, Math.max(0, (s - cum[i - 1]) / (cum[i] - cum[i - 1])))
      return {
        easting: a[0] + (b[0] - a[0]) * t,
        northing: a[1] + (b[1] - a[1]) * t,
        bearing: (Math.atan2(b[0] - a[0], b[1] - a[1]) * 180 / Math.PI + 360) % 360,
      }
    },
  }
}

/**
 * Where the next axis point should be, from the last ones within
 * FOLLOW_REACH: with FOLLOW_MIN of them, their offsets from the guide on a
 * straight line over the station; with fewer, the last one carried on in the
 * direction its slice was turned to. `{ offset, slope }` or null.
 */
export function foresee(points, station) {
  const recent = []
  for (let i = points.length - 1; i >= 0 && station - points[i].station <= FOLLOW_REACH; i--) recent.push(points[i])
  if (!recent.length) return null
  if (recent.length < FOLLOW_MIN) {
    const last = recent[0]
    const slope = Math.tan((last.turn ?? 0) * Math.PI / 180)
    return { offset: last.offset + slope * (station - last.station), slope }
  }
  const n = recent.length
  const ms = recent.reduce((a, p) => a + p.station, 0) / n
  const mo = recent.reduce((a, p) => a + p.offset, 0) / n
  const sxx = recent.reduce((a, p) => a + (p.station - ms) ** 2, 0)
  const slope = sxx > 0 ? recent.reduce((a, p) => a + (p.station - ms) * (p.offset - mo), 0) / sxx : 0
  return { offset: mo + slope * (station - ms), slope }
}

/** Stations without a track, grouped into stretches `{ from, to }`. */
export function gapsOf(stations, step = TRACE_STEP) {
  const out = []
  for (const s of stations) {
    const last = out[out.length - 1]
    if (last && s - last.to <= step * 1.5) last.to = s
    else out.push({ from: s, to: s })
  }
  return out
}

/**
 * Walk `guide` in steps of `step` and find the track's heads at every one.
 * Once a point is found, the next is looked for close to where the last ones
 * lead — the slice turned by their slope against the guide — and only where
 * it is not there in the guide's whole window; with none to go by, the slice
 * is tried turned by SEARCH_TURNS as well. Returns `{ points, gaps,
 * epsg }` or throws an AbortError.
 *
 * A point: `station` along the guide, `easting`/`northing` of the axis in
 * the guide's plane, `offset` from the guide [m], `turn` of its slice against
 * the guide [degrees], `zLeft`/`zRight` the head
 * tops, `cant` (left over right), `gauge` [m], `quality`.
 */
export async function traceTrack({
  projectId, clouds, guide, rail, step = TRACE_STEP, onProgress, signal, detect = detectInClouds,
}) {
  const points = [], missed = []
  const steps = Math.max(1, Math.floor(guide.length / step + 1e-9))
  for (let k = 0; k <= steps; k++) {
    if (signal?.aborted) throw Object.assign(new Error('aborted'), { name: 'AbortError' })
    const s = Math.min(k * step, guide.length)
    const g = guide.at(s)
    if (!g) continue
    const ahead = foresee(points, s)
    const look = (turn, around, window) => detect(projectId, clouds, {
      origin: { easting: g.easting, northing: g.northing }, bearing: g.bearing + turn, crs: guide.epsg, rail, around, window,
    })
    // Close to where the last points lead first, then their whole window,
    // then turned — the guide's direction may be off the track's.
    const base = ahead ? Math.atan(ahead.slope) * 180 / Math.PI : 0
    const around = ahead?.offset ?? 0
    const tries = [
      ...(ahead ? [[base, FOLLOW_WINDOW]] : []),
      ...SEARCH_TURNS.map(t => [base + t, guide.window]),
    ]
    let det = null, turn = 0
    for (const [t, window] of tries) {
      turn = t
      det = await look(t, around, window)
      if (!det.reason) break
    }
    if (det.reason) {
      missed.push(s)
    } else {
      const rad = (g.bearing + turn) * Math.PI / 180
      const easting = g.easting + Math.cos(rad) * det.axis
      const northing = g.northing - Math.sin(rad) * det.axis
      const gRad = g.bearing * Math.PI / 180
      points.push({
        station: s, easting, northing,
        offset: (easting - g.easting) * Math.cos(gRad) - (northing - g.northing) * Math.sin(gRad),
        turn,
        zLeft: det.left.z, zRight: det.right.z, cant: det.cant, gauge: det.gauge, quality: det.quality,
      })
    }
    onProgress?.(k / steps)
  }
  return { points, gaps: gapsOf(missed, step), epsg: guide.epsg }
}

/**
 * The height of the rail top an axis point stands for (Entscheidung 130):
 * `lower` the lower head (DB — the cant is measured up from it), `axis` the
 * mean of both, `left` / `right` that head. Takes a detection or a traced
 * point. Heights in m.
 */
export function soHeight(p, reference = 'lower') {
  const zl = p.zLeft ?? p.left.z, zr = p.zRight ?? p.right.z
  if (reference === 'axis')  return (zl + zr) / 2
  if (reference === 'left')  return zl
  if (reference === 'right') return zr
  return Math.min(zl, zr)
}

/** Cant below this is taken as none [m] — the two heads differ by noise. */
export const CANT_NOISE = 0.003

/** The cant of a detection or point [mm], positive = left raised, under CANT_NOISE none. */
export const cantMm = (p) => (Math.abs(p.cant) < CANT_NOISE ? 0 : Math.round(p.cant * 1000))

/** The columns of the exported axis points — fixed, the file is read back by the alignment fit. */
export const AXIS_CSV_HEADER = 'Nr;Station [m];Rechtswert [m];Hochwert [m];SO [m];Überhöhung [mm];Güte'
const QUALITY_WORD = { good: 'gut', doubtful: 'fraglich' }

/**
 * The traced points as a point file (Entscheidung 138): one line each,
 * semicolons, decimal points; the top of rail by `soReference`, the cant in
 * mm with the app's sign (positive = left rail higher, looking along the
 * trace).
 */
export function axisPointsCsv(points, { soReference = 'lower' } = {}) {
  const lines = points.map((p, i) => [
    i + 1,
    p.station.toFixed(3),
    p.easting.toFixed(4),
    p.northing.toFixed(4),
    soHeight(p, soReference).toFixed(4),
    cantMm(p),
    QUALITY_WORD[p.quality] ?? p.quality,
  ].join(';'))
  return [AXIS_CSV_HEADER, ...lines].join('\r\n') + '\r\n'
}
