import { describe, it, expect } from 'vitest'
import { governing, maxSpeeds, ruleMaxSpeed, ruleMaxSpeedsOf, SPEED_STEP } from './speed'
import { maxSpeedFor } from './cant'
import { checkTrack, elementVerdict } from './trassierungCheck'

const straight = (extra = {}) => ({ elementType: 0, length: 100, ...extra })
const arc = (radius, cant, extra = {}) => ({ elementType: 1, length: 100, radius, cant, ...extra })
const clothoid = (r1, r2, extra = {}) => ({ elementType: 2, length: 60, r1, r2, ...extra })

describe('what governs an element', () => {
  it('is the arc itself, with its signed radius and cant', () => {
    expect(governing([arc(-600, -80)], 0)).toEqual({ radius: -600, cant: -80 })
    expect(governing([arc(600)], 0)).toEqual({ radius: 600, cant: 0 })
  })

  it('is nothing on a straight', () => {
    expect(governing([straight()], 0)).toBe(null)
  })

  it('is the tighter end of a transition, with the cant of the neighbour there', () => {
    const els = [straight(), clothoid(null, 500), arc(500, 60)]
    expect(governing(els, 1)).toEqual({ radius: 500, cant: 60 })
    const back = [arc(800, 40), clothoid(800, 400), arc(400, 90)]
    expect(governing(back, 1)).toEqual({ radius: 400, cant: 90 })
    const out = [arc(400, 90), clothoid(400, 800), arc(800, 40)]
    expect(governing(out, 1)).toEqual({ radius: 400, cant: 90 })
  })

  it('takes the ramp a cut transition keeps as its own', () => {
    expect(governing([clothoid(null, 500, { cantStart: 0, cantEnd: 35 })], 0)).toEqual({ radius: 500, cant: 35 })
  })

  it('is nothing on a transition between two straights', () => {
    expect(governing([clothoid(null, null)], 0)).toBe(null)
  })
})

describe('the highest speed the rule catalogue allows (Entscheidung 372)', () => {
  const down = (v) => Math.floor(v / SPEED_STEP) * SPEED_STEP
  const errorsAt = (els, i, v) => elementVerdict(els.map((e, j) => (Math.abs(j - i) <= 1 ? { ...e, speed: v } : e)), i)
    .filter(r => r.severity === 'error').map(r => r.id)

  it('is the fastest speed on the 5 km/h step at which the element has no error', () => {
    const els = [arc(600, 80, { length: 1000 })]
    const { speed } = ruleMaxSpeed(els, 0)
    expect(speed % SPEED_STEP).toBe(0)
    expect(errorsAt(els, 0, speed)).toEqual([])
    expect(errorsAt(els, 0, speed + SPEED_STEP).length).toBeGreaterThan(0)
    // On a long arc only the deficiency limits it — the speed its discretion limit gives.
    expect(speed).toBe(down(maxSpeedFor(els[0], 600, 80)))
  })

  it('lets a Hinweis or a Warnung stand — only an error stops it', () => {
    const els = [arc(600, 80, { length: 1000 })]
    const { speed } = ruleMaxSpeed(els, 0)
    const severities = elementVerdict([{ ...els[0], speed }], 0).map(r => r.severity)
    expect(severities.some(s => s === 'hint' || s === 'warning')).toBe(true)
  })

  it('holds a straight to its minimum element length', () => {
    const els = [straight({ length: 30 })]
    const { speed } = ruleMaxSpeed(els, 0)
    expect(speed).toBeLessThan(300)
    expect(errorsAt(els, 0, speed)).toEqual([])
    expect(errorsAt(els, 0, speed + SPEED_STEP)).toContain('LP.EL.01')
  })

  it('reads the joints at both ends at its own speed', () => {
    // A straight into a tight arc without a transition: the comparison radius (LP.KS.01) limits both sides.
    const els = [straight({ length: 1000 }), arc(400, 0, { length: 1000 })]
    const { speed } = ruleMaxSpeed(els, 0)
    expect(speed).toBeLessThan(300)
    expect(errorsAt(els, 0, speed + SPEED_STEP)).toContain('LP.KS.01')
  })

  it('leaves out an error no speed removes, and names it', () => {
    const els = [arc(600, 63, { length: 1000 })]
    const { speed, fixed } = ruleMaxSpeed(els, 0)
    expect(fixed).toContain('LP.KB.03')
    expect(speed).toBe(ruleMaxSpeed([arc(600, 65, { length: 1000 })], 0).speed)
  })

  it('stays under the line speed, and searches below it rather than trimming down to it', () => {
    expect(maxSpeeds([arc(5000, 0, { length: 1000 }), straight({ length: 1000 })], 120).map(e => e.speed)).toEqual([120, 120])
    const els = [arc(600, 80, { length: 1000 })]
    expect(ruleMaxSpeed(els, 0, { cap: 100 }).speed).toBe(100)
  })

  it('returns an element that already has its speed unchanged', () => {
    const [first] = maxSpeeds([arc(600, 80, { length: 1000 })], null)
    expect(maxSpeeds([first], null)[0]).toBe(first)
  })

  it('holds a switch route to the switch deficiency', () => {
    const plain = maxSpeeds([arc(500, 0, { length: 1000 })], null)[0].speed
    const route = maxSpeeds([arc(500, 0, { length: 1000, switchBranch: 'branch', switchId: 's' })], null)[0].speed
    expect(route).toBeLessThan(plain)
  })

  it('adds no error when every element is set to it at once', () => {
    const els = [straight({ length: 300 }), clothoid(null, 800, { length: 90 }), arc(800, 90, { length: 200 }),
      clothoid(800, null, { length: 90 }), straight({ length: 50 }), arc(-1500, -40, { length: 300 })]
    const set = maxSpeeds(els, 160)
    const fixedAt = els.map((e, i) => ruleMaxSpeed(els, i).fixed)
    checkTrack(set).perElement.forEach((entry, i) => {
      const errors = entry.results.filter(r => r.severity === 'error').map(r => r.id).filter(id => !fixedAt[i].includes(id))
      expect(errors, `element ${i}`).toEqual([])
    })
  })

  it('works each chain out once', () => {
    const els = [arc(600, 80, { length: 1000 })]
    expect(ruleMaxSpeedsOf(els)).toBe(ruleMaxSpeedsOf(els))
    expect(ruleMaxSpeedsOf(els)[0]).toEqual(ruleMaxSpeed(els, 0))
  })
})
