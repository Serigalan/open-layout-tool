import { utmToWgs84 } from '../coordinateUtils'
import { bearingAfterUtm } from '../elementUtils'
import {
  transitionPointAtUtm, transitionBearingAtUtm, sampleTransitionUtm, clothoidRadiusAt, curvatureOf,
  radiusOfCurvature,
} from '../clothoidUtils'
import { STRAIGHT_CURVATURE, asRadius, bauform, branchRadius } from './catalogue'

// Switch routes and chains: a route or a chain of pieces as it runs away from the point it starts at.

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
export function toRoute(route) {
  if ('r1' in route || 'r2' in route) {
    const r1 = asRadius(route.r1)
    return { length: route.length, r1, r2: 'r2' in route ? asRadius(route.r2) : r1 }
  }
  const r = asRadius(route.radius)
  return { length: route.length, r1: r, r2: r }
}

/** A chain from a route or from a list of routes. */
export function toChain(route) {
  return Array.isArray(route) ? route.map(toRoute) : [toRoute(route)]
}

export const negR = (r) => (r == null ? null : -r)

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
 *
 * `symmetric` names it 'sym' outright: a symmetrical turnout's stem is the
 * branch's own mirror arc, not a track the form was laid onto, so reading it
 * against the form's curvature the way an ordinary bent switch is read would
 * call it an ABW — a different form wearing the wrong name.
 */
export function switchChainBauform(stem, branch, symmetric = false) {
  if (symmetric) return 'sym'
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
export function clothoidRoutePoints(originUtm, bearing, route) {
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
export function utmEndRoute(utm, bearing, length, signedR) {
  return signedR ? utmEndCurved(utm, bearing, length, signedR) : utmEndStraight(utm, bearing, length)
}

/**
 * Polyline (WGS84) of such a route. It starts at the caller's own WGS84 twin of
 * the origin, so the join with what comes before is exact — the plane point is
 * never sent through WGS84 and back. A clothoid also ends on the caller's twin
 * of its end.
 */
export function routeCoords(originUtm, originWgs, bearing, route, endWgs) {
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
export function chainGeometry(originUtm, originWgs, bearing, chain, endWgs) {
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
