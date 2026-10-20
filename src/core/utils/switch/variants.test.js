import { describe, it, expect } from 'vitest'
import {
  ALL_SWITCH_TYPES, CROSSING_TYPES, switchStraightLength, switchTypeByLabel, switchVariantFor, switchVariants,
} from './catalogue'

// The variants are the rows of the DB switch table (800.0120, 05/2024); the
// geometry stays the form's. These tests hold the two against each other.

const straightPiece = (form) => (form.branch ?? [])
  .filter(section => section.type === 'straight')
  .reduce((sum, section) => sum + section.length, 0)

describe('switch variants', () => {
  it('every turnout row is built by its form to 3 mm', () => {
    let rows = 0
    for (const form of ALL_SWITCH_TYPES) {
      const alpha = Math.atan(1 / form.ratio)
      for (const v of switchVariants(form)) {
        rows++
        const m = v.masse
        expect(Math.abs(switchStraightLength(form) - m.l), `${v.nr} l`).toBeLessThan(0.003)
        if (form.symmetric) continue
        const a = form.R * Math.tan(alpha / 2)
        expect(Math.abs(a - m.a), `${v.nr} a`).toBeLessThan(0.003)
        expect(Math.abs(a + straightPiece(form) - m.b), `${v.nr} b`).toBeLessThan(0.003)
        expect(Math.abs((a + straightPiece(form)) * Math.sin(alpha) - m.c), `${v.nr} c`).toBeLessThan(0.003)
      }
    }
    expect(rows).toBeGreaterThan(60)
  })

  it('every crossing row has the tangent of its form', () => {
    for (const form of CROSSING_TYPES.filter(f => f.kind === 'crossing')) {
      for (const v of switchVariants(form)) expect(Math.abs(form.lt - v.masse.l1), `${v.nr}`).toBeLessThan(0.001)
    }
  })

  it('a variant keeps the form’s ldS and states its sleepers', () => {
    const form = switchTypeByLabel('760 – 1:14')
    expect(form.lds).toBe(5.125)
    const v49 = switchVariants(form).find(v => v.profil === '49E5')
    expect(v49.masse.lds).toBe(4.04)
    const v54 = switchVariants(form).find(v => v.nr === 1009)
    expect(v54).toMatchObject({ profil: '54E4', schwellen: 'beton', klasse: 'regel', schwellenzahl: 99, klammer: [3, 7, 8] })
  })

  it('picks the variant of the track’s rail: concrete before timber, Regelform before Sonderbauform', () => {
    const form = switchTypeByLabel('500 – 1:12')
    expect(switchVariantFor(form, '54E4').nr).toBe(1008)
    expect(switchVariantFor(form, '60E2').nr).toBe(1012)
    expect(switchVariantFor(form, '49E5').nr).toBe(1003)
    // No variant has the profile: the form's first.
    expect(switchVariantFor(switchTypeByLabel('300 – 1:14'), '49E5').nr).toBe(1042)
    expect(switchVariantFor(switchTypeByLabel('190 – 1:6.3'), '54E4')).toBeNull()
  })

  it('the 215 – 1:4.8 keeps ldS 0 although the table states −0.244', () => {
    const form = switchTypeByLabel('215 – 1:4.8')
    expect(form.lds).toBe(0)
    expect(switchVariants(form).every(v => v.masse.lds < 0)).toBe(true)
  })
})
