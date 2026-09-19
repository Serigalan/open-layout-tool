import { describe, it, expect } from 'vitest'
import {
  RUNNING_CIRCLE_DISTANCE, TRACK_GAUGE, RAILS, SLEEPERS, DEFAULT_RAIL, DEFAULT_SLEEPER,
  superstructureAt, elementStartStation,
  cantAngle, rotatePoint, fitSection, sectionAtStation, crossSection, platformSection,
} from './crossSectionUtils'
import { GAUGE_PROFILES, DEFAULT_GAUGE_PROFILE, gaugeProfileRing } from './gaugeProfiles'

describe('the frame the section is drawn in', () => {
  it('states the two track figures in millimetres, not metres', () => {
    expect(RUNNING_CIRCLE_DISTANCE).toBe(1500)
    expect(TRACK_GAUGE).toBe(1435)
  })
})

describe('the superstructure along a track', () => {
  const track = { elements: [{ length: 100 }, { length: 150 }] }

  it('builds a track that states nothing of the defaults, begin to end', () => {
    expect(superstructureAt(track, 0)).toEqual({ rail: DEFAULT_RAIL, sleeper: DEFAULT_SLEEPER })
    expect(superstructureAt(track, 250)).toEqual({ rail: DEFAULT_RAIL, sleeper: DEFAULT_SLEEPER })
    expect(RAILS[DEFAULT_RAIL]).toBeDefined()
    expect(SLEEPERS[DEFAULT_SLEEPER]).toBeDefined()
  })

  it('reads a stated stretch where the station falls in it, the default outside', () => {
    const stated = { ...track, rails: [{ type: '60E2', from: 100, to: 200 }] }
    expect(superstructureAt(stated, 99).rail).toBe(DEFAULT_RAIL)
    expect(superstructureAt(stated, 100).rail).toBe('60E2')
    expect(superstructureAt(stated, 200).rail).toBe('60E2')
    expect(superstructureAt(stated, 201).rail).toBe(DEFAULT_RAIL)
  })

  it('lets the later stretch win where two overlap — the last adjustment holds', () => {
    const stated = { ...track, sleepers: [
      { type: 'B90', from: 0, to: 250 },
      { type: 'SWITCH', from: 100, to: 130 },
    ] }
    expect(superstructureAt(stated, 50).sleeper).toBe('B90')
    expect(superstructureAt(stated, 120).sleeper).toBe('SWITCH')
    expect(superstructureAt(stated, 200).sleeper).toBe('B90')
  })

  it('stations an element from the track begin, so a stretch can be read at it', () => {
    expect(elementStartStation(track, 0)).toBe(0)
    expect(elementStartStation(track, 1)).toBe(100)
  })
})

describe('the cant turning the section', () => {
  /** Height of a running circle after the cant has turned the section. */
  const railZ = (cant, y) => rotatePoint([y, 0], cantAngle(cant))[1]

  it('splits the cant evenly between the two rails — it turns about their centre', () => {
    const left = railZ(100, -RUNNING_CIRCLE_DISTANCE / 2)
    const right = railZ(100, RUNNING_CIRCLE_DISTANCE / 2)
    expect(left).toBeCloseTo(50, 9)
    expect(right).toBeCloseTo(-50, 9)
    expect(left - right).toBeCloseTo(100, 9)   // …and the difference is the cant itself
  })

  it('raises the left rail for a positive cant, as the store’s sign convention has it', () => {
    expect(railZ(160, -RUNNING_CIRCLE_DISTANCE / 2)).toBeGreaterThan(0)
    expect(railZ(-160, -RUNNING_CIRCLE_DISTANCE / 2)).toBeLessThan(0)
  })

  it('leaves a section without cant alone', () => {
    expect(cantAngle(0)).toBeCloseTo(0, 12)
    expect(cantAngle(undefined)).toBeCloseTo(0, 12)
    expect(rotatePoint([717.5, 3000], cantAngle(0))).toEqual([717.5, 3000])
  })

  it('turns the whole section rigidly — a point keeps its distance from the centre', () => {
    const p = rotatePoint([1645, 3220], cantAngle(150))
    expect(Math.hypot(...p)).toBeCloseTo(Math.hypot(1645, 3220), 9)
  })
})

describe('sectionAtStation', () => {
  // 0–100 straight · 100–140 arc · 140–200 transition (cant 0→120, ∞→R 300)
  const track = {
    elements: [
      { length: 100 },                                        // straight, no cant
      { length: 40, cant: 80, radius: -500 },                 // arc, cant throughout
      { elementType: 2, cantStart: 0, cantEnd: 120, r1: null, r2: 300, length: 60 },
    ],
  }

  it('reads an arc at the cant and radius it carries throughout', () => {
    expect(sectionAtStation(track, 120)).toEqual({ elIdx: 1, station: 120, cant: 80, radius: -500 })
  })

  it('reads a straight as the state without cant it is', () => {
    expect(sectionAtStation(track, 50)).toEqual({ elIdx: 0, station: 50, cant: 0, radius: null })
  })

  it('ramps the cant linearly through a transition — halfway is halfway', () => {
    const half = sectionAtStation(track, 170)   // 30 m into the 60 m ramp
    expect(half.elIdx).toBe(2)
    expect(half.station).toBe(170)
    expect(half.cant).toBeCloseTo(60, 9)
  })

  it('ramps the curvature, not the radius — a clothoid is linear in 1/R', () => {
    // Straight → R 300: halfway the curvature is half, so R 600.
    expect(sectionAtStation(track, 170).radius).toBeCloseTo(600, 6)
    expect(sectionAtStation(track, 140).radius).toBeNull()
    expect(sectionAtStation(track, 190).radius).toBeCloseTo(360, 6)
  })

  it('answers at the ends with the values the ends hold', () => {
    expect(sectionAtStation(track, 140).cant).toBeCloseTo(0, 9)
    expect(sectionAtStation(track, 200).cant).toBeCloseTo(120, 9)
  })

  it("holds the last element's values beyond the end, and the first's before the begin", () => {
    expect(sectionAtStation(track, 5000)).toEqual({ elIdx: 2, station: 200, cant: 120, radius: 300 })
    expect(sectionAtStation(track, -5)).toEqual({ elIdx: 0, station: 0, cant: 0, radius: null })
  })

  it("ramps between the neighbours' cant where a transition carries none of its own", () => {
    // 0–100 arc cant 40 · 100–160 transition, no cant of its own · 160–210 arc cant 120
    const joined = {
      elements: [
        { length: 100, cant: 40, radius: -400 },
        { elementType: 2, r1: -400, r2: 500, length: 60 },
        { length: 50, cant: 120, radius: 500 },
      ],
    }
    expect(sectionAtStation(joined, 100).cant).toBeCloseTo(40, 9)
    expect(sectionAtStation(joined, 130).cant).toBeCloseTo(80, 9)    // halfway is halfway
    expect(sectionAtStation(joined, 145).cant).toBeCloseTo(100, 9)
    expect(sectionAtStation(joined, 160).cant).toBeCloseTo(120, 9)
  })

  it("lets a transition's own cantStart / cantEnd win over the neighbours", () => {
    const cut = {
      elements: [
        { length: 100, cant: 40, radius: -400 },
        { elementType: 2, r1: -400, r2: 500, length: 60, cantStart: 0, cantEnd: 90 },
      ],
    }
    expect(sectionAtStation(cut, 100).cant).toBeCloseTo(0, 9)
    expect(sectionAtStation(cut, 160).cant).toBeCloseTo(90, 9)
  })
})

describe('fitSection', () => {
  const square = [[-1000, 0], [1000, 0], [1000, 2000], [-1000, 2000]]

  it('uses one scale for both axes, so the section stays to scale', () => {
    const { k, cx, cy } = fitSection(square, { w: 400, h: 400 }, 0)
    expect(k).toBeCloseTo(400 / 2000, 9)          // the taller axis decides
    expect(cx).toBeCloseTo(200, 9)                 // centred across
    expect(cy - 1000 * k).toBeCloseTo(200, 9)      // …and up the page
  })

  it('keeps the margin free on the axis that decides', () => {
    const { k } = fitSection(square, { w: 400, h: 400 }, 20)
    expect(k * 2000).toBeCloseTo(360, 9)
  })

  it('hands back the bounds it fitted, so a drawing can label its top edge', () => {
    expect(fitSection(square, { w: 400, h: 400 }).bounds)
      .toEqual({ yMin: -1000, yMax: 1000, zMin: 0, zMax: 2000 })
  })
})

describe('the section of an element, as it is drawn', () => {
  const ring = gaugeProfileRing(GAUGE_PROFILES[DEFAULT_GAUGE_PROFILE].points)

  it('leaves a section without cant upright and level', () => {
    const s = crossSection({ cant: 0, gaugeRing: ring })
    expect(s.runningCircles.map(p => p[1])).toEqual([0, 0])
    expect(s.railFaces[1][0] - s.railFaces[0][0]).toBeCloseTo(TRACK_GAUGE, 9)
  })

  it('leans the clearance contour with the track — it is fixed to the running plane', () => {
    const upright = crossSection({ cant: 0, gaugeRing: ring })
    const canted  = crossSection({ cant: 150, gaugeRing: ring })
    const top = (s) => s.gauge.reduce((a, b) => (b[1] > a[1] ? b : a))
    expect(top(canted)[0]).not.toBeCloseTo(top(upright)[0], 3)
    // …and carries the running circles with it, still 1500 mm apart.
    const [left, right] = canted.runningCircles
    expect(Math.hypot(right[0] - left[0], right[1] - left[1])).toBeCloseTo(RUNNING_CIRCLE_DISTANCE, 9)
    expect(left[1] - right[1]).toBeCloseTo(150, 9)
  })

  it('draws nothing where no profile is given, rather than an empty outline', () => {
    expect(crossSection({ cant: 0, gaugeRing: [] }).gauge).toEqual([])
  })
})

describe('the superstructure as it is drawn', () => {
  const section = (over = {}) => crossSection({ cant: 0, rail: '54E4', sleeper: 'B70', ...over })

  it('sets each rail with its inner face on the gauge, head top on the running plane', () => {
    const [left, right] = section().rails
    const rail = RAILS['54E4']
    // The gauge is measured between the heads; the foot reaches further in.
    const headTop = (r) => r.filter(p => p[1] === 0).map(p => p[0])
    expect(Math.max(...headTop(left))).toBeCloseTo(-TRACK_GAUGE / 2, 9)
    expect(Math.min(...headTop(right))).toBeCloseTo(TRACK_GAUGE / 2, 9)
    expect(Math.max(...right.map(p => p[1]))).toBeCloseTo(0, 9)
    expect(Math.min(...right.map(p => p[1]))).toBeCloseTo(-rail.height, 9)
  })

  it('carries the running circle over the rail head, where the wheel rides', () => {
    const [, right] = section().rails
    const head = right.filter(p => p[1] === 0).map(p => p[0])
    expect(Math.min(...head)).toBeLessThanOrEqual(RUNNING_CIRCLE_DISTANCE / 2)
    expect(Math.max(...head)).toBeGreaterThanOrEqual(RUNNING_CIRCLE_DISTANCE / 2)
  })

  it('is as wide as the profile says, no wider', () => {
    const [, right] = section().rails
    const rail = RAILS['54E4']
    const width = Math.max(...right.map(p => p[0])) - Math.min(...right.map(p => p[0]))
    expect(width).toBeCloseTo(rail.foot, 9)
  })

  it('lays the sleeper under the rail foot, its own length across the track', () => {
    const s = section()
    const sleeper = SLEEPERS.B70, rail = RAILS['54E4']
    expect(Math.max(...s.sleeper.map(p => p[0]))).toBeCloseTo(sleeper.length / 2, 9)
    expect(Math.max(...s.sleeper.map(p => p[1]))).toBeCloseTo(-rail.height, 9)
    expect(Math.min(...s.sleeper.map(p => p[1]))).toBeCloseTo(-rail.height - sleeper.height, 9)
  })

  it('draws no superstructure where the track states a type that is gone', () => {
    const s = crossSection({ cant: 0, rail: 'whatever', sleeper: 'whatever' })
    expect(s.rails).toEqual([])
    expect(s.sleeper).toEqual([])
  })

  it('turns the superstructure with the section — rail and contour lean together', () => {
    const [, right] = section({ cant: 150 }).rails
    expect(Math.max(...right.map(p => p[1]))).toBeLessThan(0)   // the right rail goes down
  })
})

describe('a platform in the section', () => {
  it('stands beside the track between its two edge offsets, top at its height over top of rail', () => {
    const p = platformSection({ side: 'right', height: 550 })
    expect(Math.min(...p.map(q => q[0]))).toBeCloseTo(1680, 9)
    expect(Math.max(...p.map(q => q[0]))).toBeCloseTo(4680, 9)
    expect(Math.max(...p.map(q => q[1]))).toBeCloseTo(550, 9)
  })

  it('lies on the other side for a left platform, at the same offsets', () => {
    const p = platformSection({ side: 'left', height: 380 })
    expect(Math.max(...p.map(q => q[0]))).toBeCloseTo(-1680, 9)
    expect(Math.min(...p.map(q => q[0]))).toBeCloseTo(-4680, 9)
  })

  it('reaches down to the underside of the superstructure', () => {
    const p = platformSection({ side: 'right', height: 550 }, { rail: '54E4', sleeper: 'B70' })
    expect(Math.min(...p.map(q => q[1]))).toBeCloseTo(-(RAILS['54E4'].height + SLEEPERS.B70.height), 9)
  })

  it('fits together with the section the way the drawing composes both', () => {
    // The overlay hands one flat list of points to fitSection: the section's
    // parts spread, the platform outlines flattened in. An outline spread as
    // a whole would put an array among the points and turn the whole fit —
    // and with it the entire drawing — into NaN.
    const s = crossSection({
      cant: 0,
      gaugeRing: gaugeProfileRing(GAUGE_PROFILES[DEFAULT_GAUGE_PROFILE].points),
      rail: '54E4', sleeper: 'B70',
    })
    const outlines = [platformSection({ side: 'right', height: 550 })]
    const all = [...s.gauge, ...s.runningCircles, ...s.sleeper, ...s.guides.flat(), ...outlines.flat()]
    const { k, bounds } = fitSection(all, { w: 400, h: 200 })
    expect(Number.isFinite(k)).toBe(true)
    expect(Number.isFinite(bounds.yMax)).toBe(true)
    expect(bounds.yMax).toBeCloseTo(4680, 9)   // the platform's back edge is the widest point
  })
})
