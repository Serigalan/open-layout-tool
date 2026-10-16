import { describe, it, expect } from 'vitest'
import { connectTransitionLengths, lengthRuleFormula, transitionChain, transitionCheck, transitionHasError, transitionLengths } from './transitionLength'

const straight = { elementType: 0, cant: 0, speed: 120 }
const arc = (radius, cant, speed = 120) => ({ elementType: 1, radius, cant, speed })

describe('the length of a transition by the rules', () => {
  it('runs a clothoid into a canted curve at 10·v·Δu, down to 8·v·Δu', () => {
    // 10 · 120 · 100 / 1000 = 120 m; the Ermessensgrenze 96 m.
    expect(transitionLengths({ prev: straight, next: arc(1000, 100), speed: 120 }))
      .toMatchObject({ regular: 120, minimum: 96 })
    // Out of the curve the same.
    expect(transitionLengths({ prev: arc(1000, 100), next: straight, r1: 1000, speed: 120 }))
      .toMatchObject({ regular: 120, minimum: 96 })
  })

  it('takes the deficiency where there is no cant to ramp, which has no Ermessensgrenze', () => {
    // u_f = 11.8 · 120² / 1000 = 170 mm: 4 · 120 · 170 / 1000 = 81.6 m.
    expect(transitionLengths({ prev: straight, next: arc(1000, 0), speed: 120 }))
      .toMatchObject({ regular: 81.6, minimum: 81.6 })
  })

  it('holds a Bloss curve to 8·v·Δu, down to 6·v·Δu', () => {
    expect(transitionLengths({ prev: straight, next: arc(1000, 100), type: 'bloss', speed: 120 }))
      .toMatchObject({ regular: 96, minimum: 72 })
  })

  it('rounds up to a full decimetre, and the result holds', () => {
    // u_f = 11.8 · 100² / 700 − 60 = 109 mm: 4 · 100 · 109 / 1000 = 43.6 m;
    // Δu 60: 10 · 100 · 60 / 1000 = 60 m, the ramp 1:600 = 36 m.
    const next = { elementType: 1, radius: 700, cant: 60, speed: 100 }
    const { regular, minimum } = transitionLengths({ prev: { ...straight, speed: 100 }, next, speed: 100 })
    expect(regular).toBe(60)
    expect(minimum).toBe(48)
    const odd = transitionLengths({ prev: straight, next: arc(1234, 0), speed: 120 })
    // 11.8 · 14400 / 1234 = 137.7 → 138 mm: 4 · 120 · 138 / 1000 = 66.24 m.
    expect(odd.regular).toBe(66.3)
    const check = transitionCheck(transitionChain({ prev: straight, next: arc(1234, 0), length: odd.regular, speed: 120 }))
    expect(check.severity).toBe('ok')
  })

  it('lists every rule on the length with its bound, the longest first, those that set it marked', () => {
    const setBy = (list) => list.filter(b => b.binding).map(({ binding: _b, ...b }) => b)
    // The ramp at 10·v·Δu sets the Regellänge, at 8·v·Δu the Mindestlänge.
    const ramp = transitionLengths({ prev: straight, next: arc(1000, 100), speed: 120 })
    expect(setBy(ramp.regularBy)).toEqual([{ id: 'LP.UB.03', formula: '10·v·Δu/1000', length: 120 }])
    expect(setBy(ramp.minimumBy)).toEqual([{ id: 'LP.UB.03', formula: '8·v·Δu/1000', length: 96 }])
    // Without cant to ramp, the change of the deficiency, which has no Ermessensgrenze.
    const flat = transitionLengths({ prev: straight, next: arc(1000, 0), speed: 120 })
    expect(setBy(flat.minimumBy)).toEqual([{ id: 'LP.UB.05', formula: '4·v·Δu_f/1000', length: expect.closeTo(81.6, 6) }])
    // At 60 km/h and 20 mm the ramp's 10·v·Δu and its slope 1:600 both come
    // to 12 m; the slope is a bound on the length through Δu.
    expect(setBy(transitionLengths({ prev: { ...straight, speed: 60 }, next: arc(3000, 20, 60), speed: 60 }).regularBy)).toEqual([
      { id: 'LP.UB.03', formula: '10·v·Δu/1000', length: 12 },
      { id: 'LP.UB.07', formula: '600·Δu/1000', length: 12 },
    ])
    // A Bloss curve's ramp is steeper in its middle than on average: 2/3·m_M
    // is held to 1:600 (1:400), so m_M to 900 (600). At 60 km/h and 20 mm
    // that is 18 m (12 m) and sets the length over 8·v·Δu (6·v·Δu).
    const bloss = transitionLengths({ prev: { ...straight, speed: 60 }, next: arc(3000, 20, 60), type: 'bloss', speed: 60 })
    expect(setBy(bloss.regularBy)).toEqual([{ id: 'LP.UB.07', formula: '900·Δu/1000', length: 18 }])
    expect(setBy(bloss.minimumBy)).toEqual([{ id: 'LP.UB.07', formula: '600·Δu/1000', length: 12 }])
    expect(lengthRuleFormula('LP.UB.07', 'ok', 'clothoid')).toBe('600·Δu/1000')
    // A table has no formula: the minimum element length at 60 km/h, 6 m.
    expect(setBy(transitionLengths({ prev: { ...straight, speed: 60 }, next: arc(5000, 0, 60), speed: 60 }).regularBy))
      .toEqual([{ id: 'LP.EL.01', formula: null, length: 6 }])
    // A compound curve R 410 / 80 mm into R 750 / 45 mm at 80 km/h: the ramp
    // sets 28 m; the deficiency, 104 − 56 = 48 mm, asks for 15.36 m and is listed.
    const compound = transitionLengths({ prev: arc(410, 80, 80), next: arc(750, 45, 80), r1: 410, speed: 80 })
    expect(compound.regularBy.map(b => [b.id, b.length, b.binding])).toEqual([
      ['LP.UB.03', 28, true], ['LP.UB.07', 21, false], ['LP.UB.05', expect.closeTo(15.36, 6), false], ['LP.EL.01', 12, false],
    ])
  })

  it('says nothing without a design speed', () => {
    expect(transitionLengths({ prev: straight, next: arc(1000, 100), speed: 0 }))
      .toMatchObject({ regular: null, minimum: null })
  })

  it('finds a transition too short for its ramp', () => {
    const check = transitionCheck(transitionChain({ prev: straight, next: arc(1000, 100), length: 50, speed: 120 }))
    expect(check.severity).toBe('error')
    expect(check.results.find(r => r.id === 'LP.UB.03').severity).toBe('error')
  })
})

describe('the transition out of a canted arc into a straight (Entscheidung 316)', () => {
  it('has a Regellänge that ramps the cant down without an error, longer the more cant there is', () => {
    const at = (cant) => connectTransitionLengths({ prevCant: cant, r1: 600, type: 'clothoid', speed: 100 }).regular
    expect(at(100)).toBeGreaterThan(0)
    expect(at(140)).toBeGreaterThan(at(60))
    const chain = transitionChain({
      prev: { elementType: 1, radius: 600, cant: 100, speed: 100 }, next: { elementType: 0, cant: 0, speed: 100 },
      r1: 600, length: at(100), speed: 100,
    })
    expect(transitionHasError(chain)).toBe(false)
  })
})
