import { describe, it, expect } from 'vitest'
import { nearestValid, settleStation, uniqueStations, validIntervals } from './stationSlider'

describe('the position slider', () => {
  const valid = (s) => (s >= 10.25 && s <= 40.5) || (s >= 60 && s <= 70)

  it('finds the stretches where the position is valid, edges to a tenth of a millimetre', () => {
    const iv = validIntervals(valid, 0, 100, 1)
    expect(iv).toHaveLength(2)
    expect(iv[0][0]).toBeCloseTo(10.25, 4)
    expect(iv[0][1]).toBeCloseTo(40.5, 4)
    expect(iv[1]).toEqual([expect.closeTo(60, 4), expect.closeTo(70, 4)])
  })

  it('asks the snap points on their own: a valid point between failing samples is a stretch', () => {
    const point = (s) => Math.abs(s - 20.37) < 1e-9
    expect(validIntervals(point, 0, 50, 1)).toEqual([])
    expect(validIntervals(point, 0, 50, 1, [20.37, 30])).toEqual([[20.37, 20.37]])
  })

  it('skips what is not valid: the nearest valid station', () => {
    const iv = [[10, 40], [60, 70]]
    expect(nearestValid(45, iv)).toBe(40)
    expect(nearestValid(56, iv)).toBe(60)
    expect(nearestValid(20, iv)).toBe(20)
    expect(nearestValid(5, [])).toBeNull()
  })

  it('snaps within the tolerance onto a valid snap point, never onto an invalid one', () => {
    const iv = [[10, 40], [60, 70]]
    expect(settleStation(24.4, { intervals: iv, snaps: [25], tol: 1 })).toBe(25)
    expect(settleStation(23.5, { intervals: iv, snaps: [25], tol: 1 })).toBe(23.5)
    expect(settleStation(49.5, { intervals: iv, snaps: [50], tol: 1 })).toBe(40)
  })

  it('states snap points once each, ascending', () => {
    expect(uniqueStations([3, 1.00001, 1.000012, NaN, 2])).toEqual([1, 2, 3])
  })
})
