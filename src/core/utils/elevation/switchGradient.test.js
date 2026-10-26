import { describe, it, expect } from 'vitest'
import {
  switchCoupling, couplingOf, branchPlaneHeight, trackHeightAt, switchBodySpans, switchLds, heightContext,
} from './switchGradient'
import { withSwitchHeights } from './switchChain'
import { reverseTrack } from '../track/trackModel'
import { checkVertical } from './gradientCheck'
import { LDS, R, branchTrack as branchOf, formOf, mainTrack as mainOf, sleeperAtX, turnout, xAtMain } from '../../test/turnoutFixture'

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

// The tracks as the store leaves them, coupled (decision 384), and the
// branch's height on its ldS there.
const coupled = (tracks, sw = turnout(), o = opts) => withSwitchHeights({ tracks: [] }, { tracks, switches: [sw] }, { opts: o })
const atLds = (p, o = opts) => {
  const c = couplingOf(p.tracks, p.switches, p.switches[0], o)
  return p.tracks.find(t => t.id === 'b').heights.find(q => Math.abs(q.station - c.ldsBranch) < 0.011)
}

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
    const c = couplingOf([mainTrack(), branchTrack()], [turnout()], turnout(), opts)
    expect(c.ldsMain).toBeCloseTo(40, 6)
    expect(c.ldsBranch).toBeCloseTo(ALONG, 3)
    expect(c.offset).toBeCloseTo(OFFSET, 4)
  })

  it('gives the branch the main route\'s height at the ldS without cant', () => {
    const p = coupled([mainTrack(0), branchTrack()])
    expect(p.tracks[1].heights.map(q => q.station)).toEqual([0, Number(ALONG.toFixed(3)), 60])
    expect(atLds(p).z).toBeCloseTo(ldsZ(0), 3)
  })

  it('lifts it by u/1500 · offset when it leaves to the raised side, lowers it to the other, whichever way the main track runs', () => {
    // A positive cant raises the left rail — the branch's side.
    for (const cant of [50, -50, 0]) {
      expect(atLds(coupled([mainTrack(cant), branchTrack()])).z).toBeCloseTo(ldsZ(cant), 3)
      // The same main route stored the other way round: its cant and its stations turn with it.
      const back = reverseTrack(mainTrack(cant))
      expect(atLds(coupled([back, branchTrack()], turnout({ ports: { B2: { endpoint: 'END' } } }))).z).toBeCloseTo(ldsZ(cant), 3)
    }
  })

  it('reproduces the worked example: 105.75 + 0.05 · 2720 / 1500', () => {
    // A main route of one gradient through 105.75 where the ldS sleeper meets
    // it 2.72 m off — the branch lies u/1500 · 2.72 above the main route
    // across from it, at the foot of the perpendicular from the branch point.
    const x = (() => { let lo = 30, hi = 59; for (let i = 0; i < 60; i++) { const m = (lo + hi) / 2; if (sleeperAtX(xAtMain(m)).q[1] < 2.72) lo = m; else hi = m } return (lo + hi) / 2 })()
    const foot = sleeperAtX(xAtMain(x)).q[0]
    const main = mainTrack(50, [{ station: 0, z: 105.75 - G * foot }, { station: 60, z: 105.75 + G * (60 - foot) }])
    const o = { formOf: () => ({ lds: x - 30 }) }
    const c = couplingOf([main, branchTrack()], [turnout()], turnout(), o)
    expect(c.offset).toBeCloseTo(2.72, 4)
    expect(atLds(coupled([main, branchTrack()], turnout(), o), o).z).toBeCloseTo(105.841, 3)
  })

  it('works the same on a branch whose stations run toward the toe', () => {
    const sw = turnout({ ports: { B1: { endpoint: 'END' } } })
    const p = coupled([mainTrack(50), reverseTrack(branchTrack())], sw)
    expect(couplingOf(p.tracks, p.switches, sw, opts).ldsBranch).toBeCloseTo(60 - ALONG, 3)
    expect(atLds(p).z).toBeCloseTo(ldsZ(50), 3)
  })

  it('keeps a branch point between WA and ldS: the line through the ldS starts there', () => {
    const p = coupled([mainTrack(0), branchTrack([{ station: 0, z: 105.2 }, { station: 20, z: 105.3 }, { station: 60, z: 105.5 }])])
    const b = p.tracks[1].heights
    expect(b[1]).toEqual({ station: 20, z: 105.3 })
    expect(atLds(p).z).toBeCloseTo(ldsZ(0), 3)
    // The ldS on the line from 20 m to the free point behind it.
    expect(atLds(p).z).toBeCloseTo(105.3 + (b[3].z - 105.3) * (ALONG - 20) / 40, 3)
  })

  it('makes up no gradient: none without heights on either side', () => {
    // The branch alone only gets its ldS point, on its own gradient.
    const alone = coupled([mainTrack(0, null), branchTrack()]).tracks[1].heights
    expect(alone.filter(q => q !== alone[1])).toEqual(branchTrack().heights)
    expect(alone[1].z).toBeCloseTo(105.2 + 0.3 * ALONG / 60, 4)
    expect(coupled([mainTrack(), branchTrack(null)]).tracks[1].heights).toBeUndefined()
    // A main gradient that stops before the ldS has no height to give there.
    const short = mainTrack(0, [{ station: 0, z: 105.2 }, { station: 35, z: 105.6 }])
    expect(atLds(coupled([short, branchTrack()])).z).toBeCloseTo(105.2 + 0.3 * ALONG / 60, 4)
  })

  it('couples a form without ldS up to WE (decision 383), and no other kind of switch', () => {
    expect(switchCoupling([mainTrack(), branchTrack()], turnout({ label: 'X' }), opts).ldsMain).toBeCloseTo(30, 6)
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
