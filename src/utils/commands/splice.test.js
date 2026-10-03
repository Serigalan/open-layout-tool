import { describe, it, expect } from 'vitest'
import { buildSplice, secondPickRefusal, solveSplice, splicePick } from './splice'
import { straightElement, transitionElement } from '../elementFactory'
import { recalcAbsLengths, rebuildCoords } from '../trackModel'
import { expectValidTrack } from '../../test/chainInvariants'

const EPSG = 25832
const P = (x, y, zone = EPSG) => ({ easting: 500000 + x, northing: 5700000 + y, zone })
const track = (id, a, b, extra = {}) => {
  const elements = recalcAbsLengths([straightElement(a, b, { speed: 80 })])
  return { id, name: id, epsg: a.zone, elements, coordinates: rebuildCoords(elements), ...extra }
}
const settings = { radius: 300, clothoidEnabled: false, clothoidDep: 60, clothoidArr: 60, transitionType: 'clothoid', arcJoin: 'straight' }

// Track a runs east to x = 200; track b runs north from y = 100 at x = 400. An
// arc of R 300 turns the one into the other: a quarter circle, 471 m.
const a = track('a', P(0, 0), P(200, 0), { heights: [{ station: 0, z: 100 }, { station: 200, z: 102 }] })
const b = track('b', P(400, 100), P(400, 700))
let n = 0
const newId = () => `m${++n}`

describe('picking the two elements', () => {
  it('reads an element\'s ends, bearing and radius', () => {
    const pick = splicePick(a, 0)
    expect(pick).toMatchObject({ trackId: 'a', elIdx: 0, signedR: null, label: 'a' })
    expect(pick.bearing).toBeCloseTo(90, 9)
    expect(splicePick(a, 3)).toBe(null)
  })

  it('refuses a transition, the same track and another plane', () => {
    const tr = transitionElement(P(0, 0), 90, 50, null, 300).element
    expect(splicePick({ ...a, elements: [tr] }, 0)).toEqual({ error: 'splice_hint_straight_only' })
    const first = splicePick(a, 0)
    expect(secondPickRefusal(first, first)).toBe('same')
    expect(secondPickRefusal(first, { ...first, elIdx: 1 })).toBe('splice_error_same_track')
    expect(secondPickRefusal(first, splicePick(track('c', P(0, 0, 25833), P(0, 100, 25833)), 0))).toBe('splice_error_crs')
    expect(secondPickRefusal(first, splicePick(b, 0))).toBe(null)
  })
})

describe('the splice', () => {
  const dep = splicePick(a, 0), arr = splicePick(b, 0)

  it('solves the arc between two straights', () => {
    const splice = solveSplice(dep, arr, settings)
    expect(splice.result.arcLength).toBeCloseTo(300 * Math.PI / 2, 3)
    expect(splice.arcMode).toBe(false)
  })

  it('merges both tracks into one, in one commit', () => {
    const splice = solveSplice(dep, arr, settings)
    const commit = buildSplice({ tracks: [a, b], dep, arr, splice, speed: 60, cant: 40, clothoidEnabled: false, newId })
    expect(commit.removeTrackIds).toEqual(['a', 'b'])
    const [merged] = commit.addTracks
    expectValidTrack(merged)
    expect(merged.elements.map(e => e.elementType)).toEqual([0, 1, 0])
    expect(merged.elements[1]).toMatchObject({ radius: -300, cant: -40, speed: 60 })   // a left turn
    // The arrival track runs on in its own direction: it is not folded in.
    expect(commit.remap).toEqual([{ oldId: 'a', newId: merged.id }, { oldId: 'b', newId: merged.id, flip: false }])
    expect(commit.consumed).toEqual([{ trackId: 'a', endpoint: 'END' }, { trackId: 'b', endpoint: 'BEGIN' }])
    // The departure track's gradient ends where its last element is re-shaped.
    expect(merged.heights).toBeUndefined()
  })

  it('puts transitions either side when asked', () => {
    const s = { ...settings, clothoidEnabled: true }
    const splice = solveSplice(dep, arr, s)
    const commit = buildSplice({ tracks: [a, b], dep, arr, splice, speed: 60, cant: 40, clothoidEnabled: true, newId })
    expect(commit.addTracks[0].elements.map(e => e.elementType)).toEqual([0, 2, 1, 2, 0])
    expectValidTrack(commit.addTracks[0])
  })

  it('has nothing to commit without a solution', () => {
    expect(buildSplice({ tracks: [a, b], dep, arr, splice: { error: 'x' }, speed: 0, cant: 0 })).toBe(null)
  })
})
