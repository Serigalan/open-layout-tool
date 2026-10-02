import { describe, it, expect } from 'vitest'
import { governing, maxSpeeds, SPEED_STEP } from './speed'
import { maxSpeedFor } from './cant'

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

describe('the highest speeds the geometry allows', () => {
  const down = (v) => Math.floor(v / SPEED_STEP) * SPEED_STEP

  it('gives a curve what its deficiency leaves room for, on the 5 km/h step', () => {
    const [a] = maxSpeeds([arc(600, 80)], null)
    expect(a.speed).toBe(down(maxSpeedFor(a, 600, 80)))
    expect(a.speed % SPEED_STEP).toBe(0)
  })

  it('gives a straight the faster of the curves it runs between, past other straights', () => {
    const els = [arc(300, 100), straight(), straight(), arc(1200, 60)]
    const out = maxSpeeds(els, null)
    const slow = out[0].speed, fast = out[3].speed
    expect(fast).toBeGreaterThan(slow)
    expect(out[1].speed).toBe(fast)
    expect(out[2].speed).toBe(fast)
  })

  it('leaves a straight with no curve anywhere as it was, unless the cap trims it', () => {
    const lone = straight({ speed: 200 })
    expect(maxSpeeds([lone], null)[0]).toBe(lone)
    expect(maxSpeeds([lone], 160)[0].speed).toBe(160)
    expect(maxSpeeds([straight()], 160)[0].speed).toBeUndefined()
  })

  it('never goes past the line speed', () => {
    const out = maxSpeeds([arc(5000, 0), straight()], 120)
    expect(out.map(e => e.speed)).toEqual([120, 120])
  })

  it('returns an element that already has its speed unchanged', () => {
    const [first] = maxSpeeds([arc(600, 80)], null)
    expect(maxSpeeds([first], null)[0]).toBe(first)
  })

  it('holds a switch route to the switch deficiency', () => {
    const plain = maxSpeeds([arc(500, 0)], null)[0].speed
    const route = maxSpeeds([arc(500, 0, { switchBranch: 'branch' })], null)[0].speed
    expect(route).toBeLessThanOrEqual(plain)
  })
})
