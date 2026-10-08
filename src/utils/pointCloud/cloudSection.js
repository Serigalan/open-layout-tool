import { sourceOf, forgetSource, forgetSources } from './cloudSource'
import { decodeCloudSegment, segmentPlacement } from './tiles'
import { sliceFrame, tilesInSlice, sliceSegment, SlicePoints } from './cloudSlice'
import { planeMapper } from './cloudCrs'
import { transformPlanePoint, transformGridBearing } from '../coordinateUtils'

/**
 * The points of the project's clouds in a cross section, read through each
 * cloud's source — the local tile store or the server (cloudSource). Walking
 * the slider moves the plane a little at a time, so the tiles it needs are
 * mostly the ones it just had: decoded segments are kept in a small cache,
 * and a station change costs only the filtering and the few tiles that come
 * new into reach.
 */

/**
 * Bytes of decoded segments kept, across all clouds. A segment of the original
 * resolution holds every point of its tile — up to some 100 000 — so the cache
 * counts bytes, not segments.
 */
const CACHE_BYTES = 64 * 1024 * 1024
const cache = new Map()   // "cloud key|offset" → decoded segment (insertion order = age)
let cachedBytes = 0

const segmentBytes = (seg) => seg.x.byteLength + seg.y.byteLength + seg.z.byteLength + seg.i.byteLength
  + (seg.intensity?.byteLength ?? 0) + (seg.r ? 3 * seg.r.byteLength : 0)

const forget = (key) => {
  cachedBytes -= segmentBytes(cache.get(key))
  cache.delete(key)
}

const remember = (key, seg) => {
  if (cache.has(key)) forget(key)
  cache.set(key, seg)
  cachedBytes += segmentBytes(seg)
  while (cachedBytes > CACHE_BYTES && cache.size > 1) forget(cache.keys().next().value)
}

/**
 * The decoded segments `wanted` (`[offset, length, count, z0]` entries) of a
 * cloud, by offset. What the cache lacks is read through the cloud's source
 * in one call — the source batches the reads.
 */
let decodeMs = 0

/** A cloud's key in the cache: a server cloud's levels are clouds of their own. */
const keyOf = (cloud) => (cloud.server ? `${cloud.id}@L${cloud.server.level}` : cloud.id)

async function segments(projectId, cloud, wanted) {
  const cloudKey = keyOf(cloud)
  decodeMs = 0
  const got = new Map()
  const missing = []
  for (const s of wanted) {
    const key = `${cloudKey}|${s[0]}`
    const hit = cache.get(key)
    if (hit) {
      cache.delete(key)
      cache.set(key, hit)
      got.set(s[0], hit)
    } else {
      missing.push(s)
    }
  }
  if (!missing.length) return got
  const bytes = await sourceOf(projectId, cloud).readMany(missing.map(s => [s[0], s[1]]))
  const t0 = performance.now()
  missing.forEach(([offset, , count], k) => {
    const seg = decodeCloudSegment(cloud, bytes[k], count)
    remember(`${cloudKey}|${offset}`, seg)
    got.set(offset, seg)
  })
  decodeMs += performance.now() - t0
  return got
}

/** Forget what was read of a cloud — after it was deleted. */
export function forgetCloud(cloudId) {
  for (const key of [...cache.keys()]) if (key.startsWith(`${cloudId}|`) || key.startsWith(`${cloudId}@`)) forget(key)
  forgetSource(cloudId)
}

/** Forget what was read of every cloud — after all of them were deleted. */
export function forgetAllClouds() {
  for (const key of [...cache.keys()]) forget(key)
  forgetSources()
}

/**
 * The points of `cloud` in the section through `origin` (`{ easting,
 * northing }` in plane `crs`, the track's) square to `bearing`: `{ count, y,
 * z, i }` — y [m] across, z [m] absolute in the cloud's height system,
 * i the intensity byte.
 */
export async function cloudSectionPoints(projectId, cloud, { origin, bearing, crs, halfWidth, thickness }) {
  const out = new SlicePoints(!!cloud.rgb)
  const frame = sliceFrame({ easting: origin.easting, northing: origin.northing, bearing, halfWidth, thickness })
  let tiles
  let toPlane = null
  if (Number(cloud.crs) === Number(crs)) {
    tiles = tilesInSlice(cloud, frame)
  } else {
    // Tiles are found in the cloud's plane, a little wider for the scale the
    // planes differ by; the points are then carried into the track's plane
    // and cut exactly there.
    const [e, n] = transformPlanePoint(origin.easting, origin.northing, crs, cloud.crs)
    const b = transformGridBearing(origin.easting, origin.northing, bearing, crs, cloud.crs)
    tiles = tilesInSlice(cloud, sliceFrame({
      easting: e, northing: n, bearing: b, halfWidth: halfWidth * 1.01 + 0.1, thickness: thickness + 0.2,
    }))
    toPlane = planeMapper(cloud.crs, crs)
  }
  const decoded = await segments(projectId, cloud, tiles.flatMap(([, , segs]) => segs))
  const t0 = performance.now()
  for (const [tx, ty, segs] of tiles) {
    for (const s of segs) {
      sliceSegment(out, decoded.get(s[0]), segmentPlacement(cloud, tx, ty, s[3]), frame, toPlane)
    }
  }
  // What the slice cost in computation alone, apart from waiting for the reads.
  out.sliceMs = performance.now() - t0
  out.decodeMs = decodeMs
  out.tiles = tiles.length
  return out
}
