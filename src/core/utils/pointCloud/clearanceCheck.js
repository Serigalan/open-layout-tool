import { cantAngle, cantPivot, rotatePoint } from '../crossSectionUtils'

/**
 * The clearance check of a cloud slice (AP 11.5): which measured points lie
 * inside the clearance outline of the track, and how close the nearest one
 * outside comes to it.
 *
 * The outline is fixed to the track and leans with its cant (crossSection), so
 * the points are carried into the track's own frame — over its top of rail,
 * turned back by the cant about the same running circle — and tested against
 * the outline as the regelwerk states it. Points in an area the outline allows
 * to be reached into (`einragungen`: platform edges, signals) are marked but
 * not counted.
 *
 * The outline's lower edge is the running plane itself, so the measured rail
 * heads, check rails and the ballast shoulder touch it from inside by a few
 * millimetres of survey noise — and so would every measured offset between
 * planned and built top of rail. Points less than BOTTOM_BAND over the
 * running plane are therefore not checked; that band is a statement the
 * section makes about itself, not a hole in the regelwerk.
 */

/** Height over the running plane below which points are not checked [mm]. */
export const BOTTOM_BAND = 50
/** Points farther than this from the outline are not measured against it [mm]. */
const NEAR = 2000

/** Flag values per point. */
export const INSIDE = 1
export const ALLOWED = 2

function inside(ring, y, z) {
  let hit = false
  for (let a = 0, b = ring.length - 1; a < ring.length; b = a++) {
    const [ya, za] = ring[a], [yb, zb] = ring[b]
    if ((za > z) !== (zb > z) && y < (yb - ya) * (z - za) / (zb - za) + ya) hit = !hit
  }
  return hit
}

// The distance to the outline's sides and top. Its lower edge is the running
// plane: nothing is measured against it, and a point is never "deep" in the
// outline for being high over the rails.
function distanceToRing(ring, y, z) {
  let best = Infinity
  for (let a = 0; a + 1 < ring.length; a++) {
    const [ya, za] = ring[a], [yb, zb] = ring[a + 1]
    if (za <= 0 && zb <= 0) continue
    const dy = yb - ya, dz = zb - za
    const len2 = dy * dy + dz * dz
    const t = len2 ? Math.max(0, Math.min(1, ((y - ya) * dy + (z - za) * dz) / len2)) : 0
    best = Math.min(best, Math.hypot(y - (ya + t * dy), z - (za + t * dz)))
  }
  return best
}

/**
 * Check `points` (`{ count, y, z }`: y [m] across the track, z [m] absolute)
 * against the outline `ring` and its `areas` (track frame, mm, as
 * gaugeProfileRing/Areas give them) of a track whose top of rail is `zTrack`
 * [m, in the points' height system] with cant `cant` [mm].
 *
 * Returns `{ flags, inside, deepest, nearest }`: per point INSIDE, ALLOWED or
 * 0; how many points are inside; the one reaching deepest in (distance to
 * the outline [mm] and its index); and the nearest one outside, above the
 * bottom band and within NEAR of the outline (or null).
 */
export function checkClearance(points, { zTrack, cant = 0, ring, areas = [] }) {
  const flags = new Uint8Array(points.count)
  const angle = -cantAngle(cant)
  const [py, pz] = cantPivot(cant)
  let yMin = Infinity, yMax = -Infinity, zMax = -Infinity
  for (const [y, z] of ring) { yMin = Math.min(yMin, y); yMax = Math.max(yMax, y); zMax = Math.max(zMax, z) }
  let count = 0
  let deepest = null, nearest = null
  for (let k = 0; k < points.count; k++) {
    // Into the track's frame: mm over the top of rail, the cant turned back.
    const [ry, rz] = rotatePoint([points.y[k] * 1000 - py, (points.z[k] - zTrack) * 1000 - pz], angle)
    const y = ry + py, z = rz + pz
    if (z < BOTTOM_BAND) continue
    if (y < yMin - NEAR || y > yMax + NEAR || z > zMax + NEAR) continue
    if (inside(ring, y, z)) {
      if (areas.some(a => inside(a, y, z))) { flags[k] = ALLOWED; continue }
      flags[k] = INSIDE
      count++
      const depth = distanceToRing(ring, y, z)
      if (!deepest || depth > deepest.distance) deepest = { distance: depth, index: k }
    } else {
      const d = distanceToRing(ring, y, z)
      if (d <= NEAR && (!nearest || d < nearest.distance)) nearest = { distance: d, index: k }
    }
  }
  return { flags, inside: count, deepest, nearest }
}
