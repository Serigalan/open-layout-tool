import { describe, it, expect } from 'vitest'
import {
  ALL_SWITCH_TYPES, CROSSING_TYPES, SWITCH_CONNECTION_STAGES, SWITCH_PICK_TYPES, hasCompoundBranch, switchBranchSections,
  switchMark, switchMarkDistance, switchStraightLength, switchTangents, switchTypeByLabel, switchVariantFor,
  switchVariants,
} from './catalogue'

// The variants are the rows of the DB switch table (800.0120, 05/2024); the
// geometry stays the form's. These tests hold the two against each other.

const straightPiece = (form) => (form.branch ?? [])
  .filter(section => section.type === 'straight')
  .reduce((sum, section) => sum + section.length, 0)

describe('switch variants', () => {
  it('every turnout row is built by its form to 3 mm', () => {
    let rows = 0
    for (const form of ALL_SWITCH_TYPES.filter(f => !hasCompoundBranch(f))) {
      const alpha = Math.atan(1 / form.ratio)
      for (const v of switchVariants(form)) {
        rows++
        const m = v.masse
        expect(Math.abs(switchStraightLength(form) - m.l), `${v.nr} l`).toBeLessThan(0.003)
        if (form.symmetric) continue
        const a = form.R * Math.tan(alpha / 2)
        expect(Math.abs(a - m.a), `${v.nr} a`).toBeLessThan(0.003)
        expect(Math.abs(a + straightPiece(form) - m.b), `${v.nr} b`).toBeLessThan(0.003)
        expect(Math.abs((a + straightPiece(form)) * Math.sin(alpha) - m.c), `${v.nr} c`).toBeLessThan(0.003)
      }
    }
    expect(rows).toBeGreaterThan(60)
  })

  it('every crossing row has the tangent of its form', () => {
    for (const form of CROSSING_TYPES.filter(f => f.kind === 'crossing')) {
      for (const v of switchVariants(form)) expect(Math.abs(form.lt - v.masse.l1), `${v.nr}`).toBeLessThan(0.001)
    }
  })

  it('a variant keeps the form’s ldS and states its sleepers', () => {
    const form = switchTypeByLabel('760 – 1:14')
    expect(form.lds).toBe(5.125)
    const v49 = switchVariants(form).find(v => v.profil === '49E5')
    expect(v49.masse.lds).toBe(4.04)
    const v54 = switchVariants(form).find(v => v.nr === 1009)
    expect(v54).toMatchObject({ profil: '54E4', schwellen: 'beton', klasse: 'regel', schwellenzahl: 99, klammer: [3, 7, 8] })
  })

  it('picks the variant of the track’s rail: concrete before timber, Regelform before Sonderbauform', () => {
    const form = switchTypeByLabel('500 – 1:12')
    expect(switchVariantFor(form, '54E4').nr).toBe(1008)
    expect(switchVariantFor(form, '60E2').nr).toBe(1012)
    expect(switchVariantFor(form, '49E5').nr).toBe(1003)
    // No variant has the profile: the form's first.
    expect(switchVariantFor(switchTypeByLabel('300 – 1:14'), '49E5').nr).toBe(1042)
    expect(switchVariantFor(switchTypeByLabel('190 – 1:6.3'), '54E4')).toBeNull()
  })

  it('the 215 – 1:4.8 keeps ldS 0 although the table states −0.244', () => {
    const form = switchTypeByLabel('215 – 1:4.8')
    expect(form.lds).toBe(0)
    expect(switchVariants(form).every(v => v.masse.lds < 0)).toBe(true)
  })
})

describe('the fb and gb turnouts (decision 343)', () => {
  const frogs = ALL_SWITCH_TYPES.filter(f => f.herzstueck && !hasCompoundBranch(f))

  it('are forms of their own, each built as the rows of the table that name it', () => {
    expect(frogs.map(f => f.label)).toEqual([
      '2500 – 1:26.5', '500 – 1:12 fb', '760 – 1:14 fb', '1200 – 1:18.5 fb',
      '300 – 1:9 gb', '300 – 1:9.4 gb', '500 – 1:11 fb', '500 – 1:12 gb', '500 – 1:14 fb', '760 – 1:14 gb',
      '760 – 1:15 fb', '760 – 1:18.5 fb', '1200 – 1:18 fb', '1200 – 1:18.5 gb', '1200 – 1:19.277 fb',
      '2500 – 1:27.85 fb',
    ])
    for (const f of frogs) {
      expect(f.label.endsWith(f.herzstueck) || f.label === '2500 – 1:26.5', f.label).toBe(true)
      expect(switchVariants(f).every(v => v.bezeichnung.endsWith(` ${f.herzstueck}`)), f.label).toBe(true)
    }
  })

  it('run at the speed of their radius (decision 348)', () => {
    const speed = { 300: 50, 500: 60, 760: 80, 1200: 100, 2500: 130 }
    for (const f of frogs) expect(f.speed, f.label).toBe(speed[f.R])
  })

  it('take the Weichenmarke from the construction, the stated one where there is one (decision 346)', () => {
    const fb = switchTypeByLabel('500 – 1:12 fb')
    expect(fb.dLcs).toBeUndefined()
    expect(switchMark(fb)).toBe(switchMarkDistance(fb))
    expect(switchMark(switchTypeByLabel('500 – 1:12'))).toBe(6.3)
    expect(switchMark(switchTypeByLabel('Kr 1:2.9'))).toBeNull()
  })

  it('keep the exact ldS of the rigid form of the same geometry, the table’s otherwise', () => {
    expect(switchTypeByLabel('760 – 1:14 gb').lds).toBe(5.125)
    expect(switchTypeByLabel('500 – 1:12 fb').lds).toBe(2.7)
    expect(switchTypeByLabel('1200 – 1:18.5 fb').branch.at(-1).length).toBe(1.798)
  })

  it('are offered in their group and never chosen by a switch connection', () => {
    const regel = SWITCH_PICK_TYPES.filter(f => f.klasse === 'regel').map(f => f.label)
    expect(regel).toContain('500 – 1:12 fb')
    expect(SWITCH_PICK_TYPES.filter(f => f.klasse === 'sonderbauform').map(f => f.label)).toContain('760 – 1:14 gb')
    const staged = SWITCH_CONNECTION_STAGES.flat()
    for (const f of frogs) expect(staged.includes(f), f.label).toBe(f.label === '2500 – 1:26.5')
  })
})

describe('the clothoid and compound-curve turnouts (decision 344)', () => {
  const forms = ALL_SWITCH_TYPES.filter(hasCompoundBranch)

  it('are the nine of the table, all fb', () => {
    expect(forms.map(f => f.label)).toEqual([
      '6000/3700 – 1:32.5 fb', '7000/6000 – 1:42 fb',
      '3000/1500 – 1:18.132 fb', '3000/1500/∞ – 1:23.735 fb', '4800/2450 – 1:24.257 fb', '4800/2450/∞ – 1:30.686 fb',
      '10000/4000 – 1:32.05 fb', '10000/4000/∞ – 1:39.113 fb', '16000/6100 – 1:40.154 fb',
    ])
    expect(forms.every(f => f.herzstueck === 'fb')).toBe(true)
  })

  it('turn through the frog angle over their stated sections', () => {
    for (const form of forms) {
      const angle = form.branch.reduce((sum, s) => sum + (s.type === 'clothoid'
        ? s.length * (1 / s.R1 + (s.R2 ? 1 / s.R2 : 0)) / 2
        : s.type === 'arc' ? s.length / s.R : 0), 0)
      expect(angle, form.label).toBeCloseTo(Math.atan(1 / form.ratio), 6)
    }
  })

  it('reach t1, t2 and l of the table to 3 cm — a run-out branch to where the tracks stand s apart', () => {
    for (const form of forms) {
      const m = switchVariants(form)[0].masse
      const { t1, t2 } = switchTangents(form)
      expect(Math.abs(t1 - m.t1), `${form.label} t1`).toBeLessThan(0.03)
      expect(Math.abs(t2 - m.t2), `${form.label} t2`).toBeLessThan(0.03)
      expect(Math.abs(switchStraightLength(form) - m.l), `${form.label} l`).toBeLessThan(0.03)
    }
    // 3000/1500/∞: WE on the straight behind the run-out; 10000/4000/∞: 4 m before its end.
    expect(switchBranchSections(switchTypeByLabel('3000/1500/∞ – 1:23.735 fb')).at(-1)).toMatchObject({ type: 'straight' })
    const cut = switchBranchSections(switchTypeByLabel('10000/4000/∞ – 1:39.113 fb')).at(-1)
    expect(cut.type).toBe('clothoid')
    expect(cut.length).toBeCloseTo(51.08, 1)
  })

  it('run at the speed of their smallest radius (decision 348)', () => {
    expect(forms.map(f => [f.R, f.speed])).toEqual([
      [3700, 160], [6000, 200], [1500, 100], [1500, 100], [2450, 130], [2450, 130], [4000, 160], [4000, 160], [6100, 200],
    ])
  })

  it('take the Weichenmarke from the construction with t2', () => {
    const form = switchTypeByLabel('6000/3700 – 1:32.5 fb')
    expect(switchMark(form)).toBeCloseTo(15.9, 6)
  })
})
