import { describe, it, expect } from 'vitest'
import { formatGrund, grundText } from './optimizeReport'

describe('formatGrund', () => {
  it('is null where there is no grund (an unchanged row)', () => {
    expect(formatGrund(undefined)).toBeNull()
    expect(formatGrund(null)).toBeNull()
  })

  it('formats korridor in cm, not the metres the service sends', () => {
    expect(formatGrund({ regel: 'korridor', ist: 0.499, soll: 0.5 }))
      .toEqual({ key: 'optimize_grund_korridor', ist: '49.9', soll: '50.0' })
  })

  it('formats zielgeschwindigkeit and cant ceilings without decimals', () => {
    expect(formatGrund({ regel: 'zielgeschwindigkeit', ist: 115.5, soll: 115 }))
      .toEqual({ key: 'optimize_grund_zielgeschwindigkeit', ist: '116', soll: '115' })
    expect(formatGrund({ regel: 'weiche', arc: 1, ist: 100, soll: 100 }))
      .toEqual({ key: 'optimize_grund_weiche', ist: '100', soll: '100' })
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

  it('is the empty string where there is nothing to show', () => {
    expect(grundText(t, null)).toBe('')
  })
})
