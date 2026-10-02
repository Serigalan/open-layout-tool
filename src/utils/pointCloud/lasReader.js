import { parseLasHeader, HEADER_PROBE_BYTES, VARIABLE_CHUNK_SIZE } from './lasHeader'
import { decodeChunkTable } from './lazChunkTable'

/**
 * Reading the points of a LAS or LAZ file in pieces, never the whole file at
 * once: a delivery is a few long files of several gigabytes each
 * (Entscheidung 120). The file is reached through a `source` —
 * `{ size, read(offset, length) → Promise<Uint8Array> }` — which in the
 * browser is `File.slice` (fileSource) and in a test the file system.
 *
 * LAZ is decoded chunk by chunk with laz-perf (WASM): its `ChunkDecoder` is
 * handed one chunk at a time, found through the chunk table (lazChunkTable).
 * Plain LAS goes the same way, read in blocks.
 *
 * What comes out is a batch per chunk: x, y, z in the file's own units
 * (metres, scale and offset applied) and the intensity as stored.
 */

/** Read windows hold whole chunks up to about this many bytes. */
const WINDOW_BYTES = 8 * 1024 * 1024
/** Points per batch of a plain LAS file. */
const LAS_BATCH = 50000
/** How much of the file end is read for the chunk table, at most. */
const MAX_TABLE_BYTES = 64 * 1024 * 1024

/** A source over a browser `File` (or `Blob`). */
export const fileSource = (file) => ({
  size: file.size,
  read: async (offset, length) => new Uint8Array(await file.slice(offset, offset + length).arrayBuffer()),
})

const abortError = () => Object.assign(new Error('aborted'), { name: 'AbortError' })

/** The header of the file behind a source. */
export async function readLasHeader(source) {
  return parseLasHeader(await source.read(0, Math.min(source.size, HEADER_PROBE_BYTES)))
}

/**
 * Where each chunk of a LAZ file lies: `[{ offset, bytes, points }]`. The
 * table's position is the 64-bit integer at the start of the point data; -1
 * there means a writer that could not seek back, and the position is then
 * the last eight bytes of the file.
 */
async function lazChunks(source, header) {
  const head = await source.read(header.pointDataOffset, 8)
  let tableAt = Number(new DataView(head.buffer, head.byteOffset, 8).getBigInt64(0, true))
  if (tableAt === -1) {
    const tail = await source.read(source.size - 8, 8)
    tableAt = Number(new DataView(tail.buffer, tail.byteOffset, 8).getBigInt64(0, true))
  }
  if (!(tableAt > header.pointDataOffset) || tableAt >= source.size) throw new Error('LAZ chunk table not found')
  const table = await source.read(tableAt, Math.min(source.size - tableAt, MAX_TABLE_BYTES))
  const { chunkSize } = header.laszip
  const entries = decodeChunkTable(table, chunkSize)
  let offset = header.pointDataOffset + 8
  let remaining = header.pointCount
  return entries.map(e => {
    const points = chunkSize === VARIABLE_CHUNK_SIZE ? e.points : Math.min(chunkSize, remaining)
    remaining -= points
    const chunk = { offset, bytes: e.bytes, points }
    offset += e.bytes
    return chunk
  })
}

const newBatch = (n) => ({
  count: n,
  x: new Float64Array(n), y: new Float64Array(n), z: new Float64Array(n),
  intensity: new Uint16Array(n),
})

/**
 * The points of a LAS/LAZ file, batch by batch (an async generator).
 *
 * - `lazPerf`: the laz-perf module (`await createLazPerf()`), needed for LAZ.
 * - `onProgress({ bytes, totalBytes, points, totalPoints })` after each batch.
 * - `signal`: an AbortSignal; aborting throws an AbortError at the next batch.
 */
export async function* readLasPoints(source, header, { lazPerf = null, onProgress, signal } = {}) {
  const [sx, sy, sz] = header.scale
  const [ox, oy, oz] = header.offset
  const totalPoints = header.pointCount
  let totalBytes = source.size - header.pointDataOffset
  let points = 0

  if (!header.compressed) {
    const len = header.pointLength
    for (let first = 0; first < totalPoints; first += LAS_BATCH) {
      if (signal?.aborted) throw abortError()
      const n = Math.min(LAS_BATCH, totalPoints - first)
      const bytes = await source.read(header.pointDataOffset + first * len, n * len)
      const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
      const batch = newBatch(n)
      for (let i = 0; i < n; i++) {
        const at = i * len
        batch.x[i] = view.getInt32(at, true) * sx + ox
        batch.y[i] = view.getInt32(at + 4, true) * sy + oy
        batch.z[i] = view.getInt32(at + 8, true) * sz + oz
        batch.intensity[i] = view.getUint16(at + 12, true)
      }
      points += n
      onProgress?.({ bytes: (first + n) * len, totalBytes, points, totalPoints })
      yield batch
    }
    return
  }

  if (!lazPerf) throw new Error('laz-perf is needed to read LAZ')
  const chunks = await lazChunks(source, header)
  // The points end where the chunk table begins.
  if (chunks.length) totalBytes = chunks[chunks.length - 1].offset + chunks[chunks.length - 1].bytes - header.pointDataOffset
  const decoder = new lazPerf.ChunkDecoder()
  const pointPtr = lazPerf._malloc(header.pointLength)
  let dataPtr = 0, dataCap = 0
  try {
    let c = 0
    while (c < chunks.length) {
      if (signal?.aborted) throw abortError()
      // A window of whole chunks, read in one go.
      const start = chunks[c].offset
      let end = c
      while (end + 1 < chunks.length && chunks[end + 1].offset + chunks[end + 1].bytes - start <= WINDOW_BYTES) end++
      const window = await source.read(start, chunks[end].offset + chunks[end].bytes - start)
      for (; c <= end; c++) {
        if (signal?.aborted) throw abortError()
        const chunk = chunks[c]
        if (chunk.bytes > dataCap) {
          if (dataPtr) lazPerf._free(dataPtr)
          dataCap = chunk.bytes
          dataPtr = lazPerf._malloc(dataCap)
        }
        lazPerf.HEAPU8.set(window.subarray(chunk.offset - start, chunk.offset - start + chunk.bytes), dataPtr)
        decoder.open(header.pointFormat, header.pointLength, dataPtr)
        const n = chunk.points
        const batch = newBatch(n)
        const i32 = pointPtr >> 2, u16 = (pointPtr + 12) >> 1
        for (let i = 0; i < n; i++) {
          decoder.getPoint(pointPtr)
          // Read after every call: the heap views are replaced when WASM memory grows.
          const heap32 = lazPerf.HEAP32
          batch.x[i] = heap32[i32] * sx + ox
          batch.y[i] = heap32[i32 + 1] * sy + oy
          batch.z[i] = heap32[i32 + 2] * sz + oz
          batch.intensity[i] = lazPerf.HEAPU16[u16]
        }
        points += n
        onProgress?.({ bytes: chunk.offset + chunk.bytes - header.pointDataOffset, totalBytes, points, totalPoints })
        yield batch
      }
    }
  } finally {
    if (dataPtr) lazPerf._free(dataPtr)
    lazPerf._free(pointPtr)
    decoder.delete()
  }
}

/**
 * The first `n` points of a file, as `[{ x, y, z, intensity }]` — for reading
 * them as a human would (lasText). Only the first chunk or block is decoded;
 * leaving the loop early closes the reader and frees what it holds.
 */
export async function readFirstPoints(source, header, n, { lazPerf = null } = {}) {
  const out = []
  if (!(n > 0)) return out
  for await (const b of readLasPoints(source, header, { lazPerf })) {
    for (let i = 0; i < b.count && out.length < n; i++) {
      out.push({ x: b.x[i], y: b.y[i], z: b.z[i], intensity: b.intensity[i] })
    }
    if (out.length >= n) break
  }
  return out
}


