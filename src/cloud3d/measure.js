import { decodeCloudSegment, segmentPlacement } from '../utils/pointCloud/tiles'
import { sourceOf } from '../utils/pointCloud/cloudSource'

/**
 * Measuring in the 3D view (AP 13.11). A click picks the nearest point drawn
 * — from a level of 2 cm or coarser —, then the original (L0) is read around
 * it and the point of the original nearest to it taken: the coordinate is
 * always the original's, never a voxel's.
 */

/** How far around the picked point the original is searched [m]. */
const ORIGINAL_RADIUS = 0.1

/**
 * The original point nearest to `target` ([e, n, z] in the cloud's plane):
 * `{ e, n, z, intensity, rgb, distance }`, or null where the original has
 * none within ORIGINAL_RADIUS. `l0` is the index of level 0 (with `server`).
 */
export async function originalPoint(projectId, l0, target, radius = ORIGINAL_RADIUS) {
  const [te, tn, tz] = target
  const size = l0.tileSize
  l0.byTile ??= new Map(l0.tiles.map(t => [`${t[0]},${t[1]}`, t[2]]))
  const tiles = []
  for (let tx = Math.floor((te - radius) / size); tx <= Math.floor((te + radius) / size); tx++) {
    for (let ty = Math.floor((tn - radius) / size); ty <= Math.floor((tn + radius) / size); ty++) {
      const segs = l0.byTile.get(`${tx},${ty}`)
      if (segs) tiles.push({ tx, ty, segs })
    }
  }
  const segs = tiles.flatMap(t => t.segs.map(s => ({ ...t, s })))
  if (!segs.length) return null
  const bytes = await sourceOf(projectId, l0).readMany(segs.map(({ s }) => [s[0], s[1]]))
  let best = null
  segs.forEach(({ tx, ty, s }, k) => {
    const seg = decodeCloudSegment(l0, bytes[k], s[2])
    const p = segmentPlacement(l0, tx, ty, s[3])
    for (let i = 0; i < s[2]; i++) {
      const e = p.ox + seg.x[i] * p.sx, n = p.oy + seg.y[i] * p.sy, z = p.oz + seg.z[i] * p.sz
      const d = Math.hypot(e - te, n - tn, z - tz)
      if (d <= radius && (!best || d < best.distance)) {
        best = {
          e, n, z, distance: d, intensity: seg.intensity?.[i] ?? seg.i[i],
          rgb: seg.r ? [seg.r[i], seg.g[i], seg.b[i]] : null,
        }
      }
    }
  })
  return best
}

/** Between two measured points: slope distance, height difference and horizontal distance [m]. */
export function between(a, b) {
  const dh = b.z - a.z
  const horizontal = Math.hypot(b.e - a.e, b.n - a.n)
  return { distance: Math.hypot(horizontal, dh), dh, horizontal }
}

const f3 = (v) => (v == null ? '' : v.toFixed(3))

/**
 * The measured points as CSV: number, coordinates in the view's plane,
 * height, the track and station they lie at, across (right +) and over SO,
 * and to the point before: slope distance, height difference, horizontal.
 */
export function measurementsCsv(points, { crs, heightName = '' } = {}) {
  const head = [`# Messpunkte aus der 3D-Ansicht; Lage EPSG ${crs}${heightName ? `, Höhe ${heightName}` : ''}; quer rechts +`,
    'Nr;Rechtswert;Hochwert;Hoehe;Wolke;Gleis;Station;Quer;ueber_SO;Strecke;dH;Horizontal']
  const rows = points.map((p, i) => {
    const d = i > 0 ? between(points[i - 1], p) : null
    return [i + 1, f3(p.e), f3(p.n), f3(p.z), p.cloud ?? '', p.track ?? '', f3(p.station), f3(p.offset),
      f3(p.overSo), f3(d?.distance), f3(d?.dh), f3(d?.horizontal)].join(';')
  })
  return [...head, ...rows].join('\n') + '\n'
}
