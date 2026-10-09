import { describe, it, expect } from 'vitest'
import { FIRST_SLEEPER, SLEEPER_SPACING, sleeperNear, sleeperOffsets, sleeperThrough, turnoutSleepers } from './switchSleepers'
import { reverseTrack } from './trackModel'
import { branchTrack, formOf, mainTrack, sleeperAtX as exact, turnout, xAtArc, xAtMain } from '../test/turnoutFixture'

describe('the sleepers of a turnout', () => {
  const frame = turnoutSleepers([mainTrack(), branchTrack()], turnout(), { formOf })

  it('lie 0.3 m behind WA and then every 0.6 m along the bisector', () => {
    const grid = frame.sleepers.filter(sl => sl.k !== 'lds')
    grid.forEach((sl, i) => {
      expect(sl.k).toBe(i)
      expect(sl.s).toBeCloseTo(FIRST_SLEEPER + SLEEPER_SPACING * i, 9)
    })
    for (const sl of [grid[0], grid[25], grid[grid.length - 1]]) {
      const e = exact(xAtArc(sl.s))
      expect(sl.main).toBeCloseTo(e.main, 3)
      expect(sl.branch).toBeCloseTo(e.branch, 3)
    }
  })

  it('end with the ldS: the sleeper through the main route 10 m behind WE, square to the bisector', () => {
    const lds = frame.sleepers[frame.sleepers.length - 1]
    expect(lds.k).toBe('lds')
    expect(lds.main).toBeCloseTo(40, 6)
    const e = exact(xAtMain(40))
    expect(lds.branch).toBeCloseTo(e.branch, 3)
    expect(frame.ldsBranch).toBeCloseTo(e.branch, 3)
    // The grid stops before it.
    expect(frame.sleepers[frame.sleepers.length - 2].s).toBeLessThan(lds.s)
  })

  it('run square to the main route at WA and turn with the bisector', () => {
    const first = frame.sleepers[0]
    expect(first.branch - first.main).toBeCloseTo(0, 4)
    // Further on it leans with the bisector: the branch point lies behind the main one.
    const lds = frame.sleepers[frame.sleepers.length - 1]
    const off = sleeperOffsets(frame, lds)
    const e = exact(xAtMain(40))
    expect(off.a).toBeCloseTo(e.q[0] - 40, 3)
    expect(off.y).toBeCloseTo(e.q[1], 3)
    expect(off.a).toBeLessThan(-0.03)
  })

  it('give the nearest sleeper to a station of either track, only between WA and ldS', () => {
    expect(sleeperNear(frame, 'main', 10.1).k).toBe(frame.sleepers.find(sl => Math.abs(sl.main - 10.1) < 0.3).k)
    expect(sleeperNear(frame, 'main', 0)).toBeNull()
    expect(sleeperNear(frame, 'main', 45)).toBeNull()
    expect(sleeperNear(frame, 'main', 39.99).k).toBe('lds')
    const sl = frame.sleepers[20]
    expect(sleeperNear(frame, 'branch', sl.branch + 0.2)).toBe(sl)
  })

  it('lay a sleeper through any point between them', () => {
    const sl = frame.sleepers[30]
    const through = sleeperThrough(frame, 'branch', sl.branch)
    expect(through.main).toBeCloseTo(sl.main, 4)
    expect(sleeperThrough(frame, 'branch', 50)).toBeNull()
  })

  it('are the same on a branch whose stations run toward the toe', () => {
    const turned = turnoutSleepers([mainTrack(), reverseTrack(branchTrack())], turnout({ portB1_endpoint: 'END' }), { formOf })
    const a = frame.sleepers[40], b = turned.sleepers[40]
    expect(b.main).toBeCloseTo(a.main, 6)
    expect(b.branch).toBeCloseTo(60 - a.branch, 4)
  })

  it('are worked out once for the same tracks', () => {
    const tracks = [mainTrack(), branchTrack()]
    const sw = turnout()
    expect(turnoutSleepers(tracks, sw, { formOf })).toBe(turnoutSleepers(tracks, sw, { formOf }))
  })

  it('are none for a form without ldS or another kind of switch', () => {
    expect(turnoutSleepers([mainTrack(), branchTrack()], turnout({ label: 'X' }), { formOf })).toBeNull()
    expect(turnoutSleepers([mainTrack(), branchTrack()], turnout({ kind: 'crossing' }), { formOf })).toBeNull()
  })
})
