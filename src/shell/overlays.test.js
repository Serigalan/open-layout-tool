import { describe, it, expect } from 'vitest'
import { OVERLAYS_CLOSED, closesTrackTable, overlayReducer } from './overlays'

const run = (...actions) => actions.reduce(overlayReducer, OVERLAYS_CLOSED)

describe('overlay state (R2.4)', () => {
  it('holds one map overlay at a time', () => {
    const s = run({ type: 'open', overlay: { kind: 'profile', trackId: 'a' } }, { type: 'open', overlay: { kind: 'crossSection', at: {} } })
    expect(s.overlay.kind).toBe('crossSection')
  })

  it('closes an overlay only by its own kind', () => {
    const s = run({ type: 'open', overlay: { kind: 'profile', trackId: 'a' } })
    expect(overlayReducer(s, { type: 'close', kind: 'trackTable' })).toBe(s)
    expect(overlayReducer(s, { type: 'close', kind: 'profile' }).overlay).toBeNull()
  })

  it('lets physics and the regelwerk replace each other, beside the overlay', () => {
    const s = run(
      { type: 'open', overlay: { kind: 'trackTable', track: { id: 't' } } },
      { type: 'popup', popup: { kind: 'physics' } },
      { type: 'popup', popup: { kind: 'regelwerk', regelwerkId: '' } },
    )
    expect(s.popup.kind).toBe('regelwerk')
    expect(s.overlay.kind).toBe('trackTable')
  })

  it('closes both when the panel changes', () => {
    const s = run({ type: 'open', overlay: { kind: 'trackTable', track: { id: 't' } } }, { type: 'popup', popup: { kind: 'physics' } })
    expect(overlayReducer(s, { type: 'panelChange' })).toEqual(OVERLAYS_CLOSED)
  })

  it('knows when an action would take the element table away', () => {
    const s = run({ type: 'open', overlay: { kind: 'trackTable', track: { id: 't' } } })
    expect(closesTrackTable(s, { type: 'panelChange' })).toBe(true)
    expect(closesTrackTable(s, { type: 'popup', popup: { kind: 'physics' } })).toBe(false)
    expect(closesTrackTable(s, { type: 'open', overlay: { kind: 'trackTable', track: { id: 'u' } } })).toBe(false)
  })

  it('keeps a detached overlay across panel changes, and sends its kind to its window', () => {
    const win = {}
    const s = run(
      { type: 'open', overlay: { kind: 'crossSection', at: { trackId: 'a', station: 1 } } },
      { type: 'detach', kind: 'crossSection', win },
      { type: 'panelChange' },
      { type: 'open', overlay: { kind: 'trackTable', track: { id: 't' } } },
    )
    expect(s.detached).toEqual({ kind: 'crossSection', at: { trackId: 'a', station: 1 }, win })
    expect(s.overlay.kind).toBe('trackTable')
    const moved = overlayReducer(s, { type: 'open', overlay: { kind: 'crossSection', at: { trackId: 'b', station: 2 } } })
    expect(moved.overlay.kind).toBe('trackTable')
    expect(moved.detached).toEqual({ kind: 'crossSection', at: { trackId: 'b', station: 2 }, win })
  })

  it('docks a detached overlay back, and closes it with the project', () => {
    const s = run(
      { type: 'open', overlay: { kind: 'crossSection', at: { station: 3 } } },
      { type: 'detach', kind: 'crossSection', win: {} },
    )
    expect(s.overlay).toBeNull()
    expect(overlayReducer(s, { type: 'dock' })).toEqual({ ...OVERLAYS_CLOSED, overlay: { kind: 'crossSection', at: { station: 3 } } })
    expect(overlayReducer(s, { type: 'closeDetached' })).toEqual(OVERLAYS_CLOSED)
    expect(overlayReducer(s, { type: 'closeAll' })).toEqual(OVERLAYS_CLOSED)
    expect(overlayReducer(s, { type: 'detach', kind: 'profile', win: {} })).toBe(s)
  })
})
