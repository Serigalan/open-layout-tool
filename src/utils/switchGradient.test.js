import { describe, it, expect } from 'vitest'
import {
  switchCoupling, coupledBranchHeights, coupleSwitchGradients, branchPlaneHeight, trackHeightAt,
  touchedTurnouts, coupledPoints, switchBodySpans, switchLds,
} from './switchGradient'
import { endPointCurvedUtm, endPointStraightUtm } from './elementUtils'
import { reverseTrack } from './trackModel'
import { checkVertical } from './gradientCheck'

// A turnout at (1000, 1000): the main route runs straight east, the branch
// leaves it on R 500 to the left (north). Its body is 30 m long (WA to WE) on
// either track, and the form puts its ldS 10 m behind WE — 40 m from WA.
const R = 500
const START = { easting: 1000, northing: 1000, zone: 5684 }
const node = (p) => [p.easting, p.northing]

const WE = endPointStraightUtm(START, 90, 30)
const mainTrack = (cant = 0, heights = [{ station: 0, z: 105.2 }, { station: 60, z: 106.025 }]) => ({
  id: 'm', epsg: 5684, trackType: 1,
  elements: [
    { elementType: 0, startNode: node(START), endNode: node(WE),
      bearing: 90, length: 30, speed: 80, cant, switchId: 's1', switchRoute: 'main' },
    { elementType: 0, startNode: node(WE), endNode: node(endPointStraightUtm(WE, 90, 30)),
      bearing: 90, length: 30, speed: 80, cant },
  ],
  ...(heights ? { heights } : {}),
})

const branchEnd = endPointCurvedUtm(START, 90, 30, -R)
const turned = (L) => 90 - (L / R) * 180 / Math.PI
const branchTrack = (heights = [{ station: 0, z: 105.2 }, { station: 60, z: 105.5 }]) => ({
  id: 'b', epsg: 5684, trackType: 1,
  elements: [
    { elementType: 1, startNode: node(START), endNode: node(branchEnd), bearing: 90, endBearing: turned(30),
      radius: -R, length: 30, speed: 80, switchId: 's1', switchRoute: 'branch' },
    { elementType: 1, startNode: node(branchEnd), endNode: node(endPointCurvedUtm(branchEnd, turned(30), 30, -R)),
      bearing: turned(30), endBearing: turned(60), radius: -R, length: 30, speed: 80 },
  ],
  ...(heights ? { heights } : {}),
})

const turnout = (over = {}) => ({
  switchId: 's1', kind: 'turnout', label: 'TEST',
  portA_trackId: 'a', portA_endpoint: 'END',
  portB1_trackId: 'b', portB1_endpoint: 'BEGIN',
  portB2_trackId: 'm', portB2_endpoint: 'BEGIN',
  ...over,
})

const formOf = (label) => (label === 'TEST' ? { lds: 10 } : null)
const opts = { formOf }

// The branch lies 500 − √(500² − 40²) to the left at the ldS, 40.04 m along it.
const OFFSET = R - Math.sqrt(R * R - 40 * 40)
const ALONG = R * Math.asin(40 / R)

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
    const c = switchCoupling([mainTrack(), branchTrack()], turnout(), opts)
    expect(c.ldsMain).toBeCloseTo(40, 6)
    expect(c.ldsBranch).toBeCloseTo(ALONG, 3)
    expect(c.offset).toBeCloseTo(OFFSET, 4)
  })

  it('gives the branch the main route\'s height at the ldS without cant', () => {
    const c = switchCoupling([mainTrack(0), branchTrack()], turnout(), opts)
    const h = coupledBranchHeights(c)
    expect(h.map(p => p.station)).toEqual([0, Number(ALONG.toFixed(3)), 60])
    expect(h[1].z).toBeCloseTo(105.75, 3)
  })

  it('lifts it by u/1500 · offset when it leaves to the raised side, lowers it to the other', () => {
    // A positive cant raises the left rail — the branch's side.
    const up = coupledBranchHeights(switchCoupling([mainTrack(50), branchTrack()], turnout(), opts))
    expect(up[1].z).toBeCloseTo(105.75 + 0.05 * OFFSET / 1.5, 3)
    const down = coupledBranchHeights(switchCoupling([mainTrack(-50), branchTrack()], turnout(), opts))
    expect(down[1].z).toBeCloseTo(105.75 - 0.05 * OFFSET / 1.5, 3)
  })

  it('reproduces the worked example: 105.75 + 0.05 · 2720 / 1500', () => {
    // The ldS where the branch lies 2.72 m off: 500 − √(500² − x²) = 2.72.
    const x = Math.sqrt(R * R - (R - 2.72) ** 2)
    const main = mainTrack(50, [{ station: 0, z: 105.2 }, { station: x, z: 105.75 }, { station: 60, z: 106 }])
    const c = switchCoupling([main, branchTrack()], turnout(), { formOf: () => ({ lds: x - 30 }) })
    expect(c.offset).toBeCloseTo(2.72, 4)
    expect(coupledBranchHeights(c).find(p => p.station > 0 && p.station < 60).z).toBeCloseTo(105.841, 3)
  })

  it('works the same on a branch whose stations run toward the toe', () => {
    const reversed = reverseTrack(branchTrack())
    const sw = turnout({ portB1_endpoint: 'END' })
    const c = switchCoupling([mainTrack(50), reversed], sw, opts)
    expect(c.offset).toBeCloseTo(OFFSET, 4)
    expect(c.ldsBranch).toBeCloseTo(60 - ALONG, 3)
    const h = coupledBranchHeights(c)
    expect(h.find(p => Math.abs(p.station - (60 - ALONG)) < 0.01).z).toBeCloseTo(105.75 + 0.05 * OFFSET / 1.5, 3)
  })

  it('also sets any branch point between WA and ldS to the plane, and leaves the rest', () => {
    const branch = branchTrack([{ station: 0, z: 105.2 }, { station: 20, z: 999 }, { station: 60, z: 105.5 }])
    const h = coupledBranchHeights(switchCoupling([mainTrack(0), branch], turnout(), opts))
    expect(h[1]).toEqual({ station: 20, z: expect.closeTo(105.2 + 0.01375 * 20, 2) })
    expect(h[h.length - 1]).toEqual({ station: 60, z: 105.5 })
  })

  it('makes up no gradient: none without heights on either side', () => {
    expect(coupledBranchHeights(switchCoupling([mainTrack(0, null), branchTrack()], turnout(), opts))).toBeNull()
    expect(coupledBranchHeights(switchCoupling([mainTrack(), branchTrack(null)], turnout(), opts))).toBeNull()
    // A main gradient that stops before the ldS has no height to give there.
    const short = mainTrack(0, [{ station: 0, z: 105.2 }, { station: 35, z: 105.6 }])
    expect(coupledBranchHeights(switchCoupling([short, branchTrack()], turnout(), opts))).toBeNull()
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
    expect(lds.z).toBeCloseTo(105.2 + 1.8 * 40 / 60 + 0.05 * OFFSET / 1.5, 3)
  })

  it('locks the coupled points of the branch, and only those', () => {
    const p = coupleSwitchGradients(project(), opts)
    expect([...coupledPoints(p.tracks, p.switches, p.tracks[1], opts).keys()]).toEqual([1])
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
