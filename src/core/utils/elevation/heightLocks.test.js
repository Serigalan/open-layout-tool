import { describe, it, expect } from 'vitest'
import { heightRoles, withSwitchHeights } from './switchChain'
import { lockBreach } from './heightLocks'
import { endPointCurvedUtm, endPointStraightUtm } from '../geometry/elementUtils'
import { formOf } from '../../test/turnoutFixture'

// Entscheidung 382 — on the turnout of switchChain.test.js: approach `a`
// (100 m, ending at WA), main `m` (60 m, ldS at 40 m), branch `b` on R 500.
const R = 500
const node = (p) => [p.easting, p.northing]
const straight = (from, bearing, length, extra = {}) => ({
  elementType: 0, startNode: node(from), endNode: node(endPointStraightUtm(from, bearing, length)), bearing, length, speed: 80, ...extra,
})
const arc = (from, bearing, length, r, extra = {}) => ({
  elementType: 1, startNode: node(from), endNode: node(endPointCurvedUtm(from, bearing, length, r)),
  bearing, endBearing: bearing - Math.sign(-r) * (length / R) * 180 / Math.PI, radius: r, length, speed: 80, ...extra,
})
const endOf = (el) => ({ easting: el.endNode[0], northing: el.endNode[1], zone: 5684 })
const opts = { formOf }

function single() {
  const at = { easting: 1000, northing: 1000, zone: 5684 }
  const m1 = straight(at, 90, 30, { switchId: 's1', switchRoute: 'main' })
  const b1 = arc(at, 90, 30, -R, { switchId: 's1', switchRoute: 'branch' })
  const project = {
    tracks: [
      { id: 'a', epsg: 5684, elements: [straight(endPointStraightUtm(at, 270, 100), 90, 100)],
        heights: [{ station: 0, z: 100 }, { station: 50, z: 100.5 }, { station: 100, z: 101.7 }] },
      { id: 'm', epsg: 5684, elements: [m1, straight(endOf(m1), 90, 30)], heights: [{ station: 0, z: 101.7 }, { station: 60, z: 102 }] },
      { id: 'b', epsg: 5684, elements: [b1, arc(endOf(b1), b1.endBearing, 30, -R)], heights: [{ station: 0, z: 101.7 }, { station: 60, z: 101.9 }] },
    ],
    switches: [{ switchId: 's1', kind: 'turnout', label: 'TEST', ports: {
      A: { trackId: 'a', endpoint: 'END' }, B1: { trackId: 'b', endpoint: 'BEGIN' }, B2: { trackId: 'm', endpoint: 'BEGIN' },
    } }],
  }
  return withSwitchHeights({ tracks: [] }, project, { opts })
}

/** The project with the heights of track `id` made by `fn`. */
const withHeights = (p, id, fn) => ({ ...p, tracks: p.tracks.map(t => (t.id === id ? { ...t, heights: fn(t.heights) } : t)) })
const lockAt = (p, id, i) => withHeights(p, id, h => h.map((q, k) => (k === i ? { ...q, locked: true } : q)))
/** A write as the store does it: the turnout's lines and coupling (decision 384), then the check. */
const write = (before, next, extra = {}) => lockBreach(before, withSwitchHeights(before, next, { opts }), extra)

describe('a locked point (Entscheidung 382)', () => {
  it('may be locked, and then keeps its height', () => {
    const p = single()
    const locked = lockAt(p, 'a', 0)
    expect(write(p, locked)).toBeNull()
    const moved = withHeights(locked, 'a', h => h.map((q, k) => (k === 0 ? { ...q, z: 99 } : q)))
    expect(write(locked, moved)).toMatchObject({ kind: 'point', trackId: 'a', station: 0 })
  })

  it('goes only where the write may take locks away', () => {
    const locked = lockAt(single(), 'a', 0)
    const gone = withHeights(locked, 'a', h => h.slice(1))
    expect(write(locked, gone)).not.toBeNull()
    expect(write(locked, gone, { unlock: true })).toBeNull()
    const unlocked = withHeights(locked, 'a', h => h.map(({ locked: _l, ...q }) => q))
    expect(write(locked, unlocked)).not.toBeNull()
    expect(write(locked, unlocked, { unlock: true })).toBeNull()
  })

  it('goes with its track, and lives on where the track was split', () => {
    const locked = lockAt(single(), 'a', 0)
    expect(write(locked, { ...locked, tracks: locked.tracks.filter(t => t.id !== 'a') })).toBeNull()
  })
})

describe('a locked toe or ldS holds the turnout (decision 384)', () => {
  // The toe is the last point of the approach `a` (and the first of m and b).
  const lockedToe = () => lockAt(single(), 'a', 2)

  it('is shown as locked, with the role it has besides', () => {
    const roles = heightRoles(lockedToe(), opts)
    expect(roles.get('a').get(2)).toMatchObject({ kind: 'locked', was: { kind: 'wa', side: 'main' } })
    expect(roles.get('m').get(1)).toMatchObject({ kind: 'lds', side: 'main' })
  })

  it('refuses a height before the toe that would turn the line through it', () => {
    const p = lockedToe()
    const tilted = withHeights(p, 'a', h => h.map((q, k) => (k === 1 ? { ...q, z: q.z + 0.2 } : q)))
    expect(write(p, tilted)).toMatchObject({ kind: 'point', trackId: 'a' })
  })

  it('takes a point before the toe moved along its line', () => {
    const p = lockedToe()
    const [, q, wa] = p.tracks.find(t => t.id === 'a').heights
    const g = (wa.z - q.z) / (wa.station - q.station)
    const along = withHeights(p, 'a', h => h.map((x, k) => (k === 1 ? { ...x, station: 40, z: Math.round((q.z + g * (40 - q.station)) * 1e4) / 1e4 } : x)))
    expect(write(p, along)).toBeNull()
  })

  it('holds the branch\'s ldS against the coupling: the main route moved under it is refused', () => {
    const p = lockAt(single(), 'b', 1)
    const raised = withHeights(p, 'm', h => h.map((q, k) => (k === 2 ? { ...q, z: q.z + 0.2 } : q)))
    expect(write(p, raised)).toMatchObject({ kind: 'point', trackId: 'b' })
  })
})
