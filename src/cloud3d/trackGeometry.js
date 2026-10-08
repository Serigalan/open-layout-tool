import { elementStations, pointOnElement } from '../utils/platformUtils'
import { sectionAtStation, crossSection, RUNNING_CIRCLE_DISTANCE } from '../utils/crossSectionUtils'
import { trackHeightAt } from '../utils/switchGradient'

/**
 * The planned tracks in the 3D view (AP 13.10): each a run of samples along
 * its axis at the height of the gradient (SO), with the two rails' running
 * circles beside it — the one the cant raises lifted by it — and what a
 * point in the view is relative to them (station, offset), for picking and
 * measuring (AP 13.11). Everything in metres in the view's plane.
 */

/** Spacing of the samples along a track [m]: a chord of it in R 300 misses the arc by 0.1 mm. */
const SAMPLE_STEP = 0.5

const HALF_RUNNING = RUNNING_CIRCLE_DISTANCE / 2000

/**
 * The samples of a track: `[{ s, e, n, z, bearing, cant }]` — z null where the
 * track has no gradient there. `toView(e, n)` carries a point of the track's
 * plane into the view's.
 */
export function trackSamples(track, { tracks = [], switches = [], toView = (e, n) => [e, n], step = SAMPLE_STEP } = {}) {
  const rows = elementStations(track)
  if (!track?.epsg || !rows.length) return []
  const out = []
  for (const row of rows) {
    const len = row.el.length ?? 0
    const n = Math.max(1, Math.ceil(len / step))
    // Each element from its own start; the last one closes the track.
    for (let i = 0; i < n + (row === rows[rows.length - 1] ? 1 : 0); i++) {
      const ds = Math.min(len, i * len / n)
      const s = row.start + ds
      const { utm, bearing } = pointOnElement(row.el, track.epsg, ds)
      const [e, nn] = toView(utm.easting, utm.northing)
      const z = trackHeightAt(tracks, switches, track, s)
      out.push({ s, e, n: nn, z: Number.isFinite(z) ? z : null, bearing, cant: sectionAtStation(track, s)?.cant ?? 0 })
    }
  }
  return out
}

/** The direction to the right of a bearing [degrees from grid north], as (de, dn). */
const rightOf = (bearing) => {
  const r = bearing * Math.PI / 180
  return [Math.cos(r), -Math.sin(r)]
}

/**
 * The three lines of a track as `[[e, n, z], …]` each — axis, left and right
 * running circle — broken where the gradient is missing (a list of runs per
 * line). The cant lifts the rail that is not the pivot: positive cant the
 * left one (crossSectionUtils.cantPivot).
 */
export function trackLines(samples) {
  const lines = { axis: [], left: [], right: [] }
  let run = null
  for (const p of samples) {
    if (p.z == null) { run = null; continue }
    if (!run) {
      run = { axis: [], left: [], right: [] }
      for (const k of Object.keys(lines)) lines[k].push(run[k])
    }
    const [re, rn] = rightOf(p.bearing)
    const lift = Math.abs(p.cant) / 1000
    run.axis.push([p.e, p.n, p.z])
    run.left.push([p.e - re * HALF_RUNNING, p.n - rn * HALF_RUNNING, p.z + (p.cant > 0 ? lift : 0)])
    run.right.push([p.e + re * HALF_RUNNING, p.n + rn * HALF_RUNNING, p.z + (p.cant < 0 ? lift : 0)])
  }
  return lines
}

/**
 * Where a point (e, n) of the view lies along the nearest of `tracks` —
 * `[{ id, samples }]` — within `reach` metres: `{ id, station, offset,
 * distance, z }` with offset positive to the right and z the gradient's height
 * there, or null.
 */
export function nearestOnTracks(tracks, e, n, reach = 50) {
  let best = null
  for (const t of tracks) {
    const p = t.samples
    for (let i = 0; i + 1 < p.length; i++) {
      const a = p[i], b = p[i + 1]
      const de = b.e - a.e, dn = b.n - a.n
      const len2 = de * de + dn * dn
      if (!(len2 > 0)) continue
      const u = Math.max(0, Math.min(1, ((e - a.e) * de + (n - a.n) * dn) / len2))
      const qe = a.e + u * de, qn = a.n + u * dn
      const d = Math.hypot(e - qe, n - qn)
      if (d > reach || (best && d >= best.distance)) continue
      // Right of the direction of travel is positive.
      const side = Math.sign(de * (n - a.n) - dn * (e - a.e)) || 1
      const z = a.z != null && b.z != null ? a.z + u * (b.z - a.z) : null
      best = { id: t.id, station: a.s + u * (b.s - a.s), offset: -side * d, distance: d, z, bearing: b.bearing ?? null }
    }
  }
  return best
}

/**
 * The cross section plane at a station (AP 13.10): the sample there, the
 * quad of the plane `halfWidth` either side from `below` under to `above`
 * over SO, and the clearance outline turned by the cant — all as `[e, n, z]`.
 */
export function sectionPlane(samples, station, { ring = [], halfWidth = 20, below = 2, above = 8 } = {}) {
  if (!samples.length) return null
  let i = samples.findIndex(p => p.s >= station)
  if (i < 0) i = samples.length - 1
  const a = samples[Math.max(0, i - 1)], b = samples[i]
  const u = b.s > a.s ? Math.max(0, Math.min(1, (station - a.s) / (b.s - a.s))) : 0
  const p = {
    e: a.e + u * (b.e - a.e), n: a.n + u * (b.n - a.n),
    z: a.z != null && b.z != null ? a.z + u * (b.z - a.z) : (b.z ?? a.z),
    bearing: b.bearing, cant: a.cant + u * (b.cant - a.cant),
  }
  if (p.z == null) return { at: p, quad: null, outline: [] }
  const [re, rn] = rightOf(p.bearing)
  const at = (y, z) => [p.e + re * y, p.n + rn * y, p.z + z]
  const quad = [at(-halfWidth, -below), at(halfWidth, -below), at(halfWidth, above), at(-halfWidth, above)]
  const outline = crossSection({ cant: p.cant, gaugeRing: ring }).gauge.map(([y, z]) => at(y / 1000, z / 1000))
  return { at: p, quad, outline }
}
