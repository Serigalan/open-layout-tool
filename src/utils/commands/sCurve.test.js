import { describe, it, expect } from 'vitest'
import { SWITCH_TYPES } from '../switchConnectionUtils'
import { stems, solveConnection } from './sCurve'

const EPSG  = 25832
const P     = (e, n) => ({ easting: e, northing: n, zone: EPSG })
const SPEED = SWITCH_TYPES.find(f => f.label === '500 – 1:12').speed

/** A pick as the dialog makes one: the element it lies on and the station of the click. */
const pick = (startUtm, bearing, length, along, radius = null) => ({
  zone: EPSG, startUtm, bearing, along, elLength: length,
  route: { length, r1: radius, r2: radius },
  cantStart: 0, cantEnd: 0,
})

describe('which way the connection runs', () => {
  // Two parallel tracks running north. Track 2's element starts well behind
  // the first click, so its start node lies on the other side of it from the
  // second click.
  const p1 = pick(P(500000, 5600000), 0, 1000, 500)
  const p2 = pick(P(499995.5, 5599700), 0, 2000, 860)   // clicked at northing 5600560

  it('runs from the first click towards the second, not towards the element start of track 2', () => {
    expect(stems([p1, p2]).g1.dir ?? 1).toBe(1)
    const res = solveConnection({ picks: [p1, p2], speed: SPEED, shift: 0 })
    expect(res.valid).toBe(true)
    expect(res.TP2.northing).toBeGreaterThan(res.TP1.northing)
  })

  it('runs the other way when the second click lies behind the first', () => {
    const back = pick(P(499995.5, 5599700), 0, 2000, 740)   // northing 5600440
    expect(stems([p1, back]).g1.dir).toBe(-1)
    const res = solveConnection({ picks: [p1, back], speed: SPEED, shift: 0 })
    expect(res.valid).toBe(true)
    expect(res.TP2.northing).toBeLessThan(res.TP1.northing)
  })

  it('takes the second click on its own curve, not on the chord from the element start', () => {
    // Track 2 an arc bending away from track 1; its start node again behind the first click.
    const arc = pick(P(499995.5, 5599700), 0, 2000, 860, -3000)
    expect(stems([p1, arc]).g1.dir ?? 1).toBe(1)
  })
})
