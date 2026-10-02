import { describe, it, expect } from 'vitest'
import { parseRecords, buildElements, parseGradient, gradientHeights, gradientHeightCode } from './vermEsnImport'

/** A GRA file: header (num = number of points), then station, height, radius, tangent length, point number. */
function graBuffer(rows, num = rows.length) {
  const buf = new ArrayBuffer(36 * (rows.length + 1))
  const view = new DataView(buf)
  view.setFloat64(0, num, true)
  rows.forEach(([station, z, rv = 0, t = 0, nr = 0], i) => {
    const o = 36 * (i + 1)
    view.setFloat64(o, station, true)
    view.setFloat64(o + 8, z, true)
    view.setFloat64(o + 16, rv, true)
    view.setFloat64(o + 24, t, true)
    view.setInt32(o + 32, nr, true)
  })
  return buf
}

/** A TRA file of straights due north, each record { station, length }; the last one closes the axis. */
function traBuffer(rows) {
  const buf = new ArrayBuffer(78 * rows.length)
  const view = new DataView(buf)
  rows.forEach(({ station, length }, i) => {
    const o = 78 * i
    view.setFloat64(o + 16, 700000, true)
    view.setFloat64(o + 24, 5700000 + (station - rows[0].station), true)
    view.setFloat64(o + 32, 0, true)
    view.setFloat64(o + 40, station, true)
    view.setInt16(o + 48, 0, true)
    view.setFloat64(o + 50, length, true)
  })
  return buf
}

describe('parseGradient', () => {
  it('reads the tangent polygon after the header, radius as magnitude', () => {
    const points = parseGradient(graBuffer([[1000, 80], [1200, 82, -5000, 20], [1500, 79]]))
    expect(points).toEqual([
      { station: 1000, z: 80 },
      { station: 1200, z: 82, rv: 5000 },
      { station: 1500, z: 79 },
    ])
  })

  it('leaves out the closing record behind the gradient', () => {
    // As in the delivered files: num points, then a record whose station
    // jumps back (and a padding record).
    const rows = [[0, 508.032], [164, 508.36, -2037.351, 25], [404, 502.95],
      [1426.98, 1460.58, 1516.58, 2060, 1000], [0, 0]]
    expect(parseGradient(graBuffer(rows, 3)).map(p => p.station)).toEqual([0, 164, 404])
    // A header that counts the closing record as well still ends at the last point.
    rows[3][0] = 100
    expect(parseGradient(graBuffer(rows, 4)).map(p => p.station)).toEqual([0, 164, 404])
  })

  it('stops at the end of the file when the header promises more', () => {
    const buf = graBuffer([[0, 1], [10, 2]])
    new DataView(buf).setFloat64(0, 9, true)
    expect(parseGradient(buf)).toHaveLength(2)
  })
})

describe('gradientHeights — the gradient on the imported track', () => {
  const tra = traBuffer([
    { station: 1100, length: 200 },
    { station: 1300, length: 100 },
    { station: 1400, length: 0 },
  ])

  it('stations the heights from the track begin', () => {
    const { elements, errors, startStation } = buildElements(parseRecords(tra), 25832)
    expect(errors).toEqual([])
    expect(startStation).toBe(1100)
    const length = elements.reduce((s, el) => s + el.length, 0)
    const points = parseGradient(graBuffer([[1000, 80], [1200, 82, 5000], [1500, 79]]))
    const { heights, notes } = gradientHeights(points, startStation, length)
    expect(notes).toEqual([])
    expect(heights.map(p => p.station)).toEqual([0, 100, 300])
    expect(heights[0].z).toBeCloseTo(81)
    expect(heights[1]).toEqual({ station: 100, z: 82, rv: 5000 })
    expect(heights[2].z).toBeCloseTo(80)
  })

  it('notes a gradient that covers only part of the track', () => {
    const points = parseGradient(graBuffer([[1200, 82], [1300, 83]]))
    const { heights, notes } = gradientHeights(points, 1100, 300)
    expect(heights.map(p => p.station)).toEqual([100, 200])
    expect(notes).toHaveLength(1)
  })

  it('refuses a gradient outside the axis', () => {
    const points = parseGradient(graBuffer([[5000, 82], [5300, 83]]))
    const { heights, notes } = gradientHeights(points, 1100, 300)
    expect(heights).toBeNull()
    expect(notes[0]).toMatch(/nicht im Stationsbereich/)
  })
})

describe('gradientHeightCode — the height status the file names', () => {
  it('reads it from the header after num', () => {
    const buf = graBuffer([[0, 1], [10, 2]])
    new Uint8Array(buf).set([0x56, 0x30, 0x30, 0], 8)   // 'V00'
    expect(gradientHeightCode(buf, 'x.GRA')).toBe('V00')
  })

  it('falls back to the file name where the header holds something else', () => {
    const buf = graBuffer([[0, 1], [10, 2]])
    new Uint8Array(buf).set([0x00, 0x7e, 0x70, 0x01], 8)
    expect(gradientHeightCode(buf, '5550R000_EA0_V00_VR.GRA')).toBe('V00')
    expect(gradientHeightCode(buf, 'gradient.gra')).toBeNull()
  })
})
