import { describe, it, expect } from 'vitest'
import {
  switchCoupling, couplingOf, pairedHeights, coupleSwitchGradients, coupleSwitchHeights, branchPlaneHeight,
  trackHeightAt, touchedTurnouts, coupledPoints, switchBodySpans, switchLds, heightContext, unpairedTurnouts,
  planeDeviations,
} from './switchGradient'
import { turnoutSleepers } from './switchSleepers'
import { reverseTrack } from './trackModel'
import { endPointCurvedUtm } from './elementUtils'
import { checkVertical } from './gradientCheck'
import { LDS, R, branchTrack as branchOf, formOf, mainTrack as mainOf, sleeperAtX, turnout, xAtMain } from '../test/turnoutFixture'

const mainTrack = (cant = 0, heights = [{ station: 0, z: 105.2 }, { station: 60, z: 106.025 }]) => mainOf(cant, heights)
const branchTrack = (heights = [{ station: 0, z: 105.2 }, { station: 60, z: 105.5 }]) => branchOf(heights)
const opts = { formOf }

// The ldS sleeper leans with the bisector: it meets the branch LDS.branch
// along it, LDS.q[1] to the left and LDS.q[0] east of WA. On a main route of
// one gradient g the turnout is a plane, so the branch lies there at
// z_WA + g · LDS.q[0] + u/1500 · LDS.q[1], whichever way the sleeper leans.
const OFFSET = LDS.q[1]
const ALONG = LDS.branch
const G = 0.825 / 60
const ldsZ = (cant, z0 = 105.2, g = G) => z0 + g * LDS.q[0] + (cant / 1500) * OFFSET

// The coupling of the one turnout, and the branch heights pairing asks for.
const coupling = (tracks, sw, o) => couplingOf(tracks, [sw], sw, o)
const pairedBranch = (c) => (c ? pairedHeights(c, 'main')?.branch ?? null : null)

describe('the ldS of a form', () => {
  it('comes from the catalogue, as the distance behind WE', () => {
    expect(switchLds(turnout(), formOf)).toBe(10)
    expect(switchLds(turnout({ label: '500 – 1:12' }))).toBe(6.334)
    expect(switchLds(turnout({ label: '215 – 1:4.8' }))).toBe(0)
    expect(switchLds(turnout({ label: '300 – 1:14' }))).toBe(5.125)
    expect(switchLds(turnout({ label: '190 – 1:6.3' }))).toBe(0)
  })
})

describe('coupling a branch to its main route', () => {
  it('finds the ldS on both tracks, and how far apart they are there', () => {
    const c = coupling([mainTrack(), branchTrack()], turnout(), opts)
    expect(c.ldsMain).toBeCloseTo(40, 6)
    expect(c.ldsBranch).toBeCloseTo(ALONG, 3)
    expect(c.offset).toBeCloseTo(OFFSET, 4)
  })

  it('gives the branch the main route\'s height at the ldS without cant', () => {
    const c = coupling([mainTrack(0), branchTrack()], turnout(), opts)
    const h = pairedBranch(c)
    expect(h.map(p => p.station)).toEqual([0, Number(ALONG.toFixed(3)), 60])
    expect(h[1].z).toBeCloseTo(ldsZ(0), 3)
  })

  it('lifts it by u/1500 · offset when it leaves to the raised side, lowers it to the other', () => {
    // A positive cant raises the left rail — the branch's side.
    const up = pairedBranch(coupling([mainTrack(50), branchTrack()], turnout(), opts))
    expect(up[1].z).toBeCloseTo(ldsZ(50), 3)
    const down = pairedBranch(coupling([mainTrack(-50), branchTrack()], turnout(), opts))
    expect(down[1].z).toBeCloseTo(ldsZ(-50), 3)
  })

  it('reproduces the worked example: 105.75 + 0.05 · 2720 / 1500', () => {
    // A main route of one gradient through 105.75 where the ldS sleeper meets
    // it 2.72 m off — the branch lies u/1500 · 2.72 above the main route
    // across from it, at the foot of the perpendicular from the branch point.
    const x = (() => { let lo = 30, hi = 59; for (let i = 0; i < 60; i++) { const m = (lo + hi) / 2; if (sleeperAtX(xAtMain(m)).q[1] < 2.72) lo = m; else hi = m } return (lo + hi) / 2 })()
    const foot = sleeperAtX(xAtMain(x)).q[0]
    const main = mainTrack(50, [{ station: 0, z: 105.75 - G * foot }, { station: 60, z: 105.75 + G * (60 - foot) }])
    const c = coupling([main, branchTrack()], turnout(), { formOf: () => ({ lds: x - 30 }) })
    expect(c.offset).toBeCloseTo(2.72, 4)
    expect(pairedBranch(c).find(p => p.station > 0 && p.station < 60).z).toBeCloseTo(105.841, 3)
  })

  it('works the same on a branch whose stations run toward the toe', () => {
    const reversed = reverseTrack(branchTrack())
    const sw = turnout({ portB1_endpoint: 'END' })
    const c = coupling([mainTrack(50), reversed], sw, opts)
    expect(c.offset).toBeCloseTo(OFFSET, 4)
    expect(c.ldsBranch).toBeCloseTo(60 - ALONG, 3)
    const h = pairedBranch(c)
    expect(h.find(p => Math.abs(p.station - (60 - ALONG)) < 0.01).z).toBeCloseTo(ldsZ(50), 3)
  })

  it('takes away a branch point between WA and ldS without a partner on the main route, and leaves the rest', () => {
    const branch = branchTrack([{ station: 0, z: 105.2 }, { station: 20, z: 999 }, { station: 60, z: 105.5 }])
    const h = pairedBranch(coupling([mainTrack(0), branch], turnout(), opts))
    expect(h.map(p => p.station)).toEqual([0, Number(ALONG.toFixed(3)), 60])
    expect(h[h.length - 1]).toEqual({ station: 60, z: 105.5 })
  })

  it('makes up no gradient: none without heights on either side', () => {
    expect(pairedBranch(coupling([mainTrack(0, null), branchTrack()], turnout(), opts))).toBeNull()
    expect(pairedBranch(coupling([mainTrack(), branchTrack(null)], turnout(), opts))).toBeNull()
    // A main gradient that stops before the ldS has no height to give there.
    const short = mainTrack(0, [{ station: 0, z: 105.2 }, { station: 35, z: 105.6 }])
    expect(pairedBranch(coupling([short, branchTrack()], turnout(), opts))).toBeNull()
  })

  it('does not couple a form without ldS, nor any other kind of switch', () => {
    expect(switchCoupling([mainTrack(), branchTrack()], turnout({ label: 'X' }), opts)).toBeNull()
    expect(switchCoupling([mainTrack(), branchTrack()], turnout({ kind: 'crossing' }), opts)).toBeNull()
  })
})

describe('the plane between WA and ldS', () => {
  it('gives the branch the main route\'s height plus the tilt at each station', () => {
    const tracks = [mainTrack(50), branchTrack()]
    const c = switchCoupling(tracks, turnout(), opts)
    const d = 20
    const x = R * Math.sin(d / R), y = R - R * Math.cos(d / R)
    expect(branchPlaneHeight(c, d)).toBeCloseTo(105.2 + 0.01375 * x + 0.05 * y / 1.5, 4)
    expect(trackHeightAt(tracks, [turnout()], tracks[1], d, opts)).toBeCloseTo(branchPlaneHeight(c, d), 9)
  })

  it('is not stored: beyond the ldS and on the main route the gradient answers', () => {
    const tracks = [mainTrack(50), branchTrack()]
    expect(trackHeightAt(tracks, [turnout()], tracks[1], 50, opts)).toBeCloseTo(105.2 + 0.3 * 50 / 60, 6)
    expect(trackHeightAt(tracks, [turnout()], tracks[0], 20, opts)).toBeCloseTo(105.2 + 0.01375 * 20, 6)
  })

  it('needs only the branch, its main route and the turnout (heightContext)', () => {
    const other = { ...mainTrack(0), id: 'other' }
    const tracks = [mainTrack(50), other, branchTrack()]
    const ctx = heightContext(tracks, [turnout()], tracks[2], opts)
    expect(ctx.tracks.map(t => t.id)).toEqual([tracks[2].id, tracks[0].id])
    expect(ctx.switches).toEqual([turnout()])
    for (const d of [5, 20, 39, 50]) {
      expect(trackHeightAt(ctx.tracks, ctx.switches, tracks[2], d, opts)).toBe(trackHeightAt(tracks, [turnout()], tracks[2], d, opts))
    }
    expect(heightContext(tracks, [turnout()], tracks[0], opts)).toEqual({ tracks: [tracks[0]], switches: [] })
  })
})

describe('coupling a project', () => {
  const project = (cant = 50) => ({ tracks: [mainTrack(cant), branchTrack()], switches: [turnout()] })

  it('writes the branch and leaves a coupled project as it is', () => {
    const once = coupleSwitchGradients(project(), opts)
    expect(once.tracks[1].heights).toHaveLength(3)
    // The main route leads and is left as it was.
    expect(once.tracks[0]).toEqual(project().tracks[0])
    expect(coupleSwitchGradients(once, opts)).toBe(once)
  })

  it('couples only the turnouts a write reached', () => {
    const before = coupleSwitchGradients(project(), opts)
    const edited = {
      ...before,
      tracks: [{ ...before.tracks[0], heights: [{ station: 0, z: 105.2 }, { station: 60, z: 107 }] }, before.tracks[1]],
    }
    expect([...touchedTurnouts(before, edited)]).toEqual(['s1'])
    expect([...touchedTurnouts(before, before)]).toEqual([])
    const after = coupleSwitchGradients(edited, { ...opts, only: touchedTurnouts(before, edited) })
    const lds = after.tracks[1].heights[1]
    expect(lds.z).toBeCloseTo(ldsZ(50, 105.2, 1.8 / 60), 3)
  })

  it('marks the points in the turnout\'s stretch, with their sleeper', () => {
    const p = coupleSwitchGradients(project(), opts)
    const marked = coupledPoints(p.tracks, p.switches, p.tracks[1], opts)
    expect([...marked.keys()]).toEqual([1])
    expect(marked.get(1)).toMatchObject({ side: 'branch', sleeper: { k: 'lds' } })
    expect(coupledPoints(p.tracks, p.switches, p.tracks[0], opts).size).toBe(0)
  })
})

describe('the turnout in the Höhenplan', () => {
  it('reaches from WA to ldS on both tracks', () => {
    const tracks = [mainTrack(), branchTrack()]
    expect(switchBodySpans(tracks, [turnout()], tracks[0], opts)).toEqual([{ from: 0, to: 40 }])
    const [b] = switchBodySpans(tracks, [turnout()], tracks[1], opts)
    expect(b.from).toBe(0)
    expect(b.to).toBeCloseTo(ALONG, 3)
  })

  it('reaches to WE where the form has no ldS', () => {
    const tracks = [mainTrack(), branchTrack()]
    expect(switchBodySpans(tracks, [turnout({ label: 'X' })], tracks[0], opts)).toEqual([{ from: 0, to: 30 }])
  })

  it('warns of a gradient change between WA and ldS, not beyond', () => {
    const at = (station) => ({
      ...mainTrack(0, [{ station: 0, z: 105 }, { station, z: 105.5 }, { station: 60, z: 105.6 }]),
    })
    const check = (station) => {
      const main = at(station)
      return checkVertical(main, { tracks: [main, branchTrack()], switches: [turnout()], formOf })
        .curves[0].results.find(r => r.id === 'HP.AR.06')?.severity ?? null
    }
    expect(check(30)).toBe('warning')
    expect(check(50)).toBeNull()
  })
})

describe('points in pairs on the sleepers, either track leading', () => {
  const sw = turnout()
  const base = (cant = 50) => coupleSwitchGradients({ tracks: [mainTrack(cant), branchTrack()], switches: [sw] }, opts)
  const sleepers = turnoutSleepers(base().tracks, sw, opts).sleepers
  const nearest = (key, d) => sleepers.reduce((a, b) => (Math.abs(b[key] - d) < Math.abs(a[key] - d) ? b : a))
  const withHeights = (p, i, heights) => ({ ...p, tracks: p.tracks.map((t, j) => (j === i ? { ...t, heights } : t)) })
  const couple = (before, after) => coupleSwitchHeights(before, after, opts)
  const at = (h, station) => h.find(q => Math.abs(q.station - station) < 0.002)
  // The branch above the main route on a sleeper, the main route's gradient g there.
  const lift = (sl, g, cant = 50) => g * sl.a + (cant / 1500) * sl.y

  it('puts a point set on the main route onto its nearest sleeper, and its partner on the branch', () => {
    const before = base()
    const sl = nearest('m', 20.1)
    const after = couple(before, withHeights(before, 0,
      [{ station: 0, z: 105.2 }, { station: 20.1, z: 105.6, rv: 5000, reason: 'Bestand' }, { station: 60, z: 106.025 }]))
    const [main, branch] = after.tracks.map(t => t.heights)
    expect(main[1]).toEqual({ station: Number(sl.main.toFixed(3)), z: 105.6, rv: 5000, reason: 'Bestand' })
    // At the kink the gradient is the mean of the two either side.
    const g = (0.4 / sl.main + 0.425 / (60 - sl.main)) / 2
    expect(at(branch, sl.branch)).toEqual({
      station: Number(sl.branch.toFixed(3)), z: expect.closeTo(105.6 + lift(sl, g), 3), rv: 5000, reason: 'Bestand',
    })
    // The branch keeps its ldS point.
    expect(branch).toHaveLength(4)
  })

  it('moves the main route when a branch point is changed, and creates and takes away its partner', () => {
    const p1 = couple(base(), withHeights(base(), 0, [{ station: 0, z: 105.2 }, { station: 20, z: 105.6 }, { station: 60, z: 106.025 }]))
    const sl = nearest('m', 20)
    const pair = at(p1.tracks[1].heights, sl.branch)
    // Raised by 10 mm on the branch: the main route follows by as much.
    const p2 = couple(p1, withHeights(p1, 1, p1.tracks[1].heights.map(q => (q === pair ? { ...q, z: q.z + 0.01 } : q))))
    expect(at(p2.tracks[0].heights, sl.main).z).toBeCloseTo(105.61, 3)
    // A point set on the branch snaps to its sleeper and gets a partner on the main route.
    const s2 = nearest('b', 30.12)
    const p3 = couple(p2, withHeights(p2, 1, [...p2.tracks[1].heights, { station: 30.12, z: 105.7 }].sort((a, b) => a.station - b.station)))
    expect(at(p3.tracks[1].heights, s2.branch).z).toBe(105.7)
    expect(at(p3.tracks[0].heights, s2.main)).toBeTruthy()
    const mainCount = p2.tracks[0].heights.length
    expect(p3.tracks[0].heights).toHaveLength(mainCount + 1)
    // Taken away on the branch, it goes on the main route as well.
    const p4 = couple(p3, withHeights(p3, 1, p3.tracks[1].heights.filter(q => !at([q], s2.branch))))
    expect(at(p4.tracks[0].heights, s2.main)).toBeUndefined()
    expect(p4.tracks[0].heights).toHaveLength(mainCount)
  })

  it('gives the main route a point on the ldS where the branch\'s ldS height asks for one', () => {
    const p0 = base()
    const lds = p0.tracks[1].heights[1]
    const p1 = couple(p0, withHeights(p0, 1, p0.tracks[1].heights.map(q => (q === lds ? { ...q, z: q.z + 0.05 } : q))))
    const main = p1.tracks[0].heights
    expect(main).toHaveLength(3)
    expect(main[1].station).toBeCloseTo(40, 3)
    expect(main[1].z).toBeCloseTo(105.2 + G * 40 + 0.05, 3)
    // Its ldS height given back, the main route keeps the point — at the plane's height.
    const p2 = couple(p1, withHeights(p1, 1, p1.tracks[1].heights.map(q => (Math.abs(q.station - lds.station) < 1e-9 ? lds : q))))
    expect(p2.tracks[0].heights[1].z).toBeCloseTo(105.2 + G * 40, 3)
  })

  it('leaves the main route as it is for an edit on the branch beyond the ldS', () => {
    const p0 = base()
    const p1 = couple(p0, withHeights(p0, 1, p0.tracks[1].heights.map((q, i) => (i === 2 ? { ...q, z: 105.9 } : q))))
    expect(p1.tracks[0]).toBe(p0.tracks[0])
  })

  it('counts the turnouts that are not paired yet', () => {
    const raw = { tracks: [mainTrack(50), branchTrack()], switches: [sw] }
    expect(unpairedTurnouts(raw.tracks, raw.switches, opts)).toHaveLength(1)
    const p = base()
    expect(unpairedTurnouts(p.tracks, p.switches, opts)).toHaveLength(0)
  })
})

describe('two turnouts reaching into one track from its two ends', () => {
  // A second turnout faces the first from the other end of the main track:
  // WA at its END, its own main route the main track's second element, its
  // branch leaving to the south-west on R 500. Both reach 40 m into the 60 m
  // track; the 20 m they share are split in the middle.
  const ws = { easting: 1060, northing: 1000, zone: 5684 }
  const node = (p) => [p.easting, p.northing]
  const be = endPointCurvedUtm(ws, 270, 30, -R)
  const bend = (L) => 270 - (L / R) * 180 / Math.PI
  const second = {
    id: 'c', epsg: 5684, trackType: 1,
    elements: [
      { elementType: 1, startNode: node(ws), endNode: node(be), bearing: 270, endBearing: bend(30),
        radius: -R, length: 30, speed: 80, switchId: 's2', switchRoute: 'branch' },
      { elementType: 1, startNode: node(be), endNode: node(endPointCurvedUtm(be, bend(30), 30, -R)), bearing: bend(30),
        endBearing: bend(60), radius: -R, length: 30, speed: 80 },
    ],
    heights: [{ station: 0, z: 106.025 }, { station: 60, z: 106.2 }],
  }
  const main = (() => {
    const m = mainTrack(0)
    return { ...m, elements: m.elements.map((el, i) => (i === 1 ? { ...el, switchId: 's2', switchRoute: 'main' } : el)) }
  })()
  const sw2 = turnout({ switchId: 's2', portB1_trackId: 'c', portB1_endpoint: 'BEGIN', portB2_trackId: 'm', portB2_endpoint: 'END' })
  const project = { tracks: [main, branchTrack(), second], switches: [turnout(), sw2] }

  it('lays each turnout\'s own sleepers up to the middle and couples every sleeper there to all three tracks', () => {
    const p = coupleSwitchGradients(project, opts)
    const t = (q, id) => q.tracks.find(x => x.id === id)
    // Neither reaches its ldS on its own: no ldS point on either branch.
    expect(t(p, 'b').heights).toHaveLength(2)
    const edited = { ...p, tracks: p.tracks.map(x => (x.id === 'm'
      ? { ...x, heights: [{ station: 0, z: 105.2 }, { station: 25, z: 105.5 }, { station: 35, z: 105.7 }, { station: 60, z: 106.025 }] } : x)) }
    const after = coupleSwitchHeights(p, edited, opts)
    // 25 m lies on the first turnout's grid, 35 m on the second's — and both
    // have a partner on both branches.
    const g1 = turnoutSleepers(after.tracks, turnout(), opts).sleepers
    const g2 = turnoutSleepers(after.tracks, sw2, opts).sleepers
    const main = t(after, 'm').heights
    expect(g1.some(sl => Math.abs(sl.main - main[1].station) < 0.001)).toBe(true)
    expect(g2.some(sl => Math.abs(sl.main - main[2].station) < 0.001)).toBe(true)
    expect(t(after, 'b').heights).toHaveLength(4)
    expect(t(after, 'c').heights).toHaveLength(4)
    // Without cant the three lie at one height on a sleeper, to the gradient over its lean.
    for (const id of ['b', 'c']) {
      const inner = t(after, id).heights.slice(1, 3).map(q => q.z).sort()
      expect(Math.abs(inner[0] - 105.5)).toBeLessThan(0.003)
      expect(Math.abs(inner[1] - 105.7)).toBeLessThan(0.003)
    }
    const marks = [...coupledPoints(after.tracks, after.switches, after.tracks[0], opts).values()]
    expect(marks.map(v => [v.sw.switchId, v.also.map(x => x.switchId)])).toEqual([['s1', ['s2']], ['s2', ['s1']]])
    // Raised on one branch, the shared sleeper takes the main track and the other branch along.
    const b = t(after, 'b').heights
    const i = b.findIndex(q => Math.abs(q.z - 105.7) < 0.003)
    const raised = { ...after, tracks: after.tracks.map(x => (x.id === 'b' ? { ...x, heights: b.map((q, k) => (k === i ? { ...q, z: q.z + 0.01 } : q)) } : x)) }
    const moved = coupleSwitchHeights(after, raised, opts)
    expect(t(moved, 'm').heights[2].z).toBeCloseTo(105.71, 3)
    const c = t(moved, 'c').heights
    expect(c.some(q => Math.abs(q.z - 105.71) < 0.003)).toBe(true)
  })
})

describe('where a turnout no longer lies in its plane', () => {
  const sw = turnout()
  const paired = () => coupleSwitchGradients({ tracks: [mainTrack(50), branchTrack()], switches: [sw] }, opts)

  it('says on which sleeper and by how much, when the cant changed and nothing coupled again', () => {
    const p = paired()
    const recant = { ...p, tracks: [{ ...p.tracks[0], elements: p.tracks[0].elements.map(el => ({ ...el, cant: 100 })) }, p.tracks[1]] }
    const off = planeDeviations(couplingOf(recant.tracks, recant.switches, recant.switches[0], opts))
    expect(off).toHaveLength(1)
    expect(off[0].sleeper.k).toBe('lds')
    // 50 mm more cant lifts the branch by 50/1500 of its offset there.
    expect(off[0].dz).toBeCloseTo(-0.05 * OFFSET / 1.5, 3)
    expect(planeDeviations(couplingOf(p.tracks, p.switches, p.switches[0], opts))).toEqual([])
  })
})

describe('a gradient change in a turnout, with its reason', () => {
  // A crest at 20 m, between WA and ldS of the main route; 80 km/h there,
  // so the Regelwert of Tabelle 12 is 0.4 · 80² = 2560 m.
  const main = (point) => mainTrack(0, [{ station: 0, z: 105 }, { station: 20, z: 105.3, ...point }, { station: 60, z: 105.4 }])
  const results = (point) => {
    const m = main(point)
    const curve = checkVertical(m, { tracks: [m, branchTrack()], switches: [turnout()], formOf }).curves[0]
    return Object.fromEntries(curve.results.map(r => [r.id, r.severity]))
  }

  it('warns without a reason and holds with one (HP.AR.06)', () => {
    expect(results({ rv: 3000 })['HP.AR.06']).toBe('warning')
    expect(results({ rv: 3000, reason: 'Bestand, Zwangspunkt Brücke' })['HP.AR.06']).toBe('ok')
    // Blank is no reason.
    expect(results({ rv: 3000, reason: '  ' })['HP.AR.06']).toBe('warning')
  })

  it('is an error below the Regelwert, whatever the reason (HP.AR.07)', () => {
    expect(results({ rv: 2000, reason: 'Bestand' })['HP.AR.07']).toBe('error')
    expect(results({ rv: 2560 })['HP.AR.07']).toBe('ok')
    // Beyond the ldS the rule is silent.
    const far = mainTrack(0, [{ station: 0, z: 105 }, { station: 50, z: 105.3, rv: 2000 }, { station: 60, z: 105.32 }])
    const curve = checkVertical(far, { tracks: [far, branchTrack()], switches: [turnout()], formOf }).curves[0]
    expect(curve.results.map(r => r.id)).not.toContain('HP.AR.07')
  })
})
