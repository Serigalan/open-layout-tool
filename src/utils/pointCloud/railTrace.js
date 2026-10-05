import { cloudSectionPoints } from './cloudSection'
import { detectTrack } from './railDetect'

/**
 * Finding a track's rail heads in the point clouds of a project (phase 12):
 * the slice is read here, the heads are found by railDetect.
 */

/** Thickness of the slice the heads are looked for in [m] — the step of a trace. */
export const DETECT_THICKNESS = 0.5

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
export async function detectInClouds(projectId, clouds, { origin, bearing, crs, around = 0, window = 0.3, rail }) {
  const halfWidth = Math.abs(around) + window + 1.2
  const points = await slicePoints(projectId, clouds, {
    origin, bearing, crs, halfWidth, thickness: DETECT_THICKNESS,
  })
  return detectTrack(points, { around, window, rail })
}

/**
 * The height of the rail top a measured axis point stands for (Entscheidung
 * 130): `lower` the lower head (DB — the cant is measured up from it), `axis`
 * the mean of both, `left` / `right` that head. Heights in m.
 */
export function soHeight(det, reference = 'lower') {
  const { left, right } = det
  if (reference === 'axis')  return (left.z + right.z) / 2
  if (reference === 'left')  return left.z
  if (reference === 'right') return right.z
  return Math.min(left.z, right.z)
}

/** Cant below this is taken as none [m] — the two heads differ by noise. */
export const CANT_NOISE = 0.003

/** The cant of a detection [mm], positive = left raised, under CANT_NOISE none. */
export const cantMm = (det) => (Math.abs(det.cant) < CANT_NOISE ? 0 : Math.round(det.cant * 1000))
