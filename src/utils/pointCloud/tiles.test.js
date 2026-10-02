import { describe, it, expect } from 'vitest'
import {
  encodeSegment, decodeSegment, splitIntoBands, TileBuilder, intensityShift, tileOf,
} from './tiles'
import { planeMapper } from './cloudCrs'
import { transformPlanePoint } from '../coordinateUtils'

const columns = (pts) => ({
  count: pts.length,
  x: Uint16Array.from(pts.map(p => p[0])), y: Uint16Array.from(pts.map(p => p[1])),
  z: Int32Array.from(pts.map(p => p[2])), i: Uint8Array.from(pts.map(p => p[3])),
})

const sorted = (pts) => [...pts].sort((a, b) => a[2] - b[2] || a[1] - b[1] || a[0] - b[0] || a[3] - b[3])

describe('tile segments', () => {
  it('come back as they went in, heights over the lowest point', () => {
    const pts = Array.from({ length: 5000 }, (_, k) => [
      (k * 37) % 2000, (k * 91) % 2000, 531000 + ((k * 13) % 7000), k % 256,
    ])
    const seg = encodeSegment(columns(pts))
    expect(seg.z0).toBe(531000)
    expect(seg.count).toBe(5000)
    const back = decodeSegment(seg.bytes, seg.count)
    const got = Array.from({ length: seg.count }, (_, k) => [back.x[k], back.y[k], back.z[k] + seg.z0, back.i[k]])
    expect(sorted(got)).toEqual(sorted(pts))
  })

  it('split into height bands where a tile is taller than 65.535 m', () => {
    const cols = columns([[0, 0, 0, 1], [1, 1, 65535, 2], [2, 2, 65536, 3], [3, 3, 200000, 4]])
    const bands = splitIntoBands(cols)
    expect(bands).toHaveLength(3)
    for (const b of bands) {
      const zs = Array.from(b.z.subarray(0, b.count))
      expect(Math.max(...zs) - Math.min(...zs)).toBeLessThanOrEqual(65535)
    }
    expect(bands.reduce((s, b) => s + b.count, 0)).toBe(4)
  })
})

describe('TileBuilder', () => {
  it('keeps the first point of every 2-cm voxel and sorts points into 2-m tiles', () => {
    const tiles = []
    const b = new TileBuilder({ onTile: (tx, ty, cols) => tiles.push({ tx, ty, n: cols.count, cols }) })
    b.add(100.001, 200.001, 50.001, 7)
    b.add(100.019, 200.019, 50.019, 8)   // same voxel → dropped
    b.add(100.021, 200.001, 50.001, 9)   // next voxel along x
    b.add(101.999, 201.999, 50.001, 1)
    b.add(102.0, 200.0, 50.0, 2)         // next tile
    b.flushAll()
    expect(b.kept).toBe(4)
    expect(tiles.map(t => [t.tx, t.ty, t.n]).sort()).toEqual([[50, 100, 3], [51, 100, 1]])
    const first = tiles.find(t => t.tx === 50).cols
    expect(Array.from(first.x.subarray(0, 3))).toEqual([1, 21, 1999])
    expect(Array.from(first.i.subarray(0, 3))).toEqual([7, 9, 1])
    expect(tileOf(101.999, 200)).toEqual([50, 100])
  })

  it('writes a tile once no point has come to it for a while, and a later pass as a new segment', () => {
    const tiles = []
    const b = new TileBuilder({ idlePoints: 10, onTile: (tx, ty, cols) => tiles.push([tx, ty, cols.count]) })
    b.add(0.5, 0.5, 0, 0)
    for (let k = 0; k < 20; k++) b.add(10 + k * 0.05, 0.5, 0, 0)
    b.flushIdle()
    expect(tiles).toEqual([[0, 0, 1]])
    b.add(0.5, 0.5, 0, 0)            // the way back: same voxel, but the tile was written
    b.flushAll()
    expect(tiles.filter(t => t[0] === 0 && t[1] === 0)).toEqual([[0, 0, 1], [0, 0, 1]])
  })

  it('brings any intensity range into a byte', () => {
    expect(intensityShift(255)).toBe(0)
    expect(intensityShift(4095)).toBe(4)
    expect(intensityShift(62222)).toBe(8)
  })
})

describe('planeMapper', () => {
  it('is the identity within one plane', () => {
    expect(planeMapper(25832, 25832)(500000.123, 5700000.456)).toEqual([500000.123, 5700000.456])
  })

  it('follows proj4 to well under a millimetre between DHDN / GK 4 and ETRS89 / UTM 32', () => {
    const map = planeMapper(5678, 25832)
    let worst = 0
    for (let k = 0; k < 400; k++) {
      const e = 4470000 + (k * 7919) % 3000 + (k % 7) * 0.37
      const n = 5332000 + (k * 104729) % 3000 + (k % 11) * 0.53
      const [ae, an] = map(e, n)
      const [xe, xn] = transformPlanePoint(e, n, 5678, 25832)
      worst = Math.max(worst, Math.hypot(ae - xe, an - xn))
    }
    expect(worst).toBeLessThan(0.0002)
  })
})
