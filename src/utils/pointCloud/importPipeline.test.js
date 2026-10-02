import { describe, it, expect } from 'vitest'
import { importPointCloud } from './importPipeline'
import { readLasHeader } from './lasReader'
import { decodeSegment, TILE_SIZE } from './tiles'
import { probeExtent, projectPlane } from './cloudProbe'
import { utmToWgs84 } from '../coordinateUtils'
import { hasLaz, LAZ_PATH, nodeFileSource, nodeLazPerf, bytesSource, makeLas } from '../../test/pointCloudFixture'

const memoryWriter = () => {
  const parts = []
  let at = 0
  return {
    append(bytes) { const o = at; parts.push(bytes); at += bytes.length; return o },
    bytes() {
      const out = new Uint8Array(at)
      let o = 0
      for (const p of parts) { out.set(p, o); o += p.length }
      return out
    },
  }
}

/** Every point of every segment, absolute [m] in the tiles' plane. */
function readBack(index, bytes) {
  const pts = []
  for (const [tx, ty, segs] of index.tiles) {
    for (const [offset, length, count, z0] of segs) {
      const s = decodeSegment(bytes.subarray(offset, offset + length), count)
      for (let k = 0; k < count; k++) {
        pts.push([tx * TILE_SIZE + s.x[k] / 1000, ty * TILE_SIZE + s.y[k] / 1000, (z0 + s.z[k]) / 1000, s.i[k]])
      }
    }
  }
  return pts
}

describe('importPointCloud', () => {
  it('stores every point of a file, thinned to the voxel, at the millimetre', async () => {
    // 3 × 3 × 3 cm lattice — every point its own 2-cm voxel — plus a double of
    // each that falls into the same voxel.
    const pts = []
    for (let a = 0; a < 40; a++) for (let b = 0; b < 40; b++) {
      pts.push({ x: 4470001 + a * 0.03, y: 5332001 + b * 0.03, z: 531.001 + ((a + b) % 5) * 0.03, intensity: 40000 })
      pts.push({ x: 4470001.005 + a * 0.03, y: 5332001 + b * 0.03, z: 531.001 + ((a + b) % 5) * 0.03, intensity: 100 })
    }
    const source = bytesSource(makeLas(pts, { offset: [4470000, 5332000, 500] }))
    const header = await readLasHeader(source)
    const writer = memoryWriter()
    const index = await importPointCloud({ source, header, writer })
    expect(index).toMatchObject({ sourcePoints: 3200, points: 1600, intensityShift: 8, tileSize: 2, voxel: 0.02 })
    const back = readBack(index, writer.bytes())
    expect(back).toHaveLength(1600)
    const want = new Set(pts.filter((_, k) => k % 2 === 0).map(p => `${p.x.toFixed(3)},${p.y.toFixed(3)},${p.z.toFixed(3)}`))
    for (const [x, y, z, i] of back) {
      expect(want.has(`${x.toFixed(3)},${y.toFixed(3)},${z.toFixed(3)}`)).toBe(true)
      expect(i).toBe(40000 >> 8)
    }
    expect(index.bounds.minE).toBeCloseTo(4470001, 6)
    expect(index.bounds.maxN).toBeCloseTo(5332001 + 39 * 0.03, 6)
  })

  it('stops when aborted, between batches', async () => {
    const source = bytesSource(makeLas(Array.from({ length: 120000 }, (_, k) => ({ x: k * 0.01, y: 0, z: 0 }))))
    const header = await readLasHeader(source)
    const ctl = new AbortController()
    let batches = 0
    const run = importPointCloud({
      source, header, writer: memoryWriter(), signal: ctl.signal,
      onProgress: () => { if (++batches === 1) ctl.abort() },
    })
    await expect(run).rejects.toMatchObject({ name: 'AbortError' })
    expect(batches).toBe(1)
  })

  it('carries points into the project plane on the way', async () => {
    const pts = [{ x: 4470700, y: 5332200, z: 531 }]
    const source = bytesSource(makeLas(pts, { offset: [4470000, 5332000, 500] }))
    const header = await readLasHeader(source)
    const writer = memoryWriter()
    const index = await importPointCloud({ source, header, writer, mapper: (e, n) => [e - 4000000, n + 1] })
    const [[x, y]] = readBack(index, writer.bytes())
    expect(x).toBeCloseTo(470700, 3)
    expect(y).toBeCloseTo(5332201, 3)
  })
})

// Measured against the roadmap's table: 2-cm voxel keeps 28 %, ~4 bytes a point.
describe.skipIf(!hasLaz)('importPointCloud — the LAZ sample', () => {
  it('keeps 28 % of the points in a little under 4 bytes each', async () => {
    const source = await nodeFileSource(LAZ_PATH)
    try {
      const header = await readLasHeader(source)
      const writer = memoryWriter()
      let last = null
      const index = await importPointCloud({
        source, header, writer, lazPerf: await nodeLazPerf(), onProgress: (p) => { last = p },
      })
      expect(index.sourcePoints).toBe(3239356)
      expect(index.points / index.sourcePoints).toBeGreaterThan(0.27)
      expect(index.points / index.sourcePoints).toBeLessThan(0.30)
      expect(index.bytes / index.points).toBeLessThan(4.2)
      expect(index.intensityShift).toBe(8)
      expect(index.bounds.minZ).toBeCloseTo(header.min[2], 6)
      expect(index.bounds.maxE).toBeCloseTo(header.max[0], 6)
      expect(index.tiles.reduce((s, t) => s + t[2].reduce((a, g) => a + g[2], 0), 0)).toBe(index.points)
      expect(last).toMatchObject({ points: 3239356, remaining: 0 })
      // The stored points lie inside the file's box, to the millimetre.
      const back = readBack(index, writer.bytes())
      expect(back).toHaveLength(index.points)
      for (const [x, y, z] of back.filter((_, k) => k % 997 === 0)) {
        expect(x).toBeGreaterThanOrEqual(header.min[0] - 0.001)
        expect(y).toBeLessThanOrEqual(header.max[1] + 0.001)
        expect(z).toBeGreaterThanOrEqual(header.min[2] - 0.001)
      }
    } finally {
      await source.close()
    }
  }, 60000)
})

describe('probeExtent', () => {
  const header = { min: [4470661, 5332178, 531], max: [4470713, 5332239, 538] }
  const trackAt = (crs, e, n) => ({ epsg: crs, coordinates: [utmToWgs84(e, n, crs), utmToWgs84(e + 100, n + 100, crs)] })

  it('accepts a file that lies at the tracks in the chosen system', () => {
    expect(probeExtent(header, 5678, [trackAt(5678, 4470600, 5332100)]).ok).toBe(true)
  })

  it('warns when the chosen system puts it somewhere else', () => {
    // The same numbers read as GK zone 3 land some 200 km to the west.
    expect(probeExtent(header, 5677, [trackAt(5678, 4470600, 5332100)]).ok).toBe(false)
  })

  it('cannot say anything for a project without tracks', () => {
    expect(probeExtent(header, 5678, []).ok).toBe(null)
  })

  it('keeps the tiles in the plane most tracks are in', () => {
    expect(projectPlane([{ epsg: 25832 }, { epsg: 5683 }, { epsg: 25832 }])).toBe(25832)
    expect(projectPlane([])).toBe(null)
  })
})
