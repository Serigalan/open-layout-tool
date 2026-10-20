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

  it('has the table’s sleeper count from WA to the ldS, to one sleeper', () => {
    let checked = 0
    for (const form of ALL_SWITCH_TYPES) {
      const d = formDetail(form)
      for (const v of switchVariants(form)) {
        // Only rows whose ldS is the form's: the catalogue's ldS binds, a row
        // with another one counts other sleepers.
        // The run-out turnouts (…/∞) are laid on another spacing than 0.60 m:
        // even (l + ldS) / 0.60 overshoots the table's count by 6 to 12.
        if (v.schwellenzahl == null || Math.abs(v.masse.lds - form.lds) > 0.1 || form.s_we) continue
        expect(Math.abs(d.counts.throughSleepers - v.schwellenzahl), `${v.nr} ${v.bezeichnung}`).toBeLessThanOrEqual(1)
        checked++
      }
    }
    expect(checked).toBeGreaterThan(40)
  })

  it('reaches the count of the clothoid and compound-curve turnouts exactly', () => {
    expect(formDetail(switchTypeByLabel('6000/3700 – 1:32.5 fb')).counts.throughSleepers).toBe(232)
    expect(formDetail(switchTypeByLabel('7000/6000 – 1:42 fb')).counts.throughSleepers).toBe(290)
  })

  it('lets the ldS take the place of a grid sleeper just before it', () => {
    const d = formDetail(switchTypeByLabel('190 – 1:7.5'))
    const through = d.sleepers.filter(s => s.kind === 'grid' || s.kind === 'lds')
    expect(through.at(-1).kind).toBe('lds')
    expect(through.at(-1).m - through.at(-2).m).toBeGreaterThan(0.3)
    // Where the ldS lies half a spacing or more behind it, the grid sleeper stays.
    const d2 = formDetail(switchTypeByLabel('500 – 1:14'))
    const t2 = d2.sleepers.filter(s => s.kind === 'grid' || s.kind === 'lds')
    expect(t2.at(-1).m - t2.at(-2).m).toBeCloseTo(0.544, 2)
  })

  it('lays the bracket sleepers of the variant: before WA and behind the ldS on either track', () => {
    const form = switchTypeByLabel('760 – 1:14')
    const d54 = formDetail(form, { rail: '54E4' })
    expect(d54.variant.nr).toBe(1009)
    expect(d54.counts).toMatchObject({ before: 3, behindMain: 7, behindBranch: 8 })
    const before = d54.sleepers.filter(s => s.kind === 'before').map(s => s.m)
    expect(before.map(m => +m.toFixed(6))).toEqual([-0.3, -0.9, -1.5])
    // The 60E2A1 variant has none before WA.
    expect(formDetail(form, { rail: '60E2' }).counts.before).toBe(0)
  })

  it('shortens a sleeper behind the ldS to 5 cm short of the middle between the tracks', () => {
    const d = formDetail(switchTypeByLabel('300 – 1:9'), { rail: '54E4' })
    const first = d.sleepers.find(s => s.kind === 'main' && s.k === 1)
    const firstBranch = d.sleepers.find(s => s.kind === 'branch' && s.k === 1)
    expect(first.ends[0][1]).toBeCloseTo(-HALF, 2)
    expect(first.ends[1][1]).toBeLessThan(HALF)
    expect(first.ends[1][1]).toBeGreaterThan(0.9)
    // The two inner ends do not meet.
    expect(firstBranch.ends[1][1] - first.ends[1][1]).toBeGreaterThan(0.09)
    // Far enough on, the track distance allows the whole sleeper.
    const last = d.sleepers.filter(s => s.kind === 'branch').at(-1)
    expect(last.k).toBe(6)
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
    expect(d.marks.ldS.main[0]).toBeCloseTo(40, 6)
    expect(d.marks.WE.main[0]).toBeCloseTo(30, 6)
    expect(switchDetail([mainTrack()], turnout(), { formOf })).toBeNull()
  })
})
