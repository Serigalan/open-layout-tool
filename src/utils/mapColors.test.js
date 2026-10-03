import { describe, it, expect } from 'vitest'
import { deltaE, highlightColors, resolveHighlight } from './mapColors'
import { PALETTE } from '../styles/palette'

describe('highlight colours against the project colour', () => {
  it('keeps the designed ones on the default blue', () => {
    expect(highlightColors(PALETTE.primaryDefault)).toEqual({
      hover: PALETTE.mapHover, selected: PALETTE.mapSelected, flash: PALETTE.mapFlash,
    })
  })

  it('moves a highlight off a project colour it would vanish on', () => {
    const orange = highlightColors('#ff8a00')
    expect(orange.hover).not.toBe(PALETTE.mapHover)
    expect(deltaE(orange.hover, '#ff8a00')).toBeGreaterThan(32)
    const red = highlightColors('#a62b20')
    expect(red.selected).not.toBe(PALETTE.mapSelected)
  })

  it('measures colours that look alike as close', () => {
    expect(deltaE('#ff8c00', '#ff8a00')).toBeLessThan(3)
    expect(deltaE('#000000', '#ffffff')).toBeGreaterThan(90)
  })

  it('puts the chosen colours into a paint value, expressions included', () => {
    const colors = { hover: '#111111', selected: '#222222', flash: '#333333' }
    expect(resolveHighlight(PALETTE.mapHover, colors)).toBe('#111111')
    expect(resolveHighlight(['case', ['get', 'a'], PALETTE.mapHover, PALETTE.mapSelected], colors))
      .toEqual(['case', ['get', 'a'], '#111111', '#222222'])
    expect(resolveHighlight(2, colors)).toBe(2)
  })
})
