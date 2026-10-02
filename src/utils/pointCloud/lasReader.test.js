import { describe, it, expect } from 'vitest'
import { readLasHeader, readLasPoints } from './lasReader'
import { hasLaz, LAZ_PATH, nodeFileSource, nodeLazPerf, bytesSource, makeLas } from '../../test/pointCloudFixture'

describe('readLasPoints — plain LAS', () => {
  it('reads every point with scale and offset applied', async () => {
    const pts = Array.from({ length: 120001 }, (_, i) => ({
      x: 4470000 + i * 0.001, y: 5332000 - i * 0.002, z: 530 + (i % 1000) * 0.01, intensity: i % 65536,
    }))
    const source = bytesSource(makeLas(pts, { offset: [4470000, 5332000, 500] }))
    const header = await readLasHeader(source)
    expect(header).toMatchObject({ compressed: false, pointFormat: 1, pointLength: 28, pointCount: 120001 })
    const seen = []
    let progress = null
    for await (const b of readLasPoints(source, header, { onProgress: p => { progress = p } })) {
      for (let i = 0; i < b.count; i++) seen.push([b.x[i], b.y[i], b.z[i], b.intensity[i]])
    }
    expect(seen).toHaveLength(120001)
    for (const i of [0, 49999, 50000, 120000]) {
      expect(seen[i][0]).toBeCloseTo(pts[i].x, 6)
      expect(seen[i][1]).toBeCloseTo(pts[i].y, 6)
      expect(seen[i][2]).toBeCloseTo(pts[i].z, 6)
      expect(seen[i][3]).toBe(pts[i].intensity)
    }
    expect(progress).toMatchObject({ points: 120001, totalPoints: 120001 })
    expect(progress.bytes).toBe(progress.totalBytes)
  })

  it('stops at the next batch once aborted', async () => {
    const source = bytesSource(makeLas(Array.from({ length: 150000 }, () => ({ x: 1, y: 2, z: 3 }))))
    const header = await readLasHeader(source)
    const ctl = new AbortController()
    let batches = 0
    await expect((async () => {
      for await (const b of readLasPoints(source, header, { signal: ctl.signal })) { batches++; if (b) ctl.abort() }
    })()).rejects.toMatchObject({ name: 'AbortError' })
    expect(batches).toBe(1)
  })

  it('refuses what is not a LAS file', async () => {
    await expect(readLasHeader(bytesSource(new Uint8Array(400)))).rejects.toThrow(/not a LAS/)
  })
})

// Reference values read with laspy 2 / lazrs from the same file.
describe.skipIf(!hasLaz)('readLasPoints — the LAZ sample', () => {
  it('decodes all 3 239 356 points, chunk by chunk, as laspy does', async () => {
    const source = await nodeFileSource(LAZ_PATH)
    try {
      const header = await readLasHeader(source)
      expect(header).toMatchObject({
        version: '1.2', compressed: true, pointFormat: 1, pointLength: 28, pointCount: 3239356,
        laszip: { compressor: 2, chunkSize: 50000 },
      })
      const lazPerf = await nodeLazPerf()
      const wanted = new Map([
        [0, [4470683.058286359, 5332199.762836749, 536.8305144555818, 14867]],
        [49999, [4470682.202286359, 5332200.962836749, 531.3385144555818, 41049]],
        [50000, [4470682.202286359, 5332200.963836749, 531.3355144555818, 41001]],
        [1234567, [4470686.435286359, 5332204.687836749, 531.3345144555818, 37816]],
        [3239355, [4470689.505286358, 5332214.975836749, 537.1065144555818, 26566]],
      ])
      let n = 0, intensitySum = 0, xIntSum = 0, batches = 0
      const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity]
      for await (const b of readLasPoints(source, header, { lazPerf })) {
        batches++
        for (let i = 0; i < b.count; i++, n++) {
          intensitySum += b.intensity[i]
          xIntSum += Math.round((b.x[i] - header.offset[0]) / header.scale[0])
          const p = [b.x[i], b.y[i], b.z[i]]
          for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k], p[k]); max[k] = Math.max(max[k], p[k]) }
          const w = wanted.get(n)
          if (w) {
            expect(p[0]).toBeCloseTo(w[0], 6)
            expect(p[1]).toBeCloseTo(w[1], 6)
            expect(p[2]).toBeCloseTo(w[2], 6)
            expect(b.intensity[i]).toBe(w[3])
          }
        }
      }
      expect(n).toBe(3239356)
      expect(batches).toBe(65)
      expect(intensitySum).toBe(115818658440)
      expect(xIntSum).toBe(14489871739)
      for (let k = 0; k < 3; k++) {
        expect(min[k]).toBeCloseTo(header.min[k], 6)
        expect(max[k]).toBeCloseTo(header.max[k], 6)
      }
    } finally {
      await source.close()
    }
  }, 60000)
})
