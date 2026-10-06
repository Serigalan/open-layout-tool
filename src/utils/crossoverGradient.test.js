import { describe, it, expect } from 'vitest'
import {
  findCrossovers, crossoverFrame, lineChain, planCrossoverGradient, shareCorrection,
} from './crossoverGradient'
import { checkVertical } from './gradientCheck'
import { gradientAt } from './heightUtils'

// Two tracks on one right-hand curve about C = (0, −1000): track 1 on R 1000,
// track 2 four metres outside it on R 1004 — to the left, the raised side of
// a positive cant. A crossover from track 1 to track 2: turnout 1 (500 – 1:12,
// body 30 m, ldS 36.334 m on) with its toe at track 1's arc length 0 and its
// main route running on, turnout 2 with its toe 130 m on along track 2 and
// its main route running back toward turnout 1.
const C = [0, -1000]
const pointOn = (r, s) => [C[0] + r * Math.sin(s / r), C[1] + r * Math.cos(s / r)]
const bearing = (r, s) => 90 + (s / r) * 180 / Math.PI

/** Arc elements on radius r from arc length s0, `pieces` [[length, extra]]. */
function arcs(r, s0, pieces, cant) {
  let s = s0
  return pieces.map(([length, extra = {}]) => {
    const el = {
      elementType: 1, radius: r, length, cant, speed: 100,
      startNode: pointOn(r, s), endNode: pointOn(r, s + length),
      bearing: bearing(r, s), endBearing: bearing(r, s + length), ...extra,
    }
    s += length
    return el
  })
}

/** The connecting track, drawn as one straight from toe to toe. */
function connection(a, b) {
  const length = Math.hypot(b[0] - a[0], b[1] - a[1])
  const brg = (Math.atan2(b[0] - a[0], b[1] - a[1]) * 180 / Math.PI + 360) % 360
  return { elementType: 0, startNode: a, endNode: b, bearing: brg, length, speed: 100 }
}

const level = (length, z) => [{ station: 0, z }, { station: length, z }]

function layout({ z1 = 100, z2 = 100, cant = 60 } = {}) {
  const m1 = { switchId: 'w1', switchRoute: 'main' }
  const m2 = { switchId: 'w2', switchRoute: 'main' }
  const s2 = 130 * 1004 / 1000   // turnout 2's toe on track 2, across from 130 m on track 1
  const tracks = [
    { id: 't1a', name: 'T1 a', epsg: 5684, trackType: 1, elements: arcs(1000, -300, [[300]], cant), heights: level(300, z1) },
    { id: 't1b', name: 'T1 b', epsg: 5684, trackType: 1, elements: arcs(1000, 0, [[30, m1], [470]], cant), heights: level(500, z1) },
    { id: 't2a', name: 'T2 a', epsg: 5684, trackType: 1,
      elements: arcs(1004, -300, [[300 + s2 - 30], [30, m2]], cant), heights: level(300 + s2, z2) },
    { id: 't2b', name: 'T2 b', epsg: 5684, trackType: 1, elements: arcs(1004, s2, [[400]], cant), heights: level(400, z2) },
    { id: 'c', name: 'conn', epsg: 5684, trackType: 1, elements: [connection(pointOn(1000, 0), pointOn(1004, s2))] },
  ]
  const switches = [
    { switchId: 'w1', kind: 'turnout', label: '500 – 1:12',
      portA_trackId: 't1a', portA_endpoint: 'END', portB2_trackId: 't1b', portB2_endpoint: 'BEGIN',
      portB1_trackId: 'c', portB1_endpoint: 'BEGIN' },
    { switchId: 'w2', kind: 'turnout', label: '500 – 1:12',
      portA_trackId: 't2b', portA_endpoint: 'BEGIN', portB2_trackId: 't2a', portB2_endpoint: 'END',
      portB1_trackId: 'c', portB1_endpoint: 'END' },
  ]
  return { tracks, switches }
}

const LIMITS = { raise: 0.1, lower: 0.1, before: 150, after: 150 }

/** The project with a plan's writes applied. */
function applied({ tracks, switches }, plan) {
  return {
    switches,
    tracks: tracks.map(t => ({
      ...t,
      ...(plan.heights.has(t.id) ? { heights: plan.heights.get(t.id) } : {}),
      ...(plan.elements.has(t.id) ? { elements: plan.elements.get(t.id) } : {}),
    })),
  }
}

const zOf = (p, id, station) => gradientAt(p.tracks.find(t => t.id === id).heights, station)

describe('finding a crossover and its frame', () => {
  it('knows a crossover by the track both branches lie on', () => {
    const { tracks, switches } = layout()
    const [x] = findCrossovers(tracks, switches)
    expect([x.w1.switchId, x.w2.switchId, x.conn.id]).toEqual(['w1', 'w2', 'c'])
  })

  it('follows a line through the turnout\'s main route, not into its branch', () => {
    const { tracks, switches } = layout()
    const line = lineChain(tracks, switches, tracks[1])
    expect(line.map(s => s.track.id)).toEqual(['t1a', 't1b'])
    expect(line[0].from).toBeCloseTo(-300, 6)
  })

  it('measures the second track four metres to the left and reads the cant', () => {
    const { tracks, switches } = layout()
    const f = crossoverFrame(tracks, switches, findCrossovers(tracks, switches)[0])
    expect(f.y).toBeCloseTo(4, 2)
    expect(f.cant).toBe(60)
    // From turnout 1's toe to turnout 2's, laid across.
    expect(f.zone1[0]).toBeCloseTo(0, 1)
    expect(f.zone1[1]).toBeCloseTo(130, 0)
  })
})

describe('sharing the correction', () => {
  it('splits it half and half, and gives the rest to the other where one is at its limit', () => {
    expect(shareCorrection(0.16, LIMITS, LIMITS)).toEqual({ d1: -0.08, d2: 0.08 })
    const s = shareCorrection(0.16, { raise: 0, lower: 0.2 }, { raise: 0.05, lower: 0 })
    expect(s.d2).toBeCloseTo(0.05, 9)
    expect(s.d1).toBeCloseTo(-0.11, 9)
    expect(shareCorrection(0.16, { raise: 0, lower: 0.05 }, { raise: 0.05, lower: 0 })).toBeNull()
  })
})

describe('heights from the cant', () => {
  it('puts the outer track u/1500 · y above the inner one across the crossover', () => {
    const p = layout()
    const [x] = findCrossovers(p.tracks, p.switches)
    const plan = planCrossoverGradient(p.tracks, p.switches, x, { mode: 'heights', cant: 60, limits: [LIMITS, LIMITS] })
    expect(plan.ok).toBe(true)
    expect(plan.shares[0].d2).toBeCloseTo(0.08, 3)
    const after = applied(p, plan)
    // At turnout 1's toe and at turnout 2's, the difference is 60/1500 · 4 m.
    expect(zOf(after, 't2a', 300 + 0 * 1.004) - zOf(after, 't1b', 0)).toBeCloseTo(0.16, 2)
    expect(zOf(after, 't2a', 300 + 130 * 1.004) - zOf(after, 't1b', 130)).toBeCloseTo(0.16, 2)
    // Outside the marked stretch nothing moved.
    expect(zOf(after, 't1b', 400)).toBe(100)
    expect(zOf(after, 't1a', 100)).toBe(100)
  })

  it('makes the gradient changes rounded where they must be, and keeps them out of the turnouts', () => {
    const p = layout()
    const [x] = findCrossovers(p.tracks, p.switches)
    const short = { ...LIMITS, before: 40, after: 40 }
    const plan = planCrossoverGradient(p.tracks, p.switches, x, { mode: 'heights', cant: 60, limits: [short, short] })
    expect(plan.ok).toBe(true)
    const after = applied(p, plan)
    for (const id of ['t1a', 't1b', 't2a', 't2b']) {
      const track = after.tracks.find(t => t.id === id)
      const check = checkVertical(track, { tracks: after.tracks, switches: after.switches })
      const bad = check.curves.flatMap(c => c.results).filter(r => ['HP.AR.01', 'HP.AR.06'].includes(r.id) && r.severity !== 'ok')
      expect(bad, id).toEqual([])
    }
  })

  it('refuses where the limits do not reach, and moves nothing', () => {
    const p = layout()
    const [x] = findCrossovers(p.tracks, p.switches)
    const tight = { ...LIMITS, raise: 0.03, lower: 0.03 }
    const plan = planCrossoverGradient(p.tracks, p.switches, x, { mode: 'heights', cant: 60, limits: [tight, tight] })
    expect(plan).toEqual(expect.objectContaining({ ok: false, reason: 'limits' }))
  })

  it('sets a wanted cant other than the one there on the curve of both tracks', () => {
    const p = layout()
    const [x] = findCrossovers(p.tracks, p.switches)
    const plan = planCrossoverGradient(p.tracks, p.switches, x, { mode: 'heights', cant: 45, limits: [LIMITS, LIMITS] })
    expect(plan.ok).toBe(true)
    for (const id of ['t1a', 't1b', 't2a', 't2b']) {
      expect(plan.elements.get(id).every(el => el.cant === 45), id).toBe(true)
    }
  })

  it('gives the connecting track its gradient from the two toes', () => {
    const p = layout()
    const [x] = findCrossovers(p.tracks, p.switches)
    const plan = planCrossoverGradient(p.tracks, p.switches, x, { mode: 'heights', cant: 60, limits: [LIMITS, LIMITS] })
    const conn = plan.heights.get('c')
    expect(conn[0].z).toBeCloseTo(zOf(applied(p, plan), 't1b', 0), 3)
    expect(conn[conn.length - 1].z).toBeCloseTo(zOf(applied(p, plan), 't2a', 300 + 130 * 1.004), 3)
  })
})

describe('cant from the heights', () => {
  it('reads u off the heights, on the 5 mm grid, and leaves heights that fit alone', () => {
    // 0.12 m over 4 m: u = 45 mm.
    const p = layout({ z2: 100.12 })
    const [x] = findCrossovers(p.tracks, p.switches)
    const plan = planCrossoverGradient(p.tracks, p.switches, x, { mode: 'cant', limits: [LIMITS, LIMITS] })
    expect(plan.ok).toBe(true)
    expect(plan.u).toBe(45)
    expect(plan.uExact).toBeCloseTo(45, 0)
    expect([...plan.heights.keys()].filter(id => id !== 'c')).toEqual([])
    expect(plan.elements.get('t1b').every(el => el.cant === 45)).toBe(true)
  })

  it('makes up what the rounding leaves with the heights', () => {
    // 0.13 m over 4 m: 48.75 mm, rounded to 50 — 0.0033 m to find.
    const p = layout({ z2: 100.13 })
    const [x] = findCrossovers(p.tracks, p.switches)
    const plan = planCrossoverGradient(p.tracks, p.switches, x, { mode: 'cant', limits: [LIMITS, LIMITS] })
    expect(plan.u).toBe(50)
    const after = applied(p, plan)
    // To the millimetre the heights are stated in.
    const diff = zOf(after, 't2a', 300 + 60 * 1.004) - zOf(after, 't1b', 60)
    expect(Math.abs(diff - 50 / 1500 * 4)).toBeLessThan(0.0015)
  })

  it('will not cant the curve the wrong way', () => {
    const p = layout({ z2: 99.9 })
    const [x] = findCrossovers(p.tracks, p.switches)
    expect(planCrossoverGradient(p.tracks, p.switches, x, { mode: 'cant', limits: [LIMITS, LIMITS] }).reason)
      .toBe('cant_wrong_side')
  })
})
