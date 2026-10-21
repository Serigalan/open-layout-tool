import { describe, it, expect } from 'vitest'
import { fileCants, signedCants, withFileCants } from './fileCants'

const straight = { elementType: 0 }
const arc = (radius) => ({ elementType: 1, radius })
const transition = (r1, r2) => ({ elementType: 2, r1, r2 })

describe('the cants of an exchange file', () => {
  // W12 of the test axes: a right-hand curve ramps up to 25 mm, a straight
  // keeps it, a ramp between two straights takes it to 17.2, and a left-hand
  // curve brings it down — canted against its own curve, as the file says.
  const w12 = [transition(218.59, 218.59), straight, transition(null, null), transition(-409.99, -362.14)]
  const w12File = [{ start: 0, end: 25 }, { start: 25, end: 25 }, { start: 25, end: 17.2 }, { start: -17.2, end: 0 }]

  it('are signed by the raised rail, the straight ones by the cant they continue', () => {
    expect(signedCants(w12, w12File)).toEqual([
      { start: 0, end: 25 }, { start: 25, end: 25 }, { start: 25, end: 17.2 }, { start: 17.2, end: 0 },
    ])
  })

  it('take their side from what follows where a ramp starts at nothing', () => {
    // 55501R: out of a left-hand curve down to 0 between two straights, and up again into a right-hand one.
    const els = [transition(-465, null), transition(null, null), transition(null, null), transition(null, 500)]
    const file = [{ start: 100, end: 15 }, { start: 15, end: 0 }, { start: 0, end: 15 }, { start: 15, end: 100 }]
    expect(signedCants(els, file)).toEqual([
      { start: -100, end: -15 }, { start: -15, end: 0 }, { start: 0, end: 15 }, { start: 15, end: 100 },
    ])
  })

  it('put a transition its own ends only where the neighbours do not state them', () => {
    const els = [straight, transition(null, -500), arc(-500), transition(-500, -500), arc(-500)]
    const out = withFileCants(els, [
      { start: 0, end: 0 }, { start: 0, end: 60 }, { start: 60, end: 60 }, { start: 60, end: 80 }, { start: 80, end: 80 },
    ])
    expect(out.map(el => el.cant)).toEqual([undefined, undefined, -60, undefined, -80])
    expect(out[1]).not.toHaveProperty('cantStart')
    expect(out[1]).not.toHaveProperty('cantEnd')
    // A ramp from one arc's cant to the next one's is what the neighbours say already.
    expect(out[3]).not.toHaveProperty('cantStart')
    const step = withFileCants(els.slice(0, 3), [{ start: 0, end: 0 }, { start: 0, end: 40 }, { start: 60, end: 60 }])
    expect(step[1].cantEnd).toBe(-40)
  })

  it('go out as they came in', () => {
    const built = withFileCants(w12, w12File)
    expect(fileCants(built)).toEqual(w12File)
  })
})
