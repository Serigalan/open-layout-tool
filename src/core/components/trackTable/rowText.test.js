import { describe, it, expect } from 'vitest'
import { comparisonRadiusText, lengthText, radiusText } from './rowText'
import { boundaryScope } from '../../utils/trassierungCheck'

describe('what the element table shows', () => {
  it('rounds lengths and radii to three decimals', () => {
    expect(lengthText(41.594612345, 'de')).toBe('41,595')
    expect(radiusText({ r1: -1342.5322214966, r2: null }, 'en')).toBe('-1342.532 → ∞')
  })

  it('gives the comparison radius of a joint, and none where the curvature runs on', () => {
    // R 500 into R 1000 the same way: 1/r_w = 1/500 − 1/1000, so 1000 m.
    const arcs = [{ elementType: 1, radius: 500 }, { elementType: 1, radius: 1000 }]
    expect(comparisonRadiusText(boundaryScope(arcs, 0)['physics.r_w'], 'de')).toBe('1000')
    // Against each other: 1/500 + 1/1000, so 333.333 m.
    const reverse = [{ elementType: 1, radius: 500 }, { elementType: 1, radius: -1000 }]
    expect(comparisonRadiusText(boundaryScope(reverse, 0)['physics.r_w'], 'de')).toBe('333,333')
    // A clothoid out of the arc runs on from its radius.
    const ramp = [{ elementType: 1, radius: 500 }, { elementType: 2, r1: 500, r2: null }]
    expect(comparisonRadiusText(boundaryScope(ramp, 0)['physics.r_w'], 'de')).toBe('–')
  })
})
