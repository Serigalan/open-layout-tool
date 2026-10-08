import { readCloudPoints } from './cloudReader'
import {
  TileBuilder, encodeSegment, encodeGridSegment, splitIntoBands, intensityShift, colorShift, originalGrid,
  LEVELS,
} from './tiles'

/**
 * The import of one LAS/LAZ/E57 file into tiles: read chunk by chunk, convert
 * into the target plane, thin to the voxel, write each tile once the scanner
 * has moved on. Level 0 keeps every point, on the file's own grid and in its
 * own plane (Entscheidung 145) — the mapper is then not used. Nothing of the
 * file is held beyond the tiles still open, so a file of several gigabytes
 * goes through in a bounded heap (Entscheidung 120).
 *
 * The local import makes one level — the 2-cm voxel or the original
 * (importPointCloud); the server makes all five in the same pass (decision
 * 206, importLevels), each into a tile file of its own.
 *
 * `writer.append(bytes)` stores a segment and returns its offset in the tile
 * file — the worker backs it with OPFS, the server with a file, a test with
 * memory. What comes back per level is the body of its index: which tiles
 * there are and where their segments lie, and what the cloud covers.
 */

/**
 * Index format version. 1 was the 2-cm voxel, 2 the original resolution;
 * 3 (AP 13.4) adds the level, its unit and colour. All three stay readable.
 */
const INDEX_VERSION = 3

/**
 * How long the import computes before it lets the event loop run [ms]. Decoding
 * a read window is microtasks only, so without a pause an abort message would
 * wait for the next window — up to 8 MB of LAZ later.
 */
const YIELD_EVERY = 100
const pause = () => new Promise(resolve => setTimeout(resolve, 0))

/** The colour shift of a file: E57 colours come scaled to 16 bits, LAS ones as written. */
function fileColorShift(header, batch) {
  if (header.format === 'e57') return 8
  let max = 0
  for (let k = 0; k < batch.count; k++) max = Math.max(max, batch.red[k], batch.green[k], batch.blue[k])
  return max === 0 ? 8 : colorShift(max)
}

/**
 * Every level in `levels` (indices into LEVELS) in one pass: `writers[level]`
 * stores its segments. Returns `{ [level]: index body }`.
 */
export async function importLevels({
  source, header, lazPerf = null, mapper = (e, n) => [e, n], writers, levels,
  onProgress, signal, idlePoints,
}) {
  const rgb = !!header.rgb
  const bounds = { minE: Infinity, minN: Infinity, minZ: Infinity, maxE: -Infinity, maxN: -Infinity, maxZ: -Infinity }
  const grid = levels.includes(0) ? originalGrid(header) : null
  const sinks = levels.map((level) => {
    const def = LEVELS[level]
    const sink = { def, tiles: new Map(), bytes: 0, segments: 0, writer: writers[level] }
    sink.builder = new TileBuilder({
      idlePoints, rgb,
      ...(level === 0 ? { grid } : { level: def }),
      onTile: (tx, ty, cols) => {
        for (const band of splitIntoBands(cols)) {
          const seg = level === 0 ? encodeGridSegment(band) : encodeSegment(band)
          const offset = sink.writer.append(seg.bytes)
          const key = `${tx},${ty}`
          if (!sink.tiles.has(key)) sink.tiles.set(key, [tx, ty, []])
          sink.tiles.get(key)[2].push([offset, seg.bytes.length, seg.count, seg.z0])
          sink.bytes += seg.bytes.length
          sink.segments++
        }
      },
    })
    return sink
  })
  const original = sinks.find(s => s.def.level === 0)
  const voxels = sinks.filter(s => s.def.level !== 0)
  // A level other than the original converts only when asked to; the
  // original stays in the file's plane.
  const convert = voxels.length > 0

  let shift = null, cshift = null
  const started = Date.now()
  let lastPause = started
  const bytesWritten = () => sinks.reduce((n, s) => n + s.bytes, 0)
  const kept = () => (voxels[0] ?? original).builder.kept
  for await (const batch of readCloudPoints(source, header, { lazPerf, signal, onProgress: (p) => {
    const elapsed = (Date.now() - started) / 1000
    const share = p.totalBytes ? p.bytes / p.totalBytes : 0
    onProgress?.({
      ...p, kept: kept(), bytesWritten: bytesWritten(), elapsed,
      remaining: share > 0 ? elapsed * (1 - share) / share : null,
    })
  } })) {
    if (shift == null) {
      let max = 0
      for (let k = 0; k < batch.count; k++) if (batch.intensity[k] > max) max = batch.intensity[k]
      shift = intensityShift(max)
      if (rgb) cshift = fileColorShift(header, batch)
    }
    const { red, green, blue } = batch
    for (let k = 0; k < batch.count; k++) {
      const fe = batch.x[k], fn = batch.y[k], z = batch.z[k]
      const [e, n] = convert ? mapper(fe, fn) : [fe, fn]
      if (!Number.isFinite(e) || !Number.isFinite(n) || !Number.isFinite(z)) continue
      if (e < bounds.minE) bounds.minE = e
      if (e > bounds.maxE) bounds.maxE = e
      if (n < bounds.minN) bounds.minN = n
      if (n > bounds.maxN) bounds.maxN = n
      if (z < bounds.minZ) bounds.minZ = z
      if (z > bounds.maxZ) bounds.maxZ = z
      let r = 0, g = 0, b = 0
      if (rgb) {
        r = Math.min(255, red[k] >> cshift); g = Math.min(255, green[k] >> cshift); b = Math.min(255, blue[k] >> cshift)
      }
      if (original) original.builder.add(fe, fn, z, batch.intensity[k], r, g, b)
      if (voxels.length) {
        const i = Math.min(255, batch.intensity[k] >> shift)
        for (const s of voxels) s.builder.add(e, n, z, i, r, g, b)
      }
    }
    for (const s of sinks) s.builder.flushIdle()
    if (Date.now() - lastPause > YIELD_EVERY) {
      await pause()
      lastPause = Date.now()
      if (signal?.aborted) throw Object.assign(new Error('aborted'), { name: 'AbortError' })
    }
  }
  for (const s of sinks) s.builder.flushAll()

  return Object.fromEntries(sinks.map(s => [s.def.level, {
    version: INDEX_VERSION,
    level: s.def.level,
    tileSize: s.def.tileSize,
    ...(s.def.level === 0
      ? { resolution: 'original', voxel: null, grid }
      : { resolution: 'voxel', voxel: s.def.voxel, perMetre: s.def.perMetre }),
    rgb,
    sourcePoints: header.pointCount,
    points: s.builder.kept,
    bytes: s.bytes,
    segments: s.segments,
    intensityShift: shift ?? 0,
    bounds,
    tiles: [...s.tiles.values()],
  }]))
}

/**
 * One level, as the local import makes it: the 2-cm voxel converted by
 * `mapper` into the project's plane, or with `original` every point in the
 * file's. Returns the index body.
 */
export async function importPointCloud({ writer, original = false, ...rest }) {
  const level = original ? 0 : 1
  const out = await importLevels({ ...rest, levels: [level], writers: { [level]: writer } })
  return out[level]
}
