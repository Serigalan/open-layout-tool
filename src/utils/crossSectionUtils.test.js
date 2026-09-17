import { describe, it, expect } from 'vitest'
import {
  RUNNING_CIRCLE_DISTANCE, TRACK_GAUGE, RAILS, SLEEPERS, DEFAULT_RAIL, DEFAULT_SLEEPER,
  superstructureAt, elementStartStation,
  cantAngle, rotatePoint, fitSection, sectionStates, crossSection,
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

describe('sectionStates', () => {
  it('reads an arc once, at the cant and radius it carries throughout', () => {
    expect(sectionStates({ cant: 80, radius: -500, length: 40 }, 120))
      .toEqual([{ id: 'const', cant: 80, radius: -500, station: 120 }])
  })

  it('reads a transition at both ends — the ramp answers for neither middle', () => {
    const el = { elementType: 2, cantStart: 0, cantEnd: 120, r1: null, r2: 300, length: 60 }
    expect(sectionStates(el, 40)).toEqual([
      { id: 'start', cant: 0, radius: null, station: 40 },
      { id: 'end', cant: 120, radius: 300, station: 100 },
    ])
  })

  it('reads a straight as the one state without cant it is', () => {
    expect(sectionStates({ length: 200 })).toEqual([{ id: 'const', cant: 0, radius: null, station: 0 }])
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
