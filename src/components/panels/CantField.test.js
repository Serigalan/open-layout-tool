import { describe, it, expect } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import translations from '../../locales/de.json'
import CantField from './CantField'
import { CANT_STEP, MAX_CANT, cantFromInput, equilibriumCant } from '../../utils/mapConstants'

const t = (key) => translations[key] ?? key
const render = (props) => renderToStaticMarkup(createElement(CantField, {
  t, value: 0, onChange: () => {}, min: -MAX_CANT, max: MAX_CANT, ...props,
}))

// What the field does with the text in it when it is left. Typing itself is
// not transformed at all — that is the whole point of the draft, and the bug
// this replaces: rounding every keystroke made 65 unreachable, because the 6
// became a 5 before the 5 was typed.
describe('cantFromInput', () => {
  it('rounds onto the design step, up from half a step', () => {
    expect(cantFromInput('65', -MAX_CANT, MAX_CANT)).toBe(65)
    expect(cantFromInput('63', -MAX_CANT, MAX_CANT)).toBe(65)
    expect(cantFromInput('62', -MAX_CANT, MAX_CANT)).toBe(60)
    expect(cantFromInput('62.5', -MAX_CANT, MAX_CANT) % CANT_STEP).toBe(0)
  })

  it('holds the value inside the limits it was given', () => {
    expect(cantFromInput('1000', -MAX_CANT, MAX_CANT)).toBe(MAX_CANT)
    expect(cantFromInput('-1000', -MAX_CANT, MAX_CANT)).toBe(-MAX_CANT)
    // A field whose radius is a magnitude takes no negative cant at all.
    expect(cantFromInput('-40', 0, MAX_CANT)).toBe(0)
  })

  it('takes nothing from an empty field or a half-typed number', () => {
    for (const draft of ['', '   ', '-', '.', 'e']) {
      expect(cantFromInput(draft, -MAX_CANT, MAX_CANT), JSON.stringify(draft)).toBe(null)
    }
  })
})

describe('the field itself', () => {
  it('shows the value it was given, unrounded and untouched', () => {
    expect(render({ value: 65 })).toContain('value="65"')
  })

  it('offers the ausgleichende Überhöhung, with the value it would set', () => {
    // 11.8 · 100² / 1000 = 118 mm
    const html = render({ value: 65, speed: 100, radius: 1000 })
    expect(equilibriumCant(100, 1000)).toBe(120)
    expect(html).toContain(t('cant_equilibrium'))
    expect(html).toContain('(120 mm)')
  })

  it('does not offer what is already there', () => {
    expect(render({ value: 120, speed: 100, radius: 1000 }))
      .not.toContain(t('cant_equilibrium'))
  })

  it('offers what the limits allow where u_0 is past them', () => {
    // 11.8 · 100² / 300 = 393 mm, far past the 160 a curve may carry.
    expect(render({ value: 0, speed: 100, radius: 300 })).toContain(`(${MAX_CANT} mm)`)
  })

  it('offers nothing where there is no speed or no curve to compute one from', () => {
    expect(render({ value: 0 })).not.toContain(t('cant_equilibrium'))
    expect(render({ value: 0, speed: 100 })).not.toContain(t('cant_equilibrium'))
    expect(render({ value: 0, radius: 1000 })).not.toContain(t('cant_equilibrium'))
  })
})
