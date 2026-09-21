import { describe, it, expect } from 'vitest'
import {
  SWITCH_TYPES, SWITCH_TYPES_ALT1, SWITCH_TYPES_ALT2,
  switchArcLength, switchStraightLength, switchBranchSections, switchBranchLength,
  switchFormChain, switchBranchChain, switchBranchRoute, switchChainTo, switchChainSlice,
  computeSwitchGeometryUtm, branchRadius, SWITCH_TYPES_INVENTORY, switchMarkDistance,
} from './switchUtils'

const ALL_FORMS = [...SWITCH_TYPES, ...SWITCH_TYPES_ALT1, ...SWITCH_TYPES_ALT2]
// The forms whose branch is the single arc, and the ones that end in a straight
// piece — every helper here has to hold for both, and the first group has to
// give back exactly what it gave before the end pieces existed (AP 3.1).
const ARC_FORMS = ALL_FORMS.filter(f => !f.branch)
const END_PIECE_FORMS = ALL_FORMS.filter(f => f.branch)
/** The straight piece a form ends in, 0 where it has none. */
const endPiece = (f) => (f.branch ?? []).filter(s => s.type === 'straight')
  .reduce((sum, s) => sum + s.length, 0)

// The branch as it was built when a form *was* a single arc: the stem taken to
// the arc's length, every piece offset by the one form radius. AP 0.3 replaced
// this with a sequence of sections; for the forms the tables hold — all of them
// one arc — the sequence has to give back exactly this.
const branchChainBeforeSections = (formSignedR, stem, length) =>
  switchChainTo(stem, length).map(piece => switchBranchRoute(formSignedR, piece, piece.length))

const STEMS = {
  straight: { length: 120, r1: null, r2: null },
  arcRight: { length: 120, r1: 600, r2: 600 },
  arcLeft:  { length: 120, r1: -450, r2: -450 },
  clothoid: { length: 120, r1: null, r2: -800 },
  chain: [
    { length: 30, r1: null, r2: null },
    { length: 40, r1: null, r2: -900 },
    { length: 50, r1: -900, r2: -900 },
  ],
}

describe('switchBranchSections — a form without an end piece is one arc', () => {
  it.each(ARC_FORMS.map(f => [f.label, f]))('%s', (_label, form) => {
    const sections = switchBranchSections(form)
    expect(sections).toHaveLength(1)
    expect(sections[0]).toEqual({
      type: 'arc', R: form.R, length: switchArcLength(form.R, form.ratio),
    })
  })

  it('switchBranchLength is the arc length for those forms', () => {
    for (const form of ARC_FORMS) {
      expect(switchBranchLength(form)).toBe(switchArcLength(form.R, form.ratio))
    }
  })
})

describe('switchBranchSections — a form that ends in a straight piece', () => {
  it.each(END_PIECE_FORMS.map(f => [f.label, f]))('%s', (_label, form) => {
    const sections = switchBranchSections(form)
    expect(sections).toHaveLength(2)
    expect(sections[0]).toEqual({ type: 'arc', R: form.R, length: switchArcLength(form.R, form.ratio) })
    expect(sections[1]).toEqual({ type: 'straight', R: null, length: endPiece(form) })
  })

  it('reaches the arc plus its end piece from the toe', () => {
    for (const form of END_PIECE_FORMS) {
      expect(switchBranchLength(form))
        .toBeCloseTo(switchArcLength(form.R, form.ratio) + endPiece(form), 12)
    }
  })

  it('the five forms AP 3.1 brought are the ones that have one', () => {
    expect(END_PIECE_FORMS.map(f => f.label)).toEqual(
      ['190 – 1:9', '190 – 1:7.5', '500 – 1:14', '760 – 1:15', '760 – 1:18.5'])
  })

  it('185 – 1:7 is gone — the 190s replace it (Entscheidung 12)', () => {
    expect(ALL_FORMS.some(f => f.label === '185 – 1:7')).toBe(false)
  })
})

describe('switchFormChain', () => {
  it('signs the branch radius by the side the turnout diverges to', () => {
    const form = SWITCH_TYPES[1]
    expect(switchFormChain(form, 'right')[0].signedR).toBe(form.R)
    expect(switchFormChain(form, 'left')[0].signedR).toBe(-form.R)
  })
})

describe('switchBranchChain — the sequence gives back what the single radius gave', () => {
  for (const [stemName, stem] of Object.entries(STEMS)) {
    for (const side of ['left', 'right']) {
      it(`${stemName} stem, ${side}-hand branch, all forms`, () => {
        for (const form of ARC_FORMS) {
          const formSignedR = side === 'left' ? -form.R : form.R
          const expected = branchChainBeforeSections(formSignedR, stem, switchArcLength(form.R, form.ratio))
          expect(switchBranchChain(switchFormChain(form, side), stem)).toEqual(expected)
        }
      })
    }
  }
})

describe('switchBranchChain — a form with a straight end piece', () => {
  // The shape AP 3.1 enters into the tables. Nothing states one yet, so this is
  // the sequence doing the thing it was generalised for.
  const form = { label: 'test', R: 500, ratio: 14, branch: [
    { type: 'arc', R: 500 }, { type: 'straight', length: 9.274 },
  ] }

  it('the branch length is the arc plus the straight piece', () => {
    expect(switchBranchLength(form)).toBeCloseTo(switchArcLength(500, 14) + 9.274, 12)
  })

  it('parts the branch at the form section boundary even on a stem of one piece', () => {
    const chain = switchBranchChain(switchFormChain(form, 'right'), STEMS.straight)
    expect(chain).toHaveLength(2)
    expect(chain[0].length).toBeCloseTo(switchArcLength(500, 14), 12)
    expect(chain[1].length).toBeCloseTo(9.274, 12)
  })

  it('on a straight stem the end piece is straight', () => {
    const [arc, straight] = switchBranchChain(switchFormChain(form, 'right'), STEMS.straight)
    expect(arc.r1).toBe(500)
    expect(straight.r1).toBeNull()
  })

  it('in a curve the end piece curves with the stem — kappa_branch = kappa_stem', () => {
    const [arc, straight] = switchBranchChain(switchFormChain(form, 'right'), STEMS.arcRight)
    expect(arc.r1).toBeCloseTo(branchRadius(500, 600), 9)
    // No curvature of its own, so it takes the stem's and nothing else.
    expect(straight.r1).toBe(STEMS.arcRight.r1)
    expect(straight.r2).toBe(STEMS.arcRight.r1)
  })

  it('parts at both the form sections and the stem elements', () => {
    // The chain stem parts at 30 m and 70 m; the form parts at its arc length
    // (~35.6 m), which falls inside the stem's second piece.
    const chain = switchBranchChain(switchFormChain(form, 'right'), STEMS.chain)
    const total = chain.reduce((sum, p) => sum + p.length, 0)
    expect(total).toBeCloseTo(switchBranchLength(form), 9)
    expect(chain.length).toBeGreaterThan(2)
  })
})

describe('switchChainSlice', () => {
  const chain = [
    { length: 10, r1: null, r2: null },
    { length: 20, r1: 500, r2: 500 },
  ]

  it('returns the whole chain for its full span', () => {
    expect(switchChainSlice(chain, 0, 30)).toEqual(chain)
  })

  it('cuts at the stations asked for, keeping the chain’s own boundaries', () => {
    const out = switchChainSlice(chain, 5, 25)
    expect(out.map(p => p.length)).toEqual([5, 15])
    expect(out[1].r1).toBe(500)
  })

  it('drops pieces the span does not reach', () => {
    expect(switchChainSlice(chain, 0, 10)).toEqual([{ length: 10, r1: null, r2: null }])
  })
})

describe('switchStraightLength', () => {
  it('is the symmetric tangent construction where the branch is one arc', () => {
    for (const form of ARC_FORMS) {
      const arcLen = switchArcLength(form.R, form.ratio)
      expect(switchStraightLength(form))
        .toBeCloseTo(2 * form.R * Math.tan(arcLen / (2 * form.R)), 12)
    }
  })

  it('adds the end piece on top of that construction', () => {
    for (const form of END_PIECE_FORMS) {
      const arcLen = switchArcLength(form.R, form.ratio)
      expect(switchStraightLength(form))
        .toBeCloseTo(2 * form.R * Math.tan(arcLen / (2 * form.R)) + endPiece(form), 12)
    }
  })

  it('gives the DB building lengths for the forms that state one', () => {
    const lengthOf = (label) => switchStraightLength(ALL_FORMS.find(f => f.label === label))
    expect(lengthOf('190 – 1:9')).toBeCloseTo(27.14, 2)
    expect(lengthOf('190 – 1:7.5')).toBeCloseTo(25.86, 2)
    expect(lengthOf('500 – 1:14')).toBeCloseTo(44.94, 2)
  })
})

describe('computeSwitchGeometryUtm still builds the same turnout', () => {
  const start = { easting: 500000, northing: 5600000, zone: 25832 }

  it('the branch ends a form-branch away from the toe, on either side', () => {
    for (const form of SWITCH_TYPES) {
      for (const side of ['left', 'right']) {
        const g = computeSwitchGeometryUtm(start, 30, form, side, false)
        expect(g.arcLen).toBeCloseTo(switchArcLength(form.R, form.ratio) + endPiece(form), 12)
        expect(g.branchChain).toHaveLength(form.branch ? 2 : 1)
        expect(g.branchChain[0].r1).toBe(side === 'left' ? -form.R : form.R)
        // The two routes leave the toe together and part by the frog angle.
        const delta = Math.abs(((g.branchEndBearing - g.mainEndBearing + 540) % 360) - 180)
        expect(delta).toBeCloseTo(Math.atan(1 / form.ratio) * 180 / Math.PI, 6)
      }
    }
  })

  it('a bent switch adds the curvatures: kappa_branch = kappa_stem + kappa_form', () => {
    const form = SWITCH_TYPES.find(f => f.label === '300 – 1:9')
    const g = computeSwitchGeometryUtm(start, 30, form, 'right', false, null, 900)
    expect(g.mainSignedR).toBe(900)
    expect(g.branchChain[0].r1).toBeCloseTo(branchRadius(form.R, 900), 9)
  })
})

/**
 * The forms that exist in the Bestand and in no connection: the symmetrical
 * turnout and the 190 carried on to 1:6,3 (geliefert am 2026-09-21).
 */
describe('the inventory forms', () => {
  const sym = SWITCH_TYPES_INVENTORY.find(f => f.label === '215 – 1:4.8')
  const sharp = SWITCH_TYPES_INVENTORY.find(f => f.label === '190 – 1:6.3')

  it('are out of the tables a connection and a dialog read', () => {
    // They are Regelweichen and they are still not connection forms: the
    // solver's chain and the „Weiche aufs Gleis" picker keep what they had.
    for (const f of SWITCH_TYPES_INVENTORY) {
      expect(ALL_FORMS.some(t => t.label === f.label), f.label).toBe(false)
    }
  })

  it('part the symmetrical turnout into two arcs of its own radius', () => {
    // 1:4,8 is the angle between the two routes, so each of them turns half of
    // it — on R = 215, which is what makes it symmetrical and what makes it
    // unbendable: at any other stem radius the two would differ.
    const half = 215 * Math.atan(1 / 4.8) / 2
    expect(switchBranchLength(sym)).toBeCloseTo(half, 9)
    expect(switchBranchLength(sym)).toBeCloseTo(22.080, 3)
    expect(switchBranchSections(sym)).toEqual([{ type: 'arc', R: 215, length: half }])
    // Both routes are that same arc, so the through route is as long as the
    // branch — a symmetrical turnout has no side that runs on.
    expect(switchStraightLength(sym)).toBeCloseTo(22.0994, 3)
  })

  it('carry the 190 on to 1:6,3 as the one arc it is', () => {
    // „Letztlich eine 190 – 1:7,5, wo der Bogen einfach weitergeführt wird" —
    // so no straight end piece, and the branch is longer than the 1:7,5's.
    expect(sharp.branch).toBeUndefined()
    expect(switchBranchLength(sharp)).toBeCloseTo(190 * Math.atan(1 / 6.3), 9)
    expect(switchBranchLength(sharp)).toBeCloseTo(29.909, 3)
    const flatter = SWITCH_TYPES.find(f => f.label === '190 – 1:7.5')
    expect(switchBranchLength(sharp)).toBeGreaterThan(switchBranchLength(flatter))
    expect(sharp.R).toBe(flatter.R)
  })

  it('run at the speed and the spacing the form table states', () => {
    for (const f of SWITCH_TYPES_INVENTORY) {
      expect(f.speed, f.label).toBe(40)
      expect(f.minl, f.label).toBe(6)
      expect(f.dLcs, f.label).toBe(0.30)
    }
  })
})

describe('the mark distance the form table is built on', () => {
  const at = (label) => [...SWITCH_TYPES, ...SWITCH_TYPES_ALT1, ...SWITCH_TYPES_ALT2]
    .find(f => f.label === label)

  it('gives the stored value for every form whose branch is the one arc', () => {
    // `d = 2.272/atan(w) − R·tan(w/2)` on the table's 0.30 + k · 0.60 grid.
    expect(switchMarkDistance(185, 7)).toBeCloseTo(2.70, 9)     // the form AP 3.1 dropped
    expect(switchMarkDistance(300, 9)).toBeCloseTo(at('300 – 1:9').dLcs, 9)
    expect(switchMarkDistance(500, 12)).toBeCloseTo(at('500 – 1:12').dLcs, 9)
    expect(switchMarkDistance(2500, 26.5)).toBeCloseTo(at('2500 – 1:26.5').dLcs, 9)
  })

  it('does not reach the ones that carry a straight end piece', () => {
    // The rule takes the branch for one arc, and an end piece moves the switch
    // end the mark is measured from — so these stay the delivered values.
    expect(switchMarkDistance(190, 9)).not.toBeCloseTo(at('190 – 1:9').dLcs, 9)
    expect(switchMarkDistance(190, 7.5)).not.toBeCloseTo(at('190 – 1:7.5').dLcs, 9)
  })

  it('puts a mark that would sit inside the switch on the first step', () => {
    // 190 – 1:6,3 diverges fast enough to stand 2,272 m apart before it ends:
    // the rule gives −0,30, and the grid's floor is where the mark goes, which
    // is where the confirmed 190 – 1:7,5 sits for the same reason.
    expect(switchMarkDistance(190, 6.3)).toBe(0.30)
    expect(switchMarkDistance(107.5, 4.8)).toBe(0.30)   // the symmetrical 215
  })
})
