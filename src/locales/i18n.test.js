import { describe, it, expect } from 'vitest'
import { translations, languageLabels } from './i18n'
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
      expect(hint, lang).toContain('{{mm}}')    // up to 150 km/h
      expect(hint, lang).toContain('{{fast}}')  // above it — LP.KB.02 is a step
      expect(hint, lang).toContain('{{sw}}')    // a switch route's own
    }
  })

  it('say in the deficiency error what the speed would have to be', () => {
    for (const lang of languages) {
      const over = translations[lang].table_cant_def_over
      for (const slot of ['{{is}}', '{{mm}}', '{{v}}']) expect(over, lang).toContain(slot)
    }
  })
})
