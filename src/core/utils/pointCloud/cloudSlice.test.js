import { describe, it, expect } from 'vitest'
import { sliceFrame, tilesInSlice, sliceSegment, SlicePoints } from './cloudSlice'
import { importPointCloud } from './importPipeline'
import { readLasHeader, readLasPoints } from './lasReader'
import { decodeCloudSegment, decodeSegment, encodeSegment, segmentPlacement } from './tiles'
import { hasLaz, LAZ_PATH, nodeFileSource, nodeLazPerf } from '../../test/pointCloudFixture'

const slice = (index, bytes, frame, toPlane = null) => {
  const out = new SlicePoints()
  for (const [tx, ty, segs] of tilesInSlice(index, frame)) {
    for (const [offset, length, count, z0] of segs) {
      sliceSegment(out, decodeCloudSegment(index, bytes.subarray(offset, offset + length), count),
        segmentPlacement(index, tx, ty, z0), frame, toPlane)
    }
  }
  return out
}

describe('the slice of a cross section', () => {
  it('keeps the points within half the thickness of the plane, y to the right', () => {
    // A section due north (bearing 0) through (100, 200): along = +n, right = +e.
    const frame = sliceFrame({ easting: 100, northing: 200, bearing: 0, halfWidth: 3, thickness: 0.1 })
    const pts = [
      [100.5, 200.04, 1, 10],   // in: 0.5 m right, 4 cm ahead
      [99.0, 199.96, 2, 20],    // in: 1 m left
      [100.0, 200.06, 3, 30],   // out: 6 cm ahead
      [104.0, 200.0, 4, 40],    // out: 4 m right, wider than the drawing
    ]
    const tiles = new Map()
    for (const [e, n, z, i] of pts) {
      const tx = Math.floor(e / 2), ty = Math.floor(n / 2), key = `${tx},${ty}`
      if (!tiles.has(key)) tiles.set(key, { tx, ty, x: [], y: [], z: [], i: [] })
      const t = tiles.get(key)
      t.x.push(Math.round((e - tx * 2) * 1000)); t.y.push(Math.round((n - ty * 2) * 1000))
      t.z.push(z * 1000); t.i.push(i)
    }
    const out = new SlicePoints()
    for (const t of tiles.values()) {
      const seg = encodeSegment({ ...t, count: t.x.length })
      sliceSegment(out, decodeSegment(seg.bytes, seg.count), segmentPlacement({ tileSize: 2 }, t.tx, t.ty, seg.z0), frame)
    }
    const got = Array.from({ length: out.count }, (_, k) => [out.y[k], out.z[k], out.i[k]]).sort((a, b) => a[0] - b[0])
    expect(got.map(([y]) => Math.round(y * 1000))).toEqual([-1000, 500])
    expect(got.map(([, z, i]) => [z, i])).toEqual([[2, 20], [1, 10]])
  })

  it('finds only the tiles a thin slanted slice crosses', () => {
    const tiles = []
    for (let tx = -10; tx < 10; tx++) for (let ty = -10; ty < 10; ty++) tiles.push([tx, ty, []])
    const frame = sliceFrame({ easting: 0, northing: 0, bearing: 45, halfWidth: 10, thickness: 0.1 })
    const hit = tilesInSlice({ tileSize: 2, tiles }, frame)
    // Every tile hit has a corner on each side of the plane (or touches it).
    for (const [tx, ty] of hit) {
      const ds = [[0, 0], [2, 0], [0, 2], [2, 2]].map(([a, b]) => (tx * 2 + a) * frame.along[0] + (ty * 2 + b) * frame.along[1])
      expect(Math.min(...ds)).toBeLessThanOrEqual(0.05 + 1e-9)
      expect(Math.max(...ds)).toBeGreaterThanOrEqual(-0.05 - 1e-9)
    }
    // A diagonal through the grid crosses 7–8 tiles each side of the origin.
    expect(hit.length).toBeGreaterThan(14)
    expect(hit.length).toBeLessThan(30)
  })
})

// Reference: the same thinning and slice computed with laspy/numpy on the sample.
describe.skipIf(!hasLaz)('the slice of the LAZ sample', () => {
  it('holds the points the Python evaluation finds', async () => {
    const source = await nodeFileSource(LAZ_PATH)
    try {
      const header = await readLasHeader(source)
      const parts = []
      let at = 0
      const writer = { append(b) { const o = at; parts.push(b); at += b.length; return o } }
      const index = await importPointCloud({ source, header, writer, lazPerf: await nodeLazPerf() })
      expect(index.points).toBe(918957)
      const bytes = new Uint8Array(at)
      let o = 0
      for (const p of parts) { bytes.set(p, o); o += p.length }

      const cases = [
        [{ easting: 4470688.083, northing: 5332206.905, bearing: 45.35, halfWidth: 30, thickness: 0.1 }, 6122, 155.202, 531.215, 537.106],
        [{ easting: 4470690.0, northing: 5332212.0, bearing: 45.35, halfWidth: 20, thickness: 0.04 }, 2426, 1997.424, 531.273, 536.841],
        [{ easting: 4470680.0, northing: 5332200.0, bearing: 10, halfWidth: 30, thickness: 0.1 }, 2556, 20593.709, 531.822, 536.869],
      ]
      for (const [args, count, ySum, zMin, zMax] of cases) {
        const t0 = performance.now()
        const out = slice(index, bytes, sliceFrame(args))
        const ms = performance.now() - t0
        expect(out.count).toBe(count)
        let sum = 0, lo = Infinity, hi = -Infinity
        for (let k = 0; k < out.count; k++) { sum += out.y[k]; lo = Math.min(lo, out.z[k]); hi = Math.max(hi, out.z[k]) }
        expect(sum).toBeCloseTo(ySum, 0)
        expect(lo).toBeCloseTo(zMin, 3)
        expect(hi).toBeCloseTo(zMax, 3)
        expect(ms).toBeLessThan(500)   // decoding included; the page caches decoded tiles
      }
    } finally {
      await source.close()
    }
  }, 60000)

  it('holds every point of the file in the slice when kept in original resolution', async () => {
    const source = await nodeFileSource(LAZ_PATH)
    try {
      const header = await readLasHeader(source)
      const lazPerf = await nodeLazPerf()
      const parts = []
      let at = 0
      const writer = { append(b) { const o = at; parts.push(b); at += b.length; return o } }
      const index = await importPointCloud({ source, header, writer, lazPerf, original: true })
      const bytes = new Uint8Array(at)
      let o = 0
      for (const p of parts) { bytes.set(p, o); o += p.length }

      const frame = sliceFrame({ easting: 4470688.083, northing: 5332206.905, bearing: 45.35, halfWidth: 30, thickness: 0.1 })
      const out = slice(index, bytes, frame)
      // The same slice straight from the file's points.
      let count = 0, ySum = 0, zSum = 0
      for await (const b of readLasPoints(source, header, { lazPerf })) {
        for (let k = 0; k < b.count; k++) {
          const de = b.x[k] - frame.e, dn = b.y[k] - frame.n
          const d = de * frame.along[0] + dn * frame.along[1]
          const q = de * frame.right[0] + dn * frame.right[1]
          if (Math.abs(d) > frame.half || Math.abs(q) > frame.halfWidth) continue
          count++; ySum += q; zSum += b.z[k]
        }
      }
      expect(count).toBeGreaterThan(6122 * 3)     // the thinned slice has 6122
      expect(out.count).toBe(count)
      let y = 0, z = 0
      for (let k = 0; k < out.count; k++) { y += out.y[k]; z += out.z[k] }
      expect(y).toBeCloseTo(ySum, 1)
      expect(z).toBeCloseTo(zSum, 6)
    } finally {
      await source.close()
    }
  }, 60000)
})
