import { describe, it, expect } from 'vitest'
import { translations, languageLabels, format, fill, tOr } from './i18n'
import {
  SWITCH_KINDS, switchKindLabelKey, switchRouteLabelKey, switchRoutes,
} from '../utils/switchModel'

/**
 * A key a component asks for that no locale answers renders as the key itself
 * (see App's `t`), which is why the keys the code derives rather than writes
 * out — the names of a switch's kinds and routes — are checked here against
 * both files rather than trusted.
 */

const languages = Object.keys(translations)

describe('the locales', () => {
  it('cover every language offered', () => {
    expect(languages.sort()).toEqual(Object.keys(languageLabels).sort())
  })

  it('use one placeholder syntax, and the same placeholders per key in every language (R6.1)', () => {
    const slots = (text) => [...String(text).matchAll(/\{(\w+)\}/g)].map(m => m[1]).sort()
    const [first, ...rest] = languages
    for (const [key, text] of Object.entries(translations[first])) {
      expect(String(text), key).not.toMatch(/\{\{/)
      for (const lang of rest) expect(slots(translations[lang][key]), `${lang}.${key}`).toEqual(slots(text))
    }
  })

  it('say the same things in both', () => {
    const [first, ...rest] = languages
    for (const lang of rest) {
      expect(Object.keys(translations[lang]).sort(), lang)
        .toEqual(Object.keys(translations[first]).sort())
    }
  })
})

describe('the keys the element table derives', () => {
  const has = (key) => languages.every(lang => typeof translations[lang][key] === 'string')

  it('name every kind of switch and every route it has', () => {
    for (const kind of SWITCH_KINDS) {
      expect(has(switchKindLabelKey(kind)), kind).toBe(true)
      for (const route of switchRoutes(kind)) {
        expect(has(switchRouteLabelKey(kind, route)), `${kind}.${route}`).toBe(true)
      }
    }
  })

  it('name the CRS column and what it is', () => {
    expect(has('table_crs')).toBe(true)
    expect(has('table_crs_hint')).toBe(true)
  })

  it('leave room in the V_max hint for every deficiency limit there is', () => {
    for (const lang of languages) {
      const hint = translations[lang].table_max_speed_hint
      expect(hint, lang).toContain('{mm}')    // up to 150 km/h
      expect(hint, lang).toContain('{fast}')  // above it — LP.KB.02 is a step
      expect(hint, lang).toContain('{sw}')    // a switch route's own
    }
  })

  it('say in the deficiency error what the speed would have to be', () => {
    for (const lang of languages) {
      const over = translations[lang].table_cant_def_over
      for (const slot of ['{is}', '{mm}', '{v}']) expect(over, lang).toContain(slot)
    }
  })
})

describe('filling texts (R6.1)', () => {
  it('fills every {placeholder} it has a value for, and leaves the rest standing', () => {
    expect(format('{a} und {b}, {a}', { a: 1, b: 'x' })).toBe('1 und x, 1')
    expect(format('{a} {missing}', { a: 0 })).toBe('0 {missing}')
  })

  it('fills a translation, and falls back where a key has none', () => {
    const t = (k) => ({ hi: 'Hallo {name}' }[k] ?? k)
    expect(fill(t, 'hi', { name: 'Ada' })).toBe('Hallo Ada')
    expect(tOr(t, 'hi', 'x')).toBe('Hallo {name}')
    expect(tOr(t, 'nope', 'x')).toBe('x')
  })
})

describe('formatDate', () => {
  it('writes a date as the interface language does', async () => {
    const { formatDate } = await import('./i18n')
    expect(formatDate('2026-10-02T14:05:00', 'de')).toBe('02.10.2026')
    expect(formatDate('2026-10-02T14:05:00', 'en')).toBe('02/10/2026')
    expect(formatDate('2026-10-02T14:05:00', 'de', { time: true })).toBe('02.10.2026, 14:05')
    expect(formatDate(null, 'de')).toBe('')
    expect(formatDate('not a date', 'de')).toBe('')
  })
})
