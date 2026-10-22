import { describe, it, expect } from 'vitest'
import {
  computeStraightValuesUtm,
  computeCurvedValuesUtm,
  endPointStraightUtm,
  endPointCurvedUtm,
  reverseElement,
  arcCenter,
  displayCoords,
} from './elementUtils'
import { arcElement, transitionElement } from './elementFactory'
import { wgs84ToUTM } from './coordinateUtils'
import { transitionPointAtUtm } from './clothoidUtils'

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

describe('displayCoords draws curves finely enough to be looked at from close up', () => {
  const plane = (coords) => coords.map(c => wgs84ToUTM(c, EPSG))
  // Largest distance of a chord's midpoint from the arc around (cx, cy).
  const worstSagitta = (pts, cx, cy, r) => Math.max(...pts.slice(1).map((p, i) => {
    const mE = (p.easting + pts[i].easting) / 2, mN = (p.northing + pts[i].northing) / 2
    return r - Math.hypot(mE - cx, mN - cy)
  }))

  it('an arc within 5 mm, its stored ends kept exactly', () => {
    const el = arcElement(START, endPointCurvedUtm(START, 0, 120, 500), 500)
    const coords = displayCoords(el, EPSG)
    const stored = el.geometry.coordinates
    expect(coords[0]).toEqual(stored[0])
    expect(coords.at(-1)).toEqual(stored.at(-1))
    expect(coords.length).toBeGreaterThan(stored.length)
    const { cx, cy } = arcCenter(START.easting, START.northing, el.endNode[0], el.endNode[1], 500)
    const pts = plane(coords)
    for (const p of pts) expect(Math.abs(Math.hypot(p.easting - cx, p.northing - cy) - 500)).toBeLessThan(1e-4)
    expect(worstSagitta(pts, cx, cy, 500)).toBeLessThan(0.005 + 1e-4)
  })

  it("a turnout's arc at least every 2 m, as its body is", () => {
    // A 27 m branch on R 500: the stored polyline has one vertex inside.
    const el = { ...arcElement(START, endPointCurvedUtm(START, 0, 27, 500), 500), switchId: 'w1' }
    expect(el.geometry.coordinates).toHaveLength(3)
    expect(displayCoords(el, EPSG)).toHaveLength(Math.ceil(el.length / 2) + 1)
  })

  it('a transition on its own curve', () => {
    const { element } = transitionElement(START, 30, 80, null, 300)
    const coords = displayCoords(element, EPSG)
    expect(coords.length).toBeGreaterThan(element.geometry.coordinates.length)
    expect(coords.at(-1)).toEqual(element.geometry.coordinates.at(-1))
    // Vertices are evenly spaced along the curve: vertex k sits at station 80·k/n.
    const n = coords.length - 1
    const k = Math.floor(n / 2)
    const p = plane([coords[k]])[0]
    const on = transitionPointAtUtm(START, 30, 80, null, 300, 'clothoid', 80 * k / n)
    expect(Math.hypot(p.easting - on.easting, p.northing - on.northing)).toBeLessThan(1e-4)
  })
})
