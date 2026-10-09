import { describe, it, expect } from 'vitest'
import {
  computeStraightValuesUtm,
  computeCurvedValuesUtm,
  endPointStraightUtm,
  endPointCurvedUtm,
  reverseElement,
  arcCenter,
} from './elementUtils'

const EPSG = 25832
const START = { easting: 500000, northing: 5600000, zone: EPSG }

describe('computeStraightValuesUtm / endPointStraightUtm round trip', () => {
  it('recovers length and bearing for a straight run', () => {
    for (const bearing of [0, 45, 90, 133.7, 270, 359]) {
      const end = endPointStraightUtm(START, bearing, 250)
      const v = computeStraightValuesUtm(START, end)
      expect(v.length).toBeCloseTo(250, 6)
      expect(v.bearing).toBeCloseTo(bearing, 6)
    }
  })
})

describe('computeCurvedValuesUtm / endPointCurvedUtm round trip', () => {
  it('recovers arc length, start and end bearing for right- and left-hand curves', () => {
    for (const signedR of [600, -600, 190, -1200]) {
      const arcLength = 120
      const bearing = 30
      const end = endPointCurvedUtm(START, bearing, arcLength, signedR)
      const v = computeCurvedValuesUtm(START, end, signedR)
      expect(v.length).toBeCloseTo(arcLength, 3)
      expect(v.bearing).toBeCloseTo(bearing, 3)
      const expectedEndBearing = ((bearing + (arcLength / signedR) * 180 / Math.PI) % 360 + 360) % 360
      expect(v.endBearing).toBeCloseTo(expectedEndBearing, 3)
    }
  })
})

describe('arcCenter', () => {
  it('is null when the radius is shorter than half the chord', () => {
    const end = endPointStraightUtm(START, 0, 1000)
    expect(arcCenter(START.easting, START.northing, end.easting, end.northing, 100)).toBeNull()
  })

  it('places the center at signedR from both endpoints', () => {
    const end = endPointCurvedUtm(START, 0, 300, 500)
    const ac = arcCenter(START.easting, START.northing, end.easting, end.northing, 500)
    expect(ac).not.toBeNull()
    const dStart = Math.hypot(START.easting - ac.cx, START.northing - ac.cy)
    const dEnd = Math.hypot(end.easting - ac.cx, end.northing - ac.cy)
    expect(dStart).toBeCloseTo(500, 6)
    expect(dEnd).toBeCloseTo(500, 6)
  })
})

describe('reverseElement is self-inverse', () => {
  const base = {
    elementType: 0,
    epsg: EPSG,
    startNode: [500000, 5600000],
    endNode: [500250, 5600250],
    bearing: 45,
    length: 353.5,
    cant: 80,
    geometry: { type: 'LineString', coordinates: [[9, 51], [9.01, 51.01]] },
  }

  const arc = {
    ...base,
    elementType: 1,
    radius: -600,
    endBearing: 20,
  }

  const transition = {
    ...base,
    elementType: 2,
    r1: null,
    r2: -601.04,
    endBearing: 40.1,
    cantStart: 0,
    cantEnd: 90,
    renderCoords: [[9, 51], [9.005, 51.005], [9.01, 51.01]],
  }

  it.each([['straight', base], ['arc', arc], ['transition', transition]])('%s reverse(reverse(el)) === el', (_label, el) => {
    const roundTripped = reverseElement(reverseElement(el))
    // Bearings go through a `% 360` twice, which can leave ~1e-13° of float
    // noise — real geometry, not a defect — so compare those numerically and
    // everything else structurally.
    const { bearing: rBearing, endBearing: rEndBearing, ...rRest } = roundTripped
    const { bearing: eBearing, endBearing: eEndBearing, ...eRest } = el
    expect(rRest).toEqual(eRest)
    expect(rBearing).toBeCloseTo(eBearing, 9)
    if (eEndBearing != null) expect(rEndBearing).toBeCloseTo(eEndBearing, 9)
  })

  it('flips node order, bearing and cant sign once', () => {
    const rev = reverseElement(arc)
    expect(rev.startNode).toEqual(arc.endNode)
    expect(rev.endNode).toEqual(arc.startNode)
    expect(rev.radius).toBe(600)
    expect(rev.cant).toBe(-80)
    expect(rev.bearing).toBeCloseTo((arc.endBearing + 180) % 360, 9)
  })

  it('swaps r1/r2 and cantStart/cantEnd for a transition', () => {
    const rev = reverseElement(transition)
    expect(rev.r1).toBe(601.04)
    expect(rev.r2).toBeNull()
    expect(rev.cantStart).toBe(-90)
    expect(rev.cantEnd).toBe(-0)
  })
})
