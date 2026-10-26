import { describe, it, expect } from 'vitest'
import { heightRoles, switchMisfits, takeOverHeight, withSwitchHeights } from './switchChain'
import { couplingOf, ldsLift } from './switchGradient'
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
const take = (p, at, from, sw = 's1') => {
  const r = takeOverHeight(p, sw, at, from, opts)
  if (r.error) throw new Error(`${at} from ${from}: ${r.error}`)
  return r.project
}
const gapsOf = (p) => switchMisfits(p, opts)

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

describe('coupled: the tracks meet at WA and ldS (decision 384)', () => {
  it('gives the branch the main route\'s toe and its ldS the plane, moving the free point behind it', () => {
    const p = settle(raw())
    expect(gapsOf(p)).toEqual([])
    expect(t(p, 'b')[0].z).toBe(t(p, 'm')[0].z)
    // The main route stays as its lines make it.
    expect(t(p, 'm')[2].z).toBe(102)
    expect(t(p, 'b')[2].z).not.toBe(101.9)
  })

  it('lets the main route lead where it was written, its free points staying', () => {
    const p = settle(raw())
    const after = write(p, 'a', setZ(1, 100.8))
    expect(gapsOf(after)).toEqual([])
    expect(t(after, 'a')[1].z).toBe(100.8)
    expect(t(after, 'm')[2].z).toBe(102)
    expect(t(after, 'b')[0].z).toBe(t(after, 'm')[0].z)
  })

  it('lets the branch lead where only it was written: the main route moves the free point behind its ldS', () => {
    const p = settle(raw())
    const after = write(p, 'b', setZ(2, 102.5))
    expect(gapsOf(after)).toEqual([])
    expect(t(after, 'b')[2].z).toBe(102.5)
    expect(t(after, 'a')[1].z).toBe(100.5)
    expect(t(after, 'm')[2].z).not.toBe(102)
    expect(t(after, 'b')[0].z).toBe(t(after, 'm')[0].z)
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

  it('makes up no gradient: a branch without heights is left out', () => {
    const p = settle(single({
      a: [{ station: 0, z: 100 }, { station: 100, z: 100 }],
      m: [{ station: 0, z: 100 }, { station: 60, z: 100.6 }],
    }))
    expect(t(p, 'b')).toBeUndefined()
    expect(gapsOf(p)).toEqual([])
  })

  it('lets a branch getting heights for the first time follow, not lead', () => {
    const bare = settle(single({
      a: [{ station: 0, z: 100 }, { station: 100, z: 100 }],
      m: [{ station: 0, z: 100 }, { station: 60, z: 100.6 }],
    }))
    const after = write(bare, 'b', () => [{ station: 0, z: 99 }, { station: 60, z: 99 }])
    expect(t(after, 'm')).toEqual(t(bare, 'm'))
    expect(gapsOf(after)).toEqual([])
  })
})

describe('the design mode: taking one height over (decision 384)', () => {
  // Coupled first, then the approach moved with the mode on: the main route's
  // toe and ldS follow their line, the branch does not.
  const apart = () => write(settle(raw()), 'a', setZ(1, 100.9), true)

  it('couples nothing, and says where the tracks do not meet', () => {
    const p = apart()
    expect(gapsOf(p).map(m => m.at)).toEqual(['wa', 'lds'])
  })

  it('takes the toe over into the branch, then the ldS by the free point behind it', () => {
    let p = take(apart(), 'wa', 'main')
    expect(t(p, 'b')[0].z).toBe(t(p, 'm')[0].z)
    expect(gapsOf(p).some(m => m.at === 'wa')).toBe(false)
    p = take(p, 'lds', 'main')
    expect(gapsOf(p)).toEqual([])
    expect(take(p, 'lds', 'main')).toBe(p)
  })

  it('takes the branch\'s heights over into the main route by the free point behind its turnout', () => {
    let p = take(apart(), 'lds', 'branch')
    expect(gapsOf(p).map(m => m.at)).toEqual(['wa'])
    expect(t(p, 'a')[1].z).toBe(100.9)
    p = take(p, 'wa', 'branch')
    expect(t(p, 'm')[0].z).toBe(t(p, 'b')[0].z)
    expect(gapsOf(p).filter(m => m.at === 'wa')).toEqual([])
  })

  it('says why it cannot', () => {
    expect(takeOverHeight(apart(), 'gone', 'wa', 'main', opts)).toEqual({ error: 'not_coupled' })
    const bare = settle(single({ a: [{ station: 0, z: 100 }, { station: 100, z: 100 }], m: [{ station: 0, z: 100 }, { station: 60, z: 100.6 }] }))
    expect(takeOverHeight(bare, 's1', 'lds', 'main', opts)).toEqual({ error: 'no_height' })
    // No free point behind the ldS: the branch ends at the next point.
    const short = apart()
    const cut = { ...short, tracks: short.tracks.map(x => (x.id === 'b' ? { ...x, heights: x.heights.slice(0, 2) } : x)) }
    expect(takeOverHeight(cut, 's1', 'lds', 'main', opts)).toEqual({ error: 'no_free_point' })
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

  it('needs a free point of its own behind either ldS', () => {
    const one = settle(build(40, (L) => [{ station: 0, z: 100 }, { station: L / 2, z: 100.2 }, { station: L, z: 100.4 }]))
    expect(gapsOf(one).filter(m => m.need)).toHaveLength(2)
  })

  it('couples both turnouts where it has them, each main route leading its own', () => {
    const p = settle(build(40, (L) => [{ station: 0, z: 100 }, { station: 45, z: 100.2 }, { station: 55, z: 100.2 }, { station: L, z: 100.4 }]))
    expect(gapsOf(p)).toEqual([])
    expect(t(p, 'x')[0].z).toBe(t(p, 'm1')[0].z)
    expect(t(p, 'x')[t(p, 'x').length - 1].z).toBe(t(p, 'm2')[0].z)
    // An edit of one main route moves the connecting track's end on its side only.
    const after = write(p, 'a1', setZ(0, 99))
    expect(gapsOf(after)).toEqual([])
    expect(t(after, 'm2')).toBe(t(p, 'm2'))
    expect(zAt(t(after, 'x'), 55)).toBe(zAt(t(p, 'x'), 55))
  })
})

describe.skipIf(!hasPek)('PEK Halle–Könnern', () => {
  it('couples every turnout but the crossovers lacking a free point, and stays so', () => {
    const p0 = hydrateProjects([loadPek()])[0]
    const p = withSwitchHeights({ tracks: [] }, p0)
    const left = switchMisfits(p)
    // Each turnout of a crossover is left with its ldS and the free point it lacks.
    const needs = left.filter(m => m.need).map(m => m.sw.switchId)
    expect(needs.length).toBeGreaterThanOrEqual(4)
    expect(left.every(m => needs.includes(m.sw.switchId))).toBe(true)
    expect(withSwitchHeights(p, { ...p, tracks: p.tracks.map(x => ({ ...x })) }).tracks.map(x => x.heights))
      .toEqual(p.tracks.map(x => x.heights))
  })
})
