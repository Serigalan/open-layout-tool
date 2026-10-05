import { describe, it, expect } from 'vitest'
import {
  encodeSegment, decodeSegment, encodeGridSegment, decodeGridSegment, splitIntoBands, TileBuilder,
  intensityShift, tileOf, originalGrid, segmentPlacement,
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

describe('segments of the original resolution', () => {
  it('come back as they went in — 32-bit steps, the intensity as stored', () => {
    const pts = Array.from({ length: 5000 }, (_, k) => [
      (k * 7919) % 200001, (k * 104729) % 200001, 5310000 + ((k * 13) % 900000), (k * 977) % 65536,
    ])
    const seg = encodeGridSegment({
      count: pts.length,
      x: Uint32Array.from(pts.map(p => p[0])), y: Uint32Array.from(pts.map(p => p[1])),
      z: Float64Array.from(pts.map(p => p[2])), i: Uint16Array.from(pts.map(p => p[3])),
    })
    expect(seg.z0).toBe(5310000)
    const back = decodeGridSegment(seg.bytes, seg.count, 8)
    const got = Array.from({ length: seg.count }, (_, k) => [back.x[k], back.y[k], back.z[k] + seg.z0, back.intensity[k]])
    expect(sorted(got)).toEqual(sorted(pts))
    for (let k = 0; k < seg.count; k++) expect(back.i[k]).toBe(back.intensity[k] >> 8)
  })

  it('are not split into bands below 4 · 10⁹ steps of height', () => {
    const b = new TileBuilder({ grid: { scale: [0.001, 0.001, 0.001], offset: [0, 0, 0] }, onTile: (tx, ty, cols) => {
      expect(splitIntoBands(cols)).toHaveLength(1)
    } })
    b.add(0.5, 0.5, -100, 1)
    b.add(0.5, 0.5, 3000000, 2)
    b.flushAll()
  })
})

describe('originalGrid', () => {
  it('is the scale and offset of a LAS file', () => {
    expect(originalGrid({ scale: [0.001, 0.001, 0.0001], offset: [4470683.058, 5332199.76, 536.83] }))
      .toEqual({ scale: [0.001, 0.001, 0.0001], offset: [4470683.058, 5332199.76, 536.83] })
  })

  it('is a tenth of a millimetre for E57, or its finer integer step', () => {
    expect(originalGrid({ format: 'e57', scale: [0.001, 0.001, 0.001] }).scale).toEqual([0.0001, 0.0001, 0.0001])
    expect(originalGrid({ format: 'e57', scale: [0.00001, 0.00001, 0.00001] }).scale).toEqual([0.00001, 0.00001, 0.00001])
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

  it('keeps every point on a grid, doubles too, and they come back to the bit', () => {
    // A LAS grid whose offset is not on the millimetre, as in the sample file.
    const grid = { scale: [0.001, 0.001, 0.001], offset: [4470683.058286359, 5332199.762836749, 536.8305144555818] }
    const file = []
    for (let k = 0; k < 400; k++) {
      const X = -3000 + k * 17, Y = 2000 - k * 11, Z = -5000 + (k % 9) * 3
      file.push([X, Y, Z, 60000 - k])
      if (k % 4 === 0) file.push([X, Y, Z, 7])           // the same spot scanned twice
    }
    const tiles = []
    const b = new TileBuilder({ grid, onTile: (tx, ty, cols) => tiles.push({ tx, ty, cols }) })
    const metres = ([X, Y, Z]) => [X * 0.001 + grid.offset[0], Y * 0.001 + grid.offset[1], Z * 0.001 + grid.offset[2]]
    for (const p of file) b.add(...metres(p), p[3])
    b.flushAll()
    expect(b.kept).toBe(file.length)
    const back = []
    for (const { tx, ty, cols } of tiles) {
      const seg = encodeGridSegment(cols)
      const s = decodeGridSegment(seg.bytes, seg.count)
      const at = segmentPlacement({ grid }, tx, ty, seg.z0)
      for (let k = 0; k < seg.count; k++) {
        const e = at.ox + s.x[k] * at.sx, n = at.oy + s.y[k] * at.sy, z = at.oz + s.z[k] * at.sz
        expect(Math.floor(e / 2)).toBe(tx)
        expect(Math.floor(n / 2)).toBe(ty)
        // Back on the file's integers exactly.
        back.push([Math.round((e - grid.offset[0]) / 0.001), Math.round((n - grid.offset[1]) / 0.001),
          Math.round((z - grid.offset[2]) / 0.001), s.intensity[k]])
        expect(Math.abs(e - metres(back.at(-1))[0])).toBeLessThan(1e-8)
      }
    }
    expect(sorted(back)).toEqual(sorted(file))
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
