import { describe, it, expect } from 'vitest'
import {
  RUNNING_CIRCLE_DISTANCE, TRACK_GAUGE,
  resolveSuperstructure, cantAngle, rotatePoint, fitSection, sectionStates, crossSection,
} from './crossSectionUtils'
import { GAUGE_PROFILES, DEFAULT_GAUGE_PROFILE, gaugeProfileRing } from './gaugeProfiles'

describe('the frame the section is drawn in', () => {
  it('states the two track figures in millimetres, not metres', () => {
    expect(RUNNING_CIRCLE_DISTANCE).toBe(1500)
    expect(TRACK_GAUGE).toBe(1435)
  })
})

describe('resolveSuperstructure', () => {
  const track = { rail: 'S54', sleeper: 'B70' }

  it('takes the track’s superstructure where the element says nothing', () => {
    expect(resolveSuperstructure(track, { length: 100 })).toEqual({ rail: 'S54', sleeper: 'B70' })
  })

  it('lets the element win, field by field — a rail change need not restate the sleeper', () => {
    expect(resolveSuperstructure(track, { rail: 'UIC60' })).toEqual({ rail: 'UIC60', sleeper: 'B70' })
  })

  it('answers with nothing where neither states anything', () => {
    expect(resolveSuperstructure({}, {})).toEqual({ rail: null, sleeper: null })
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
    expect(sectionStates({ cant: 80, radius: -500 })).toEqual([{ id: 'const', cant: 80, radius: -500 }])
  })

  it('reads a transition at both ends — the ramp answers for neither middle', () => {
    const el = { elementType: 2, cantStart: 0, cantEnd: 120, r1: null, r2: 300 }
    expect(sectionStates(el)).toEqual([
      { id: 'start', cant: 0, radius: null },
      { id: 'end', cant: 120, radius: 300 },
    ])
  })

  it('reads a straight as the one state without cant it is', () => {
    expect(sectionStates({ length: 200 })).toEqual([{ id: 'const', cant: 0, radius: null }])
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
