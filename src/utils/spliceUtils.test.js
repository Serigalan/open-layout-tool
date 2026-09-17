import { describe, it, expect } from 'vitest'
import { computeArcArcTransition, computeArcStraightSplice } from './spliceUtils'
import { endPointCurvedUtm, bearingAfterUtm } from './elementUtils'
import { computeClothoidUtm, transitionCantEnds } from './clothoidUtils'
import { SAGITTA_ELEMENT } from './mapConstants'
import { recalcAbsLengths } from '../storage'
import { expectValidTrack } from '../test/chainInvariants'

/**
 * AP 4.1 — two arcs joined directly by one transition curve.
 *
 * Each case is a round trip: an ideal chain is built forwards (arc → transition
 * → arc), its two outer arcs are handed to the solver as the two picked
 * elements, and the solver has to find the transition back. The construction is
 * unique, so "finds it back" is the whole assertion — the length, both
 * junctions and the geometry have to come out as they went in.
 */

const EPSG = 25832
const P0   = { easting: 500000, northing: 5600000, zone: EPSG }

/** An ideal chain: arc r1 of `len1`, transition of `L`, arc r2 of `len2`. */
function idealChain({ r1, r2, L, len1 = 300, len2 = 250, bearing0 = 20 }) {
  const A  = endPointCurvedUtm(P0, bearing0, len1, r1)
  const bA = bearingAfterUtm(bearing0, len1, r1)
  const cl = computeClothoidUtm(A, bA, L, r1, r2, SAGITTA_ELEMENT)
  const B  = cl.endUtm
  const bB = cl.endBearing
  const C  = endPointCurvedUtm(B, bB, len2, r2)
  const bC = bearingAfterUtm(bB, len2, r2)
  return { A, bA, B, bB, C, bC }
}

/**
 * The two picks the panel would hand over for that chain. The arrival element is
 * the second arc as it would be *stored* running the other way — the splice
 * folds it in backwards, which is what flips its radius.
 */
function picksFor(chain, r1, r2) {
  return {
    depStart: P0, depEnd: chain.A, depBearing: chain.bA, depSignedR: r1,
    arrStart: chain.C, arrEnd: chain.B, arrBearing: (chain.bB + 180) % 360, arrSignedR: -r2,
  }
}

const solve = (p, type = 'clothoid') => computeArcArcTransition(
  p.depEnd, p.depBearing, p.depSignedR,
  p.arrEnd, p.arrBearing, p.arrSignedR,
  p.depStart, p.arrStart, type)

const apart = (a, b) => Math.hypot(a.easting - b[0], a.northing - b[1])

describe('a compound curve — two arcs turning the same way', () => {
  const r1 = 1000, r2 = 600, L = 120
  const chain = idealChain({ r1, r2, L })
  const res = solve(picksFor(chain, r1, r2))

  it('finds the transition that was there', () => {
    expect(res.error).toBeUndefined()
    expect(res.transitionLength).toBeCloseTo(L, 4)
    expect(res.compound).toBe(true)
  })

  it('puts both junctions back where they were', () => {
    const [depArc, transition, arrArc] = res.elements
    expect(apart(chain.A, transition.startNode)).toBeLessThan(1e-3)
    expect(apart(chain.B, transition.endNode)).toBeLessThan(1e-3)
    expect(apart(chain.C, arrArc.endNode)).toBeLessThan(1e-9)
    expect(apart(P0, depArc.startNode)).toBeLessThan(1e-9)
  })

  it('keeps each element the kind of element it is', () => {
    const [depArc, transition, arrArc] = res.elements
    expect(depArc.radius).toBe(r1)
    expect(transition.elementType).toBe(2)
    expect(transition.r1).toBe(r1)
    expect(transition.r2).toBe(r2)
    expect(arrArc.radius).toBe(r2)
  })

  it('and the chain holds together', () => {
    expectValidTrack({ id: 't', epsg: EPSG, elements: recalcAbsLengths(res.elements) })
  })
})

describe('a reverse curve — two arcs turning opposite ways', () => {
  const r1 = 1000, r2 = -800, L = 150
  const chain = idealChain({ r1, r2, L })
  const res = solve(picksFor(chain, r1, r2))

  it('finds the transition through R = ∞', () => {
    expect(res.error).toBeUndefined()
    expect(res.transitionLength).toBeCloseTo(L, 4)
    expect(res.compound).toBe(false)
    expect(res.elements[1].r1).toBe(r1)
    expect(res.elements[1].r2).toBe(r2)
  })

  it('puts both junctions back where they were', () => {
    const transition = res.elements[1]
    expect(apart(chain.A, transition.startNode)).toBeLessThan(1e-3)
    expect(apart(chain.B, transition.endNode)).toBeLessThan(1e-3)
  })

  it('and the chain holds together', () => {
    expectValidTrack({ id: 't', epsg: EPSG, elements: recalcAbsLengths(res.elements) })
  })
})

describe('a Bloss transition between the two arcs', () => {
  const r1 = 900, r2 = 500, L = 140
  it('is found back the same way', () => {
    const A  = endPointCurvedUtm(P0, 20, 300, r1)
    const bA = bearingAfterUtm(20, 300, r1)
    const cl = computeClothoidUtm(A, bA, L, r1, r2, SAGITTA_ELEMENT, 'bloss')
    const C  = endPointCurvedUtm(cl.endUtm, cl.endBearing, 250, r2)
    const res = computeArcArcTransition(
      A, bA, r1, cl.endUtm, (cl.endBearing + 180) % 360, -r2, P0, C, 'bloss')
    expect(res.error).toBeUndefined()
    expect(res.transitionLength).toBeCloseTo(L, 3)
    expect(res.elements[1].transitionType).toBe('bloss')
    expectValidTrack({ id: 't', epsg: EPSG, elements: recalcAbsLengths(res.elements) })
  })
})

describe('when no transition fits', () => {
  it('refuses two circles no transition can bridge', () => {
    // Concentric-ish: the centres are 100 m apart but the radii differ by 400,
    // so no transition of any length reaches from one circle to the other.
    const r1 = 1000, r2 = 600
    const chain = idealChain({ r1, r2, L: 120 })
    const p = picksFor(chain, r1, r2)
    // Move the arrival circle's centre onto the departure circle's.
    const res = computeArcArcTransition(
      p.depEnd, p.depBearing, p.depSignedR,
      p.depEnd, p.depBearing, -r2,          // same point and tangent → centres 400 apart… on the same side
      p.depStart, p.arrStart, 'clothoid')
    expect(res.error).toBe('splice_error_arcs_no_fit')
  })
})

// ── an arc and a straight, joined by a new arc ──────────────────────────────

describe('an arc spliced to a straight', () => {
  const R1 = 900, RNEW = 400, L = 80

  /** An ideal chain: arc R1 → transition → new arc → transition → straight. */
  function mixedChain({ Rn = -RNEW, Ld = L, La = L } = {}) {
    // A transition of no length is no transition — the pieces simply meet.
    const step = (from, bearing, len, r1, r2) => (len > 0
      ? (({ endUtm, endBearing }) => ({ p: endUtm, b: endBearing }))(
        computeClothoidUtm(from, bearing, len, r1, r2, SAGITTA_ELEMENT))
      : { p: from, b: bearing })
    const A  = endPointCurvedUtm(P0, 20, 300, R1)
    const bA = bearingAfterUtm(20, 300, R1)
    const s1 = step(A, bA, Ld, R1, Rn)
    const B  = s1.p, bB = s1.b
    const C  = endPointCurvedUtm(B, bB, 160, Rn)
    const bC = bearingAfterUtm(bB, 160, Rn)
    const s2 = step(C, bC, La, Rn, null)
    const D  = s2.p, bD = s2.b
    const E  = { easting: D.easting + 200 * Math.sin(bD * Math.PI / 180),
                 northing: D.northing + 200 * Math.cos(bD * Math.PI / 180), zone: EPSG }
    return { A, bA, D, bD, E }
  }

  it('finds the arc that was between them', () => {
    const ch = mixedChain()
    const res = computeArcStraightSplice(
      { pointUtm: ch.A, bearing: ch.bA, signedR: R1, farUtm: P0 },
      // The straight as it would be stored: the chain meets its END (D) and runs
      // on to its START (E), so it is traversed against its own direction.
      { pointUtm: ch.D, bearing: (ch.bD + 180) % 360, signedR: null, farUtm: ch.E },
      RNEW, L, L, 'clothoid')
    expect(res.error).toBeUndefined()
    expect(res.signedR).toBe(-RNEW)
    expect(res.arcLength).toBeCloseTo(160, 2)
    expectValidTrack({ id: 't', epsg: EPSG, elements: recalcAbsLengths(res.elements) })
  })

  it('gives the chain in travel order when the arc is the arrival instead', () => {
    const ch = mixedChain()
    const res = computeArcStraightSplice(
      { pointUtm: ch.D, bearing: (ch.bD + 180) % 360, signedR: null, farUtm: ch.E },
      { pointUtm: ch.A, bearing: ch.bA, signedR: R1, farUtm: P0 },
      RNEW, L, L, 'clothoid')
    expect(res.error).toBeUndefined()
    const els = res.elements
    // Reversed: it starts on the straight and ends on the arc.
    expect(els[0].elementType).toBe(0)
    expect(els[els.length - 1].radius).toBe(-R1)
    expectValidTrack({ id: 't', epsg: EPSG, elements: recalcAbsLengths(els) })
  })

  it('works without transitions at all', () => {
    const ch = mixedChain({ Ld: 0, La: 0 })
    const res = computeArcStraightSplice(
      { pointUtm: ch.A, bearing: ch.bA, signedR: R1, farUtm: P0 },
      { pointUtm: ch.D, bearing: (ch.bD + 180) % 360, signedR: null, farUtm: ch.E },
      RNEW, 0, 0, 'clothoid')
    expect(res.error).toBeUndefined()
    expect(res.elements).toHaveLength(3)
    expectValidTrack({ id: 't', epsg: EPSG, elements: recalcAbsLengths(res.elements) })
  })

  it('refuses two elements of the same kind — that is the other two solvers’ work', () => {
    const ch = mixedChain()
    const both = { pointUtm: ch.A, bearing: ch.bA, signedR: R1, farUtm: P0 }
    expect(computeArcStraightSplice(both, both, RNEW, 0, 0).error).toBe('splice_error_mixed')
  })
})

// ── the cant ramp AP 2.2 handed over ────────────────────────────────────────

describe('the cant across a spliced transition', () => {
  /**
   * The question AP 2.2 left open was whether an element of constant curvature
   * may carry two cant values. Here it does not have to: what lies between two
   * differently canted arcs *is* a transition curve, and a transition is the one
   * element this model lets state a cant at each end. So the ramp has a place to
   * live, and nothing of constant curvature has to carry two values.
   */
  it('is the ramp between its two neighbours, read off them', () => {
    const r1 = 1000, r2 = 600
    const chain = idealChain({ r1, r2, L: 120 })
    const res = solve(picksFor(chain, r1, r2))
    const elements = recalcAbsLengths(res.elements).map((el, i) => (
      el.elementType === 1 ? { ...el, cant: i === 0 ? 40 : 70 } : el))

    const ramp = transitionCantEnds(elements, 1)
    expect(ramp.start).toBe(40)
    expect(ramp.end).toBe(70)
    // …and the transition itself states neither, so it cannot contradict them.
    expect(elements[1].cantStart).toBeUndefined()
    expect(elements[1].cantEnd).toBeUndefined()
  })
})
