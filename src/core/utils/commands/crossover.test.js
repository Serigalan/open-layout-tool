import { describe, it, expect } from 'vitest'
import { adoptCrossover, crossoverRequest } from './crossover'
import { computeShiftBounds, solveConnection } from './sCurve'
import { minElementLength } from '../rules/elementLength'

const EPSG = 25832
const P = (e, n) => ({ easting: e, northing: n, zone: EPSG })
const pick = (startUtm, bearing, length, along, radius = null) => ({
  zone: EPSG, startUtm, bearing, along, route: { length, r1: radius, r2: radius },
  cantStart: 0, cantEnd: 0, speed: 80, trackEnds: [false, false], name: 'x',
})

// Track 1 straight, track 2 an R 800 bending away from it, 4.5 m apart at
// its start: at 80 km/h the one arc between the branches jumps in curvature
// below the comparison radius wherever the slider stands (LP.KS.01).
const picks = [pick(P(500000, 5600000), 0, 300, 150), pick(P(499995.5, 5599900), 1, 300, 140, -800)]
const SPEED = 80

// What the service answered for it (Python solver, 2026-10-21): a
// transition from the branch's curvature and an arc.
const ANSWER = {
  form: 0, label: '760 – 1:14', template: ['transition', 'arc'],
  s1: 0.6940785785742632, s2: 109.27430600676253,
  pieces: [
    { type: 'transition', length: 12, kappa: null },
    { type: 'arc', length: 98.35707094547843, kappa: 0.0009255784249655759 },
  ],
  hints: [], rwMin: 1163.076122936535, score: 0.2,
}

describe('the Python solver of a switch connection (Entscheidungen 357–358)', () => {
  it('is asked where the slider finds nothing', () => {
    const bounds = computeShiftBounds({ picks, speed: SPEED })
    expect(bounds.max > bounds.min).toBe(false)
    expect(solveConnection({ picks, speed: SPEED, shift: bounds.min }).valid).toBe(false)
  })

  it('gets both branch ends sampled for every form and the limits of the middle', () => {
    const req = crossoverRequest({ picks, speed: SPEED })
    expect(req.speed).toBe(SPEED)
    expect(req.limits.lMin).toBe(minElementLength(SPEED))
    expect(req.limits.rwDiscretion).toBeLessThan(req.limits.rwReg)
    expect(req.forms.length).toBeGreaterThan(0)
    const [form] = req.forms
    expect(form.label).toBe('760 – 1:14')
    for (const side of [form.first, form.second]) {
      expect(side.length).toBeGreaterThan(100)
      const steps = side.slice(1).map((p, i) => p.s - side[i].s)
      expect(Math.max(...steps)).toBeLessThanOrEqual(0.5 + 1e-9)
      expect(side.some(p => p.ok)).toBe(true)
    }
    // Relative to the first branch end, in metres.
    expect(Math.hypot(form.first[0].x, form.first[0].y)).toBeLessThan(1e-9)
  })

  it('adopts an answer as a shift and a spec with two values open, solved again here', () => {
    const adopted = adoptCrossover({ picks, speed: SPEED, solution: ANSWER })
    expect(adopted).not.toBeNull()
    expect(adopted.shift).toBeCloseTo(ANSWER.s1, 6)
    expect(adopted.mids.map(m => m.type)).toEqual(['transition', 'arc'])
    const open = adopted.mids.flatMap(m => [m.length, ...(m.type === 'arc' ? [m.radius] : [])]).filter(v => v == null)
    expect(open).toHaveLength(2)
    const res = solveConnection({ picks, speed: SPEED, shift: adopted.shift, mids: adopted.mids, seed: adopted.seed })
    expect(res.valid).toBe(true)
    expect(res.s2).toBeCloseTo(ANSWER.s2, 2)
    expect(res.midPieces[1].route.length).toBeCloseTo(ANSWER.pieces[1].length, 2)
  })

  it('gives the slider the stretch around the adopted shift', () => {
    const adopted = adoptCrossover({ picks, speed: SPEED, solution: ANSWER })
    const bounds = computeShiftBounds({ picks, speed: SPEED, mids: adopted.mids, seed: adopted.seed, around: adopted.shift })
    expect(bounds.min).toBeLessThanOrEqual(adopted.shift)
    expect(bounds.max).toBeGreaterThanOrEqual(adopted.shift)
  })

  it('says so where an answer does not close here', () => {
    // The first toe off the element it was picked on: nothing to lay it in.
    expect(adoptCrossover({ picks, speed: SPEED, solution: { ...ANSWER, s1: 400 } })).toBeNull()
  })
})
