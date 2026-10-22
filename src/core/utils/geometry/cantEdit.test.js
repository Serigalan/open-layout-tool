import { describe, it, expect } from 'vitest'
import { cantEnds, hasCantEnds, loadedTrackCants, storedTrackCants, withCantEdit } from './clothoidUtils'

// The cant typed in the element table and carried over the joints (Entscheidung 373).
const straight = (more = {}) => ({ elementType: 0, length: 100, ...more })
const arc = (radius, cant, more = {}) => ({ elementType: 1, length: 100, radius, cant, ...more })
const clothoid = (r1, r2, more = {}) => ({ elementType: 2, length: 60, r1, r2, ...more })
const ends = (els) => els.map((el, i) => { const e = cantEnds(els, i); return [e.start, e.end] })

describe('the cant an element states', () => {
  it('is at its two ends for a transition, and for an arc or a straight whose cant changes along it', () => {
    expect(hasCantEnds(clothoid(null, 500))).toBe(true)
    expect(hasCantEnds(arc(500, 30, { cantStart: 30, cantEnd: 50 }))).toBe(true)
    expect(hasCantEnds(arc(500, 30))).toBe(false)
    expect(hasCantEnds(straight())).toBe(false)
  })
})

describe('a cant typed in the element table', () => {
  // straight · clothoid · arc · clothoid · straight · clothoid · arc
  const chain = () => [straight(), clothoid(null, 500), arc(500, 60), clothoid(500, null), straight(), clothoid(null, 800), arc(800, 40)]

  it('carries a transition\'s end into the element of one cant beyond it, and on to the next transition\'s start', () => {
    const els = [clothoid(null, 500, { cantStart: 0, cantEnd: 60 }), arc(500, 60), clothoid(500, null, { cantStart: 60, cantEnd: 0 })]
    const out = withCantEdit(els, 0, 'cantEnd', 80)
    expect(out[1].cant).toBe(80)
    expect(ends(out)).toEqual([[0, 80], [80, 80], [80, 0]])
  })

  it('carries an arc\'s cant to both its transitions, which follow it again', () => {
    const out = withCantEdit(chain(), 2, 'cant', 75)
    expect(ends(out).slice(1, 4)).toEqual([[0, 75], [75, 75], [75, 0]])
    expect(out[1]).not.toHaveProperty('cantEnd')
    expect(out[3]).not.toHaveProperty('cantStart')
  })

  it('runs on through elements of one cant to the next one with ends', () => {
    const els = [clothoid(null, 500, { cantStart: 0, cantEnd: 40 }), arc(500, 40), arc(500, 40), straight({ cant: 40 }), clothoid(null, null, { cantStart: 40, cantEnd: 0 })]
    const out = withCantEdit(els, 2, 'cant', 50)
    expect(out.slice(1, 4).map(e => e.cant)).toEqual([50, 50, 50])
    expect(ends(out)[0]).toEqual([0, 50])
    expect(ends(out)[4]).toEqual([50, 0])
  })

  it('carries a start backwards, and stops at the element that states its ends', () => {
    const out = withCantEdit(chain(), 5, 'cantStart', 20)
    expect(out[4].cant).toBe(20)
    expect(ends(out)[3]).toEqual([60, 20])
    expect(ends(out)[2]).toEqual([60, 60])
  })

  it('moves an arc\'s ramp end, and keeps one cant where both ends then agree', () => {
    const els = [arc(500, 30, { cantStart: 30, cantEnd: 50 }), straight({ cant: 50 })]
    const out = withCantEdit(els, 0, 'cantEnd', 30)
    expect(out[0]).toMatchObject({ cant: 30 })
    expect(out[0]).not.toHaveProperty('cantStart')
    expect(out[1].cant).toBe(30)
  })

  it('takes no cant for the field an element does not show', () => {
    const els = chain()
    expect(withCantEdit(els, 1, 'cant', 40)).toBe(els)
    expect(withCantEdit(els, 2, 'cantEnd', 40)).toBe(els)
  })

  it('reads and writes the same through the record', () => {
    const out = withCantEdit(chain(), 2, 'cant', 75)
    expect(ends(loadedTrackCants(storedTrackCants(out)))).toEqual(ends(out))
  })
})
