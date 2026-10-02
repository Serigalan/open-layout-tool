import { cloudTilesFile } from './cloudStore'
import { decodeSegment } from './tiles'
import { sliceFrame, tilesInSlice, sliceSegment, SlicePoints } from './cloudSlice'
import { planeMapper } from './cloudCrs'
import { transformPlanePoint, transformGridBearing } from '../coordinateUtils'

/**
 * The points of the project's clouds in a cross section, read from the local
 * tile store. Walking the slider moves the plane a little at a time, so the
 * tiles it needs are mostly the ones it just had: decoded segments are kept
 * in a small cache, and a station change costs only the filtering and the
 * few tiles that come new into reach.
 */

/** Decoded segments kept, across all clouds — some 50 MB at the outside. */
const CACHE_SEGMENTS = 600
const cache = new Map()   // "cloudId|offset" → decoded segment (insertion order = age)
const files = new Map()   // "projectId|cloudId" → Promise<File>

/** Segments closer together than this in the tile file are read in one go [bytes]. */
const MERGE_GAP = 256 * 1024

const remember = (key, seg) => {
  cache.set(key, seg)
  while (cache.size > CACHE_SEGMENTS) cache.delete(cache.keys().next().value)
}

/**
 * The decoded segments `wanted` (`[offset, length, count, z0]` entries) of a
 * cloud, by offset. What the cache lacks is read in as few reads as there are
 * clusters in the file — a `File.slice` costs some milliseconds of its own,
 * and a section needs a few dozen segments.
 */
let decodeMs = 0

async function segments(projectId, cloudId, wanted) {
  decodeMs = 0
  const got = new Map()
  const missing = []
  for (const s of wanted) {
    const key = `${cloudId}|${s[0]}`
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
  const fileKey = `${projectId}|${cloudId}`
  if (!files.has(fileKey)) files.set(fileKey, cloudTilesFile(projectId, cloudId))
  const file = await files.get(fileKey)
  missing.sort((a, b) => a[0] - b[0])
  const ranges = []
  for (const s of missing) {
    const last = ranges[ranges.length - 1]
    if (last && s[0] - last.end <= MERGE_GAP) { last.segs.push(s); last.end = Math.max(last.end, s[0] + s[1]) }
    else ranges.push({ start: s[0], end: s[0] + s[1], segs: [s] })
  }
  await Promise.all(ranges.map(async ({ start, end, segs }) => {
    const bytes = new Uint8Array(await file.slice(start, end).arrayBuffer())
    const t0 = performance.now()
    for (const [offset, length, count] of segs) {
      const seg = decodeSegment(bytes.subarray(offset - start, offset - start + length), count)
      remember(`${cloudId}|${offset}`, seg)
      got.set(offset, seg)
    }
    decodeMs += performance.now() - t0
  }))
  return got
}

/** Forget what was read of a cloud — after it was deleted. */
export function forgetCloud(cloudId) {
  for (const key of [...cache.keys()]) if (key.startsWith(`${cloudId}|`)) cache.delete(key)
  for (const key of [...files.keys()]) if (key.endsWith(`|${cloudId}`)) files.delete(key)
}

/**
 * The points of `cloud` in the section through `origin` (`{ easting,
 * northing }` in plane `crs`, the track's) square to `bearing`: `{ count, y,
 * z, i }` — y [m] across, z [m] absolute in the cloud's height system,
 * i the intensity byte.
 */
export async function cloudSectionPoints(projectId, cloud, { origin, bearing, crs, halfWidth, thickness }) {
  const out = new SlicePoints()
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
  const decoded = await segments(projectId, cloud.id, tiles.flatMap(([, , segs]) => segs))
  const t0 = performance.now()
  for (const [tx, ty, segs] of tiles) {
    for (const s of segs) {
      sliceSegment(out, decoded.get(s[0]), { tx, ty, z0: s[3], tileSize: cloud.tileSize }, frame, toPlane)
    }
  }
  // What the slice cost in computation alone, apart from waiting for the reads.
  out.sliceMs = performance.now() - t0
  out.decodeMs = decodeMs
  out.tiles = tiles.length
  return out
}
