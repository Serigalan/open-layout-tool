import { describe, it, expect } from 'vitest'
import {
  SWITCH_TYPES, SWITCH_TYPES_ALT1, SWITCH_TYPES_ALT2,
  switchArcLength, switchStraightLength, switchBranchSections, switchBranchLength,
  switchFormChain, switchBranchChain, switchBranchRoute, switchChainTo, switchChainSlice,
  computeSwitchGeometryUtm, branchRadius,
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
