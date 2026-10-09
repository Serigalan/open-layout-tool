import { describe, it, expect } from 'vitest'
import { escapeAction, frontHandler, pushEscape } from './escape'

describe('Escape on the map view', () => {
  it('goes to the dialog, then the form, the comparison, the popup and the overlay', () => {
    const all = { modalOpen: true, formCancel: () => {}, compare: {}, popup: {}, overlay: {} }
    expect(escapeAction(all)).toBe('modal')
    expect(escapeAction({ ...all, modalOpen: false })).toBe('form')
    expect(escapeAction({ ...all, modalOpen: false, formCancel: null })).toBe('compare')
    expect(escapeAction({ popup: {}, overlay: {} })).toBe('popup')
    expect(escapeAction({ overlay: {} })).toBe('overlay')
    expect(escapeAction({})).toBe(null)
  })

  it('cancels the form registered last, and the one before once that is gone', () => {
    const a = () => 'a', b = () => 'b'
    const offA = pushEscape(a)
    const offB = pushEscape(b)
    expect(frontHandler()).toBe(b)
    offB()
    expect(frontHandler()).toBe(a)
    offA()
    expect(frontHandler()).toBe(null)
  })
})
