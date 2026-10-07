import { describe, it, expect } from 'vitest'
import { comparedLine, heightsComparable, nearestAxis, shiftSummary, shiftValues, shiftValuesCsv } from './shiftValues'
import { buildReferenceAxis } from './referenceAxis'
import { straightElement, arcFrom } from './elementFactory'
import { recalcAbsLengths } from './trackModel'

const EPSG = 25832
const P = (x, y) => ({ easting: 500000 + x, northing: 5700000 + y, zone: EPSG })

// The reference: 300 m east from the origin, stationed from 1000, heights rising 1 ‰.
const refAxis = buildReferenceAxis({
  name: 'R', epsg: EPSG, elements: [straightElement(P(0, 0), P(300, 0))], startStation: 1000, from: 1000, to: 1300,
  gradient: [{ station: 1000, z: 100 }, { station: 1300, z: 100.3 }], heightEpsg: 7837, tra: 'r', id: 'r',
})

describe('shift values', () => {
  it('measure across the reference axis, positive to its right', () => {
    // 3 cm south of it — to the right of an axis running east.
    const line = comparedLine([straightElement(P(-10, -0.03), P(310, -0.03))], EPSG)
    const rows = shiftValues(refAxis, line, { every: 10 })
    expect(rows.length).toBe(31)
    expect(rows[0].station).toBe(1000)
    for (const r of rows) expect(r.dq).toBeCloseTo(0.03, 6)
    const left = shiftValues(refAxis, comparedLine([straightElement(P(-10, 0.05), P(310, 0.05))], EPSG), { every: 100 })
    expect(left.map(r => Math.round(r.dq * 1000))).toEqual([-50, -50, -50, -50])
  })

  it('follow an axis that leaves the reference — and stop where it is beyond reach', () => {
    // From the axis at x = 100, an arc of R 1000 to the left: y = x²/2000 roughly.
    const s = straightElement(P(0, 0), P(100, 0))
    const a = arcFrom(P(100, 0), 90, 150, -1000)
    const line = comparedLine(recalcAbsLengths([s, a]), EPSG)
    const rows = shiftValues(refAxis, line, { every: 1 })
    const at = (st) => rows.find(r => r.station === st)
    expect(at(1050).dq).toBeCloseTo(0, 6)
    // 50 m into the arc: the arc lies x²/2R = 1.25 m to the left (the normal of a straight reference is vertical).
    expect(at(1150).dq).toBeCloseTo(-(1000 - Math.sqrt(1000 ** 2 - 50 ** 2)), 3)
    // Beyond 2 m to the left nothing more.
    expect(rows.every(r => Math.abs(r.dq) <= 2)).toBe(true)
    expect(at(1250)).toBeUndefined()
  })

  it('compare heights where both have them in one system', () => {
    const els = [straightElement(P(0, 0.01), P(300, 0.01))]
    const heights = [{ station: 0, z: 100.02 }, { station: 300, z: 100.32 }]
    const rows = shiftValues(refAxis, comparedLine(els, EPSG, { heights }), { every: 50 })
    for (const r of rows) expect(r.dz).toBeCloseTo(0.02, 6)
    const flat = shiftValues(refAxis, comparedLine(els, EPSG, { heights }), { every: 50, withHeights: false })
    expect(flat.every(r => r.dz === null)).toBe(true)
    expect(heightsComparable(refAxis, 7837)).toBe(true)
    expect(heightsComparable(refAxis, 5783)).toBe(false)
  })

  it('read the line\'s own stationing for its gradient', () => {
    // The line starts 100 m along its own track: heights are stationed from its start.
    const els = [straightElement(P(0, 0), P(300, 0))]
    const line = comparedLine(els, EPSG, { heights: [{ station: 100, z: 100 }, { station: 400, z: 100.3 }], station0: 100 })
    const rows = shiftValues(refAxis, line, { every: 100 })
    expect(rows.map(r => r.along)).toEqual([100, 200, 300, 400].map(v => expect.closeTo(v, 6)))
    for (const r of rows) expect(r.dz).toBeCloseTo(0, 6)
  })

  it('sum up to the largest either way and what lies beyond the limits', () => {
    const rows = [
      { station: 0, dq: 0.01, dz: 0.03 }, { station: 5, dq: -0.06, dz: -0.01 }, { station: 10, dq: 0.04, dz: null },
    ]
    const s = shiftSummary(rows, { limitQ: 0.05, limitZ: 0.02 })
    expect(s.right.station).toBe(10)
    expect(s.left.station).toBe(5)
    expect(s.up.station).toBe(0)
    expect(s.down.station).toBe(5)
    expect(s.beyondQ).toBe(1)
    expect(s.beyondZ).toBe(1)
  })

  it('take the reference axis the line runs along the furthest by default', () => {
    const other = buildReferenceAxis({
      name: 'O', epsg: EPSG, elements: [straightElement(P(0, 50), P(300, 50))], from: 0, to: 300, tra: 'o', id: 'o',
    })
    const line = comparedLine([straightElement(P(0, 0.02), P(300, 0.02))], EPSG)
    expect(nearestAxis([other, refAxis], line, EPSG).id).toBe('r')
    expect(nearestAxis([other, refAxis], line, 5684)).toBe(null)
  })

  it('write a CSV in millimetres', () => {
    const line = comparedLine([straightElement(P(0, -0.03), P(300, -0.03))], EPSG)
    const csv = shiftValuesCsv(shiftValues(refAxis, line, { every: 100 }), { axisName: 'R', lineName: 'L' })
    const lines = csv.trim().split('\n')
    expect(lines).toHaveLength(6)
    expect(lines[2]).toMatch(/^1000\.000;30;;500000\.000;5700000\.000;500000\.000;5699999\.970$/)
  })
})
