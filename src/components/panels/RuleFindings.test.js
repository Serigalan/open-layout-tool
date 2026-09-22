import { describe, it, expect } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import translations from '../../locales/de.json'
import RuleFindings from './RuleFindings'

/**
 * What a creation dialog is told about the element it is about to write, from
 * the same catalogue the element table judges a finished one by.
 */
const t = (key) => translations[key] ?? key
const render = (element) => renderToStaticMarkup(createElement(RuleFindings, { t, element }))

const arc = (props) => ({ elementType: 1, radius: 1000, cant: 65, speed: 100, length: 200, ...props })

describe('RuleFindings', () => {
  it('says so when the element keeps every rule it was measured against', () => {
    const html = render(arc())
    expect(html).toContain(t('table_rules_ok'))
    expect(html).not.toContain('LP.')
  })

  it('names each rule that has something to say, with its step', () => {
    // 10 m at 100 km/h is under the 15 m minimum, and 60 mm is not the 65 the
    // Regelüberhöhung asks for at R 1000.
    const html = render(arc({ length: 10, cant: 60 }))
    expect(html).toContain('LP.EL.01')
    expect(html).toContain(t('rule_sev_error'))
    expect(html).toContain('LP.KB.04')
    expect(html).toContain(t('rule_sev_hint'))
  })

  it('marks each line with the colour of its step', () => {
    const html = render(arc({ length: 10 }))
    expect(html).toContain('track-table-rule-error')
  })

  it('judges a straight by the rules a straight has', () => {
    expect(render({ elementType: 0, speed: 100, length: 10, cant: 0 })).toContain('LP.EL.01')
    expect(render({ elementType: 0, speed: 100, length: 100, cant: 0 })).toContain(t('table_rules_ok'))
  })

  it('shows nothing at all while there is no design speed to judge by', () => {
    expect(render(arc({ speed: 0 }))).toBe('')
  })

  it('reports the cant limits of DB Ril 800.0110, not the dialog\'s own clamp', () => {
    // 236 mm of deficiency at R 500 and 100 km/h — over the 130 the Ril allows.
    expect(render(arc({ radius: 500, cant: 0 }))).toContain('LP.KB.02')
  })
})
