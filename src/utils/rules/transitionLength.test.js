import { describe, it, expect } from 'vitest'
import { transitionChain, transitionCheck, transitionLengths } from './transitionLength'

const straight = { elementType: 0, cant: 0, speed: 120 }
const arc = (radius, cant) => ({ elementType: 1, radius, cant, speed: 120 })

describe('the length of a transition by the rules', () => {
  it('runs a clothoid into a canted curve at 10·v·Δu, down to 8·v·Δu', () => {
    // 10 · 120 · 100 / 1000 = 120 m; the Ermessensgrenze 96 m.
    expect(transitionLengths({ prev: straight, next: arc(1000, 100), speed: 120 }))
      .toEqual({ regular: 120, minimum: 96 })
    // Out of the curve the same.
    expect(transitionLengths({ prev: arc(1000, 100), next: straight, r1: 1000, speed: 120 }))
      .toEqual({ regular: 120, minimum: 96 })
  })

  it('takes the deficiency where there is no cant to ramp, which has no Ermessensgrenze', () => {
    // u_f = 11.8 · 120² / 1000 = 170 mm: 4 · 120 · 170 / 1000 = 81.6 m.
    expect(transitionLengths({ prev: straight, next: arc(1000, 0), speed: 120 }))
      .toEqual({ regular: 81.6, minimum: 81.6 })
  })

  it('holds a Bloss curve to 8·v·Δu, down to 6·v·Δu', () => {
    expect(transitionLengths({ prev: straight, next: arc(1000, 100), type: 'bloss', speed: 120 }))
      .toEqual({ regular: 96, minimum: 72 })
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

  it('says nothing without a design speed', () => {
    expect(transitionLengths({ prev: straight, next: arc(1000, 100), speed: 0 }))
      .toEqual({ regular: null, minimum: null })
  })

  it('finds a transition too short for its ramp', () => {
    const check = transitionCheck(transitionChain({ prev: straight, next: arc(1000, 100), length: 50, speed: 120 }))
    expect(check.severity).toBe('error')
    expect(check.results.find(r => r.id === 'LP.UB.03').severity).toBe('error')
  })
})
