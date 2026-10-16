import { describe, it, expect } from 'vitest'
import {
  clothoidRadiusAt,
  computeClothoidUtm,
  transitionShift,
  curvatureOf,
  radiusOfCurvature,
} from './clothoidUtils'

const START = { easting: 500000, northing: 5600000, zone: 25832 }

describe('clothoidRadiusAt', () => {
  it('returns the stored ends exactly, not their reciprocal taken twice', () => {
    expect(clothoidRadiusAt(null, -601.5, 100, 0)).toBeNull()
    expect(clothoidRadiusAt(null, -601.5, 100, 100)).toBe(-601.5)
    expect(clothoidRadiusAt(400, null, 100, 0)).toBe(400)
    expect(clothoidRadiusAt(400, null, 100, 100)).toBeNull()
  })

  it('interpolates curvature linearly between the ends', () => {
    const mid = clothoidRadiusAt(400, 800, 100, 50)
    const expectedKappa = (curvatureOf(400) + curvatureOf(800)) / 2
    expect(mid).toBeCloseTo(radiusOfCurvature(expectedKappa), 9)
  })
})

describe('computeClothoidUtm', () => {
  it('a straight-to-straight transition (r1=r2=null) keeps its bearing and goes the stated length', () => {
    const { endUtm, endBearing } = computeClothoidUtm(START, 30, 150, null, null)
    expect(endBearing).toBeCloseTo(30, 6)
    const dist = Math.hypot(endUtm.easting - START.easting, endUtm.northing - START.northing)
    expect(dist).toBeCloseTo(150, 3)
  })

  it('total heading change matches (kappa1+kappa2)*L/2 for both curve types', () => {
    const bearing = 10
    const length = 120
    const r1 = null
    const r2 = -600
    for (const type of ['clothoid', 'bloss']) {
      const { endBearing } = computeClothoidUtm(START, bearing, length, r1, r2, 0.2, type)
      // Sign convention (see clothoidUtils.js): kappa = -1/signedR, not +1/signedR.
      const kappa1 = r1 ? -1 / r1 : 0
      const kappa2 = r2 ? -1 / r2 : 0
      const dphiDeg = ((kappa1 + kappa2) * length / 2) * (180 / Math.PI)
      const expected = ((bearing - dphiDeg) % 360 + 360) % 360
      expect(endBearing).toBeCloseTo(expected, 3)
    }
  })
})

describe('transitionShift', () => {
  it('returns the null shift for a zero-length transition', () => {
    expect(transitionShift(0, 500)).toEqual({ p: 0, t: 0, phi: 0 })
  })

  it('phi equals L/(2R) and p grows with curve entry, for both curve types', () => {
    const L = 100
    const R = 600
    for (const type of ['clothoid', 'bloss']) {
      const { p, t, phi } = transitionShift(L, R, type)
      expect(phi).toBeCloseTo(L / (2 * R), 9)
      expect(p).toBeGreaterThan(0)
      expect(t).toBeGreaterThan(0)
      expect(t).toBeLessThan(L)
    }
  })
})
