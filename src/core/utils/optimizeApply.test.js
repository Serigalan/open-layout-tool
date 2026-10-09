import { describe, it, expect } from 'vitest'
import { optimizeRequest, reshapedHeights, optimizedTrack, optimizeErrorText } from './optimizeApply'
import { straightFrom, arcFrom } from './elementFactory'

const EPSG = 25832
const O = { easting: 500000, northing: 5700000, zone: EPSG }
const at = (n) => ({ easting: n[0], northing: n[1], zone: EPSG })
const s = straightFrom(O, 90, 100)
const a = arcFrom(at(s.endNode), 90, 100, 500)
const heights = [{ station: 0, z: 100 }, { station: 100, z: 101 }, { station: 150, z: 101.5 }, { station: 200, z: 102 }]
const track = { id: 't', epsg: EPSG, elements: [s, a], heights }

describe('the optimizer request', () => {
  it('sends only what was chosen', () => {
    expect(optimizeRequest(track, { corridorCm: 30, grenzwert: 'reg', vMax: '', regelwerkId: '' }))
      .toEqual({ track, corridorCm: 30, grenzwert: 'reg', uebergang: 'auto', maxiter: 100 })
    expect(optimizeRequest(track, { corridorCm: 30, grenzwert: 'discretion', vMax: '120', regelwerkId: 'db', elementIdx: 1 }))
      .toMatchObject({ vMax: 120, regelwerk: 'db', targetElementIdx: 1 })
  })
})

describe('the optimized track', () => {
  it('keeps the heights while no length changes', () => {
    expect(reshapedHeights(track, [s, { ...a, radius: 600 }])).toBe(heights)
  })

  it('keeps the heights only up to the first length that moved', () => {
    const longer = arcFrom(at(s.endNode), 90, 110, 600)
    expect(reshapedHeights(track, [s, longer])).toEqual([{ station: 0, z: 100 }, { station: 100, z: 101 }])
  })

  it('carries the new elements and the regelwerk it was drawn under', () => {
    const out = optimizedTrack(track, { elements: [s, a], regelwerk: 'db-ril-800-0110', grenzwert: 'reg' })
    expect(out).toMatchObject({ id: 't', regelwerk: 'db-ril-800-0110', regelwerkGrenzwert: 'reg' })
    expect(out.elements[1].absLength).toBeCloseTo(200, 9)
    expect(out.coordinates.length).toBeGreaterThan(2)
  })
})

describe('what a failed run says', () => {
  const t = (key) => ({ optimize_err_unavailable: 'kein Dienst', optimize_err_internal: 'Fehler' }[key] ?? key)
  it('prefers the service\'s own sentence, then the code, then a general error', () => {
    expect(optimizeErrorText(t, 'topology', 'Gerade – Gerade')).toBe('Gerade – Gerade')
    expect(optimizeErrorText(t, 'unavailable')).toBe('kein Dienst')
    expect(optimizeErrorText(t, 'strange')).toBe('Fehler')
  })
})
