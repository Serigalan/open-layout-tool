import { describe, it, expect } from 'vitest'
import {
  addDependentAt, dependOn, heightLinks, heightRoles, releaseDependency, restoreDependency, setDependencyMode, switchMisfits,
  withAllLdsPoints, withSwitchHeights,
} from './switchChain'
import { couplingOf, ldsLift } from './switchGradient'
import { pointAtStation, stationOnTrack } from '../track'
import { endPointCurvedUtm, endPointStraightUtm } from '../geometry/elementUtils'
import { formOf } from '../../test/turnoutFixture'
import { hasPek, loadPek } from '../../test/pekFixture'
import { hydrateProjects } from '../project/persistenceUtils'

// Turnouts of the TEST form (WA–WE 30 m, ldS 10 m behind WE) on R 500 to
// the left, built anywhere: `at` the toe, `bearing` the way the main route
// leaves it.
const R = 500
const node = (p) => [p.easting, p.northing]
const turn = (bearing, L, r) => bearing - Math.sign(-r) * (L / R) * 180 / Math.PI
const straight = (from, bearing, length, extra = {}) => ({
  elementType: 0, startNode: node(from), endNode: node(endPointStraightUtm(from, bearing, length)), bearing, length, speed: 80, ...extra,
})
const arc = (from, bearing, length, r, extra = {}) => ({
  elementType: 1, startNode: node(from), endNode: node(endPointCurvedUtm(from, bearing, length, r)),
  bearing, endBearing: turn(bearing, length, r), radius: r, length, speed: 80, ...extra,
})
const endOf = (el) => ({ easting: el.endNode[0], northing: el.endNode[1], zone: 5684 })
const track = (id, elements, heights) => ({ id, epsg: 5684, trackType: 1, elements, heights })
const opts = { formOf }
const t = (p, id) => p.tracks.find(x => x.id === id).heights
const zAt = (h, s) => h.find(p => Math.abs(p.station - s) < 0.011)?.z

/** Every track of `p` as if just written — what a project opened and edited all over gets. */
const settle = (p, design = false) => withSwitchHeights({ tracks: [] }, p, { design, opts })
/** The store's pass over a write: track `id` given `heights` (a function of the old ones). */
const write = (p, id, heights, design = false) => withSwitchHeights(p, {
  ...p, tracks: p.tracks.map(x => (x.id === id ? { ...x, heights: heights(x.heights) } : x)),
}, { design, opts })
const setZ = (index, z) => (h) => h.map((q, i) => (i === index ? { ...q, z } : q))
/** A height taken over in the design mode — the other track's point made to depend on it, as the store writes it. */
/** A turnout's point at WA or ldS on its main route or branch, as the profile names it. */
const pairRef = (p, sw, at, side) => {
  for (const [trackId, byIndex] of heightRoles(p, opts)) {
    for (const [index, r] of byIndex) {
      const role = r.kind === 'locked' ? r.was : r
      if (role?.kind === at && role.sw.switchId === sw && role.side === side) return { trackId, index }
    }
  }
  throw new Error(`no ${at} ${side} of ${sw}`)
}
const take = (p, at, from, sw = 's1') => {
  const other = from === 'main' ? 'branch' : 'main'
  const r = dependOn(p, pairRef(p, sw, at, other), pairRef(p, sw, at, from), { mode: at, opts })
  if (r.error) throw new Error(`${at} from ${from}: ${r.error}`)
  return withSwitchHeights(p, r.project, { design: true, opts })
}
const gapsOf = (p) => switchMisfits(p, opts)
/** Coupled, then the approach moved in the design mode: the branch no longer meets the main route. */
const apart = () => write(settle(raw()), 'a', setZ(1, 100.9), true)

/** A turnout at `at`: approach `a` (100 m, ending at WA), main `m` (60 m), branch `b` (60 m on R 500). */
function single(heights, { cant } = {}) {
  const at = { easting: 1000, northing: 1000, zone: 5684 }
  const back = endPointStraightUtm(at, 270, 100)
  const c = cant != null ? { cant } : {}
  const m1 = straight(at, 90, 30, { switchId: 's1', switchRoute: 'main', ...c })
  const b1 = arc(at, 90, 30, -R, { switchId: 's1', switchRoute: 'branch', ...c })
  return {
    tracks: [
      track('a', [straight(back, 90, 100, c)], heights.a),
      track('m', [m1, straight(endOf(m1), 90, 30, c)], heights.m),
      track('b', [b1, arc(endOf(b1), b1.endBearing, 30, -R, c)], heights.b),
    ],
    switches: [{
      switchId: 's1', kind: 'turnout', label: 'TEST',
      ports: {
        A: { trackId: 'a', endpoint: 'END' },
        B1: { trackId: 'b', endpoint: 'BEGIN' },
        B2: { trackId: 'm', endpoint: 'BEGIN' },
      },
    }],
  }
}
const raw = () => single({
  a: [{ station: 0, z: 100 }, { station: 50, z: 100.5 }, { station: 100, z: 101.7 }],
  m: [{ station: 0, z: 101.7 }, { station: 60, z: 102 }],
  b: [{ station: 0, z: 101.7 }, { station: 60, z: 101.9 }],
})
const ldsOf = (p, side) => {
  const c = couplingOf(p.tracks, p.switches, p.switches[0], opts)
  return side === 'main' ? c.ldsMain : c.ldsBranch
}

describe('WA and ldS on their lines (decisions 270, 384)', () => {
  it('puts the main route\'s WA and ldS on the line from the last point before WA to the first behind the ldS', () => {
    const p = settle(raw(), true)
    // Q at 50 m on the approach, P at 60 m on the main route: 110 m apart.
    const g = (102 - 100.5) / 110
    expect(t(p, 'a')[2].z).toBeCloseTo(100.5 + 50 * g, 4)
    expect(t(p, 'm')).toHaveLength(3)
    expect(t(p, 'm')[0].z).toBeCloseTo(100.5 + 50 * g, 4)
    expect(zAt(t(p, 'm'), ldsOf(p, 'main'))).toBeCloseTo(100.5 + (50 + ldsOf(p, 'main')) * g, 4)
    // Q and P stay; in the design mode the branch's toe is its own.
    expect(t(p, 'a')[1].z).toBe(100.5)
    expect(t(p, 'm')[2].z).toBe(102)
    expect(t(p, 'b')[0].z).toBe(101.7)
  })

  it('puts the branch\'s ldS on the line from its WA to the free point behind it', () => {
    const p = settle(raw(), true)
    const b = t(p, 'b')
    expect(b).toHaveLength(3)
    const s = ldsOf(p, 'branch')
    expect(b[1].station).toBeCloseTo(s, 3)
    expect(b[1].z).toBeCloseTo(101.7 + 0.2 * b[1].station / 60, 4)
  })

  it('splits the main route\'s line at a free point between WA and ldS', () => {
    const p = raw()
    p.tracks[1].heights = [p.tracks[1].heights[0], { station: 20, z: 101.5 }, p.tracks[1].heights[1]]
    const m = t(settle(p, true), 'm')
    expect(m[1]).toMatchObject({ station: 20, z: 101.5 })
    expect(m[0].z).toBeCloseTo(100.5 + 50 * (101.5 - 100.5) / 70, 4)
    expect(zAt(m, ldsOf(p, 'main'))).toBeCloseTo(101.5 + (ldsOf(p, 'main') - 20) * (102 - 101.5) / 40, 4)
  })

  it('moves WA and ldS with a point moved either side, and only them', () => {
    const p = settle(raw(), true)
    const after = write(p, 'a', setZ(1, 100.8), true)
    const g = (102 - 100.8) / 110
    expect(t(after, 'm')[0].z).toBeCloseTo(100.8 + 50 * g, 4)
    expect(t(after, 'm')[2].z).toBe(102)
    expect(t(after, 'b')).toBe(t(p, 'b'))
    // Nothing moves where nothing was written.
    expect(withSwitchHeights(after, after, { opts })).toBe(after)
  })

  it('tells the profile what each point is', () => {
    const p = settle(raw())
    const roles = heightRoles(p, opts)
    expect(roles.get('a').get(2)).toMatchObject({ kind: 'wa', side: 'main' })
    expect(roles.get('m').get(0)).toMatchObject({ kind: 'wa', side: 'main' })
    expect(roles.get('m').get(1)).toMatchObject({ kind: 'lds', side: 'main' })
    expect(roles.get('b').get(0)).toMatchObject({ kind: 'wa', side: 'branch' })
    expect(roles.get('b').get(1)).toMatchObject({ kind: 'lds', side: 'branch' })
    expect(roles.get('b').has(2)).toBe(false)
    expect(roles.get('a').has(1)).toBe(false)
  })
})

describe('coupled: the branch follows the main route at WA and ldS (decisions 384, 385)', () => {
  it('gives the branch the main route\'s toe and its ldS the plane, its other points staying', () => {
    const p = settle(raw())
    expect(gapsOf(p)).toEqual([])
    expect(t(p, 'b')[0].z).toBe(t(p, 'm')[0].z)
    expect(t(p, 'm')[2].z).toBe(102)
    expect(t(p, 'b')[2].z).toBe(101.9)
  })

  it('passes an edit of the main route on to the branch', () => {
    const p = settle(raw())
    const after = write(p, 'a', setZ(1, 100.8))
    expect(gapsOf(after)).toEqual([])
    expect(t(after, 'a')[1].z).toBe(100.8)
    expect(t(after, 'm')[2].z).toBe(102)
    expect(t(after, 'b')[0].z).toBe(t(after, 'm')[0].z)
  })

  it('keeps the branch on the main route when the branch is written: the main route leads', () => {
    const p = settle(raw())
    const after = write(p, 'b', setZ(2, 102.5))
    expect(gapsOf(after)).toEqual([])
    expect(t(after, 'b')[2].z).toBe(102.5)
    expect(t(after, 'b')[1].z).toBe(t(p, 'b')[1].z)
    expect(t(after, 'm')).toBe(t(p, 'm'))
  })

  it('lifts the branch at the ldS to the side the cant raises, and lowers it to the other', () => {
    const flat = (cant) => settle(single({
      a: [{ station: 0, z: 100 }, { station: 100, z: 100 }],
      m: [{ station: 0, z: 100 }, { station: 60, z: 100 }],
      b: [{ station: 0, z: 100 }, { station: 60, z: 100 }],
    }, { cant }))
    for (const cant of [60, -60]) {
      const p = flat(cant)
      const c = couplingOf(p.tracks, p.switches, p.switches[0], opts)
      const dz = zAt(t(p, 'b'), c.ldsBranch) - zAt(t(p, 'm'), c.ldsMain)
      // y to the left, a positive cant raises the left rail.
      expect(dz).toBeCloseTo(cant / 1500 * c.offset, 4)
      expect(Math.sign(dz)).toBe(Math.sign(cant * c.offset))
      expect(ldsLift(c, t(p, 'm'))).toBeCloseTo(dz, 4)
    }
  })

  it('makes up no gradient: a branch without heights is left out, and follows once it has some', () => {
    const bare = settle(single({
      a: [{ station: 0, z: 100 }, { station: 100, z: 100 }],
      m: [{ station: 0, z: 100 }, { station: 60, z: 100.6 }],
    }))
    expect(t(bare, 'b')).toBeUndefined()
    expect(gapsOf(bare)).toEqual([])
    const after = write(bare, 'b', () => [{ station: 0, z: 99 }, { station: 60, z: 99 }])
    expect(t(after, 'm')).toEqual(t(bare, 'm'))
    expect(gapsOf(after)).toEqual([])
  })

  it('says what depends on what', () => {
    const p = settle(raw())
    const links = heightLinks(p, { opts })
    const ldsM = links.get('m|1')
    expect(ldsM.kind).toBe('line')
    expect(ldsM.from).toEqual([{ trackId: 'a', index: 1 }, { trackId: 'm', index: 2 }])
    expect(ldsM.to).toEqual([{ trackId: 'b', index: 1 }])
    // The branch's toe takes the main route's height, marked as a toe — no dependency (decision 392).
    expect(links.get('b|0')).toMatchObject({ kind: 'standard', toe: true, from: [] })
    // The approach's end is the toe, as the main route's start.
    expect(links.get('a|2')).toBe(links.get('m|0'))
    expect(heightLinks(p, { design: true, opts }).get('b|0').kind).toBeNull()
  })
})

describe('the design mode: dependencies of one\'s own (decision 385)', () => {

  it('couples nothing, and says where the tracks do not meet', () => {
    expect(gapsOf(apart()).map(m => m.at)).toEqual(['wa', 'lds'])
  })

  it('takes the toe and the ldS over into the branch for good: they follow the main route from then on', () => {
    let p = take(apart(), 'wa', 'main')
    expect(t(p, 'b')[0].z).toBe(t(p, 'm')[0].z)
    expect(t(p, 'b')[0].dep).toBe(t(p, 'm')[0].id)
    p = take(p, 'lds', 'main')
    expect(gapsOf(p)).toEqual([])
    expect(dependOn(p, { trackId: 'b', index: 1 }, { trackId: 'm', index: 1 }, { mode: 'lds', opts }).project).toBe(p)
    // Still in the mode, an edit of the approach is followed by the branch.
    const after = write(p, 'a', setZ(1, 100.2), true)
    expect(gapsOf(after)).toEqual([])
    expect(heightRoles(after, opts).get('b').get(1)).toMatchObject({ kind: 'lds', side: 'branch' })
  })

  it('takes the branch\'s heights over into the main route, which then leaves its line there', () => {
    let p = take(apart(), 'lds', 'branch')
    const ldsM = zAt(t(p, 'm'), ldsOf(p, 'main'))
    expect(gapsOf(p).map(m => m.at)).toEqual(['wa'])
    p = take(p, 'wa', 'branch')
    expect(t(p, 'm')[0].z).toBe(t(p, 'b')[0].z)
    // The toe is one point with the approach's end.
    expect(t(p, 'a')[2].z).toBe(t(p, 'b')[0].z)
    expect(zAt(t(p, 'm'), ldsOf(p, 'main'))).toBeCloseTo(ldsM, 3)
    expect(gapsOf(p)).toEqual([])
    // Turned round: taken over from the main route again, the main route is free once more.
    p = take(p, 'lds', 'main')
    expect(t(p, 'm')[1].dep).toBeUndefined()
    expect(t(p, 'b')[1].dep).toBe(t(p, 'm')[1].id)
  })

  it('refuses a ring, and lets a point go again', () => {
    const p = take(apart(), 'lds', 'main')
    // P behind the main route's ldS made to follow the branch's ldS, which follows the line through P.
    const r = dependOn(p, { trackId: 'm', index: 2 }, { trackId: 'b', index: 1 }, { opts })
    expect(r).toEqual({ error: 'ring' })
    expect(dependOn(p, { trackId: 'm', index: 0 }, { trackId: 'a', index: 2 }, { opts })).toEqual({ error: 'same' })
    const freed = releaseDependency(p, { trackId: 'b', index: 1 }, opts)
    expect(t(freed, 'b')[1].dep).toBeUndefined()
    const bare = settle(single({ a: [{ station: 0, z: 100 }, { station: 100, z: 100 }], m: [{ station: 0, z: 100 }, { station: 60, z: 100.6 }] }))
    expect(addDependentAt(bare, { trackId: 'm', index: 1 }, { trackId: 'b', station: 30 }, { opts })).toEqual({ error: 'no_height' })
  })
})

describe('letting a WA or ldS go of its rule (decision 387)', () => {
  it('frees the main route\'s ldS of its line: it is entered by hand, the toe\'s line ends at it, until restored', () => {
    const p = settle(raw(), true)
    const freed = withSwitchHeights(p, releaseDependency(p, { trackId: 'm', index: 1 }, { opts }), { design: true, opts })
    expect(t(freed, 'm')[1].free).toBe(true)
    expect(heightRoles(freed, opts).get('m').get(1)).toMatchObject({ kind: 'lds', free: true })
    expect(heightLinks(freed, { design: true, opts }).get('m|1').kind).toBeNull()
    const typed = write(freed, 'm', setZ(1, 101), true)
    expect(t(typed, 'm')[1].z).toBe(101)
    // The toe now lies on the line from Q to the ldS.
    expect(t(typed, 'm')[0].z).toBeCloseTo(100.5 + (101 - 100.5) * 50 / (50 + t(typed, 'm')[1].station), 4)
    const back = withSwitchHeights(typed, restoreDependency(typed, { trackId: 'm', index: 1 }, opts), { design: true, opts })
    expect(t(back, 'm')[1].free).toBeUndefined()
    expect(t(back, 'm')[1].z).not.toBe(101)
  })

  it('frees the branch of the standard coupling, and lets an own dependency go first', () => {
    const p = settle(raw())
    const freed = withSwitchHeights(p, releaseDependency(p, { trackId: 'b', index: 1 }, { design: false, opts }), { opts })
    const typed = write(freed, 'b', setZ(1, 99))
    expect(t(typed, 'b')[1].z).toBe(99)
    expect(gapsOf(typed).map(m => m.at)).toEqual(['lds'])
    // An own dependency is let go first, the rule under it after.
    const own = take(apart(), 'lds', 'main')
    const once = releaseDependency(own, { trackId: 'b', index: 1 }, { opts })
    expect(t(once, 'b')[1].dep).toBeUndefined()
    expect(t(once, 'b')[1].free).toBeUndefined()
    expect(t(releaseDependency(once, { trackId: 'b', index: 1 }, { opts }), 'b')[1].free).toBe(true)
    // A free point depends on nothing to let go of.
    expect(releaseDependency(p, { trackId: 'a', index: 1 }, { opts })).toBe(p)
  })
})

describe('how a point depends (decision 390)', () => {
  const ldsRef = { trackId: 'b', index: 1 }, pRef = { trackId: 'b', index: 2 }
  const follow = (p, dst, src, mode) => withSwitchHeights(p, dependOn(p, dst, src, { mode, opts }).project, { design: true, opts })

  it('as a toe: the same height', () => {
    const p = follow(apart(), pRef, { trackId: 'm', index: 2 }, 'wa')
    expect(t(p, 'b')[2].z).toBe(t(p, 'm')[2].z)
  })

  it('carrying the gradient on: the one the track runs into the source with', () => {
    // The branch's ldS on the main route's first: on its line it would hang on the point behind it — a ring.
    expect(dependOn(apart(), pRef, ldsRef, { mode: 'continueBefore', opts })).toEqual({ error: 'ring' })
    const p = follow(take(apart(), 'lds', 'main'), pRef, ldsRef, 'continueBefore')
    const b = t(p, 'b')
    const g = (b[1].z - b[0].z) / (b[1].station - b[0].station)
    expect(b[2].z).toBeCloseTo(b[1].z + g * (b[2].station - b[1].station), 4)
    // Changed to the plane, it takes the other height.
    const flat = withSwitchHeights(p, setDependencyMode(p, pRef, 'lds', opts), { design: true, opts })
    expect(t(flat, 'b')[2].depMode).toBe('lds')
    expect(t(flat, 'b')[2].z).toBeCloseTo(b[1].z, 3)
    expect(setDependencyMode(p, { trackId: 'a', index: 1 }, 'wa', opts)).toBe(p)
  })

  it('carries on the gradient before or after the source, as chosen (decision 392)', () => {
    // A straight track without turnouts: 2 ‰·10 before the point at 40 m, level after it.
    const plain = (heights) => ({
      tracks: [track('x', [straight({ easting: 0, northing: 0, zone: 5684 }, 90, 100)], heights)], switches: [],
    })
    const p = plain([[0, 100], [20, 100.2], [40, 100.6], [60, 100.6], [80, 101]].map(([station, z]) => ({ station, z })))
    const src = { trackId: 'x', index: 2 }
    const zOf = (dst, mode) => {
      const r = dependOn(p, { trackId: 'x', index: dst }, src, { mode, opts })
      return t(withSwitchHeights(p, r.project, { design: true, opts }), 'x')[dst].z
    }
    expect(zOf(4, 'continueBefore')).toBeCloseTo(101.4, 4)
    expect(zOf(4, 'continueAfter')).toBeCloseTo(100.6, 4)
    expect(zOf(0, 'continueBefore')).toBeCloseTo(99.8, 4)
    expect(zOf(0, 'continueAfter')).toBeCloseTo(100.6, 4)
    // Next to the source the point is not its own neighbour: the line runs on to the point beyond.
    expect(zOf(3, 'continueAfter')).toBeCloseTo(100.8, 4)
    // An older project's 'continue' takes the side away from the point.
    expect(zOf(4, 'continue')).toBeCloseTo(101.4, 4)
    expect(zOf(0, 'continue')).toBeCloseTo(100.6, 4)
    // Changed between the two.
    const before = withSwitchHeights(p, dependOn(p, { trackId: 'x', index: 4 }, src, { mode: 'continueBefore', opts }).project, { design: true, opts })
    const after = withSwitchHeights(before, setDependencyMode(before, { trackId: 'x', index: 4 }, 'continueAfter', opts), { design: true, opts })
    expect(t(after, 'x')[4]).toMatchObject({ depMode: 'continueAfter', z: 100.6 })
    // The toe is no longer offered.
    expect(setDependencyMode(after, { trackId: 'x', index: 4 }, 'wa', opts)).toBe(after)
  })

  it('shows a turnout\'s toe as such, not as a dependency (decision 392)', () => {
    const p = settle(raw())
    const links = heightLinks(p, { opts })
    const toe = links.get(`b|0`)
    expect(toe).toMatchObject({ toe: true, kind: 'standard', from: [], to: [] })
    expect(links.get(`m|0`)?.to ?? []).not.toContainEqual({ trackId: 'b', index: 0 })
  })

  it('gives every turnout its ldS points as a project opens, on the gradient', () => {
    const p = withAllLdsPoints(raw(), opts)
    expect(t(p, 'm')).toHaveLength(3)
    expect(t(p, 'b')).toHaveLength(3)
    expect(t(p, 'm')[1].z).toBeCloseTo(101.7 + 0.3 * t(p, 'm')[1].station / 60, 4)
    expect(withAllLdsPoints(p, opts)).toBe(p)
  })
})

describe('a crossover: the connecting track the branch of both', () => {
  // Two parallel tracks, the connecting track `x` the branch of s1 (at its
  // BEGIN) and of s2 (at its END); `mid` the straight between the two arcs.
  const build = (mid, xHeights) => {
    const wa1 = { easting: 1000, northing: 1000, zone: 5684 }
    const x1 = arc(wa1, 90, 30, -R, { switchId: 's1', switchRoute: 'branch' })
    const x2 = straight(endOf(x1), x1.endBearing, mid)
    const x3 = arc(endOf(x2), x1.endBearing, 30, R, { switchId: 's2', switchRoute: 'branch' })
    const wa2 = endOf(x3)
    const m1 = straight(wa1, 90, 30, { switchId: 's1', switchRoute: 'main' })
    const m2 = straight(wa2, 270, 30, { switchId: 's2', switchRoute: 'main' })
    return {
      tracks: [
        track('a1', [straight(endPointStraightUtm(wa1, 270, 100), 90, 100)], [{ station: 0, z: 99.5 }, { station: 100, z: 100 }]),
        track('m1', [m1, straight(endOf(m1), 90, 70)], [{ station: 0, z: 100 }, { station: 100, z: 100.6 }]),
        track('x', [x1, x2, x3], xHeights(60 + mid)),
        track('a2', [straight(endPointStraightUtm(wa2, 90, 100), 270, 100)], [{ station: 0, z: 100.7 }, { station: 100, z: 100.4 }]),
        track('m2', [m2, straight(endOf(m2), 270, 70)], [{ station: 0, z: 100.4 }, { station: 100, z: 100.1 }]),
      ],
      switches: [
        { switchId: 's1', kind: 'turnout', label: 'TEST', ports: { A: { trackId: 'a1', endpoint: 'END' }, B1: { trackId: 'x', endpoint: 'BEGIN' }, B2: { trackId: 'm1', endpoint: 'BEGIN' } } },
        { switchId: 's2', kind: 'turnout', label: 'TEST', ports: { A: { trackId: 'a2', endpoint: 'END' }, B1: { trackId: 'x', endpoint: 'END' }, B2: { trackId: 'm2', endpoint: 'BEGIN' } } },
      ],
    }
  }
  const ends = (L) => [{ station: 0, z: 100 }, { station: L, z: 100.4 }]

  it('couples both turnouts without a free point on the connecting track', () => {
    const p = settle(build(40, ends))
    expect(gapsOf(p)).toEqual([])
    const x = t(p, 'x')
    expect(x).toHaveLength(4)
    expect(x[0].z).toBe(t(p, 'm1')[0].z)
    expect(x[3].z).toBe(t(p, 'm2')[0].z)
    // An edit of one main route moves the connecting track on its side only.
    const after = write(p, 'a1', setZ(0, 99))
    expect(gapsOf(after)).toEqual([])
    expect(t(after, 'm2')).toBe(t(p, 'm2'))
    expect(t(after, 'x')[2].z).toBe(x[2].z)
  })

  it('lays the connecting track between its ends in the design mode, until heights are taken over', () => {
    let p = settle(build(40, ends), true)
    // Both ldS on the line from toe to toe: an ldS between does not count.
    const x = t(p, 'x')
    const line = (s) => x[0].z + (x[3].z - x[0].z) * s / x[3].station
    expect(x[1].z).toBeCloseTo(line(x[1].station), 3)
    expect(x[2].z).toBeCloseTo(line(x[2].station), 3)
    expect(gapsOf(p).length).toBeGreaterThan(0)
    for (const sw of ['s1', 's2']) {
      p = take(p, 'wa', 'main', sw)
      p = take(p, 'lds', 'main', sw)
    }
    expect(gapsOf(p)).toEqual([])
  })

  it('gives a point a point depending on it, picked as a place on a track: in the plane of the source\'s track', () => {
    const p = settle(build(40, ends))
    const src = { trackId: 'm1', index: 1 }      // the ldS of s1, 40 m from its toe
    // The place across on m2, the way a click on the map finds it.
    const across = stationOnTrack(p.tracks.find(x => x.id === 'm2'), pointAtStation(p.tracks.find(x => x.id === 'm1'), t(p, 'm1')[1].station).utm)
    const r = addDependentAt(p, src, { trackId: 'm2', station: across.station }, { mode: 'lds', opts })
    const after = withSwitchHeights(p, r.project, { opts })
    const dep = t(after, 'm2')[r.ref.index]
    expect(dep).toMatchObject({ dep: t(after, 'm1')[1].id, depMode: 'lds' })
    // Without cant, across a straight: the same height.
    expect(dep.z).toBeCloseTo(t(after, 'm1')[1].z, 4)
    // It holds outside the design mode too, and moves with its source.
    const moved = write(after, 'a1', setZ(0, 99))
    expect(t(moved, 'm1')[1].z).not.toBe(t(after, 'm1')[1].z)
    expect(t(moved, 'm2')[r.ref.index].z).toBeCloseTo(t(moved, 'm1')[1].z, 4)
    expect(heightLinks(moved, { opts }).get('m1|1').to).toContainEqual(r.ref)
    expect(heightLinks(moved, { opts }).get(`m2|${r.ref.index}`)).toMatchObject({ kind: 'own', mode: 'lds' })
    expect(heightRoles(moved, opts).get('m2').get(r.ref.index)).toEqual({ kind: 'own' })
    // A place within 0.5 m of a point is that point.
    const near = addDependentAt(p, src, { trackId: 'x', station: t(p, 'x')[1].station + 0.3 }, { opts })
    expect(near.ref).toEqual({ trackId: 'x', index: 1 })
    expect(t(near.project, 'x')).toHaveLength(t(p, 'x').length)
  })

})

describe.skipIf(!hasPek)('PEK Halle–Könnern', () => {
  it('couples every turnout, crossovers too, and stays so', () => {
    const p0 = hydrateProjects([loadPek()])[0]
    const p = withSwitchHeights({ tracks: [] }, p0)
    expect(switchMisfits(p)).toEqual([])
    expect(withSwitchHeights(p, { ...p, tracks: p.tracks.map(x => ({ ...x })) }).tracks.map(x => x.heights))
      .toEqual(p.tracks.map(x => x.heights))
  })
})
