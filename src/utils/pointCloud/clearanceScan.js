import { cloudSectionPoints } from './cloudSection'
import { checkClearance } from './clearanceCheck'
import { sectionOrigin, sectionAtStation } from '../crossSectionUtils'
import { gradientAt, trackLength } from '../heightUtils'

/**
 * The clearance check along a whole track (AP 11.5, the optional part): the
 * section is moved along it in steps, each step checking a slice as thick as
 * the step — so every point beside the track is looked at once — at the
 * gradient and cant of that station. What comes back are the stretches where
 * points reach into the outline.
 */

/** Step along the track and thickness of each slice [m]. */
const SCAN_STEP = 0.5

/**
 * Group stations with intrusions into stretches: neighbouring steps belong to
 * one stretch. `hits` are `{ station, inside, depth }` in station order.
 */
export function stretchesOf(hits, step = SCAN_STEP) {
  const out = []
  for (const h of hits) {
    const last = out[out.length - 1]
    if (last && h.station - last.to <= step * 1.5) {
      last.to = h.station
      last.inside += h.inside
      if (h.depth > last.depth) { last.depth = h.depth; last.deepestAt = h.station }
    } else {
      out.push({ from: h.station, to: h.station, inside: h.inside, depth: h.depth, deepestAt: h.station })
    }
  }
  return out
}

/**
 * Check `track` against the clouds from station `from` to `to`. Returns
 * `{ stretches, checked }` or throws an AbortError; `onProgress(share)` after
 * every step. A track without a gradient cannot be checked (`noGradient`).
 */
export async function scanClearance({
  projectId, clouds, track, ring, areas, from = 0, to = null, step = SCAN_STEP, onProgress, signal,
}) {
  if (!track?.heights?.length) return { noGradient: true, stretches: [], checked: 0 }
  const end = to ?? trackLength(track)
  const halfWidth = Math.max(...ring.map(([y]) => Math.abs(y))) / 1000 + 0.5
  const hits = []
  let checked = 0
  for (let s = from + step / 2; s < end; s += step) {
    if (signal?.aborted) throw Object.assign(new Error('aborted'), { name: 'AbortError' })
    const origin = sectionOrigin(track, s)
    const zTrack = gradientAt(track.heights, s)
    if (origin && zTrack != null) {
      const cant = sectionAtStation(track, s)?.cant ?? 0
      let inside = 0, depth = 0
      for (const cloud of clouds) {
        const points = await cloudSectionPoints(projectId, cloud, {
          origin: origin.utm, bearing: origin.bearing, crs: track.epsg, halfWidth, thickness: step,
        })
        const r = checkClearance(points, { zTrack, cant, ring, areas })
        inside += r.inside
        if (r.deepest) depth = Math.max(depth, r.deepest.distance)
      }
      if (inside) hits.push({ station: s, inside, depth })
      checked++
    }
    onProgress?.(Math.min(1, (s - from) / (end - from)))
  }
  return { stretches: stretchesOf(hits, step), checked }
}
