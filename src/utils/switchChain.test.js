import { describe, it, expect } from 'vitest'
import { coupleSwitchGradients, coupleSwitchHeights, heightRoles, pendingTurnouts, CROSSOVER_SPAN } from './switchChain'
import { switchCoupling } from './switchGradient'
import { endPointCurvedUtm, endPointStraightUtm } from './elementUtils'
import { formOf } from '../test/turnoutFixture'
import { hasPek, loadPek } from '../test/pekFixture'
import { hydrateProjects } from './persistenceUtils'

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
const zAt = (h, s) => h.find(p => Math.abs(p.station - s) < 0.002)?.z

/** A turnout at `at`: approach `a` (100 m, ending at WA), main `m` (60 m), branch `b` (60 m on R 500). */
function single(heights) {
  const at = { easting: 1000, northing: 1000, zone: 5684 }
  const back = endPointStraightUtm(at, 270, 100)
  const m1 = straight(at, 90, 30, { switchId: 's1', switchRoute: 'main' })
  const b1 = arc(at, 90, 30, -R, { switchId: 's1', switchRoute: 'branch' })
  return {
    tracks: [
      track('a', [straight(back, 90, 100)], heights.a),
      track('m', [m1, straight(endOf(m1), 90, 30)], heights.m),
      track('b', [b1, arc(endOf(b1), b1.endBearing, 30, -R)], heights.b),
    ],
    switches: [{
      switchId: 's1', kind: 'turnout', label: 'TEST',
      portA_trackId: 'a', portA_endpoint: 'END',
      portB1_trackId: 'b', portB1_endpoint: 'BEGIN', portB2_trackId: 'm', portB2_endpoint: 'BEGIN',
    }],
  }
}

describe('the main route through a turnout (decision 270)', () => {
  const raw = () => single({
    a: [{ station: 0, z: 100 }, { station: 50, z: 100.5 }, { station: 100, z: 101.7 }],
    m: [{ station: 0, z: 101.7 }, { station: 60, z: 102 }],
    b: [{ station: 0, z: 101.7 }, { station: 60, z: 101.9 }],
  })

  it('puts WA and ldS on the line from the last point before WA to the first behind the ldS', () => {
    const p = coupleSwitchGradients(raw(), opts)
    // Q at 50 m on the approach, P at 60 m on the main route: 110 m apart.
    const g = (102 - 100.5) / 110
    expect(t(p, 'a')[2].z).toBeCloseTo(100.5 + 50 * g, 4)
    expect(t(p, 'm').map(q => q.station)).toEqual([0, 40, 60])
    expect(t(p, 'm')[0].z).toBeCloseTo(100.5 + 50 * g, 4)
    expect(t(p, 'm')[1].z).toBeCloseTo(100.5 + 90 * g, 4)
    // The toe is one point on all three tracks; Q and P stay.
    expect(t(p, 'b')[0].z).toBe(t(p, 'm')[0].z)
    expect(t(p, 'a')[1].z).toBe(100.5)
    expect(t(p, 'm')[2].z).toBe(102)
    expect(coupleSwitchGradients(p, opts)).toBe(p)
  })

  it('follows a point moved before WA, in the same write', () => {
    const p = coupleSwitchGradients(raw(), opts)
    const edited = { ...p, tracks: p.tracks.map(x => (x.id === 'a' ? { ...x, heights: x.heights.map((q, i) => (i === 1 ? { ...q, z: 100.8 } : q)) } : x)) }
    const after = coupleSwitchHeights(p, edited, opts)
    const g = (102 - 100.8) / 110
    expect(t(after, 'm')[1].z).toBeCloseTo(100.8 + 90 * g, 4)
  })

  it('splits the line at a point between WA and ldS', () => {
    const p = coupleSwitchGradients(raw(), opts)
    const withInner = { ...p, tracks: p.tracks.map(x => (x.id === 'm'
      ? { ...x, heights: [x.heights[0], { station: 20.1, z: 101.5 }, ...x.heights.slice(1)] } : x)) }
    const after = coupleSwitchHeights(p, withInner, opts)
    const m = t(after, 'm')
    const inner = m.find(q => q.station > 15 && q.station < 25)
    expect(inner.z).toBe(101.5)
    // WA on Q → inner, ldS on inner → P.
    expect(m[0].z).toBeCloseTo(100.5 + 50 * (101.5 - 100.5) / (50 + inner.station), 3)
    const lds = m.find(q => Math.abs(q.station - 40) < 0.002)
    expect(lds.z).toBeCloseTo(101.5 + (40 - inner.station) * (102 - 101.5) / (60 - inner.station), 3)
  })

  it('keeps the toe where nothing lies before it', () => {
    const p = coupleSwitchGradients({ ...raw(), tracks: raw().tracks.filter(x => x.id !== 'a') }, opts)
    expect(t(p, 'm')[0].z).toBe(101.7)
    expect(t(p, 'm')[1].z).toBeCloseTo(101.7 + 40 * 0.3 / 60, 4)
  })
})

describe('the branch behind its ldS (decision 271)', () => {
  const raw = () => single({
    a: [{ station: 0, z: 100 }, { station: 100, z: 100 }],
    m: [{ station: 0, z: 100 }, { station: 60, z: 100.6 }],
    b: [{ station: 0, z: 100 }, { station: 50, z: 100.9 }, { station: 60, z: 101.2 }],
  })

  it('puts the first point behind the ldS on the continuation of the gradient into it, and leaves the next', () => {
    const p = coupleSwitchGradients(raw(), opts)
    const b = t(p, 'b')
    const lds = b[1]
    const g = (lds.z - b[0].z) / lds.station
    expect(b[2].station).toBe(50)
    expect(b[2].z).toBeCloseTo(lds.z + g * (50 - lds.station), 4)
    expect(b[3].z).toBe(101.2)
  })

  it('makes the track end the point where there is none behind the ldS', () => {
    const p = coupleSwitchGradients(single({
      a: [{ station: 0, z: 100 }, { station: 100, z: 100 }],
      m: [{ station: 0, z: 100 }, { station: 60, z: 100.6 }],
      b: [{ station: 0, z: 100 }, { station: 60, z: 101.2 }],
    }), opts)
    const b = t(p, 'b')
    const g = (b[1].z - b[0].z) / b[1].station
    expect(b[2].z).toBeCloseTo(b[1].z + g * (60 - b[1].station), 4)
  })

  it('tells the profile what each point is', () => {
    const p = coupleSwitchGradients(raw(), opts)
    const roles = heightRoles(p, opts)
    expect(roles.get('m').get(0)).toMatchObject({ kind: 'wa' })
    expect(roles.get('m').get(1)).toMatchObject({ kind: 'lds', side: 'main' })
    expect(roles.get('b').get(1)).toMatchObject({ kind: 'lds', side: 'branch' })
    const cont = roles.get('b').get(2)
    expect(cont).toMatchObject({ kind: 'continuation', free: 1 })
    expect(cont.line.z0 + cont.line.g * (50 - cont.line.s0)).toBeCloseTo(t(p, 'b')[2].z, 4)
    expect(roles.get('b').has(3)).toBe(false)
    expect(roles.get('a').get(1)).toMatchObject({ kind: 'wa' })
  })

  it('counts the turnouts coupling would still change', () => {
    expect(pendingTurnouts(raw(), opts)).toHaveLength(1)
    expect(pendingTurnouts(coupleSwitchGradients(raw(), opts), opts)).toHaveLength(0)
  })
})

describe('a turnout whose branch runs into the toe of the next (decision 271)', () => {
  // The branch of s1 is the approach of s2: its end is s2's toe.
  const build = () => {
    const p = single({
      a: [{ station: 0, z: 100 }, { station: 100, z: 100 }],
      m: [{ station: 0, z: 100 }, { station: 60, z: 100.6 }],
      b: [{ station: 0, z: 100 }, { station: 60, z: 101.5 }],
    })
    const b = p.tracks.find(x => x.id === 'b')
    const wa2 = endOf(b.elements[1])
    const bearing = b.elements[1].endBearing
    const m2a = straight(wa2, bearing, 30, { switchId: 's2', switchRoute: 'main' })
    const b2a = arc(wa2, bearing, 30, -R, { switchId: 's2', switchRoute: 'branch' })
    return {
      tracks: [...p.tracks,
        track('m2', [m2a, straight(endOf(m2a), bearing, 60)], [{ station: 0, z: 101.5 }, { station: 70, z: 99 }, { station: 90, z: 99 }]),
        track('b2', [b2a, arc(endOf(b2a), b2a.endBearing, 30, -R)], [{ station: 0, z: 101.5 }, { station: 60, z: 101 }]),
      ],
      switches: [...p.switches, {
        switchId: 's2', kind: 'turnout', label: 'TEST',
        portA_trackId: 'b', portA_endpoint: 'END',
        portB1_trackId: 'b2', portB1_endpoint: 'BEGIN', portB2_trackId: 'm2', portB2_endpoint: 'BEGIN',
      }],
    }
  }

  it('sets that toe on the continuation, and the next main route runs on it to its first free point', () => {
    const p = coupleSwitchGradients(build(), opts)
    const b = t(p, 'b')
    const g = (b[1].z - b[0].z) / b[1].station
    const at = (s) => b[1].z + g * (s - b[1].station)
    expect(b[2].z).toBeCloseTo(at(60), 4)
    const m2 = t(p, 'm2')
    expect(m2[0].z).toBe(b[2].z)
    expect(m2.find(q => Math.abs(q.station - 40) < 0.002).z).toBeCloseTo(at(100), 3)
    // P of s2 at 70 m lies on it too — only its station and the gradient beyond it are its own.
    expect(m2.find(q => q.station === 70).z).toBeCloseTo(at(130), 3)
    expect(m2.find(q => q.station === 90).z).toBe(99)
    const role = heightRoles(p, opts).get('m2').get(2)
    expect(role).toMatchObject({ kind: 'continuation', free: 1 })
    expect(role.line.z0 + role.line.g * (80 - role.line.s0)).toBeCloseTo(at(140), 3)
  })
})

describe('a crossover (decision 272)', () => {
  // Two parallel tracks, the connecting track `x` the branch of s1 (at its
  // BEGIN) and of s2 (at its END); `mid` the straight between the two arcs.
  const build = (mid, { h1 = [100, 100.6], h2 = [100.4, 100.1] } = {}) => {
    const wa1 = { easting: 1000, northing: 1000, zone: 5684 }
    const x1 = arc(wa1, 90, 30, -R, { switchId: 's1', switchRoute: 'branch' })
    const x2 = straight(endOf(x1), x1.endBearing, mid)
    const x3 = arc(endOf(x2), x1.endBearing, 30, R, { switchId: 's2', switchRoute: 'branch' })
    const wa2 = endOf(x3)
    const len = 60 + mid
    const m1 = straight(wa1, 90, 30, { switchId: 's1', switchRoute: 'main' })
    const m2 = straight(wa2, 270, 30, { switchId: 's2', switchRoute: 'main' })
    return {
      tracks: [
        track('a1', [straight(endPointStraightUtm(wa1, 270, 100), 90, 100)], [{ station: 0, z: h1[0] - 0.5 }, { station: 100, z: h1[0] }]),
        track('m1', [m1, straight(endOf(m1), 90, 70)], [{ station: 0, z: h1[0] }, { station: 100, z: h1[1] }]),
        track('x', [x1, x2, x3], [{ station: 0, z: h1[0] }, { station: len, z: h2[0] }]),
        track('a2', [straight(endPointStraightUtm(wa2, 90, 100), 270, 100)], [{ station: 0, z: h2[0] + 0.3 }, { station: 100, z: h2[0] }]),
        track('m2', [m2, straight(endOf(m2), 270, 70)], [{ station: 0, z: h2[0] }, { station: 100, z: h2[1] }]),
      ],
      switches: [
        { switchId: 's1', kind: 'turnout', label: 'TEST', portA_trackId: 'a1', portA_endpoint: 'END',
          portB1_trackId: 'x', portB1_endpoint: 'BEGIN', portB2_trackId: 'm1', portB2_endpoint: 'BEGIN' },
        // Seen from its toe, s2's branch turns the other way: to the left of its main route, too.
        { switchId: 's2', kind: 'turnout', label: 'TEST', portA_trackId: 'a2', portA_endpoint: 'END',
          portB1_trackId: 'x', portB1_endpoint: 'END', portB2_trackId: 'm2', portB2_endpoint: 'BEGIN' },
      ],
    }
  }
  const ldsOf = (p, id) => switchCoupling(p.tracks, p.switches.find(s => s.switchId === id), opts).ldsBranch

  it('couples both turnouts', () => {
    const p = build(60)
    expect(ldsOf(p, 's1')).toBeGreaterThan(30)
    expect(ldsOf(p, 's2')).toBeLessThan(90)
  })

  it('carries one point where the continuations meet, with more than 20 m between the ldS', () => {
    // Both main routes rise away from their toe: the continuations meet in a crest.
    const raw = build(60, { h1: [100, 101], h2: [100, 101] })
    const withExtra = { ...raw, tracks: raw.tracks.map(x => (x.id === 'x'
      ? { ...x, heights: [x.heights[0], { station: 55, z: 100.3 }, { station: 65, z: 100.2 }, x.heights[1]] } : x)) }
    const p = coupleSwitchGradients(withExtra, opts)
    const x = t(p, 'x')
    const [l1, l2] = [ldsOf(p, 's1'), ldsOf(p, 's2')]
    expect(l2 - l1).toBeGreaterThan(CROSSOVER_SPAN)
    const between = x.filter(q => q.station > l1 + 0.01 && q.station < l2 - 0.01)
    expect(between).toHaveLength(1)
    const z1 = zAt(x, l1), z2 = zAt(x, l2)
    const g1 = (z1 - x[0].z) / l1, g2 = (z2 - x[x.length - 1].z) / (l2 - x[x.length - 1].station)
    const M = between[0]
    expect(M.z).toBeCloseTo(z1 + g1 * (M.station - l1), 3)
    expect(M.z).toBeCloseTo(z2 + g2 * (M.station - l2), 3)
    expect(heightRoles(p, opts).get('x').get(x.indexOf(M))).toMatchObject({ kind: 'middle' })
  })

  it('carries none with 20 m or less, and the leading turnout sets the other\'s toe', () => {
    const raw = build(30)
    const withExtra = { ...raw, tracks: raw.tracks.map(x => (x.id === 'x'
      ? { ...x, heights: [x.heights[0], { station: 45, z: 100.3 }, x.heights[1]] } : x)) }
    const p = coupleSwitchGradients(withExtra, opts)
    const x = t(p, 'x')
    const [l1, l2] = [ldsOf(p, 's1'), ldsOf(p, 's2')]
    expect(l2 - l1).toBeLessThanOrEqual(CROSSOVER_SPAN)
    expect(x.filter(q => q.station > l1 + 0.01 && q.station < l2 - 0.01)).toHaveLength(0)
    // s1 leads (m1 comes first): its continuation reaches s2's toe.
    const z1 = zAt(x, l1)
    const g1 = (z1 - x[0].z) / l1
    const end = x[x.length - 1]
    expect(end.z).toBeCloseTo(z1 + g1 * (end.station - l1), 3)
    // s2's line Q₂ → P₂ is shifted through it: same gradient as before, Q₂ and P₂ along.
    const a2 = t(p, 'a2'), m2 = t(p, 'm2')
    expect(m2[0].z).toBe(end.z)
    const slope = (a2[0].z - m2[m2.length - 1].z) / 200
    expect(slope).toBeCloseTo((100.4 + 0.3 - 100.1) / 200, 4)
    expect(a2[0].z - end.z).toBeCloseTo(slope * 100, 3)
    expect(coupleSwitchGradients(p, opts)).toBe(p)
  })
})

describe('who leads a crossover: the track the write changed (decision 275)', () => {
  // The crossover of decision 272 with 20 m or less between the ldS (mid 30),
  // and with the two stretches overlapping (mid 0) — the usual one.
  const build = (mid) => {
    const wa1 = { easting: 1000, northing: 1000, zone: 5684 }
    const x1 = arc(wa1, 90, 30, -R, { switchId: 's1', switchRoute: 'branch' })
    const parts = [x1]
    if (mid > 0) parts.push(straight(endOf(x1), x1.endBearing, mid))
    const x3 = arc(endOf(parts[parts.length - 1]), x1.endBearing, 30, R, { switchId: 's2', switchRoute: 'branch' })
    parts.push(x3)
    const wa2 = endOf(x3)
    const m1 = straight(wa1, 90, 30, { switchId: 's1', switchRoute: 'main' })
    const m2 = straight(wa2, 270, 30, { switchId: 's2', switchRoute: 'main' })
    return {
      tracks: [
        track('a1', [straight(endPointStraightUtm(wa1, 270, 100), 90, 100)], [{ station: 0, z: 99.5 }, { station: 50, z: 99.8 }, { station: 100, z: 100 }]),
        track('m1', [m1, straight(endOf(m1), 90, 70)], [{ station: 0, z: 100 }, { station: 100, z: 100.6 }]),
        track('x', parts, [{ station: 0, z: 100 }, { station: 60 + mid, z: 100.4 }]),
        track('a2', [straight(endPointStraightUtm(wa2, 90, 100), 270, 100)], [{ station: 0, z: 100.7 }, { station: 50, z: 100.5 }, { station: 100, z: 100.4 }]),
        track('m2', [m2, straight(endOf(m2), 270, 70)], [{ station: 0, z: 100.4 }, { station: 100, z: 100.1 }]),
      ],
      switches: [
        { switchId: 's1', kind: 'turnout', label: 'TEST', portA_trackId: 'a1', portA_endpoint: 'END',
          portB1_trackId: 'x', portB1_endpoint: 'BEGIN', portB2_trackId: 'm1', portB2_endpoint: 'BEGIN' },
        { switchId: 's2', kind: 'turnout', label: 'TEST', portA_trackId: 'a2', portA_endpoint: 'END',
          portB1_trackId: 'x', portB1_endpoint: 'END', portB2_trackId: 'm2', portB2_endpoint: 'BEGIN' },
      ],
    }
  }
  const lift = (p, id, index, dz) => ({ ...p, tracks: p.tracks.map(x => (x.id === id
    ? { ...x, heights: x.heights.map((q, i) => (i === index ? { ...q, z: roundTo(q.z + dz) } : q)) } : x)) })
  const roundTo = (z) => Math.round(z * 10000) / 10000
  const last = (h) => h[h.length - 1]

  for (const mid of [30, 0]) {
    describe(`${mid ? '10' : 'no'} m between the ldS`, () => {
      it('passes an edit of the first track on to the turnout across and the track beside', () => {
        const p = coupleSwitchGradients(build(mid), opts)
        // s1 leads by the order of the project as well: its toe moves, s2 follows.
        const after = coupleSwitchHeights(p, lift(p, 'a1', 1, 0.5), opts)
        expect(t(after, 'm1')[0].z).not.toBeCloseTo(t(p, 'm1')[0].z, 3)
        expect(last(t(after, 'x')).z).not.toBeCloseTo(last(t(p, 'x')).z, 3)
        expect(t(after, 'm2')[0].z).toBe(last(t(after, 'x')).z)
        // Q₂ and P₂ rise by the same amount, the toe of s2 with them.
        const dQ = t(after, 'a2')[1].z - t(p, 'a2')[1].z
        expect(Math.abs(dQ)).toBeGreaterThan(0.01)
        expect(last(t(after, 'm2')).z - last(t(p, 'm2')).z).toBeCloseTo(dQ, 4)
        expect(t(after, 'm2')[0].z - t(p, 'm2')[0].z).toBeCloseTo(dQ, 3)  // each kept to 0.1 mm
        expect(coupleSwitchGradients(after, opts)).toBe(after)
      })

      it('lets the second track lead where it is the one edited, and keeps it so', () => {
        const p = coupleSwitchGradients(build(mid), opts)
        const after = coupleSwitchHeights(p, lift(p, 'a2', 1, 0.5), opts)
        // The edit stays, and s2's toe sits on the line through it.
        expect(t(after, 'a2')[1].z).toBe(roundTo(t(p, 'a2')[1].z + 0.5))
        expect(last(t(after, 'a2')).z).not.toBeCloseTo(last(t(p, 'a2')).z, 3)
        // s1 follows: its toe on s2's continuation, Q₁ and P₁ by the same amount.
        expect(t(after, 'x')[0].z).not.toBeCloseTo(t(p, 'x')[0].z, 3)
        expect(t(after, 'm1')[0].z).toBe(t(after, 'x')[0].z)
        const dQ = t(after, 'a1')[1].z - t(p, 'a1')[1].z
        expect(Math.abs(dQ)).toBeGreaterThan(0.01)
        expect(last(t(after, 'm1')).z - last(t(p, 'm1')).z).toBeCloseTo(dQ, 4)
        expect(t(after, 'x')[0].z - t(p, 'x')[0].z).toBeCloseTo(dQ, 3)  // each kept to 0.1 mm
        // Coupling again keeps s2 leading — it sets s1's toe now.
        expect(coupleSwitchGradients(after, opts)).toBe(after)
        expect(pendingTurnouts(after, opts)).toHaveLength(0)
        // An edit far from both turnouts leaves that as it is.
        const far = coupleSwitchHeights(after, lift(after, 'a1', 0, 0.2), opts)
        expect(t(far, 'm2')).toBe(t(after, 'm2'))
      })
    })
  }
})

describe.skipIf(!hasPek)('the crossovers of PEK Halle–Könnern (decision 275)', () => {
  it('pass an edit before either toe on to the other turnout, and stay coupled', () => {
    const p = coupleSwitchGradients(hydrateProjects([loadPek()])[0])
    expect(coupleSwitchGradients(p)).toBe(p)
    const roles = heightRoles(p)
    const turnouts = p.switches.filter(s => switchCoupling(p.tracks, s))
    const branchOf = (s) => (s.portB1_trackId && p.tracks.find(x => x.id === s.portB1_trackId)?.elements.some(el => el.switchRoute === 'branch' && el.switchId === s.switchId)
      ? { id: s.portB1_trackId, end: s.portB1_endpoint } : { id: s.portB2_trackId, end: s.portB2_endpoint })
    let checked = 0
    for (const s of turnouts) {
      const b = branchOf(s)
      const o = turnouts.find(x => x !== s && branchOf(x).id === b.id && branchOf(x).end !== b.end)
      if (!o) continue
      const gap = Math.abs(switchCoupling(p.tracks, o).ldsBranch - switchCoupling(p.tracks, s).ldsBranch)
      if (gap > CROSSOVER_SPAN) continue
      // The free point next to the toe on the approach.
      const a = p.tracks.find(x => x.id === s.portA_trackId)
      const index = s.portA_endpoint === 'END' ? a.heights.length - 2 : 1
      if (roles.get(a.id)?.has(index)) continue
      const edited = { ...p, tracks: p.tracks.map(x => (x === a
        ? { ...x, heights: x.heights.map((q, i) => (i === index ? { ...q, z: q.z + 0.5 } : q)) } : x)) }
      const after = coupleSwitchHeights(p, edited)
      const bh = (q) => q.tracks.find(x => x.id === b.id).heights
      const otherToe = (q) => (b.end === 'BEGIN' ? bh(q)[bh(q).length - 1] : bh(q)[0]).z
      expect(Math.abs(otherToe(after) - otherToe(p)), `${s.name} → ${o.name}`).toBeGreaterThan(0.001)
      expect(coupleSwitchGradients(after)).toBe(after)
      checked++
    }
    expect(checked).toBeGreaterThanOrEqual(3)
  })
})
