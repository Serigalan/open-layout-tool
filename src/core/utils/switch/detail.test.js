import { describe, it, expect } from 'vitest'
import { ALL_SWITCH_TYPES, switchTypeByLabel, switchVariants } from './catalogue'
import { formDetail, switchDetail, RAIL_OFFSET, SLEEPER_OVERHANG } from './detail'
import { branchTrack, formOf, mainTrack, turnout } from '../../test/turnoutFixture'

const HALF = RAIL_OFFSET + SLEEPER_OVERHANG

describe('a turnout in detail', () => {
  it('lays the first sleeper 0.30 m behind WA, square to the main track, 1.30 m to either side', () => {
    const d = formDetail(switchTypeByLabel('300 – 1:9'), { rail: '54E4' })
    const first = d.sleepers.find(s => s.kind === 'grid' && s.k === 0)
    expect(first.ends[0][0]).toBeCloseTo(0.3, 2)
    expect(first.ends[0][1]).toBeCloseTo(-HALF, 3)
    expect(first.ends[1][1]).toBeCloseTo(HALF, 3)
  })

  it('reaches from the outer rail of the main track to the outer rail of the branch, 0.55 m beyond', () => {
    const d = formDetail(switchTypeByLabel('300 – 1:9'), { rail: '54E4' })
    const lds = d.sleepers.find(s => s.kind === 'lds')
    // At the ldS the branch lies well to the left: the sleeper spans both tracks.
    expect(lds.ends[0][1]).toBeCloseTo(-HALF, 2)
    expect(lds.ends[1][1]).toBeGreaterThan(d.marks.ldS.branch[1] + HALF - 0.01)
  })

  it('puts the rails 0.75 m beside both axes', () => {
    const d = formDetail(switchTypeByLabel('500 – 1:12'), { rail: '54E4' })
    const outer = d.rails.find(r => r.track === 'main' && r.side === 'outer')
    const inner = d.rails.find(r => r.track === 'main' && r.side === 'inner')
    for (const p of outer.points) expect(p[1]).toBeCloseTo(-RAIL_OFFSET, 6)
    for (const p of inner.points) expect(p[1]).toBeCloseTo(RAIL_OFFSET, 6)
    // Before WA the rails run on with the sleepers there.
    expect(outer.points[0][0]).toBeLessThan(-1.5)
  })

  it('has the table’s sleeper count from WA to the ldS, for every variant (decision 350)', () => {
    let checked = 0
    for (const form of ALL_SWITCH_TYPES) {
      for (const v of switchVariants(form)) {
        if (v.schwellenzahl == null) continue
        const rail = { '49E5': '49E5', '54E4': '54E4', '60E2A1': '60E2' }[v.profil]
        const d = formDetail(form, { rail })
        // Only where this row is the variant the profile picks.
        if (d.variant.nr !== v.nr) continue
        expect(d.counts.throughSleepers, `${v.nr} ${v.bezeichnung}`).toBe(v.schwellenzahl)
        checked++
      }
    }
    expect(checked).toBeGreaterThan(30)
  })

  it('reaches the count of the clothoid and compound-curve turnouts exactly', () => {
    expect(formDetail(switchTypeByLabel('6000/3700 – 1:32.5 fb')).counts.throughSleepers).toBe(232)
    expect(formDetail(switchTypeByLabel('7000/6000 – 1:42 fb')).counts.throughSleepers).toBe(290)
  })

  it('lays the sleepers WE–ldS off along both following axes, the ldS at the table’s distance', () => {
    const form = switchTypeByLabel('190 – 1:9')
    const d = formDetail(form, { rail: '54E4' })
    const l = switchVariants(form)[0].masse.l
    const lds = d.sleepers.find(s => s.kind === 'lds')
    expect(lds.m - l).toBeCloseTo(3.9, 2)
    const after = d.sleepers.filter(s => s.kind === 'grid' && s.m > l)
    expect(after.map(s => +(s.m - lds.m + 3.9).toFixed(6))).toEqual([0.3, 0.9, 1.5, 2.1, 2.7, 3.3])
    // On the branch the same distances behind its own WE.
    after.forEach(s => expect(s.b - s.m).toBeCloseTo(lds.b - lds.m, 9))
    // The ldS runs through both axis points.
    const [e0, e1] = lds.ends
    const off = (p) => Math.abs((e1[0] - e0[0]) * (p[1] - e0[1]) - (e1[1] - e0[1]) * (p[0] - e0[0])) / Math.hypot(e1[0] - e0[0], e1[1] - e0[1])
    expect(off(d.marks.ldS.main)).toBeLessThan(1e-6)
    expect(off(d.marks.ldS.branch)).toBeLessThan(1e-6)
  })

  it('turns the sleepers behind the ldS linearly from the ldS’s angle to square', () => {
    const d = formDetail(switchTypeByLabel('760 – 1:14'), { rail: '54E4' })
    const angle = (s) => Math.atan2(s.ends[1][1] - s.ends[0][1], s.ends[1][0] - s.ends[0][0])
    const lds = d.sleepers.find(s => s.kind === 'lds')
    const main = d.sleepers.filter(s => s.kind === 'main')
    expect(main).toHaveLength(7)
    // Square to the main track is π/2 in the turnout's frame (the main track runs along x).
    const skew = angle(lds) - Math.PI / 2
    expect(Math.abs(skew)).toBeGreaterThan(0.01)
    main.forEach((s, i) => expect(angle(s) - Math.PI / 2).toBeCloseTo(skew * (1 - (i + 1) / 7), 3))
  })

  it('puts the ldS of the 215 – 1:4.8 on the last sleeper before WE, as the table has it', () => {
    const d = formDetail(switchTypeByLabel('215 – 1:4.8'), { rail: '54E4' })
    const lds = d.sleepers.find(s => s.kind === 'lds')
    expect(d.sleepers.filter(s => s.kind === 'grid' || s.kind === 'lds').at(-1)).toBe(lds)
    expect(d.counts.throughSleepers).toBe(37)
  })

  it('draws WA and WE as joints on the rails, in the middle of a sleeper bay', () => {
    const d = formDetail(switchTypeByLabel('760 – 1:14'))
    const [l, r] = d.marks.joints.WA
    expect(l).toEqual([expect.closeTo(0, 3), expect.closeTo(-RAIL_OFFSET, 9)])
    expect(r).toEqual([expect.closeTo(0, 3), expect.closeTo(RAIL_OFFSET, 9)])
    expect(d.marks.joints.WE).toHaveLength(2)
    // On every rail the joint lies in the middle of its bay: the two sleepers
    // beside it, where they cross that rail, are equally far from it.
    const through = d.sleepers.filter(s => s.kind === 'grid' || s.kind === 'lds' || s.kind === 'before')
    const crossings = (joint) => through.map(s => {
      const [e0, e1] = s.ends
      const t = (joint[1] - e0[1]) / (e1[1] - e0[1])      // the rails run nearly along x here
      return e0[0] + (e1[0] - e0[0]) * t
    })
    for (const joint of [...d.marks.joints.WA, ...d.marks.joints.WE.flat()]) {
      const xs = crossings(joint)
      const before = Math.max(...xs.filter(x => x < joint[0])), after = Math.min(...xs.filter(x => x > joint[0]))
      expect(joint[0] - before).toBeCloseTo(after - joint[0], 2)
      expect(after - before).toBeCloseTo(0.6, 1)
    }
  })

  it('marks WE on both tracks where the table puts them', () => {
    const form = switchTypeByLabel('190 – 1:9')
    const d = formDetail(form)
    const m = switchVariants(form)[0].masse
    expect(d.marks.WE.main[0]).toBeCloseTo(m.l, 2)
    expect(d.marks.WE.branch[1]).toBeCloseTo(m.c, 2)
    expect(d.marks.WM[0]).toBeCloseTo(m.a, 2)
  })

  it('draws the symmetrical turnout with the branch to one side and the main route to the other', () => {
    const d = formDetail(switchTypeByLabel('215 – 1:4.8'))
    expect(d.marks.WE.main[1]).toBeLessThan(-1)
    expect(d.marks.WE.branch[1]).toBeGreaterThan(1)
    expect(d.marks.WM[0]).toBeCloseTo(11.04, 1)
  })

  it('draws a laid turnout from its tracks; a form without variants has no bracket sleepers', () => {
    const d = switchDetail([mainTrack(), branchTrack()], turnout(), { formOf })
    expect(d.counts.throughSleepers).toBe(d.sleepers.length)
    expect(d.counts.before + d.counts.behindMain + d.counts.behindBranch).toBe(0)
    // Without a variant the ldS lies where the catalogue puts it, 10 m behind WE.
    expect(d.marks.ldS.main[0]).toBeCloseTo(40, 6)
    expect(d.marks.WE.main[0]).toBeCloseTo(30, 6)
    expect(switchDetail([mainTrack()], turnout(), { formOf })).toBeNull()
  })
})
