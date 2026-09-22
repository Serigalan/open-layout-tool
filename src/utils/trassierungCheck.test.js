import { describe, it, expect } from 'vitest'
import {
  boundaryScope, checkTrack, elementScope, formOf, hasRuleError, isCheckable, rampScope,
} from './trassierungCheck'
import { computeCantDefSigned } from './mapConstants'

// A chain that keeps every rule of the catalogue: 100 km/h throughout, the
// Regelüberhöhung for R = 1000 (65 mm), a clothoid long enough for both the
// cant ramp and the change in deficiency, and no jump in curvature or cant
// anywhere along it.
const clean = () => [
  { elementType: 0, length: 100, speed: 100, cant: 0 },
  { elementType: 2, length: 65, speed: 100, r1: null, r2: 1000, transitionType: 'clothoid' },
  { elementType: 1, length: 200, speed: 100, radius: 1000, cant: 65 },
]

const ids = (entry) => entry.results.map(r => `${r.id}:${r.severity}`)
const firing = (entry) => entry.results.filter(r => r.severity !== 'ok').map(r => `${r.id}:${r.severity}`)

describe('a chain that keeps the rules', () => {
  const out = checkTrack(clean())

  it('finds nothing above ok anywhere', () => {
    expect(out.severity).toBe('ok')
    expect(out.perElement.flatMap(firing)).toEqual([])
  })

  it('really applied the rules rather than skipping them', () => {
    expect(ids(out.elements[2])).toContain('LP.KB.04:ok')   // the Regelüberhöhung itself
    expect(ids(out.elements[1])).toContain('LP.UB.03:ok')   // the ramp gradient
    expect(ids(out.ramps[0])).toEqual(['LP.UB.02:ok'])
    expect(out.boundaries).toHaveLength(2)
  })
})

describe('what the scopes take from an element', () => {
  const els = clean()

  it('reads the cant deficiency the way the rest of the app does', () => {
    expect(elementScope(els, 2)['physics.u_f']).toBe(computeCantDefSigned(100, 1000, 65))
  })

  it('reads the ramp of a transition from the elements it joins', () => {
    expect(elementScope(els, 1)['physics.delta_u']).toBe(65)
    expect(elementScope(els, 1)['physics.ramp_slope']).toBeCloseTo(1000, 6)
  })

  it('measures the cross level over a reverse transition from rail to rail', () => {
    // +50 to −50 is a hundred millimetres of cross level, not none.
    const reverse = [
      { elementType: 1, length: 100, speed: 100, radius: 1000, cant: 50 },
      { elementType: 2, length: 100, speed: 100, r1: 1000, r2: -1000, transitionType: 'clothoid' },
      { elementType: 1, length: 100, speed: 100, radius: -1000, cant: -50 },
    ]
    expect(elementScope(reverse, 1)['physics.delta_u']).toBe(100)
  })

  it('states the cant as a magnitude, whichever rail the curve raises', () => {
    const left = [{ elementType: 1, length: 100, speed: 100, radius: -1000, cant: -65 }]
    expect(elementScope(left, 0)['element.cant']).toBe(65)
  })

  it('calls a straight between opposed curves a reverse-curve straight, and nothing else', () => {
    const between = [
      { elementType: 1, length: 100, speed: 40, radius: 300, cant: 0 },
      { elementType: 0, length: 5, speed: 40, cant: 0 },
      { elementType: 1, length: 100, speed: 40, radius: -300, cant: 0 },
    ]
    expect(elementScope(between, 1)['model.reverse_curve_straight']).toBe(true)
    const same = [...between]
    same[2] = { ...same[2], radius: 300 }
    expect(elementScope(same, 1)['model.reverse_curve_straight']).toBe(false)
    expect(elementScope(clean(), 0)['model.reverse_curve_straight']).toBe(false)
  })

  it('reads a boundary as the two curvatures that meet there', () => {
    const jumped = [
      { elementType: 0, length: 100, speed: 100, cant: 0 },
      { elementType: 1, length: 100, speed: 100, radius: 1000, cant: 0 },
    ]
    const scope = boundaryScope(jumped, 0)
    expect(scope['physics.curvature_jump']).toBe(true)
    expect(scope['physics.r_w']).toBeCloseTo(1000, 6)
    expect(boundaryScope(clean(), 0)['physics.curvature_jump']).toBe(false)
    expect(boundaryScope(clean(), 0)['physics.r_w']).toBe(Infinity)
  })

  it('gives two curves in the same sense the larger comparison radius', () => {
    const els2 = [
      { elementType: 1, length: 100, speed: 100, radius: 1000, cant: 0 },
      { elementType: 1, length: 100, speed: 100, radius: 800, cant: 0 },
    ]
    // 1/r_w = |1/1000 − 1/800| → r_w = 1000·800/200
    expect(boundaryScope(els2, 0)['physics.r_w']).toBeCloseTo(4000, 6)
  })

  it('gives two curves against each other the smaller one', () => {
    const els2 = [
      { elementType: 1, length: 100, speed: 100, radius: 1000, cant: 0 },
      { elementType: 1, length: 100, speed: 100, radius: -1000, cant: 0 },
    ]
    expect(boundaryScope(els2, 0)['physics.r_w']).toBeCloseTo(500, 6)
  })

  it('knows the form of a transition and that the ramp on it is straight', () => {
    expect(formOf({ elementType: 2 })).toBe('clothoid')
    expect(formOf({ elementType: 2, transitionType: 'bloss' })).toBe('bloss')
    expect(formOf({ elementType: 1 })).toBe(null)
    expect(rampScope(clean(), 1)).toEqual({
      'model.ramp_on_transition': true, 'model.ramp_form_matches': true,
    })
  })
})

describe('what the checker finds', () => {
  it('an element shorter than its speed allows', () => {
    const els = clean()
    els[0] = { ...els[0], length: 10 }      // 100 km/h asks for 15 m
    expect(firing(checkTrack(els).perElement[0])).toContain('LP.EL.01:error')
  })

  it('a design speed off the 5 km/h step, and one outside the range at all', () => {
    const els = clean()
    els[2] = { ...els[2], speed: 102 }
    expect(firing(checkTrack(els).perElement[2])).toContain('LP.ALL.02:error')
    els[2] = { ...els[2], speed: 305 }
    expect(firing(checkTrack(els).perElement[2])).toContain('LP.ALL.01:error')
  })

  it('a cant that steps at a joint, counted at the element it begins', () => {
    const els = clean()
    els[2] = { ...els[2], cantStart: undefined, cant: 70 }
    // The transition takes its end cant from the arc, so move the arc alone:
    els[1] = { ...els[1], cantEnd: 65 }
    const out = checkTrack(els)
    expect(firing(out.perElement[2])).toContain('LP.UB.01:error')
    expect(firing(out.perElement[1])).not.toContain('LP.UB.01:error')
  })

  it('a curvature that jumps, and how sharp the jump is allowed to be', () => {
    const sharp = [
      { elementType: 0, length: 100, speed: 100, cant: 0 },
      { elementType: 1, length: 100, speed: 100, radius: 1000, cant: 0 },
    ]
    // r_w = 1000 m against a Regelwert of 1370 and an Ermessensgrenze of 1110.
    expect(firing(checkTrack(sharp).perElement[1])).toContain('LP.KS.01:error')
    const gentle = [sharp[0], { ...sharp[1], radius: 2000 }]
    const found = firing(checkTrack(gentle).perElement[1])
    expect(found).not.toContain('LP.KS.01:error')
    // Still a jump where a transition belongs, which is the other rule's point.
    expect(found).toContain('LP.KS.02:hint')
  })

  it('leaves a curvature jump inside one turnout to the turnout\'s own catalogue', () => {
    const inside = [
      { elementType: 0, length: 20, speed: 40, cant: 0, switchId: 'sw-1' },
      { elementType: 1, length: 20, speed: 40, radius: 190, cant: 0, switchId: 'sw-1' },
    ]
    const applied = checkTrack(inside).boundaries[0].results.map(r => r.id)
    expect(applied).toEqual(['LP.UB.01'])
  })

  it('a turnout canted past what a turnout may carry', () => {
    const els = [{ elementType: 1, length: 30, speed: 60, radius: 300, cant: 110, switchId: 'sw-1' }]
    const found = firing(checkTrack(els).perElement[0])
    expect(found).toContain('LP.KB.05:warning')       // past 100, inside 120
    els[0] = { ...els[0], cant: 130 }
    expect(firing(checkTrack(els).perElement[0])).toContain('LP.KB.05:error')
  })

  it('a straight ramp drawn on a Bloß curve', () => {
    const els = clean()
    els[1] = { ...els[1], transitionType: 'bloss' }
    const out = checkTrack(els)
    // The app interpolates cant linearly on every transition, so the ramp on a
    // Bloß curve is the wrong shape — a Sonderfall, and truthfully one.
    expect(ids(out.ramps[0])).toEqual(['LP.UB.02:special_case'])
    expect(firing(out.perElement[1])).toContain('LP.UB.09:hint')
    expect(out.severity).toBe('special_case')
  })

  it('a cant ramp far too steep for its speed', () => {
    const els = clean()
    els[1] = { ...els[1], length: 20 }           // 65 mm over 20 m is 1:308
    const found = firing(checkTrack(els).perElement[1])
    expect(found).toContain('LP.UB.03:error')
    expect(found).toContain('LP.UB.07:error')
  })
})

describe('an element the catalogue cannot speak about', () => {
  it('is one whose design speed is unknown', () => {
    expect(isCheckable({ speed: 100 })).toBe(true)
    expect(isCheckable({ speed: 0 })).toBe(false)
    expect(isCheckable({})).toBe(false)
  })

  it('is left unchecked rather than judged as a slow one', () => {
    const els = clean()
    els[0] = { ...els[0], speed: 0, length: 1 }
    const out = checkTrack(els)
    expect(out.perElement[0]).toMatchObject({ unchecked: true, severity: null, results: [] })
    // And the joint it sits at goes with it — a boundary needs both sides.
    expect(out.boundaries.map(b => b.index)).toEqual([1])
    expect(out.severity).toBe('ok')
  })
})

describe('an empty track', () => {
  it('has nothing to say about it', () => {
    expect(checkTrack([])).toMatchObject({ perElement: [], boundaries: [], ramps: [], severity: null })
    expect(checkTrack()).toMatchObject({ severity: null })
  })
})

// What a creation dialog asks before it lets a commit through.
describe('hasRuleError', () => {
  it('is false for a chain the catalogue has nothing to fault', () => {
    expect(hasRuleError(clean())).toBe(false)
  })

  it('is true where any rule of the catalogue says error', () => {
    const short = [{ elementType: 0, length: 3, speed: 100, cant: 0 }]
    expect(hasRuleError(short)).toBe(true)                     // LP.EL.01
    expect(hasRuleError([{ ...short[0], length: 100, speed: 83 }])).toBe(true)   // LP.ALL.02
    expect(hasRuleError([{ ...short[0], length: 100, speed: 320 }])).toBe(true)  // LP.ALL.01
  })

  // The catalogue says of a Sonderfall that it wants an experienced hand, not
  // that it is forbidden — so a Bloß transition still commits.
  it('is false for a Sonderfall, which ranks below an error', () => {
    const bloss = clean()
    bloss[1] = { ...bloss[1], transitionType: 'bloss' }
    expect(checkTrack(bloss).severity).toBe('special_case')
    expect(hasRuleError(bloss)).toBe(false)
  })

  it('is false for a hint alone', () => {
    const offRegel = clean()
    offRegel[2] = { ...offRegel[2], cant: 60 }        // not the Regelüberhöhung
    expect(checkTrack(offRegel).severity).toBe('hint')
    expect(hasRuleError(offRegel)).toBe(false)
  })

  it('is false where there is no design speed to judge by, and for nothing at all', () => {
    expect(hasRuleError([{ elementType: 0, length: 3, speed: 0 }])).toBe(false)
    expect(hasRuleError([])).toBe(false)
    expect(hasRuleError()).toBe(false)
  })
})
