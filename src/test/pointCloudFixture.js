import { existsSync } from 'node:fs'
import { open } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { createLazPerf } from 'laz-perf'

/**
 * The point cloud sample `5550R_00004000m.laz` (8.8 MB, 3 239 356 points,
 * mobile mapping through a station, DHDN / GK zone 4 by its values) — survey
 * data from outside, kept out of the repository like the PEK file
 * (pekFixture). Tests that need it look under OLT_LAZ_FIXTURE or the project
 * notes and are skipped where it is not there.
 */
const CANDIDATES = [
  process.env.OLT_LAZ_FIXTURE,
  join(homedir(), '.claude/projects/-root-open-layout-tool/memory/testdata/5550R_00004000m.laz'),
].filter(Boolean)

export const LAZ_PATH = CANDIDATES.find(p => existsSync(p)) ?? null
export const hasLaz = LAZ_PATH !== null

/**
 * The same sample as E57, the way a scanner writes one: the points local to a
 * pose, in millimetre integers — made with libE57Format by
 * `python tools/e57fixtures.py <laz> <e57>`; looked for next to the LAZ file.
 */
const E57_CANDIDATE = LAZ_PATH?.replace(/\.laz$/i, '.e57')
export const E57_SAMPLE_PATH = E57_CANDIDATE && existsSync(E57_CANDIDATE) ? E57_CANDIDATE : null

/** The small E57 files kept in the repository (tools/e57fixtures.py) and what they hold. */
export const E57_FIXTURES = new URL('./fixtures/e57/', import.meta.url).pathname

/** A reader source over a file on disk, the way fileSource is one over a browser File. */
export async function nodeFileSource(path) {
  const fh = await open(path)
  const { size } = await fh.stat()
  return {
    size,
    read: async (offset, length) => {
      const buf = Buffer.alloc(length)
      await fh.read(buf, 0, length, offset)
      return new Uint8Array(buf.buffer, buf.byteOffset, length)
    },
    close: () => fh.close(),
  }
}

/** A source over bytes in memory. */
export const bytesSource = (bytes) => ({
  size: bytes.length,
  read: async (offset, length) => bytes.subarray(offset, offset + length),
})

let lazPerf = null
/** The laz-perf module, created once (the Node build finds its WASM itself). */
export async function nodeLazPerf() {
  lazPerf ??= await createLazPerf()
  return lazPerf
}

/**
 * A plain LAS 1.2 file (point format 1, 28 bytes a point, mm scale) holding
 * `points` — `[{ x, y, z, intensity }]` — for tests that need a file whose
 * every point is known. With `format: 3` (34 bytes) each point carries its
 * colour too, `red`, `green`, `blue` as stored (16 bits).
 */
export function makeLas(points, { offset = [0, 0, 0], scale = [0.001, 0.001, 0.001], format = 1 } = {}) {
  const HEADER = 227, LEN = format === 3 ? 34 : 28
  const bytes = new Uint8Array(HEADER + points.length * LEN)
  const v = new DataView(bytes.buffer)
  bytes.set([76, 65, 83, 70], 0)          // LASF
  bytes[24] = 1; bytes[25] = 2
  v.setUint16(94, HEADER, true)
  v.setUint32(96, HEADER, true)
  v.setUint32(100, 0, true)
  bytes[104] = format
  v.setUint16(105, LEN, true)
  v.setUint32(107, points.length, true)
  scale.forEach((s, i) => v.setFloat64(131 + 8 * i, s, true))
  offset.forEach((o, i) => v.setFloat64(155 + 8 * i, o, true))
  const ext = (k) => points.length
    ? points.reduce(([hi, lo], p) => [Math.max(hi, p[k]), Math.min(lo, p[k])], [-Infinity, Infinity])
    : [0, 0]
  ;['x', 'y', 'z'].forEach((k, i) => {
    const [hi, lo] = ext(k)
    v.setFloat64(179 + 16 * i, hi, true)
    v.setFloat64(187 + 16 * i, lo, true)
  })
  points.forEach((p, n) => {
    const at = HEADER + n * LEN
    v.setInt32(at, Math.round((p.x - offset[0]) / scale[0]), true)
    v.setInt32(at + 4, Math.round((p.y - offset[1]) / scale[1]), true)
    v.setInt32(at + 8, Math.round((p.z - offset[2]) / scale[2]), true)
    v.setUint16(at + 12, p.intensity ?? 0, true)
    if (format === 3) {
      v.setUint16(at + 28, p.red ?? 0, true)
      v.setUint16(at + 30, p.green ?? 0, true)
      v.setUint16(at + 32, p.blue ?? 0, true)
    }
  })
  return bytes
}
