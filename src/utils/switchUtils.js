import { wgs84ToUTM, utmToWgs84 } from './coordinateUtils'
import { reverseElement, bearingAfterUtm, projectOnArcUtm } from './elementUtils'
import {
  transitionPointAtUtm, transitionBearingAtUtm, sampleTransitionUtm, projectOnTransitionUtm,
  clothoidRadiusAt, curvatureOf, radiusOfCurvature,
} from './clothoidUtils'
import { elementBelongsToSwitch } from './switchModel'

// minl = minimum intermediate straight between two turnouts in a crossover [m].
// `branch` states a form whose branch is more than the one arc: the sections it
// is built from, in order from the toe (see switchBranchSections). A form
// without one is that single arc, which is what most of them are.
//
// Primary table — checked first by the switch-connection calculation. Within a
// speed the flatter form comes first: the sharper one is what the connection
// falls back to when the flatter one cannot reach its minl.
export const SWITCH_TYPES = [
  { label: '190 – 1:9',     R: 190,  ratio: 9,    speed: 40,  dLcs: 3.9,  minl: 6,
    branch: [{ type: 'arc' }, { type: 'straight', length: 6.092 }] },
  { label: '190 – 1:7.5',   R: 190,  ratio: 7.5,  speed: 40,  dLcs: 0.30, minl: 6,
    branch: [{ type: 'arc' }, { type: 'straight', length: 0.640 }] },
  { label: '300 – 1:9',     R: 300,  ratio: 9,    speed: 50,  dLcs: 3.9,  minl: 5  },
  { label: '500 – 1:12',    R: 500,  ratio: 12,   speed: 60,  dLcs: 6.3,  minl: 6  },
  { label: '760 – 1:14',    R: 760,  ratio: 14,   speed: 80,  dLcs: 9.9,  minl: 12 },
  { label: '1200 – 1:18.5', R: 1200, ratio: 18.5, speed: 100, dLcs: 11,   minl: 15 },
  { label: '2500 – 1:26.5', R: 2500, ratio: 26.5, speed: 130, dLcs: 12.9, minl: 26 },
]

// First fallback — used when a primary type cannot reach its minl for the spacing.
export const SWITCH_TYPES_ALT1 = [
  { label: '300 – 1:9.4',     R: 300,  ratio: 9.4,    speed: 50,  dLcs: 3.9,  minl: 5  },
  { label: '500 – 1:14',      R: 500,  ratio: 14,     speed: 60,  dLcs: 6.3,  minl: 6,
    branch: [{ type: 'arc' }, { type: 'straight', length: 9.274 }] },
  { label: '760 – 1:15',      R: 760,  ratio: 15,     speed: 80,  dLcs: 9.9,  minl: 12,
    branch: [{ type: 'arc' }, { type: 'straight', length: 3.606 }] },
  { label: '1200 – 1:19.277', R: 1200, ratio: 19.277, speed: 100, dLcs: 11,   minl: 15 },
]

// Second fallback — used when both the primary and ALT1 type fail.
export const SWITCH_TYPES_ALT2 = [
  { label: '760 – 1:18.5', R: 760, ratio: 18.5, speed: 80, dLcs: 9.9, minl: 12,
    branch: [{ type: 'arc' }, { type: 'straight', length: 11.883 }] },
]

// ── Crossings and crossing switches (AP 3.2) ─────────────────────────────────
//
// The crossing kinds are not turnouts: their two routes cross instead of parting,
// and their geometry is stated in their own terms. A crossing (Kr) is two
// straights at the crossing angle; its body reaches from the crossing point to
// the four ends, each as far as the end distance states — 1.85 m between the two
// ends on a side, the same measure a turnout's switch end has. A crossing switch
// (EKW/DKW) adds connecting curves between the ends on each side of the crossing
// point, tangential to both crossing legs, so its four ends are the tangent
// points at R·tan(α/2) from the crossing point; the EKW is built like the DKW
// with one curve left out.
//
// `ratio` is the crossing angle as a slope (1:9), `R` the radius of the
// connecting curves (null for the plain crossing), `endDistance` the distance
// between the two ends on one side [m] — the measure the crossing's own body is
// built from. `dLcs` and `minl` were not supplied with the dimensions and stay
// absent; nothing that builds a crossing reads them.
export const CROSSING_TYPES = [
  { kind: 'crossing',     label: 'Kr 1:9',      ratio: 9,   endDistance: 1.85 },
  { kind: 'crossing',     label: 'Kr 1:7.5',    ratio: 7.5, endDistance: 1.85 },
  { kind: 'single_slip',  label: 'EKW 1:9 – 190',  ratio: 9, R: 190,  endDistance: 1.85 },
  { kind: 'single_slip',  label: 'EKW 1:9 – 500',  ratio: 9, R: 500,  endDistance: 1.85 },
  { kind: 'double_slip',  label: 'DKW 1:9 – 190',  ratio: 9, R: 190,  endDistance: 1.85 },
  { kind: 'double_slip',  label: 'DKW 1:9 – 500',  ratio: 9, R: 500,  endDistance: 1.85 },
]

/** Any switch form — turnout table, fallback or crossing — looked up by its label. */
export function switchTypeByLabel(label) {
  return [...SWITCH_TYPES, ...SWITCH_TYPES_ALT1, ...SWITCH_TYPES_ALT2, ...CROSSING_TYPES]
    .find(t => t.label === label) ?? null
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
    return [{ type: 'arc', R: type.R, length: switchArcLength(type.R, type.ratio) }]
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
 */
export function bauform(stemSignedR, branchSignedR) {
  if (!stemSignedR) return 'plain'
  if (branchSignedR == null) return 'abw_straight'
  return Math.sign(stemSignedR) === Math.sign(branchSignedR) ? 'ibw' : 'abw'
}

// ── Routes ──────────────────────────────────────────────────────────────────
//
// A switch route — the through route or the branch — as it runs away from the
// point it starts at: { length, r1, r2 }, the signed radius at either end (null
// = straight). Where both ends agree the route is a straight or an arc, as on
// every switch on a straight or a curve. Where they differ its curvature runs
// linearly between them: a clothoid, which is what both routes of a turnout
// laid into a clothoid are (see switchBranchRoute).
//
// A turnout that reaches over several elements of the track it lies in has
// routes of several such pieces, one per element: a chain, the pieces in the
// order they run from the toe. A single route is a chain of one, and every
// chain helper below gives exactly the single route's result for one.

/** A route from { length, r1, r2 }, or from { length, radius } for a constant one. */
function toRoute(route) {
  if ('r1' in route || 'r2' in route) {
    const r1 = asRadius(route.r1)
    return { length: route.length, r1, r2: 'r2' in route ? asRadius(route.r2) : r1 }
  }
  const r = asRadius(route.radius)
  return { length: route.length, r1: r, r2: r }
}

/** A chain from a route or from a list of routes. */
function toChain(route) {
  return Array.isArray(route) ? route.map(toRoute) : [toRoute(route)]
}

const negR = (r) => (r == null ? null : -r)

/** Does the curvature change along the route — is it a clothoid? */
export const switchRouteVaries = (route) => route.r1 !== route.r2

/** Signed radius of a route at `s` from its start. */
export function switchRouteRadiusAt(route, s) {
  return switchRouteVaries(route) ? clothoidRadiusAt(route.r1, route.r2, route.length, s) : route.r1
}

/** Point of a route in the plane at `s` from its start — its end by default. */
export function switchRoutePointUtm(originUtm, bearing, route, s = route.length) {
  return switchRouteVaries(route)
    ? transitionPointAtUtm(originUtm, bearing, route.length, route.r1, route.r2, 'clothoid', s)
    : utmEndRoute(originUtm, bearing, s, route.r1)
}

/** Tangent bearing of a route at `s` from its start — at its end by default. */
export function switchRouteBearingAt(bearing, route, s = route.length) {
  return switchRouteVaries(route)
    ? transitionBearingAtUtm(bearing, route.length, route.r1, route.r2, 'clothoid', s)
    : bearingAfterUtm(bearing, s, route.r1)
}

/** The piece of a route from `a` to `b` along it; a clothoid keeps its parameter. */
export function switchRouteSlice(route, a, b) {
  if (!switchRouteVaries(route)) return { length: b - a, r1: route.r1, r2: route.r1 }
  return { length: b - a, r1: switchRouteRadiusAt(route, a), r2: switchRouteRadiusAt(route, b) }
}

/**
 * Branch of a switch whose through route, running from the toe, is `stem`;
 * `length` is how far along it the branch is wanted.
 *
 * The rule branchRadius states for one radius holds at every station: bending
 * moves no sleeper, so the branch's curvature is the stem's there plus the
 * form's, κ_branch(s) = κ_stem(s) + κ_form. On a stem of constant curvature that
 * is branchRadius itself. On a clothoid stem the sum still runs linearly in s,
 * at the stem's own rate — so the branch is a clothoid of the stem's parameter,
 * and its two end radii say all of it. Its far end lies `length` from the toe,
 * which need not be where the stem ends. Those radii are kept as exact as the
 * stem's pieces are (see radiusOfCurvature), since they are element data.
 */
export function switchBranchRoute(formSignedR, stem, length) {
  if (!switchRouteVaries(stem)) {
    // A straight section of the form adds no curvature of its own, so over it
    // the branch takes the stem's: laid in a curve, a straight end piece curves
    // with the track it is bent into.
    const r = formSignedR ? branchRadius(formSignedR, stem.r1) : stem.r1
    return { length, r1: r, r2: r }
  }
  const kForm = formSignedR ? 1 / formSignedR : 0
  const k1    = curvatureOf(stem.r1)
  const kEnd  = k1 + (curvatureOf(stem.r2) - k1) * length / stem.length
  return { length, r1: radiusOfCurvature(k1 + kForm), r2: radiusOfCurvature(kEnd + kForm) }
}

/**
 * Through route of a switch record, `length` long, as it runs from the toe,
 * for a record whose tracks do not state it (see switchRoutesFromTracks):
 * `mainRadius` is the stem radius at the toe and `mainRadiusEnd` the one at the
 * switch end. Neither set: the through route is straight.
 */
export function switchStemRoute(sw, length) {
  const r1 = asRadius(sw.mainRadius)
  return { length, r1, r2: sw.mainRadiusEnd !== undefined ? asRadius(sw.mainRadiusEnd) : r1 }
}

/** The route an element describes, in its own running direction. */
export function switchElementRoute(el) {
  return el.elementType === 2
    ? toRoute({ length: el.length, r1: el.r1 ?? null, r2: el.r2 ?? null })
    : toRoute({ length: el.length, radius: el.radius })
}

// ── Chains ──────────────────────────────────────────────────────────────────

/**
 * Within this [m] two lengths of a route are the same: lengths added up from
 * elements miss the form's own by float noise.
 */
export const SWITCH_CHAIN_TOL = 1e-3

/**
 * The first `length` metres of a chain. A chain short of that by no more than
 * SWITCH_CHAIN_TOL is made up on its last piece, since the form's dimension is
 * the one a turnout has; one shorter still is returned as it is.
 */
export function switchChainTo(chain, length) {
  const out = []
  let before = 0            // length of the pieces taken whole
  for (const piece of toChain(chain)) {
    const left = length - before
    if (left <= SWITCH_CHAIN_TOL && out.length) break
    if (piece.length < left) {
      out.push(piece)
      before += piece.length
    } else {
      out.push(switchRouteSlice(piece, 0, left))
      return out
    }
  }
  const short = length - before
  if (out.length && short > 0 && short <= SWITCH_CHAIN_TOL) {
    const last = out.pop()
    out.push(switchRouteSlice(last, 0, length - (before - last.length)))
  }
  return out
}

/**
 * Every piece of a chain placed in the plane from `originUtm` on `bearing`: the
 * piece with its station `s0` along the chain, its two ends and tangents.
 */
export function switchChainSegmentsUtm(originUtm, bearing, chain) {
  const segments = []
  let startUtm = originUtm
  let b = bearing
  let s0 = 0
  for (const piece of toChain(chain)) {
    const endUtm     = switchRoutePointUtm(startUtm, b, piece)
    const endBearing = switchRouteBearingAt(b, piece)
    segments.push({ ...piece, s0, startUtm, endUtm, bearing: b, endBearing })
    startUtm = endUtm
    b = endBearing
    s0 += piece.length
  }
  return segments
}

/** Point of a chain in the plane at `s` from its start — its end by default. */
export function switchChainPointUtm(originUtm, bearing, chain, s = null) {
  const segments = switchChainSegmentsUtm(originUtm, bearing, chain)
  if (s == null) return segments[segments.length - 1].endUtm
  const i   = segments.findIndex(seg => s <= seg.s0 + seg.length)
  const seg = segments[i < 0 ? segments.length - 1 : i]
  return switchRoutePointUtm(seg.startUtm, seg.bearing, seg, s - seg.s0)
}

/** Tangent bearing of a chain at `s` from its start — at its end by default. */
export function switchChainBearingAt(bearing, chain, s = null) {
  const pieces = toChain(chain)
  let b  = bearing
  let s0 = 0
  for (const [i, piece] of pieces.entries()) {
    if (s != null && (s <= s0 + piece.length || i === pieces.length - 1)) {
      return switchRouteBearingAt(b, piece, s - s0)
    }
    b = switchRouteBearingAt(b, piece)
    s0 += piece.length
  }
  return b
}

/** Below this an overlap is float noise at a section boundary, not a piece [m]. */
const SLICE_EPS = 1e-9

/**
 * The pieces of a chain between the stations `a` and `b` along it, cut where the
 * chain's own pieces part. A clothoid piece keeps its parameter
 * (switchRouteSlice), so a piece of one is a clothoid of the same.
 */
export function switchChainSlice(chain, a, b) {
  const out = []
  let s0 = 0
  for (const piece of toChain(chain)) {
    const s1   = s0 + piece.length
    const from = Math.max(a, s0)
    const to   = Math.min(b, s1)
    if (to - from > SLICE_EPS) out.push(switchRouteSlice(piece, from - s0, to - s0))
    s0 = s1
  }
  return out
}

/**
 * Branch of a switch whose through route, running from the toe, is the chain
 * `stem`. The form is given as its own chain (switchFormChain) — one entry per
 * section, each with its length and signed radius — and each piece of the branch
 * takes the curvature of both: κ_branch = κ_stem + κ_form, as switchBranchRoute
 * does for one.
 *
 * So the branch parts wherever *either* side parts: where the elements under the
 * turnout part, and where the form's sections do. A form of a single arc — every
 * one the tables hold — has no interior boundary of its own, and the branch then
 * parts exactly where the stem's elements do.
 */
export function switchBranchChain(formChain, stem) {
  const sections = Array.isArray(formChain) ? formChain : [formChain]
  const total    = sections.reduce((sum, section) => sum + section.length, 0)
  // Taken to the form's own dimension first, so a stem chain that adds up a hair
  // short of it (float noise off the elements) is made up on its last piece
  // rather than leaving the branch short.
  const onStem = switchChainTo(stem, total)
  const out = []
  let s = 0
  for (const section of sections) {
    for (const piece of switchChainSlice(onStem, s, s + section.length)) {
      out.push(switchBranchRoute(section.signedR, piece, piece.length))
    }
    s += section.length
  }
  return out
}

/**
 * Bauform of a turnout from its two chains, both running from the toe. It is
 * unbent only where the stem is straight throughout; otherwise it is the bent
 * form it has where its stem is tightest, so a turnout that starts on a straight
 * and ends in a curve counts as the bent one it mostly is. The branch there is
 * the stem plus the form, and the toe gives the form: κ_form = κ_branch(0) −
 * κ_stem(0).
 */
export function switchChainBauform(stem, branch) {
  const s = toChain(stem)
  const b = toChain(branch)
  let tightest = null
  for (const piece of s) {
    for (const r of [piece.r1, piece.r2]) {
      if (r != null && (tightest == null || Math.abs(r) < Math.abs(tightest))) tightest = r
    }
  }
  if (tightest == null) return 'plain'
  if (tightest === s[0].r1) return bauform(s[0].r1, b[0].r1)
  const k = 1 / tightest + curvatureOf(b[0].r1) - curvatureOf(s[0].r1)
  return bauform(tightest, Math.abs(k) < STRAIGHT_CURVATURE ? null : 1 / k)
}

// ── Pure UTM helpers ────────────────────────────────────────────────────────

export function utmEndStraight(utm, bearing, length) {
  const rad = bearing * Math.PI / 180
  return {
    easting:  utm.easting  + length * Math.sin(rad),
    northing: utm.northing + length * Math.cos(rad),
    zone: utm.zone,
  }
}

function utmEndCurved(utm, bearing, arcLength, signedR) {
  const absR = Math.abs(signedR)
  const rad  = bearing * Math.PI / 180
  const sgn  = signedR >= 0 ? -1 : 1
  const tE   = Math.sin(rad)
  const tN   = Math.cos(rad)
  const cx   = utm.easting  + sgn * absR * (-tN)
  const cy   = utm.northing + sgn * absR * tE
  const a1   = Math.atan2(utm.northing - cy, utm.easting - cx)
  const a2   = a1 + sgn * arcLength / absR
  return {
    easting:  cx + absR * Math.cos(a2),
    northing: cy + absR * Math.sin(a2),
    zone: utm.zone,
  }
}

/**
 * Step [m] a switch route's polyline is drawn with. A turnout is only tens of
 * metres long and is always looked at from close up, so its routes are stepped
 * at a fixed distance rather than by the sagitta a whole track is drawn with:
 * at a 500 m radius that rule gives a 42 m branch two segments, and the body
 * then reads as a kink instead of a curve.
 */
const SWITCH_STEP = 2

/** Segments such a route gets — one rule for map, preview and plan export, so
 *  all three draw the same curve. A straight is its two ends; a route curved
 *  at either end (a clothoid may start or end straight) is stepped. */
export function switchRouteSegments(length, signedR, signedREnd = signedR) {
  return signedR || signedREnd ? Math.max(2, Math.ceil(length / SWITCH_STEP)) : 1
}

/** Simpson sub-intervals per step of a clothoid route — puts every point on the curve. */
const ROUTE_SUBDIV = 8

/** Plane points of a clothoid route, stepped like every other switch route. */
function clothoidRoutePoints(originUtm, bearing, route) {
  const n = switchRouteSegments(route.length, route.r1, route.r2)
  return sampleTransitionUtm(originUtm, bearing, route.length, route.r1, route.r2, 'clothoid',
    { steps: n, subdiv: ROUTE_SUBDIV })
}

function utmArcCoords(startUtm, bearing, arcLength, signedR) {
  const absR = Math.abs(signedR)
  const rad  = bearing * Math.PI / 180
  const sgn  = signedR >= 0 ? -1 : 1
  const tE   = Math.sin(rad)
  const tN   = Math.cos(rad)
  const cx   = startUtm.easting  + sgn * absR * (-tN)
  const cy   = startUtm.northing + sgn * absR * tE
  const a1   = Math.atan2(startUtm.northing - cy, startUtm.easting - cx)
  const sweep = sgn * arcLength / absR
  const n = switchRouteSegments(arcLength, signedR)
  const coords = []
  for (let i = 0; i <= n; i++) {
    const angle = a1 + (i / n) * sweep
    coords.push(utmToWgs84(cx + absR * Math.cos(angle), cy + absR * Math.sin(angle), startUtm.zone))
  }
  return coords
}

/** End of a route of `length` from `utm`: an arc on `signedR`, a straight without one. */
function utmEndRoute(utm, bearing, length, signedR) {
  return signedR ? utmEndCurved(utm, bearing, length, signedR) : utmEndStraight(utm, bearing, length)
}

/**
 * Polyline (WGS84) of such a route. It starts at the caller's own WGS84 twin of
 * the origin, so the join with what comes before is exact — the plane point is
 * never sent through WGS84 and back. A clothoid also ends on the caller's twin
 * of its end.
 */
function routeCoords(originUtm, originWgs, bearing, route, endWgs) {
  if (switchRouteVaries(route)) {
    const pts = clothoidRoutePoints(originUtm, bearing, route)
    return [originWgs, ...pts.slice(1, -1).map(([e, n]) => utmToWgs84(e, n, originUtm.zone)), endWgs]
  }
  return route.r1
    ? [originWgs, ...utmArcCoords(originUtm, bearing, route.length, route.r1).slice(1)]
    : [originWgs, endWgs]
}

/**
 * Polyline (WGS84) of a chain, and its segments (switchChainSegmentsUtm) each
 * with its own polyline `coords` — the one an element built from that piece is
 * drawn with. Each piece starts on the last vertex of the one before, so the
 * whole runs through without a gap.
 */
function chainGeometry(originUtm, originWgs, bearing, chain, endWgs) {
  const segments = switchChainSegmentsUtm(originUtm, bearing, chain)
  const coords = []
  segments.forEach((seg, i) => {
    const fromWgs = i === 0 ? originWgs : coords[coords.length - 1]
    const toWgs   = i === segments.length - 1
      ? endWgs
      : utmToWgs84(seg.endUtm.easting, seg.endUtm.northing, originUtm.zone)
    seg.coords = routeCoords(seg.startUtm, fromWgs, seg.bearing, seg, toWgs)
    coords.push(...(i === 0 ? seg.coords : seg.coords.slice(1)))
  })
  return { coords, segments }
}

/**
 * How far from the turnout its designation stands [m], measured from the centre
 * of area of the body (fillCoords) — the one point that is the middle of the
 * whole turnout however its two routes run, so the same number means the same
 * gap for a 1:7 and a 1:26.5. The two routes' radii are written on the elements
 * themselves, as every other element's values are.
 */
const SWITCH_LABEL_OFFSET = 2

/**
 * Polyline (WGS84) running parallel to a switch route at `offset` metres, left
 * of the running direction for a positive offset.
 */
function routeOffsetCoords(originUtm, bearing, route, offset, epsg) {
  const n = switchRouteSegments(route.length, route.r1, route.r2)
  const pts = switchRouteVaries(route) ? clothoidRoutePoints(originUtm, bearing, route) : null
  const coords = []
  for (let i = 0; i <= n; i++) {
    const s = route.length * i / n
    const p = pts
      ? { easting: pts[i][0], northing: pts[i][1] }
      : utmEndRoute(originUtm, bearing, s, route.r1)
    const b = switchRouteBearingAt(bearing, route, s) * Math.PI / 180
    coords.push(utmToWgs84(p.easting - offset * Math.cos(b), p.northing + offset * Math.sin(b), epsg))
  }
  return coords
}

/** The same along a chain, piece by piece. */
function chainOffsetCoords(originUtm, bearing, chain, offset, epsg) {
  return switchChainSegmentsUtm(originUtm, bearing, chain).flatMap((seg, i) => {
    const c = routeOffsetCoords(seg.startUtm, seg.bearing, seg, offset, epsg)
    return i === 0 ? c : c.slice(1)
  })
}

/** Plane points of one route piece, stepped like everything else here. */
function routePointsPlane(originUtm, bearing, route) {
  if (switchRouteVaries(route)) return clothoidRoutePoints(originUtm, bearing, route)
  const n = switchRouteSegments(route.length, route.r1)
  const pts = []
  for (let i = 0; i <= n; i++) {
    const p = utmEndRoute(originUtm, bearing, route.length * i / n, route.r1)
    pts.push([p.easting, p.northing])
  }
  return pts
}

/**
 * Points ([E, N]) of a switch route — one piece or a chain — in the plane,
 * stepped like everything else here: map symbol and plan export draw a turnout
 * from the same points.
 */
export function switchRoutePointsUtm(originUtm, bearing, route) {
  if (!Array.isArray(route)) return routePointsPlane(originUtm, bearing, route)
  return switchChainSegmentsUtm(originUtm, bearing, route).flatMap((seg, i) => {
    const pts = routePointsPlane(seg.startUtm, seg.bearing, seg)
    return i === 0 ? pts : pts.slice(1)
  })
}

/** Offset of a point from one route piece (see projectOnArcUtm for the frame). */
function projectOnPiece(startUtm, bearing, piece, pointUtm) {
  return switchRouteVaries(piece)
    ? projectOnTransitionUtm(startUtm, pointUtm, bearing, piece.length, piece.r1, piece.r2)
    : projectOnArcUtm(startUtm, pointUtm, bearing, piece.r1)
}

/**
 * Offset (`perp`, positive to the right) of a point beside a chain, read off the
 * piece it lies beside: the one its foot falls within, the nearest where none.
 */
function projectOnChainUtm(originUtm, bearing, chain, pointUtm) {
  let best = null
  for (const seg of switchChainSegmentsUtm(originUtm, bearing, chain)) {
    const { along, perp } = projectOnPiece(seg.startUtm, seg.bearing, seg, pointUtm)
    const miss = along < 0 ? -along : Math.max(0, along - seg.length)
    if (!best || miss < best.miss || (miss === best.miss && Math.abs(perp) < Math.abs(best.perp))) {
      best = { miss, perp }
    }
  }
  return best
}

/**
 * Centre of area of a closed ring of plane points. A ring that encloses nothing
 * — a turnout drawn with a zero-length route — falls back on its vertex mean,
 * which for that shape is the same place.
 *
 * Summed relative to the ring's first point, which is not a nicety: a turnout's
 * body covers some 25 m² and the shoelace terms over absolute eastings and
 * northings run to 1e12, so summing those directly loses the very metres the
 * centre is wanted to. Shifted to the toe the terms stay the size of the body.
 */
function ringCentroid(ring) {
  const [ox, oy] = ring[0]
  let a = 0, cx = 0, cy = 0
  for (let i = 0; i < ring.length - 1; i++) {
    const x1 = ring[i][0] - ox,     y1 = ring[i][1] - oy
    const x2 = ring[i + 1][0] - ox, y2 = ring[i + 1][1] - oy
    const f = x1 * y2 - x2 * y1
    a += f; cx += (x1 + x2) * f; cy += (y1 + y2) * f
  }
  if (Math.abs(a) < 1e-9) {
    return [ring.reduce((s, p) => s + p[0], 0) / ring.length,
      ring.reduce((s, p) => s + p[1], 0) / ring.length]
  }
  return [ox + cx / (3 * a), oy + cy / (3 * a)]
}

/**
 * What a turnout's lettering needs from its geometry:
 *
 * `labelCoords` — the path (WGS84) its designation is written along: the through
 * route, shifted until it stands SWITCH_LABEL_OFFSET from the body's centre of
 * area, on the side facing away from that centre.
 *
 * `bodyCentre` — that centre itself (WGS84). The two routes' radii are written
 * along the elements they belong to, and a label hangs to one side of its line;
 * on one of the two routes that side is the one the body fills. Handed this
 * point, the label renderer puts the text under its line instead of over it
 * wherever the body would be behind it, which is the only thing that decides
 * per turnout — the routes' own directions do not, since either element may
 * have been stored running the other way.
 *
 * Both routes are given as they run from the toe, so which way is "away" comes
 * out of the geometry rather than out of the direction an element was stored in.
 * Each is a chain, a route ({ length, r1, r2 }) or, for a constant one,
 * { length, radius }.
 */
export function switchLabelGeometry(toeUtm, bearing, throughRoute, branchRoute, epsg) {
  const through = toChain(throughRoute)
  const branch  = toChain(branchRoute)
  const centre = ringCentroid(switchFillRing(
    switchRoutePointsUtm(toeUtm, bearing, through),
    switchRoutePointsUtm(toeUtm, bearing, branch)))
  const centreUtm = { easting: centre[0], northing: centre[1], zone: epsg }

  // Where the centre sits beside a route (positive to the left of the running
  // direction), and from that the offset a label needs to stand `d` from it on
  // the route's far side.
  const away = (chain, d) => {
    const { perp } = projectOnChainUtm(toeUtm, bearing, chain, centreUtm)
    const c = -perp
    return c - Math.sign(c || 1) * d
  }
  return {
    labelCoords: chainOffsetCoords(toeUtm, bearing, through,
      away(through, SWITCH_LABEL_OFFSET), epsg),
    bodyCentre: utmToWgs84(centre[0], centre[1], epsg),
  }
}

/**
 * The body of a switch as a closed ring: from the toe along the through route
 * to its end, across to the branch end and back along the branch to the toe.
 * Both polylines are passed as they run *from the toe*, so the ring closes on
 * itself — the reversed branch ends where the through route began — and the
 * branch side keeps its curvature instead of being cut off as a chord.
 *
 * Every switch symbol in the app is assembled here: the four dialogs that
 * create one, the OSRD import, the reload that rebuilds it from the tracks and
 * the plan export's plane twin. That is what makes a turnout look the same
 * whichever of them produced it. Points may be WGS84 or plane pairs; the ring
 * only ever reorders what it is given.
 */
export function switchFillRing(throughFromToe, branchFromToe) {
  return [...throughFromToe, ...[...branchFromToe].reverse()]
}

/**
 * LCS marker line of a switch in the plane: a 4.6 m line parallel to B1–B2,
 * offset `dLcs` to the side facing away from A. Ports are [easting, northing];
 * the result is a pair of such points.
 */
export function lcsLineUtm(portA, portB1, portB2, dLcs) {
  const [b1e, b1n] = portB1
  const [b2e, b2n] = portB2
  const [ae,  an ] = portA
  const dxB = b2e - b1e, dyB = b2n - b1n
  const lenB = Math.hypot(dxB, dyB)
  if (!(lenB > 0) || !(dLcs >= 0)) return null
  const dirE = dxB / lenB, dirN = dyB / lenB
  const perpE = -dirN, perpN = dirE          // 90° CCW rotation
  const mE = (b1e + b2e) / 2, mN = (b1n + b2n) / 2
  const awayDot = perpE * (mE - ae) + perpN * (mN - an)
  const sE = awayDot >= 0 ? perpE : -perpE   // signed perp away from A
  const sN = awayDot >= 0 ? perpN : -perpN
  const ctrE = mE + dLcs * sE, ctrN = mN + dLcs * sN
  const half = 4.6 / 2
  return [
    [ctrE - half * dirE, ctrN - half * dirN],
    [ctrE + half * dirE, ctrN + half * dirN],
  ]
}

/** The same marker as WGS84, for the map display. */
export function lcsLine(portA, portB1, portB2, dLcs, zone) {
  const line = lcsLineUtm(portA, portB1, portB2, dLcs)
  return line && line.map(([e, n]) => utmToWgs84(e, n, zone))
}

/**
 * The elements a route of a switch lies on, oriented away from its node: from
 * the end of the port's track that meets the switch, as long as they are marked
 * as that route of that switch and until they make up `length` (without one,
 * just the first). `first` takes the element at the port whatever its marks —
 * a branch track begins with its branch however old the record is.
 */
function routeElements(sw, trackById, port, route, length, { first = false } = {}) {
  const track    = trackById[sw[`port${port}_trackId`]]
  const endpoint = sw[`port${port}_endpoint`]
  const els      = track?.elements ?? []
  if (!els.length || (endpoint !== 'BEGIN' && endpoint !== 'END')) return []
  const ordered = endpoint === 'END' ? [...els].reverse() : els
  const out = []
  let total = 0
  for (const el of ordered) {
    if (length == null ? out.length > 0 : total >= length - SWITCH_CHAIN_TOL) break
    const mine = el.switchBranch
      && (!el.switchRoute || el.switchRoute === route)
      && elementBelongsToSwitch(el, sw)
    if (!mine && !(first && out.length === 0)) break
    if (!(el.length > 0)) break
    out.push(endpoint === 'END' ? reverseElement(el) : el)
    total += el.length
  }
  return out
}

/**
 * The routes of a crossing kind as its tracks state them: both legs read from
 * the port each route ends at — `main` from the elements at C, `cross` from the
 * ones at D — each as a chain running away from the crossing point, over as
 * many elements as the form's half-length reaches. The crossing point is the
 * middle of both: the first elements' start nodes coincide there.
 *
 * Returns { type, epsg, centre, mainBearing, crossBearing, main, cross } — the
 * two chains, each running from the crossing point out to its port — or null
 * where either leg or the form cannot be resolved.
 */
export function crossingRoutesFromTracks(sw, trackById) {
  const type = switchTypeByLabel(sw.label)
  if (!type || type.R == null && type.endDistance == null) return null
  const half = crossingEndDistance(type)

  const mainEls  = routeElements(sw, trackById, 'C', 'main', half)
  const crossEls = routeElements(sw, trackById, 'D', 'cross', half)
  const mainFirst = mainEls[0], crossFirst = crossEls[0]
  if (!mainFirst || !crossFirst || !mainFirst.startNode || !crossFirst.startNode) return null
  // Both legs begin at the crossing point; a record whose tracks disagree
  // there by more than a joint is not one the geometry can be read back from.
  const epsg = trackById[sw.portC_trackId]?.epsg
  if (epsg == null) return null
  if (Math.hypot(mainFirst.startNode[0] - crossFirst.startNode[0],
    mainFirst.startNode[1] - crossFirst.startNode[1]) > SWITCH_CHAIN_TOL) return null

  return {
    type, epsg,
    centre: { easting: mainFirst.startNode[0], northing: mainFirst.startNode[1], zone: epsg },
    mainBearing: mainFirst.bearing,
    crossBearing: crossFirst.bearing,
    main:  switchChainTo(mainEls.map(switchElementRoute), half),
    cross: switchChainTo(crossEls.map(switchElementRoute), half),
  }
}

/**
 * The two routes of a switch as its tracks state them, both as chains running
 * from the toe: the branch from the elements at port B1, the through route from
 * the marked elements at port B2 — the stem the turnout lies on, over as many
 * elements as it reaches across. A record whose tracks carry no such marks (an
 * import, or one from before the through route was marked) falls back on its
 * stem radii (switchStemRoute). The switch form named by `label` gives the
 * through length, so the symbol keeps the turnout's own dimensions whatever the
 * tracks do later; a record whose label no longer resolves falls back on the
 * branch's own tangent length.
 *
 * Returns { type, epsg, node, bearing, mainLen, stem, branch, branchEnd,
 * branchStartWgs, branchEndWgs } — node and bearing of the toe, branchEnd the
 * branch's far node [E, N] — or null where the branch or the form cannot be
 * resolved.
 */
export function switchRoutesFromTracks(sw, trackById) {
  const branchTrack = trackById[sw.portB1_trackId]
  const type = switchTypeByLabel(sw.label)
  const branchEls = routeElements(sw, trackById, 'B1', 'branch',
    type ? switchBranchLength(type) : null, { first: true })
  const first = branchEls[0]
  if (!first || !(first.length > 0) || !first.startNode || !first.endNode) return null
  const last = branchEls[branchEls.length - 1]
  if (!last.endNode) return null

  const epsg = branchTrack.epsg
  // Through route length: the form's, so a bent switch (whose branch element
  // carries the *combined* radius) still gets its own dimension.
  const absR    = Math.abs(first.radius ?? 0)
  const mainLen = type ? switchStraightLength(type)
    : absR > 0 ? 2 * absR * Math.tan(first.length / (2 * absR))
      : null
  if (mainLen == null) return null

  const node    = { easting: first.startNode[0], northing: first.startNode[1], zone: epsg }
  const stemEls = routeElements(sw, trackById, 'B2', 'main', mainLen)
  const onNode  = stemEls.length > 0 && Array.isArray(stemEls[0].startNode)
    && Math.hypot(stemEls[0].startNode[0] - node.easting, stemEls[0].startNode[1] - node.northing)
      <= SWITCH_CHAIN_TOL
  const firstCoords = first.geometry?.coordinates ?? []
  const lastCoords  = last.geometry?.coordinates ?? []
  return {
    type, epsg, node, bearing: first.bearing, mainLen,
    stem: onNode
      ? switchChainTo(stemEls.map(switchElementRoute), mainLen)
      : [switchStemRoute(sw, mainLen)],
    branch: branchEls.map(switchElementRoute),
    branchEnd: last.endNode,
    branchStartWgs: firstCoords.length >= 2 ? firstCoords[0] : null,
    branchEndWgs:   lastCoords.length >= 2 ? lastCoords[lastCoords.length - 1] : null,
  }
}

/**
 * Display symbol of a switch — the body between the branch and the through
 * route (fillCoords) and the LCS mark (lcsCoords), both WGS84 — rebuilt from
 * the tracks it joins (see switchRoutesFromTracks). The record itself keeps
 * only name, label, trailing, speed and the ports, so the symbol can never
 * disagree with the tracks. Returns the record with the symbol set — or without
 * one when the branch is missing.
 *
 * A crossing kind is rebuilt from its own two legs (crossingRoutesFromTracks):
 * the body is the diamond their four ends span, and the label runs along the
 * main leg, offset past the body's centre of area the way a turnout's is.
 */
export function rebuildSwitchSymbol(sw, trackById) {
  const {
    fillCoords: _f, lcsCoords: _l, labelCoords: _lc, bodyCentre: _bc, bauform: _b, ...rest
  } = sw
  if (sw.kind && sw.kind !== 'turnout') {
    const routes = crossingRoutesFromTracks(sw, trackById)
    if (!routes) return rest
    const { type, epsg, centre, mainBearing, crossBearing, main, cross } = routes
    // The legs run out to C and D; the body's other two corners lie against
    // the bearings, the same distance out on the same legs.
    const t = crossingEndDistance(type)
    const aUtm = utmEndStraight(centre, (mainBearing + 180) % 360, t)
    const bUtm = utmEndStraight(centre, (crossBearing + 180) % 360, t)
    const cUtm = switchChainPointUtm(centre, mainBearing, main)
    const dUtm = switchChainPointUtm(centre, crossBearing, cross)
    // The body is the diamond the four ports span — A over D to C and back
    // over B, closed — the same ring the commit stores (the legs are its
    // diagonals, not its sides).
    const ring = [
      [aUtm.easting, aUtm.northing],
      [dUtm.easting, dUtm.northing],
      [cUtm.easting, cUtm.northing],
      [bUtm.easting, bUtm.northing],
      [aUtm.easting, aUtm.northing],
    ]
    const centreArea = ringCentroid(ring)
    const centreUtm  = { easting: centreArea[0], northing: centreArea[1], zone: epsg }
    // The label stands beside the main leg, on the side facing away from the
    // body — the same rule a turnout's designation follows.
    const { perp } = projectOnChainUtm(centre, mainBearing, main, centreUtm)
    const c = -perp
    const offset = c - Math.sign(c || 1) * SWITCH_LABEL_OFFSET
    return {
      ...rest,
      fillCoords: ring.map(([e, n]) => utmToWgs84(e, n, epsg)),
      labelCoords: chainOffsetCoords(centre, mainBearing, main, offset, epsg),
      bodyCentre: utmToWgs84(centreArea[0], centreArea[1], epsg),
    }
  }
  const routes = switchRoutesFromTracks(sw, trackById)
  if (!routes || !routes.branchStartWgs || !routes.branchEndWgs) return rest

  const { type, epsg, node, bearing, stem, branch } = routes
  const mainEndUtm = switchChainPointUtm(node, bearing, stem)
  const mainEndWgs = utmToWgs84(mainEndUtm.easting, mainEndUtm.northing, epsg)
  const mainCoords = chainGeometry(node, routes.branchStartWgs, bearing, stem, mainEndWgs).coords
  // The branch is drawn from the elements' own node, bearing, length and radii
  // rather than from their stored polylines: same curve, same source of truth,
  // but stepped like every other switch route — a branch saved at some other
  // density would otherwise give the symbol a different outline after a reload.
  const branchCoords = chainGeometry(node, routes.branchStartWgs, bearing, branch, routes.branchEndWgs).coords
  const lcsCoords = type
    ? lcsLine([node.easting, node.northing], routes.branchEnd,
      [mainEndUtm.easting, mainEndUtm.northing], type.dLcs, epsg)
    : null
  return {
    ...rest,
    fillCoords: switchFillRing(mainCoords, branchCoords),
    ...switchLabelGeometry(node, bearing, stem, branch, epsg),
    bauform: switchChainBauform(stem, branch),
    ...(lcsCoords ? { lcsCoords } : {}),
  }
}

/**
 * Compute all geometry for a switch from an element's end point (WGS84).
 * All intermediate calculations in UTM.
 *
 * Facing:   startWgs = portA;  through → portB2;  branch → portB1
 * Trailing: startWgs = portB2; through → portA;   branch departs portA with (bearing+180°) → portB1
 *
 * crs: plane in which bearing/lengths are defined (the element's epsg);
 * without it the zone is auto-detected — wrong for GK-native tracks.
 */
export function computeSwitchGeometry(startWgs, bearing, sw, side, trailing, crs = null, mainR = null) {
  return computeSwitchGeometryUtm(wgs84ToUTM(startWgs, crs), bearing, sw, side, trailing, startWgs, mainR)
}

/**
 * The same from a start point already in the track's plane ({ easting,
 * northing, zone }). A caller holding the point in the plane uses this so it is
 * not sent through WGS84 and back — for the GK/DB_REF datum shift that round
 * trip is not exact (~0.6 mm). `startWgs` is the WGS84 twin of the start for
 * the drawn coordinates; it is derived from the plane point when not given.
 * The ports and the element ends come back in the plane too (portA/B1/B2 as
 * [E, N]; startUtm, straightUtm, arcOriginUtm, curvedUtm), so the caller's own
 * elements can be built there. `fillCoords` is the finished symbol (see
 * switchFillRing) — callers store and preview that rather than assembling one,
 * so a turnout looks the same whichever dialog made it.
 *
 * `mainR` bends the switch: the stem radius, signed in the `bearing` direction
 * (positive = right-hand curve), null for the ordinary switch on a straight.
 * The through route then runs the form's through length as an arc on that
 * radius, and the branch takes the sum of both curvatures (see branchRadius) —
 * so `signedR` comes back null for the outer-bent switch whose branch is
 * straight. `mainSignedR` and `stemAtToe` are that stem radius in the two
 * frames a caller builds elements in: along `bearing`, and away from the toe.
 *
 * Given as { r1, r2 } instead, `mainR` lays the switch into a clothoid: r1 is
 * the stem radius at the start, r2 the one at the far end of the through route,
 * both along `bearing`. Given as a list of such pieces with their lengths, it
 * lays the switch across the elements of a track — one piece each, in the order
 * they run along `bearing`, taken to the form's through length.
 *
 * `stemChain` and `branchChain` are both routes as chains running from the toe,
 * the branch parting where the stem does; `stemSegments` and `branchSegments`
 * are their pieces placed in the plane (switchChainSegmentsUtm), the branch's
 * with their own polylines, one per element a caller builds.
 * `branchEndBearing` is the branch's tangent at its end.
 */
export function computeSwitchGeometryUtm(startUtm, bearing, sw, side, trailing, startWgs = null, mainR = null) {
  const formChain   = switchFormChain(sw, side)
  const arcLen      = switchBranchLength(sw)
  const straightLen = switchStraightLength(sw)
  // The through route along `bearing`: straight, an arc, a piece of clothoid or
  // a chain of such pieces.
  const stem = Array.isArray(mainR)
    ? switchChainTo(mainR, straightLen)
    : [mainR !== null && typeof mainR === 'object'
      ? toRoute({ length: straightLen, r1: mainR.r1, r2: mainR.r2 })
      : toRoute({ length: straightLen, radius: mainR })]
  const mainSignedR = stem[0].r1

  const sWgs = startWgs ?? utmToWgs84(startUtm.easting, startUtm.northing, startUtm.zone)

  // Through route: the form's through length, laid on the stem's curvature.
  const straightUtm    = switchChainPointUtm(startUtm, bearing, stem)
  const mainEndBearing = switchChainBearingAt(bearing, stem)

  // The branch leaves the toe — the start point of a facing switch, the far end
  // of a trailing one taken against the through route. Reversing that direction
  // turns the chain round: its pieces run the other way, their radii change sign
  // and swap ends. The branch's curvature is added to the stem's from there.
  const arcOriginUtm = trailing ? straightUtm : startUtm
  const curveBearing = trailing ? (mainEndBearing + 180) % 360 : bearing
  const stemChain    = trailing
    ? [...stem].reverse().map(p => ({ length: p.length, r1: negR(p.r2), r2: negR(p.r1) }))
    : stem
  const stemAtToe    = stemChain[0].r1
  const branchChain  = switchBranchChain(formChain, stemChain)
  const signedR      = branchChain[0].r1
  const curvedUtm    = switchChainPointUtm(arcOriginUtm, curveBearing, branchChain)

  // Ports as UTM [easting, northing]
  const portA  = trailing ? [straightUtm.easting, straightUtm.northing] : [startUtm.easting, startUtm.northing]
  const portB1 = [curvedUtm.easting, curvedUtm.northing]
  const portB2 = trailing ? [startUtm.easting, startUtm.northing] : [straightUtm.easting, straightUtm.northing]

  // WGS84 coords for map rendering
  const straightEnd  = utmToWgs84(straightUtm.easting, straightUtm.northing, startUtm.zone)
  const arcOriginWgs = trailing ? straightEnd : sWgs
  const curvedEnd    = utmToWgs84(curvedUtm.easting, curvedUtm.northing, startUtm.zone)
  const main   = chainGeometry(startUtm, sWgs, bearing, stem, straightEnd)
  const branch = chainGeometry(arcOriginUtm, arcOriginWgs, curveBearing, branchChain, curvedEnd)
  const straightCoords = main.coords
  const arcCoords      = branch.coords

  const portA_wgs  = trailing ? straightEnd : sWgs
  const portB1_wgs = curvedEnd
  const portB2_wgs = trailing ? sWgs : straightEnd

  const lcsCoords = lcsLine(portA, portB1, portB2, sw.dLcs, startUtm.zone)

  // The symbol, built once here so every caller draws the same turnout. Both
  // routes have to run from the toe: a trailing switch's through route is built
  // towards it, so it turns round for the ring.
  const throughFromToe = trailing ? [...straightCoords].reverse() : straightCoords
  const fillCoords = switchFillRing(throughFromToe, arcCoords)
  const labelGeom = switchLabelGeometry(arcOriginUtm, curveBearing, stemChain, branchChain, startUtm.zone)

  return {
    straightCoords, arcCoords, fillCoords, ...labelGeom,
    bauform: switchChainBauform(stemChain, branchChain),
    portA, portB1, portB2,
    portA_wgs, portB1_wgs, portB2_wgs,
    lcsCoords,
    straightEnd, arcOrigin: arcOriginWgs, curvedEnd,
    startUtm, straightUtm, arcOriginUtm, curvedUtm,
    signedR, mainSignedR, stemAtToe, stemChain, branchChain,
    stemSegments: trailing ? switchChainSegmentsUtm(arcOriginUtm, curveBearing, stemChain) : main.segments,
    branchSegments: branch.segments,
    curveBearing, mainEndBearing, branchEndBearing: switchChainBearingAt(curveBearing, branchChain),
    arcLen, straightLen,
  }
}

// ── Crossings and crossing switches (AP 3.2) ────────────────────────────────
//
// A crossing is two routes that cross instead of parting, so it has no toe and
// no branch: its geometry is stated from the crossing point, and both of its
// routes are straights — the crossing legs. A crossing switch adds connecting
// curves between the legs, tangential to both, one per slip route.

/** Crossing angle of a form [rad], stated as its slope (1:9). */
export function crossingAngle(type) {
  return Math.atan(1 / type.ratio)
}

/**
 * How far each of a crossing's four ends lies from the crossing point [m].
 *
 * The plain crossing states it through its end distance — the two ends on a
 * side lie 1.85 m apart, so each sits half of that beyond the point on its leg.
 * A crossing switch's ends are the tangent points of its connecting curves,
 * R·tan(α/2) along each leg — the curves are tangential to both, which is what
 * places them.
 */
export function crossingEndDistance(type) {
  const half = (type.endDistance ?? 1.85) / 2
  return type.R == null
    ? half / Math.sin(crossingAngle(type) / 2)
    : type.R * Math.tan(crossingAngle(type) / 2)
}

/**
 * The connecting curve of a slip route, as a route running from one leg to the
 * other: an arc on the form's radius, tangential to both legs, turning through
 * the crossing angle. `side` says which pair of ends it joins — 'left' or
 * 'right' of the main route's running direction.
 */
function slipRoute(type, side) {
  const a = crossingAngle(type)
  const sign = side === 'left' ? -1 : 1
  return { length: type.R * a, r1: sign * type.R, r2: sign * type.R }
}

/**
 * Geometry of a crossing or crossing switch, in the plane of `epsg`.
 *
 * The crossing point is `centreUtm`; the main route (A→C) runs along `bearing`,
 * the cross route (B→D) at the crossing angle to its right — `crossAngle` signed
 * in degrees, positive = the cross route turns right off the main one. Both
 * routes are straights of the form's own length, `2 · crossingEndDistance`, so
 * the crossing point is their middle and the four ports are their ends:
 *
 *   portA  main route, against the bearing   portC  main route, along it
 *   portB  cross route, against its bearing  portD  cross route, along it
 *
 * The slip routes of an EKW/DKW join the ends on each side of the crossing
 * point: `slip1` (A→D) the pair the main route leaves on one side, `slip2`
 * (B→C) the pair on the other — which is which follows from the cross route's
 * side, and both are arcs tangential to the legs at the ports. The single slip
 * builds only slip1.
 *
 * Returns everything the dialogs, the symbol and the plan export read:
 *   mainCoords, crossCoords   the two legs as WGS84 polylines, A→C and B→D
 *   slip1Coords, slip2Coords  the connecting curves, or null where the kind has none
 *   fillCoords                the body: the diamond the two legs span
 *   portA..portD              the four ends as [easting, northing]
 *   portA_wgs..portD_wgs      the same as WGS84
 *   mainEndDistance           how far each end lies from the crossing point [m]
 *   centreUtm                 the crossing point itself
 *   mainBearing, crossBearing the legs' bearings
 */
export function computeCrossingGeometryUtm(centreUtm, bearing, type, crossAngleDeg, startWgsMain = null, startWgsCross = null, epsg = null) {
  const zone  = epsg ?? centreUtm.zone
  const t     = crossingEndDistance(type)
  const crossBearing = (bearing + crossAngleDeg + 360) % 360

  // The two legs: straights through the crossing point, each reaching t to
  // either side of it. Their polylines start on the caller's WGS84 twins of the
  // ports, so the joins with the tracks there are exact.
  const aUtm = utmEndStraight(centreUtm, (bearing + 180) % 360, t)
  const cUtm = utmEndStraight(centreUtm, bearing, t)
  const bUtm = utmEndStraight(centreUtm, (crossBearing + 180) % 360, t)
  const dUtm = utmEndStraight(centreUtm, crossBearing, t)
  const aWgs = startWgsMain ?? utmToWgs84(aUtm.easting, aUtm.northing, zone)
  const cWgs = utmToWgs84(cUtm.easting, cUtm.northing, zone)
  const bWgs = startWgsCross ?? utmToWgs84(bUtm.easting, bUtm.northing, zone)
  const dWgs = utmToWgs84(dUtm.easting, dUtm.northing, zone)
  const mainCoords = [aWgs, cWgs]
  const crossCoords = [bWgs, dWgs]

  // The slip routes. Each joins two ends on opposite sides of the crossing
  // point: slip1 the pair A–D, slip2 the pair B–C. The arc leaves each leg
  // tangentially, running *towards* the crossing point at its start port and
  // away from it at its end port, turning through the crossing angle — so its
  // centre lies in the wedge between the two legs, and its tangent points sit
  // at R·tan(α/2) from the crossing point, which is where the ports are.
  const crossRight = crossAngleDeg >= 0
  const slip1Side = crossRight ? 'right' : 'left'
  const slip2Side = crossRight ? 'left' : 'right'
  const buildSlip = (side, fromUtm, fromWgs, toUtm, toWgs, legBearing) => {
    const route = slipRoute(type, side)
    const segs = switchChainSegmentsUtm(fromUtm, legBearing, [route])
    const coords = routeCoords(fromUtm, fromWgs, legBearing, route, toWgs)
    return { coords, route, segments: segs }
  }
  // The leg bearing at a start port is the one running towards the crossing
  // point: slip1 leaves A along the main leg, slip2 leaves B along the cross.
  const slip1 = type.kind === 'single_slip' || type.kind === 'double_slip'
    ? buildSlip(slip1Side, aUtm, aWgs, dUtm, dWgs, bearing)
    : null
  const slip2 = type.kind === 'double_slip'
    ? buildSlip(slip2Side, bUtm, bWgs, cUtm, cWgs, crossBearing)
    : null

  // The body: the diamond the two legs span, from A over D to C and back over
  // B — a closed ring of the four ports, the crossing kinds' counterpart of a
  // turnout's switchFillRing.
  const fillCoords = [aWgs, dWgs, cWgs, bWgs, aWgs]

  return {
    kind: type.kind, label: type.label,
    mainCoords, crossCoords,
    slip1Coords: slip1?.coords ?? null,
    slip2Coords: slip2?.coords ?? null,
    slip1Route: slip1?.route ?? null,
    slip2Route: slip2?.route ?? null,
    fillCoords,
    portA: [aUtm.easting, aUtm.northing], portB: [bUtm.easting, bUtm.northing],
    portC: [cUtm.easting, cUtm.northing], portD: [dUtm.easting, dUtm.northing],
    portA_wgs: aWgs, portB_wgs: bWgs, portC_wgs: cWgs, portD_wgs: dWgs,
    portA_utm: aUtm, portB_utm: bUtm, portC_utm: cUtm, portD_utm: dUtm,
    mainEndDistance: t,
    centreUtm,
    mainBearing: bearing,
    crossBearing,
  }
}
