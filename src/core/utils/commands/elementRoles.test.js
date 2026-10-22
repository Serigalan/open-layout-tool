import { describe, it, expect } from 'vitest'
import { arcFrom, straightFrom, transitionElement } from '../geometry/elementFactory'
import { elementRoles, intermediateSpan, rolesFor, withRole } from './elementRoles'
import { planIntermediateChange } from './editGeometry'

// Fest-, Folge- and Zwischenelement in the element table (Entscheidung 375).

const EPSG = 25832
const utm = (e, n) => ({ easting: e, northing: n, zone: EPSG })

/** A chain laid from (500000, 5600000) due east: [kind, length, radius | [r1, r2]] each. */
function lay(spec) {
  let start = utm(500000, 5600000)
  let bearing = 90
  return spec.map(([kind, length, r]) => {
    let el
    if (kind === 't') el = transitionElement(start, bearing, length, r[0], r[1]).element
    else if (kind === 'a') el = arcFrom(start, bearing, length, r)
    else el = straightFrom(start, bearing, length)
    el = { ...el, speed: 100 }
    start = utm(el.endNode[0], el.endNode[1])
    bearing = el.endBearing ?? el.bearing
    return el
  })
}

// straight · clothoid · arc · clothoid · straight · straight
const SPEC = [['s', 200], ['t', 60, [null, 500]], ['a', 150, 500], ['t', 60, [500, null]], ['s', 200], ['s', 80]]

describe('the roles of a track\'s elements', () => {
  it('are all Festelement where none states one — nothing can be typed', () => {
    const roles = elementRoles(lay(SPEC))
    expect(roles.every(r => r.role === 'fixed' && !r.length && !r.radius)).toBe(true)
  })

  it('make every element from the first Folgeelement on one, each with length and radius', () => {
    const els = lay(SPEC)
    els[2].role = 'follow'
    const roles = elementRoles(els)
    expect(roles.map(r => r.role)).toEqual(['fixed', 'fixed', 'follow', 'follow', 'follow', 'follow'])
    expect(roles[2]).toMatchObject({ by: null, length: true, radius: true })
    expect(roles[3]).toMatchObject({ by: 2, length: true, radius: false })   // a transition has no one radius
  })

  it('give a Zwischenelement its radius and its span — the elements beside it past the transitions — to follow it', () => {
    const els = lay(SPEC)
    els[2].role = 'intermediate'
    const roles = elementRoles(els)
    expect(roles.map(r => r.role)).toEqual(['follow', 'follow', 'intermediate', 'follow', 'follow', 'fixed'])
    expect(roles[2]).toMatchObject({ radius: true, length: false })
    expect(roles[0]).toMatchObject({ by: 2, length: false, radius: false })
  })

  it('refuse a Zwischenelement with no element on one side', () => {
    expect(intermediateSpan(lay(SPEC), 5).error).toBe('table_role_intermediate_ends')
    expect(withRole(lay(SPEC), 1, 'intermediate').error).toBe('table_role_intermediate_kind')
    expect(rolesFor(lay(SPEC)[1])).toEqual(['fixed', 'follow'])
  })

  it('record only the role that was set, the ones following from it not', () => {
    let { elements } = withRole(lay(SPEC), 4, 'follow')
    ;({ elements } = withRole(elements, 2, 'follow'))
    expect(elements.map(e => e.role ?? null)).toEqual([null, null, 'follow', null, null, null])
    ;({ elements } = withRole(elements, 2, 'fixed'))
    expect(elements.every(e => e.role == null)).toBe(true)
  })
})

describe('a Zwischenelement given a new radius', () => {
  const plan = (els, z, radius) => planIntermediateChange([{ id: 't', epsg: EPSG, elements: els }], 't', z, radius)

  it('is laid anew between its span: the first keeps its start, the last its end, both take a new length', () => {
    const els = lay(SPEC)
    const { tracks, error } = plan(els, 2, 700)
    expect(error).toBe(null)
    const out = tracks[0].elements
    expect(out[2].radius).toBe(700)
    expect(out[1].r2).toBe(700)
    expect(out[3].r1).toBe(700)
    // The transitions keep their length, the straights beside take another.
    expect(out[1].length).toBeCloseTo(60, 9)
    expect(out[0].length).not.toBeCloseTo(200, 3)
    expect(out[4].length).not.toBeCloseTo(200, 3)
    // The span starts and ends where it did, in the same direction; the rest stands.
    expect(out[0].startNode).toEqual(els[0].startNode)
    expect(out[4].endNode).toEqual(els[4].endNode)
    expect(out[4].bearing).toBeCloseTo(els[4].bearing, 7)
    expect(out[5]).toEqual(els[5])
    // And it is one chain: each element starts where the one before ends.
    for (let i = 1; i <= 4; i++) {
      expect(Math.hypot(out[i].startNode[0] - out[i - 1].endNode[0], out[i].startNode[1] - out[i - 1].endNode[1])).toBeLessThan(1e-5)
    }
  })

  it('turns through the same angle — the arc takes the length the new radius needs', () => {
    const els = lay(SPEC)
    const out = plan(els, 2, 700).tracks[0].elements
    const angle = (r, l) => l / r
    const before = angle(500, 150) + 2 * 60 / (2 * 500)
    const after = angle(700, out[2].length) + 2 * 60 / (2 * 700)
    expect(after).toBeCloseTo(before, 7)
  })

  it('works between two arcs too, each keeping its radius', () => {
    const els = lay([['s', 100], ['a', 300, 1500], ['t', 50, [1500, 600]], ['a', 120, 600], ['t', 50, [600, 1500]], ['a', 300, 1500], ['s', 50]])
    const { tracks, error } = plan(els, 3, 800)
    expect(error).toBe(null)
    const out = tracks[0].elements
    expect([out[1].radius, out[5].radius]).toEqual([1500, 1500])
    expect(out[5].endNode).toEqual(els[5].endNode)
    expect(out[6]).toEqual(els[6])
  })

  it('refuses a radius no chain closes with', () => {
    // An arc too wide to fit between the two straights.
    expect(plan(lay(SPEC), 2, 100000).error).toBe('table_intermediate_no_solution')
  })

  it('moves the heights behind it on with the end', () => {
    const els = lay(SPEC)
    const total = els.reduce((s, e) => s + e.length, 0)
    const heights = [{ station: 0, z: 100 }, { station: 300, z: 101 }, { station: total, z: 102 }]
    const { tracks } = planIntermediateChange([{ id: 't', epsg: EPSG, elements: els, heights }], 't', 2, 700)
    const newTotal = tracks[0].elements.reduce((s, e) => s + e.length, 0)
    expect(tracks[0].heights[0].station).toBe(0)
    expect(tracks[0].heights[2].station).toBeCloseTo(newTotal, 6)
  })
})
