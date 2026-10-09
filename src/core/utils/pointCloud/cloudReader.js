import { readLasHeader, readLasPoints } from './lasReader'
import { isE57, readE57Header, readE57Points } from './e57Reader'

/**
 * One way into every point cloud format the import reads — LAS, LAZ and E57,
 * told apart by the file's first bytes, not its name. The header carries its
 * `format` ('e57'; a LAS/LAZ header has none), and the points come as the same
 * batches from either reader.
 */

/** The header of the file behind a source. */
export async function readCloudHeader(source) {
  const head = await source.read(0, Math.min(source.size, 8))
  return isE57(head) ? readE57Header(source) : readLasHeader(source)
}

/** The points, batch by batch (see readLasPoints and readE57Points for the options). */
export function readCloudPoints(source, header, options) {
  return header.format === 'e57' ? readE57Points(source, header, options) : readLasPoints(source, header, options)
}

/**
 * The first `n` points of a file, as `[{ x, y, z, intensity }]` — for reading
 * them as a human would (lasText). Only the first chunk or block is decoded;
 * leaving the loop early closes the reader and frees what it holds.
 */
export async function readFirstPoints(source, header, n, { lazPerf = null } = {}) {
  const out = []
  if (!(n > 0)) return out
  for await (const b of readCloudPoints(source, header, { lazPerf })) {
    for (let i = 0; i < b.count && out.length < n; i++) {
      out.push({ x: b.x[i], y: b.y[i], z: b.z[i], intensity: b.intensity[i] })
    }
    if (out.length >= n) break
  }
  return out
}
