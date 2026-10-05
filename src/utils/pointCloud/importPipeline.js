import { readCloudPoints } from './cloudReader'
import { TileBuilder, encodeSegment, splitIntoBands, intensityShift, TILE_SIZE, VOXEL_SIZE } from './tiles'

/**
 * The import of one LAS/LAZ/E57 file into tiles: read chunk by chunk, convert
 * into the project's plane, thin to the voxel, write each tile once the
 * scanner has moved on. Nothing of the file is held beyond the tiles still
 * open, so a file of several gigabytes goes through in a bounded heap
 * (Entscheidung 120).
 *
 * `writer.append(bytes)` stores a segment and returns its offset in the tile
 * file — the worker backs it with OPFS, a test with memory. What comes back is
 * the body of the cloud's index: which tiles there are and where their
 * segments lie, and what the cloud covers.
 */

/** Index format version — bumped when the tile layout changes. */
const INDEX_VERSION = 1

/**
 * How long the import computes before it lets the event loop run [ms]. Decoding
 * a read window is microtasks only, so without a pause an abort message would
 * wait for the next window — up to 8 MB of LAZ later.
 */
const YIELD_EVERY = 100
const pause = () => new Promise(resolve => setTimeout(resolve, 0))

export async function importPointCloud({
  source, header, lazPerf = null, mapper = (e, n) => [e, n], writer,
  onProgress, signal, idlePoints,
}) {
  const tiles = new Map()   // "tx,ty" → [tx, ty, [[offset, length, count, z0], …]]
  let bytesWritten = 0, segments = 0
  let shift = null
  const bounds = { minE: Infinity, minN: Infinity, minZ: Infinity, maxE: -Infinity, maxN: -Infinity, maxZ: -Infinity }

  const builder = new TileBuilder({
    idlePoints,
    onTile: (tx, ty, cols) => {
      for (const band of splitIntoBands(cols)) {
        const seg = encodeSegment(band)
        const offset = writer.append(seg.bytes)
        const key = `${tx},${ty}`
        if (!tiles.has(key)) tiles.set(key, [tx, ty, []])
        tiles.get(key)[2].push([offset, seg.bytes.length, seg.count, seg.z0])
        bytesWritten += seg.bytes.length
        segments++
      }
    },
  })

  const started = Date.now()
  let lastPause = started
  for await (const batch of readCloudPoints(source, header, { lazPerf, signal, onProgress: (p) => {
    const elapsed = (Date.now() - started) / 1000
    const share = p.totalBytes ? p.bytes / p.totalBytes : 0
    onProgress?.({
      ...p, kept: builder.kept, bytesWritten, elapsed,
      remaining: share > 0 ? elapsed * (1 - share) / share : null,
    })
  } })) {
    if (shift == null) {
      let max = 0
      for (let k = 0; k < batch.count; k++) if (batch.intensity[k] > max) max = batch.intensity[k]
      shift = intensityShift(max)
    }
    for (let k = 0; k < batch.count; k++) {
      const [e, n] = mapper(batch.x[k], batch.y[k])
      const z = batch.z[k]
      if (!Number.isFinite(e) || !Number.isFinite(n) || !Number.isFinite(z)) continue
      if (e < bounds.minE) bounds.minE = e
      if (e > bounds.maxE) bounds.maxE = e
      if (n < bounds.minN) bounds.minN = n
      if (n > bounds.maxN) bounds.maxN = n
      if (z < bounds.minZ) bounds.minZ = z
      if (z > bounds.maxZ) bounds.maxZ = z
      builder.add(e, n, z, Math.min(255, batch.intensity[k] >> shift))
    }
    builder.flushIdle()
    if (Date.now() - lastPause > YIELD_EVERY) {
      await pause()
      lastPause = Date.now()
      if (signal?.aborted) throw Object.assign(new Error('aborted'), { name: 'AbortError' })
    }
  }
  builder.flushAll()

  return {
    version: INDEX_VERSION,
    tileSize: TILE_SIZE,
    voxel: VOXEL_SIZE,
    sourcePoints: header.pointCount,
    points: builder.kept,
    bytes: bytesWritten,
    segments,
    intensityShift: shift ?? 0,
    bounds,
    tiles: [...tiles.values()],
  }
}
