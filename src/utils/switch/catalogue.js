import KATALOG from '../../constraints/db-ril-800-0120.json'

// The switch and crossing forms of DB Ril 800.0120 and what the geometry reads of them.

// The form tables are not written here any more: they are this repo's
// rendering of DB Ril 800.0120 — src/constraints/db-ril-800-0120.json — and
// this module only picks out of it what the geometry needs. A form *is* its
// catalogue entry, not a copy shaped for the drawing code, so a measure
// changed in the file is changed everywhere the form is drawn, listed or
// exported.
//
// What the geometry below reads of an entry: `R` and `ratio` make the body,
// `branch` states a form whose branch is more than the one arc (its sections in
// order from the toe, see switchBranchSections), `symmetric` says the form has
// no through route at all, `dLcs` is the Weichenmarke [m] and `minl` the
// minimum intermediate straight a connection needs between two turnouts [m].

/** The rulebook itself, for a viewer or a test that wants more than the forms. */
export { KATALOG as WEICHEN_KATALOG }

const FORMEN = KATALOG.formen
const turnouts = (klasse) => FORMEN.filter(form => form.art === 'weiche' && form.klasse === klasse)

/**
 * The turnout forms the Ril calls Regelformen (A01) — what a dialog offers
 * first. `215 – 1:4.8`, the symmetrical turnout, is one of them: the Ril plans
 * it, so the app does too, and it is no longer a form that is merely
 * recognised on import.
 */
export const SWITCH_TYPES = turnouts('regel')

/**
 * The Sonderbauformen (A02) — their own group in every picker, beside the
 * Regelformen rather than hidden behind them.
 */
export const SWITCH_TYPES_SPECIAL = turnouts('sonderbauform')

/**
 * Every turnout form a dialog offers, Regelformen first and the
 * Sonderbauformen behind them — the list a picker indexes into and the order
 * it draws them in, in the Ril's own two groups.
 */
export const SWITCH_PICK_TYPES = [...SWITCH_TYPES, ...SWITCH_TYPES_SPECIAL]

/**
 * What a picker starts on: `300 – 1:9`, the form the dialogs have opened with
 * since they had one table. Found by name, not by position — AP 3.1 dropped a
 * form and shifted every index behind it once already.
 */
export const DEFAULT_SWITCH_TYPE_IDX =
  SWITCH_PICK_TYPES.findIndex(form => form.label === '300 – 1:9')

/**
 * The stages a switch connection falls back through, and the order within
 * each: `verbindung` on the form, which the catalogue marks as this tool's own
 * decision rather than the Ril's. A form without one is never chosen by a
 * connection — the symmetrical turnout has no through route, and a crossover
 * needs one on both sides.
 */
const stage = (n) => FORMEN
  .filter(form => form.verbindung?.stufe === n)
  .sort((a, b) => a.verbindung.rang - b.verbindung.rang)
export const SWITCH_CONNECTION_STAGES = [stage(1), stage(2), stage(3)]

/** First and second fallback, under the names the connection calculation knows. */
export const SWITCH_TYPES_ALT1 = SWITCH_CONNECTION_STAGES[1]
export const SWITCH_TYPES_ALT2 = SWITCH_CONNECTION_STAGES[2]

/** Every turnout form, whatever its class — what an import matches a record against. */
export const ALL_SWITCH_TYPES = FORMEN.filter(form => form.art === 'weiche')

/**
 * Distance from a form's switch end to its Weichenmarke [m], rounded onto the
 * table's own grid of 0.30 + k · 0.60 m.
 *
 * **The table binds.** Where a form states a `dLcs`, that value is the mark —
 * this construction is only ever the fallback for a form that states none
 * (delivered 2026-09-22), which is why nothing in the app calls it for a form
 * out of the tables above.
 *
 *   d = 2.272 · n − (l_t + g),   l_t = R · tan(w/2),  w = atan(1/n)
 *
 * `l_t` is the tangent — the delivered tables name the pair `l_t` and `l_t2`,
 * and `l_t2` is that tangent plus the straight piece the branch ends in, which
 * is what the switch end is measured from. The rule as it was handed over
 * (2026-09-21) subtracts the tangent alone: the same thing for a form whose
 * branch is one arc, and 6 m out for the 190 – 1:9. With `l_t2` it reproduces
 * ten of the fifteen stored values — 185 – 1:7 (2.70, the form AP 3.1 dropped),
 * 190 – 1:9, 300 – 1:9 and 300 – 1:9.4 (3.90), 500 – 1:12 (6.30), 760 – 1:15
 * (5.10), 760 – 1:18.5 (9.90), 2500 – 1:26.5 (12.90) and both inventory forms
 * (0.30).
 *
 * Five it does not reach, and there the delivered value stands: 190 – 1:7.5
 * (0.30, confirmed as an outlier — Entscheidung 20), 500 – 1:14 (6.30 against
 * 4.50), 760 – 1:14 (9.90 against 4.50), 1200 – 1:18.5 (11 against 9.90) and
 * 1200 – 1:19.277 (9.96 against 9.90, and 9.96 is not on the grid at all). The
 * first four look like a value copied from the primary form of the same radius
 * — which is exactly what the 2026-09-21 delivery corrected for 760 – 1:15 and
 * 1200 – 1:19.277.
 *
 * Below the grid's first step the result is that step: a mark that would sit
 * inside the switch is put as close to B1–B2 as the grid allows.
 */
export function switchMarkDistance(type) {
  const w = Math.atan(1 / type.ratio)
  const straight = (type.branch ?? [])
    .filter(section => section.type === 'straight')
    .reduce((sum, section) => sum + section.length, 0)
  const d = 2.272 * type.ratio - (type.R * Math.tan(w / 2) + straight)
  return Math.max(0.30, Math.round((d - 0.30) / 0.60) * 0.60 + 0.30)
}

// ── Crossings and crossing switches (AP 3.2) ─────────────────────────────────
//
// The crossing kinds are not turnouts: their two routes cross instead of parting,
// and their geometry is stated in their own terms. A crossing (Kr) is two
// straights at the crossing angle, and its body reaches from the crossing point
// to each of its four ends — that reach is the **tangent** `lt`, which the form
// states outright. A crossing switch (EKW/DKW) adds connecting curves between
// the ends on each side of the crossing point, tangential to both crossing legs,
// so its four ends are the tangent points at R·tan(α/2) instead; the EKW is
// built like the DKW with one curve left out.
//
// `ratio` is the crossing angle as a slope (1:9), `R` the radius of the
// connecting curves (absent for the plain crossing), `lt` the tangent [m],
// `speed` the permitted speed over it and `dLcs` the Weichenmarke — which for a
// crossing can be negative, because the two routes stand 2.272 m apart before
// the body ends. `minl` has no meaning here and stays absent.
//
// The nine plain crossings were delivered on 2026-09-21 as a table of tangents,
// which replaced the 1.85 m end distance the first two had been carried with:
// measured, `Kr 1:9` reaches 16.6155 m rather than 16.727 and `Kr 1:7.5`
// 13.2510 rather than 13.964. The end distance follows from the tangent —
// c = 2·lt·sin(α/2) — and reproduces every delivered c to half a millimetre,
// which is what says the table and this construction mean the same thing.
// Several of them are the crossing that two turnouts of one form make:
// 1:4.444 = 2 × 1:9, 1:3.683 = 2 × 1:7.5, 1:6.964 = 2 × 1:14,
// 1:3.224 = 2 × 1:6.6, 1:2.9 = 3 × 1:9.
// Two more were delivered on 2026-09-22 (Kr 1:14 and Kr 1:18.5), and the four
// crossing switches now state a speed per route (`routen`) instead of none at
// all: 100 km/h over the through route, 40 or 60 over the connecting curves.
//
// The two Bogenkreuzungsweichen of A02 (EBKW and DBKW 1:9 – 500.860, AP 3.4)
// are the one crossing kind whose legs are not straights: both are arcs on
// `Rk`, and their ends lie `lb` along them. Their connecting routes are a
// straight and — in the DBKW — an inner arc on `Ri`, so the form states no
// single `R` at all.
export const CROSSING_TYPES = FORMEN.filter(form => form.art === 'kreuzung')

/**
 * Any form — turnout or crossing, Regelform or Sonderbauform — looked up by its
 * label. The label is the key a saved project keeps, which is why the
 * catalogue states outright that a label is never renamed.
 */
export function switchTypeByLabel(label) {
  return FORMEN.find(form => form.label === label) ?? null
}

/** Length of the arc a form turns its frog angle through. */
export function switchArcLength(R, ratio) {
  return R * Math.atan(1 / ratio)
}

/**
 * Length of the through route of a switch form — the tangent polygon of its
 * branch, from the toe to the switch end. A bent switch keeps it: bending moves
 * no sleeper, it only lays the same length on the stem's curvature instead of
 * on a straight.
 *
 * Every arc section contributes the symmetric tangent construction
 * `2R·tan(α/2)` over the angle it turns through, and every straight section its
 * own length — the branch leaves the through route at the frog angle and runs
 * parallel to nothing, so a straight end piece pushes the switch end that much
 * further along. For a branch that is one arc this is the construction that was
 * here before, to the last digit; with the end pieces it gives the DB building
 * lengths (190 – 1:9 = 27.14 m, 500 – 1:14 = 44.94 m, 190 – 1:7.5 = 25.86 m).
 */
export function switchStraightLength(type) {
  // A symmetrical turnout's through route is no tangent polygon: it is the
  // branch's mirror image, the same arc to the other side, and as long.
  if (type.symmetric) return switchBranchLength(type)
  return switchBranchSections(type).reduce((sum, section) => (
    sum + (section.R == null
      ? section.length
      : 2 * section.R * Math.tan(section.length / (2 * section.R)))
  ), 0)
}

/**
 * The branch of a form as the sequence of sections it is built from — each
 * `{ type, R, length }`, with `R: null` for a straight one.
 *
 * Every form in the tables above is one arc from the toe to its frog angle, so
 * its sequence is that single arc and every helper here gives exactly the result
 * it gave when a form *was* one arc. A form may state a `branch` of its own
 * instead, which is what the sequence exists for: the forms that end in a
 * straight piece are written `[{ type:'arc', R }, { type:'straight', length }]`.
 */
export function switchBranchSections(type) {
  if (!type.branch) {
    // A symmetrical turnout parts into two arcs of the same radius, one to
    // each side, and the frog angle is what they make *between them* — so each
    // of them turns half of it. Its through route is that mirror image, not a
    // straight, which is why `symmetric` shortens both.
    const length = switchArcLength(type.R, type.ratio) / (type.symmetric ? 2 : 1)
    return [{ type: 'arc', R: type.R, length }]
  }
  return type.branch.map((section) => {
    if (section.type === 'straight') return { type: 'straight', R: null, length: section.length }
    const R = section.R ?? type.R
    return { type: 'arc', R, length: switchArcLength(R, section.ratio ?? type.ratio) }
  })
}

/** Length of the whole branch — how far from the toe the turnout's own geometry reaches. */
export function switchBranchLength(type) {
  return switchBranchSections(type).reduce((sum, section) => sum + section.length, 0)
}

/**
 * The form's branch as a chain of `{ length, signedR }`, signed by the side the
 * turnout diverges to — the shape switchBranchChain lays onto a stem.
 */
export function switchFormChain(type, side) {
  const sign = side === 'left' ? -1 : 1
  return switchBranchSections(type).map(section => ({
    length:  section.length,
    signedR: section.R == null ? null : sign * section.R,
  }))
}

/**
 * Below this curvature (R > 10 000 km) a route is straight for every purpose
 * here: over a turnout's length such an arc leaves its chord by under a micron.
 */
export const STRAIGHT_CURVATURE = 1e-7

/** A radius that is usable as one: finite, non-zero. Anything else is straight. */
export const asRadius = (r) => (Number.isFinite(r) && r !== 0 ? r : null)

/**
 * Branch radius of a bent switch — a switch form laid into a curved stem.
 *
 * Bending a turnout moves none of its sleepers, so both of its routes take the
 * stem's curvature on top of the one they already have: the curvatures add,
 * κ_branch = κ_stem + κ_form. With the project's sign convention (positive =
 * right-hand curve) that single formula covers both bauforms — the inner-bent
 * switch (IBW), where stem and branch turn the same way and the branch comes
 * out tighter than the form, and the outer-bent one (ABW), where they turn
 * apart and the branch opens up, straightening out exactly where the stem
 * radius equals the form's.
 *
 * The tangent angle between the two routes stays the form's own α at every
 * station, so a bent 1:9 is still a 1:9.
 *
 * @param {number}  formSignedR  the form's branch radius, signed by the side
 * @param {?number} stemSignedR  stem radius in the direction the branch leaves
 *                               the toe; null/0 for a straight stem
 * @returns {?number} signed branch radius, or null when the branch is straight
 */
export function branchRadius(formSignedR, stemSignedR) {
  const k = (stemSignedR ? 1 / stemSignedR : 0) + 1 / formSignedR
  return Math.abs(k) < STRAIGHT_CURVATURE ? null : 1 / k
}

/**
 * Which bauform a stem radius produces, from the two radii branchRadius relates:
 * 'plain' for the unbent switch, 'ibw' where branch and stem turn the same way
 * (inner-bent, the branch tighter than the form), 'abw' where they turn apart
 * (outer-bent, the branch opened up) and 'abw_straight' for that form's
 * limiting case, the stem radius at which the branch comes out straight.
 *
 * A symmetrical turnout is none of these — its two routes are mirror images of
 * the same form, never a stem the form was laid onto — so a caller that has one
 * answers 'sym' before it ever asks this. This function does not: it works from
 * radii alone and has none to tell a mirror pair from an ordinary ABW.
 */
export function bauform(stemSignedR, branchSignedR) {
  if (!stemSignedR) return 'plain'
  if (branchSignedR == null) return 'abw_straight'
  return Math.sign(stemSignedR) === Math.sign(branchSignedR) ? 'ibw' : 'abw'
}
