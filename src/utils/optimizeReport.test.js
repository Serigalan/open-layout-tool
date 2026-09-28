import { describe, it, expect } from 'vitest'
import { formatGrund, grundText } from './optimizeReport'

describe('formatGrund', () => {
  it('is null where there is no grund (an unchanged row)', () => {
    expect(formatGrund(undefined)).toBeNull()
    expect(formatGrund(null)).toBeNull()
  })

  it('formats korridor in cm, not the metres the service sends', () => {
    expect(formatGrund({ regel: 'korridor', ist: 0.499, soll: 0.5 }))
      .toEqual({ key: 'optimize_grund_korridor', ist: '49.9', soll: '50.0', regelId: null })
  })

  it('formats zielgeschwindigkeit and cant ceilings without decimals', () => {
    expect(formatGrund({ regel: 'zielgeschwindigkeit', ist: 115.5, soll: 115 }))
      .toEqual({ key: 'optimize_grund_zielgeschwindigkeit', ist: '116', soll: '115', regelId: null })
    expect(formatGrund({ regel: 'weiche', arc: 1, ist: 100, soll: 100 }))
      .toEqual({ key: 'optimize_grund_weiche', ist: '100', soll: '100', regelId: null })
  })

  it('carries the rule of the catalogue a limit came from', () => {
    expect(formatGrund({ regel: 'rampenregel', slot: 1, ist: 150, soll: 50, regelId: 'LP.UB.03' }))
      .toEqual({ key: 'optimize_grund_rampenregel', ist: '150.0', soll: '50.0', regelId: 'LP.UB.03' })
    expect(formatGrund({ regel: 'kruemmungssprung', slot: 1, ist: 904.99, soll: 875, regelId: 'LP.KS.01' }))
      .toEqual({ key: 'optimize_grund_kruemmungssprung', ist: '905', soll: '875', regelId: 'LP.KS.01' })
  })

  it('is null for a regel it does not know, rather than showing something wrong', () => {
    expect(formatGrund({ regel: 'irgendwas', ist: 1, soll: 2 })).toBeNull()
  })
})

describe('grundText', () => {
  const t = (key) => ({
    optimize_grund_korridor: 'Korridor ({{ist}}/{{soll}} cm)',
  }[key] ?? key)

  it('fills the translated template', () => {
    expect(grundText(t, { regel: 'korridor', ist: 0.499, soll: 0.5 }))
      .toBe('Korridor (49.9/50.0 cm)')
  })

  it('names the rule after the text where there is one', () => {
    const tr = (key) => ({ optimize_grund_rampenregel: 'Rampe ({{ist}}/{{soll}} m)' }[key] ?? key)
    expect(grundText(tr, { regel: 'rampenregel', ist: 150, soll: 50, regelId: 'LP.UB.05' }))
      .toBe('Rampe (150.0/50.0 m) · LP.UB.05')
  })

  it('is the empty string where there is nothing to show', () => {
    expect(grundText(t, null)).toBe('')
  })
})
