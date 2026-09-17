import { utmToWgs84 } from './coordinateUtils'
import {
  computeClothoidUtm, transitionShift, transitionPointAtUtm, transitionBearingAtUtm,
} from './clothoidUtils'
import {
  computeCurvedValuesUtm, computeStraightValuesUtm, arcCoordsFromRadiusUtm,
  endPointCurvedUtm, bearingAfterUtm, reverseElement,
} from './elementUtils'
import { SAGITTA_ELEMENT, SAGITTA_TRACK } from './mapConstants'

const DEG2RAD = Math.PI / 180
const RAD2DEG = 180 / Math.PI

/** Beyond this a transition curve is not a design any more [m]. */
const MAX_TRANSITION_LENGTH = 5000

/**
 * Validate that the tangent points stay on the elements' lines without flipping
 * a re-shaped straight. Departure (always forward) must not end up behind its
 * start. The arrival is checked against the joined end: when reversed, its
 * tangent must not go behind the arrival start; when forward, it must not go past
 * the arrival end. Returns a translation key string, or null if valid.
 */
export function validateSpliceTangents(arc, depStart, arrRef, reverseArr = true) {

  const depStartProj =
    (arc.depClStartUtm.easting  - depStart.easting)  * arc.departureDir.e +
    (arc.depClStartUtm.northing - depStart.northing) * arc.departureDir.n
  if (depStartProj < -0.01) return 'splice_error_dep_too_large'

  const arrProj =
    (arc.arrClEndUtm.easting  - arrRef.easting)  * arc.arrivalDir.e +
    (arc.arrClEndUtm.northing - arrRef.northing) * arc.arrivalDir.n
  // reversed: tangent must stay ahead of the arrival start (proj ≥ 0)
  // forward:  tangent must stay behind the arrival end   (proj ≤ 0)
  if (reverseArr ? arrProj < -0.01 : arrProj > 0.01) return 'splice_error_arr_too_large'
  return null
}

/**
 * Compute splice geometry with optional transition curves (Approach B: exact railway geometry).
 *
 * Uses the transition shift parameters (p, t, φ) to place the arc center exactly,
 * accounting for asymmetric transition lengths on departure and arrival sides.
 *
 * Returns { error } on failure, or a full geometry object on success.
 * clothoidDep / clothoidArr: transition curve lengths in metres (0 = no transition).
 * transitionType: 'clothoid' | 'bloss' — curvature profile of both transitions.
 */
export function computeSpliceWithClothoids(
  depEnd, depBearing, arrEnd, arrBearing, radius,
  clothoidDep = 0, clothoidArr = 0, transitionType = 'clothoid',
) {
  if (!radius || radius <= 0) return { error: 'splice_error_parallel' }

  const Ld = Math.max(0, clothoidDep || 0)
  const La = Math.max(0, clothoidArr || 0)

  // depEnd / arrEnd: the element ends as plane points in the departure track's
  // CRS (the panel only splices tracks sharing one); the bearings are grid
  // bearings of that plane.
  const dep  = depEnd
  const zone = dep.zone
  const arr  = arrEnd

  const depDir = { e: Math.sin(depBearing * DEG2RAD), n: Math.cos(depBearing * DEG2RAD) }
  const arrDir = { e: Math.sin(arrBearing * DEG2RAD), n: Math.cos(arrBearing * DEG2RAD) }

  // Lines must intersect (not be parallel) to have a corner to round.
  const denom = depDir.e * arrDir.n - depDir.n * arrDir.e   // sin(angle between the lines)
  if (Math.abs(denom) < 1e-9) return { error: 'splice_error_parallel' }

  // Departure runs forward into the arc. The arrival is joined whichever way gives
  // the SMALLER turn (smallest angle change): reversed when the directions oppose
  // (a corner), forward when they are similar (a continuation). The exit direction
  // is the arrival direction with that sign; its short turn from depDir sets the
  // curve side. The fillet sits at the intersection either way.
  const reverseArr = (depDir.e * arrDir.e + depDir.n * arrDir.n) < 0
  const as = reverseArr ? -1 : 1
  const exitE = as * arrDir.e, exitN = as * arrDir.n
  const turn  = Math.atan2(depDir.e * exitN - depDir.n * exitE, depDir.e * exitE + depDir.n * exitN)
  const curveSide = turn > 0 ? 'left' : 'right'
  const signedR   = curveSide === 'left' ? -radius : radius
  const curveSign = curveSide === 'right' ? 1 : -1   // +1 right, -1 left

  // Transition shift parameters (numerically exact for clothoid and Bloss)
  const { p: p_d, t: t_d, phi: phi_d } = transitionShift(Ld, radius, transitionType)
  const { p: p_a, t: t_a, phi: phi_a } = transitionShift(La, radius, transitionType)

  // Solve for arc center C so that its signed distance from each tangent equals (R + p):
  //   curveSign · [(C.e − dep.e)·depDir.n − (C.n − dep.n)·depDir.e] = radius + p_d
  //   curveSign · [(C.e − arr.e)·arrDir.n − (C.n − arr.n)·arrDir.e] = radius + p_a
  const arrFactor = reverseArr ? -curveSign : curveSign
  const rhs_d = curveSign * (radius + p_d) + dep.easting * depDir.n - dep.northing * depDir.e
  const rhs_a = arrFactor * (radius + p_a) + arr.easting * arrDir.n - arr.northing * arrDir.e

  const det = depDir.e * arrDir.n - depDir.n * arrDir.e
  if (Math.abs(det) < 1e-10) return { error: 'splice_error_parallel' }

  const Ce = (-rhs_d * arrDir.e + rhs_a * depDir.e) / det
  const Cn = ( depDir.n * rhs_a - arrDir.n * rhs_d) / det

  // Virtual tangent points: foot of perpendicular from C to each tangent line
  const projD  = (Ce - dep.easting)  * depDir.e + (Cn - dep.northing)  * depDir.n
  const virtDE = dep.easting  + projD * depDir.e
  const virtDN = dep.northing + projD * depDir.n

  const projA  = (Ce - arr.easting)  * arrDir.e + (Cn - arr.northing)  * arrDir.n
  const virtAE = arr.easting  + projA * arrDir.e
  const virtAN = arr.northing + projA * arrDir.n

  // Clothoid start (departure straight end): t_d before virtual dep tangent
  const depClStartE = virtDE - t_d * depDir.e
  const depClStartN = virtDN - t_d * depDir.n

  // Clothoid end (arrival straight junction): t_a from the virtual arr tangent in
  // the exit direction (−arrDir when reversed, +arrDir when forward).
  const arrClEndE = virtAE + t_a * exitE
  const arrClEndN = virtAN + t_a * exitN

  // Arc start/end angles on the circle
  const thetaVirtD  = Math.atan2(virtDN - Cn, virtDE - Ce)
  const thetaVirtA  = Math.atan2(virtAN - Cn, virtAE - Ce)
  const arcStartAng = thetaVirtD - phi_d * curveSign
  const arcEndAng   = thetaVirtA + phi_a * curveSign

  // Sweep angle (adjusted for correct rotation direction)
  let sweepAngle = arcEndAng - arcStartAng
  if (curveSide === 'left'  && sweepAngle < 0) sweepAngle += 2 * Math.PI
  if (curveSide === 'right' && sweepAngle > 0) sweepAngle -= 2 * Math.PI
  // Degenerate, or a reflex sweep (the transition curves don't fit the bend).
  if (Math.abs(sweepAngle) < 1e-6 || Math.abs(sweepAngle) > Math.PI + 1e-6) {
    return { error: 'splice_error_clothoid_too_long' }
  }

  // Arc start and end points in UTM + WGS84
  const arcStartE = Ce + radius * Math.cos(arcStartAng)
  const arcStartN = Cn + radius * Math.sin(arcStartAng)
  const arcEndE   = Ce + radius * Math.cos(arcEndAng)
  const arcEndN   = Cn + radius * Math.sin(arcEndAng)
  const arcStartWgs   = utmToWgs84(arcStartE,   arcStartN,   zone)
  const depClStartWgs = utmToWgs84(depClStartE, depClStartN, zone)
  const arrClEndWgs   = utmToWgs84(arrClEndE,   arrClEndN,   zone)

  // Tangent bearing at angle θ on the arc
  const arcBearingAt = a => curveSide === 'right'
    ? (Math.atan2( Math.sin(a), -Math.cos(a)) * RAD2DEG + 360) % 360
    : (Math.atan2(-Math.sin(a),  Math.cos(a)) * RAD2DEG + 360) % 360
  const arcStartBearing = arcBearingAt(arcStartAng)
  const arcEndBearing   = arcBearingAt(arcEndAng)
  const exitBearing     = reverseArr ? (arrBearing + 180 + 360) % 360 : ((arrBearing % 360) + 360) % 360

  // Arc length and combined length
  const arcLength = Math.abs(sweepAngle) * radius

  // Arc coordinate arrays — fine (element) and coarse (track/render)
  const buildArcCoords = (dev) => {
    const maxAngle = 2 * Math.acos(Math.min(1, Math.max(-1, 1 - dev / radius)))
    const nSeg = Math.min(200, Math.max(2, Math.ceil(Math.abs(sweepAngle) / maxAngle)))
    const pts = []
    for (let i = 0; i <= nSeg; i++) {
      const a = arcStartAng + (i / nSeg) * sweepAngle
      pts.push(utmToWgs84(Ce + radius * Math.cos(a), Cn + radius * Math.sin(a), zone))
    }
    return pts
  }
  const arcCoords       = buildArcCoords(SAGITTA_ELEMENT)
  const arcCoordsRender = buildArcCoords(SAGITTA_TRACK)

  // Clothoid coordinate arrays (numerical integration in UTM, last point snapped to exact geometry)
  let depClCoords = null, depClCoordsRender = null
  let arrClCoords = null, arrClCoordsRender = null
  if (Ld > 0) {
    const cl  = computeClothoidUtm({ easting: depClStartE, northing: depClStartN, zone }, depBearing, Ld, null, signedR, SAGITTA_ELEMENT, transitionType)
    const clR = computeClothoidUtm({ easting: depClStartE, northing: depClStartN, zone }, depBearing, Ld, null, signedR, SAGITTA_TRACK, transitionType)
    depClCoords       = [...cl.coords.slice(0, -1),  arcStartWgs]
    depClCoordsRender = [...clR.coords.slice(0, -1), arcStartWgs]
  }
  if (La > 0) {
    const cl  = computeClothoidUtm({ easting: arcEndE, northing: arcEndN, zone }, arcEndBearing, La, signedR, null, SAGITTA_ELEMENT, transitionType)
    const clR = computeClothoidUtm({ easting: arcEndE, northing: arcEndN, zone }, arcEndBearing, La, signedR, null, SAGITTA_TRACK, transitionType)
    arrClCoords       = [...cl.coords.slice(0, -1),  arrClEndWgs]
    arrClCoordsRender = [...clR.coords.slice(0, -1), arrClEndWgs]
  }

  // Combined preview coords (seamless: no duplicate junction points) — coarse for rendering
  const previewCoords = [
    ...(depClCoordsRender ? depClCoordsRender.slice(0, -1) : []),
    ...arcCoordsRender,
    ...(arrClCoordsRender ? arrClCoordsRender.slice(1) : []),
  ]

  return {
    // WGS84 — only for GeoJSON geometry arrays
    depTangentWgs: depClStartWgs,
    arrTangentWgs: arrClEndWgs,
    arcCoords,
    arcCoordsRender,
    depClothoidCoords:       depClCoords,
    depClothoidCoordsRender: depClCoordsRender,
    arrClothoidCoords:       arrClCoords,
    arrClothoidCoordsRender: arrClCoordsRender,
    previewCoords,

    // UTM — all calculations
    depClStartUtm: { easting: depClStartE, northing: depClStartN, zone },
    arcStartUtm:   { easting: arcStartE,   northing: arcStartN,   zone },
    arcEndUtm:     { easting: arcEndE,     northing: arcEndN,     zone },
    arrClEndUtm:   { easting: arrClEndE,   northing: arrClEndN,   zone },

    // Scalar values
    arcLength,
    clothoidDepLength: Ld,
    clothoidArrLength: La,
    transitionType,
    curveSide,
    signedR,
    depBearing,
    arcStartBearing,
    arcEndBearing,
    exitBearing,
    reverseArr,

    // For validateSpliceTangents
    departureDir: depDir,
    arrivalDir:   arrDir,
  }
}

/**
 * Dual of computeSpliceWithClothoids: connect two CIRCULAR ARCS with a STRAIGHT
 * that is the common tangent of both arc-circles, with optional transition
 * curves (clothoid or Bloss, see transitionType) between each arc and the
 * straight.
 *
 * The departure arc flows forward into the straight; the arrival arc is traversed
 * in reverse (its signed radius flips). Each arc is re-shaped (trimmed/extended
 * along its own circle) to its tangent/clothoid junction.
 *
 * Returns { error } on failure, or { elements, previewCoords, … } on success.
 * `elements` is the middle chain (dep arc → [dep clothoid] → straight →
 * [arr clothoid] → reversed arr arc), ready except for speed/absLength.
 */
export function computeArcSpliceWithClothoids(
  depEnd, depBearing, depSignedR,
  arrEnd, arrBearing, arrSignedR,
  depStart, arrStart,
  clothoidDep = 0, clothoidArr = 0, transitionType = 'clothoid',
) {
  if (!depSignedR || !arrSignedR) return { error: 'splice_error_parallel' }

  // All four points are plane points in the departure track's CRS.
  const dep  = depEnd
  const zone = dep.zone
  const arr  = arrEnd
  const depS = depStart
  const arrS = arrStart
  const depStartWgs = utmToWgs84(depS.easting, depS.northing, zone)
  const arrStartWgs = utmToWgs84(arrS.easting, arrS.northing, zone)

  const R1 = Math.abs(depSignedR), R2 = Math.abs(arrSignedR)
  const L1 = Math.max(0, clothoidDep || 0)
  const L2 = Math.max(0, clothoidArr || 0)

  // Arc centres (on the concave side of travel)
  const ln = (e, n) => ({ e: -n, n: e })               // left normal (CCW) of (e,n)
  const d1 = { e: Math.sin(depBearing * DEG2RAD), n: Math.cos(depBearing * DEG2RAD) }
  const d2 = { e: Math.sin(arrBearing * DEG2RAD), n: Math.cos(arrBearing * DEG2RAD) }
  const sgn1 = depSignedR >= 0 ? -1 : 1
  const sgn2 = arrSignedR >= 0 ? -1 : 1
  const ln1 = ln(d1.e, d1.n), ln2 = ln(d2.e, d2.n)
  const O1 = { e: dep.easting + sgn1 * R1 * ln1.e, n: dep.northing + sgn1 * R1 * ln1.n }
  const O2 = { e: arr.easting + sgn2 * R2 * ln2.e, n: arr.northing + sgn2 * R2 * ln2.n }

  // Side of each centre relative to the straight travel u (+1 = left of u).
  // Departure arc travels forward; arrival arc is traversed in reverse.
  const sig1 = depSignedR < 0 ?  1 : -1
  const sig2 = arrSignedR < 0 ? -1 :  1

  // Transition shift parameters (numerically exact for clothoid and Bloss)
  const { p: p1, t: t1, phi: phi1 } = transitionShift(L1, R1, transitionType)
  const { p: p2, t: t2, phi: phi2 } = transitionShift(L2, R2, transitionType)
  const dd1 = R1 + p1, dd2 = R2 + p2

  // Solve the straight direction: a line at signed distance dd1/dd2 from O1/O2.
  const DE = O2.e - O1.e, DN = O2.n - O1.n
  const M  = Math.hypot(DE, DN)
  if (M < 1e-6) return { error: 'splice_error_parallel' }
  const C = sig2 * dd2 - sig1 * dd1
  if (Math.abs(C) > M + 1e-6) return { error: 'splice_error_parallel' }
  const gamma = Math.atan2(DE, DN)
  const baseA = Math.asin(Math.max(-1, Math.min(1, C / M)))

  // Pick the candidate direction whose straight runs forward (dep → arr).
  let best = null
  for (const Bm of [gamma + baseA, gamma + Math.PI - baseA]) {
    const B = ((Bm * RAD2DEG) % 360 + 360) % 360
    const u = { e: Math.sin(B * DEG2RAD), n: Math.cos(B * DEG2RAD) }
    const lnu = ln(u.e, u.n)
    const F1 = { e: O1.e - sig1 * dd1 * lnu.e, n: O1.n - sig1 * dd1 * lnu.n }
    const F2 = { e: O2.e - sig2 * dd2 * lnu.e, n: O2.n - sig2 * dd2 * lnu.n }
    const fwd = (F2.e - F1.e) * u.e + (F2.n - F1.n) * u.n
    if (!best || fwd > best.fwd) best = { B, u, F1, F2, fwd }
  }
  if (!best || best.fwd <= 0) return { error: 'splice_error_parallel' }
  const { B, u, F1, F2 } = best

  // Straight junctions (clothoid ends) and arc junctions (clothoid/arc joints)
  const S1 = { e: F1.e + t1 * u.e, n: F1.n + t1 * u.n }
  const S2 = { e: F2.e - t2 * u.e, n: F2.n - t2 * u.n }
  const straightLen = (S2.e - S1.e) * u.e + (S2.n - S1.n) * u.n
  if (straightLen < -0.01) return { error: 'splice_error_clothoid_too_long' }

  const uAng = Math.atan2(u.n, u.e)
  const aDep = uAng - sig1 * phi1
  const A1 = { e: O1.e - R1 * Math.cos(aDep + sig1 * Math.PI / 2),
               n: O1.n - R1 * Math.sin(aDep + sig1 * Math.PI / 2) }
  const bearingA1 = ((90 - aDep * RAD2DEG) % 360 + 360) % 360
  const aArr = uAng + sig2 * phi2
  const A2 = { e: O2.e - R2 * Math.cos(aArr + sig2 * Math.PI / 2),
               n: O2.n - R2 * Math.sin(aArr + sig2 * Math.PI / 2) }

  const utm  = (pt) => ({ easting: pt.e, northing: pt.n, zone })
  const wgs  = (pt) => utmToWgs84(pt.e, pt.n, zone)
  const A1u = utm(A1), A2u = utm(A2), S1u = utm(S1), S2u = utm(S2)
  const A1w = wgs(A1), S1w = wgs(S1), S2w = wgs(S2), A2w = wgs(A2)

  // ── Re-shaped departure arc (orig start → A1) ─────────────────────────────
  const cvDep = computeCurvedValuesUtm(depS, A1u, depSignedR)
  if (cvDep.length > Math.PI * R1) return { error: 'splice_error_dep_too_large' }
  const depArcEl = {
    elementType: 1,
    startNode: cvDep.startNode, endNode: cvDep.endNode,
    bearing: cvDep.bearing, length: cvDep.length, endBearing: cvDep.endBearing,
    radius: depSignedR,
    geometry:     { type: 'LineString', coordinates: arcCoordsFromRadiusUtm(depS, A1u, depSignedR, SAGITTA_ELEMENT) || [depStartWgs, A1w] },
    renderCoords: arcCoordsFromRadiusUtm(depS, A1u, depSignedR, SAGITTA_TRACK) || [depStartWgs, A1w],
  }

  // ── Departure clothoid (arc → straight) ───────────────────────────────────
  let depClEl = null
  if (L1 > 0) {
    const cl  = computeClothoidUtm(A1u, bearingA1, L1, depSignedR, null, SAGITTA_ELEMENT, transitionType)
    const clR = computeClothoidUtm(A1u, bearingA1, L1, depSignedR, null, SAGITTA_TRACK, transitionType)
    depClEl = {
      elementType: 2, r1: depSignedR, r2: null, transitionType,
      bearing: bearingA1, endBearing: B, length: L1,
      startNode: [A1.e, A1.n], endNode: [S1.e, S1.n],
      geometry:     { type: 'LineString', coordinates: [...cl.coords.slice(0, -1),  S1w] },
      renderCoords: [...clR.coords.slice(0, -1), S1w],
    }
  }

  // ── Straight connector (S1 → S2) ──────────────────────────────────────────
  const svStr = computeStraightValuesUtm(S1u, S2u)
  const straightEl = {
    elementType: 0,
    startNode: svStr.startNode, endNode: svStr.endNode,
    bearing: svStr.bearing, length: svStr.length,
    geometry: { type: 'LineString', coordinates: [S1w, S2w] },
  }

  // ── Arrival clothoid (straight → reversed arc) ────────────────────────────
  let arrClEl = null
  if (L2 > 0) {
    const cl  = computeClothoidUtm(S2u, B, L2, null, -arrSignedR, SAGITTA_ELEMENT, transitionType)
    const clR = computeClothoidUtm(S2u, B, L2, null, -arrSignedR, SAGITTA_TRACK, transitionType)
    arrClEl = {
      elementType: 2, r1: null, r2: -arrSignedR, transitionType,
      bearing: B, endBearing: cl.endBearing, length: L2,
      startNode: [S2.e, S2.n], endNode: [A2.e, A2.n],
      geometry:     { type: 'LineString', coordinates: [...cl.coords.slice(0, -1),  A2w] },
      renderCoords: [...clR.coords.slice(0, -1), A2w],
    }
  }

  // ── Re-shaped, reversed arrival arc (A2 → orig start) ─────────────────────
  const cvArr = computeCurvedValuesUtm(A2u, arrS, -arrSignedR)
  if (cvArr.length > Math.PI * R2) return { error: 'splice_error_arr_too_large' }
  const arrArcEl = {
    elementType: 1,
    startNode: cvArr.startNode, endNode: cvArr.endNode,
    bearing: cvArr.bearing, length: cvArr.length, endBearing: cvArr.endBearing,
    radius: -arrSignedR,
    geometry:     { type: 'LineString', coordinates: arcCoordsFromRadiusUtm(A2u, arrS, -arrSignedR, SAGITTA_ELEMENT) || [A2w, arrStartWgs] },
    renderCoords: arcCoordsFromRadiusUtm(A2u, arrS, -arrSignedR, SAGITTA_TRACK) || [A2w, arrStartWgs],
  }

  const elements = [depArcEl, depClEl, straightEl, arrClEl, arrArcEl].filter(Boolean)
  const previewCoords = elements.reduce((acc, el, i) => {
    const c = el.renderCoords ?? el.geometry.coordinates
    return i === 0 ? [...c] : [...acc, ...c.slice(1)]
  }, [])

  return {
    elements,
    previewCoords,
    straightLength: straightLen,
    depArcLength:   cvDep.length,
    arrArcLength:   cvArr.length,
    clothoidDepLength: L1,
    clothoidArrLength: L2,
    zone,
  }
}

/**
 * Two arcs joined **directly** by one transition curve — no straight between
 * them (AP 4.1). Same sense gives a compound curve (Korbbogen), opposite sense
 * a reverse curve (S-Bogen) whose transition passes through R = ∞ on its way
 * from one sign to the other. `computeClothoidUtm` runs r₁ → r₂ either way, so
 * the curve itself was never the missing piece; placing it was.
 *
 * **What determines it.** The transition leaves the departure circle
 * tangentially and arrives with curvature 1/r₂, so the circle it osculates at
 * its end has radius r₂ — and the construction closes exactly when that circle
 * *is* the arrival circle, i.e. when its centre falls on O₂. Tangency and
 * position both follow from that one statement, which is what makes this
 * solvable at all.
 *
 * **And it reduces to one scalar.** Where the transition starts on circle 1 only
 * rotates the whole figure about O₁, so the distance from O₁ to that end centre
 * does not depend on it — it depends on the length alone. So the length solves
 *
 *     d(L) = |O₁O₂|
 *
 * on its own, and the start station follows by rotating the figure until the two
 * centres line up. d(0) = |r₁ − r₂| is the two circles touching (nested for one
 * sense, side by side for the other) and d grows with L, so there is one root
 * and it exists exactly when the circles are further apart than touching.
 *
 * Returns { error } or { elements, previewCoords, transitionLength, … }, the
 * elements being dep arc → transition → reversed arr arc, ready except for
 * speed/absLength.
 */
export function computeArcArcTransition(
  depEnd, depBearing, depSignedR,
  arrEnd, arrBearing, arrSignedR,
  depStart, arrStart, transitionType = 'clothoid',
) {
  if (!depSignedR || !arrSignedR) return { error: 'splice_error_parallel' }
  const zone = depEnd.zone

  // Travel runs forward on the departure arc and backwards on the arrival one,
  // so the arrival radius changes sign while its centre stays where it is.
  const r1 = depSignedR
  const r2 = -arrSignedR

  const centreOf = (p, bearing, signedR) => {
    const rad = bearing * DEG2RAD
    return { e: p.easting + signedR * Math.cos(rad), n: p.northing - signedR * Math.sin(rad) }
  }
  const O1 = centreOf(depEnd, depBearing, depSignedR)
  const O2 = centreOf(arrEnd, arrBearing, arrSignedR)
  const target = Math.hypot(O2.e - O1.e, O2.n - O1.n)

  // The figure in its own frame: it starts at the origin heading north, so its
  // circle-1 centre sits at (r₁, 0).
  const ORIGIN = { easting: 0, northing: 0, zone }
  const canon = (L) => {
    const end = L > 0
      ? transitionPointAtUtm(ORIGIN, 0, L, r1, r2, transitionType, L)
      : { easting: 0, northing: 0 }
    const b = L > 0 ? transitionBearingAtUtm(0, L, r1, r2, transitionType, L) : 0
    const rad = b * DEG2RAD
    // The circle the curve osculates where it ends.
    const c = { e: end.easting + r2 * Math.cos(rad), n: end.northing - r2 * Math.sin(rad) }
    return { end, b, c, d: Math.hypot(c.e - r1, c.n - 0) }
  }

  // Two arcs of the same radius are one circle's worth of curvature: there is no
  // transition from a curvature to itself, only an arc.
  if (Math.abs(r1 - r2) < 1e-9) return { error: 'splice_error_arcs_no_fit' }

  // d(0) is the two circles touching. Which way d then runs depends on the pair:
  // a compound curve draws the inner circle *in*, so the centres come closer,
  // while a reverse curve pushes them apart. Rather than case-split on that, the
  // direction is read off the function itself — it is monotone either way.
  const d0  = canon(0).d
  const dir = Math.sign(canon(1e-3).d - d0) || 1
  if ((target - d0) * dir < -1e-6) return { error: 'splice_error_arcs_no_fit' }

  // Bracket the length in the direction d actually runs, then halve it down.
  const reach = (L) => (canon(L).d - target) * dir
  let hi = Math.max(20, Math.abs(r1 - r2))
  for (let i = 0; i < 40 && reach(hi) < 0 && hi < MAX_TRANSITION_LENGTH; i++) hi *= 2
  if (reach(hi) < 0) return { error: 'splice_error_arcs_too_far' }
  let lo = 0
  for (let i = 0; i < 80 && hi - lo > 1e-9; i++) {
    const mid = (lo + hi) / 2
    if (reach(mid) < 0) lo = mid; else hi = mid
  }
  const L = (lo + hi) / 2
  const shape = canon(L)
  if (!(L > 0)) return { error: 'splice_error_arcs_no_fit' }

  // Turn the figure about O₁ until its end centre falls on O₂, then read the two
  // junctions off it.
  const theta = Math.atan2(O2.n - O1.n, O2.e - O1.e) - Math.atan2(shape.c.n - 0, shape.c.e - r1)
  const cosT = Math.cos(theta), sinT = Math.sin(theta)
  const place = (e, n) => ({
    easting:  O1.e + (e - r1) * cosT - (n - 0) * sinT,
    northing: O1.n + (e - r1) * sinT + (n - 0) * cosT,
    zone,
  })
  // A turn of the plane counter-clockwise is a bearing turned the other way.
  const turned = (b) => ((b - theta * RAD2DEG) % 360 + 360) % 360

  const J1 = place(0, 0)
  const J2 = place(shape.end.easting, shape.end.northing)
  const bJ1 = turned(0)
  const bJ2 = turned(shape.b)

  const j1Wgs = utmToWgs84(J1.easting, J1.northing, zone)
  const j2Wgs = utmToWgs84(J2.easting, J2.northing, zone)
  const depStartWgs = utmToWgs84(depStart.easting, depStart.northing, zone)
  const arrStartWgs = utmToWgs84(arrStart.easting, arrStart.northing, zone)

  // ── Re-shaped departure arc (orig start → J1) ─────────────────────────────
  const cvDep = computeCurvedValuesUtm(depStart, J1, depSignedR)
  if (cvDep.length > Math.PI * Math.abs(r1)) return { error: 'splice_error_dep_too_large' }
  const depArcEl = {
    elementType: 1,
    startNode: cvDep.startNode, endNode: cvDep.endNode,
    bearing: cvDep.bearing, length: cvDep.length, endBearing: cvDep.endBearing,
    radius: depSignedR,
    geometry:     { type: 'LineString', coordinates: arcCoordsFromRadiusUtm(depStart, J1, depSignedR, SAGITTA_ELEMENT) || [depStartWgs, j1Wgs] },
    renderCoords: arcCoordsFromRadiusUtm(depStart, J1, depSignedR, SAGITTA_TRACK) || [depStartWgs, j1Wgs],
  }

  // ── The transition itself (J1 → J2) ───────────────────────────────────────
  const cl  = computeClothoidUtm(J1, bJ1, L, r1, r2, SAGITTA_ELEMENT, transitionType)
  const clR = computeClothoidUtm(J1, bJ1, L, r1, r2, SAGITTA_TRACK, transitionType)
  const transitionEl = {
    elementType: 2, transitionType,
    r1, r2,
    bearing: bJ1, endBearing: bJ2, length: L,
    startNode: [J1.easting, J1.northing], endNode: [J2.easting, J2.northing],
    geometry:     { type: 'LineString', coordinates: [...cl.coords.slice(0, -1),  j2Wgs] },
    renderCoords: [...clR.coords.slice(0, -1), j2Wgs],
  }

  // ── Re-shaped, reversed arrival arc (J2 → orig start) ─────────────────────
  const cvArr = computeCurvedValuesUtm(J2, arrStart, r2)
  if (cvArr.length > Math.PI * Math.abs(r2)) return { error: 'splice_error_arr_too_large' }
  const arrArcEl = {
    elementType: 1,
    startNode: cvArr.startNode, endNode: cvArr.endNode,
    bearing: cvArr.bearing, length: cvArr.length, endBearing: cvArr.endBearing,
    radius: r2,
    geometry:     { type: 'LineString', coordinates: arcCoordsFromRadiusUtm(J2, arrStart, r2, SAGITTA_ELEMENT) || [j2Wgs, arrStartWgs] },
    renderCoords: arcCoordsFromRadiusUtm(J2, arrStart, r2, SAGITTA_TRACK) || [j2Wgs, arrStartWgs],
  }

  const elements = [depArcEl, transitionEl, arrArcEl]
  const previewCoords = elements.reduce((acc, el, i) => {
    const c = el.renderCoords ?? el.geometry.coordinates
    return i === 0 ? [...c] : [...acc, ...c.slice(1)]
  }, [])

  return {
    elements, previewCoords,
    transitionLength: L,
    depArcLength: cvDep.length,
    arrArcLength: cvArr.length,
    transitionType,
    compound: Math.sign(r1) === Math.sign(r2),
    zone,
  }
}

// ── Arc against straight, joined by a new arc ────────────────────────────────

/** Signed turn a bearing makes over a transition, 0 for one of no length [deg]. */
function transitionTurn(length, r1, r2, type) {
  if (!(length > 0)) return 0
  const b = transitionBearingAtUtm(0, length, r1, r2, type, length)
  return ((b + 180) % 360 + 360) % 360 - 180
}

/** The same for a bearing delta in general. */
const turnBetween = (from, to) => ((to - from + 180) % 360 + 360) % 360 - 180

/**
 * Splice an **arc** and a **straight** with a new arc of the given radius, with
 * optional transitions on both sides (AP 4.1's second case). The panel refused
 * this pairing until now: `computeSpliceWithClothoids` rounds the corner between
 * two tangent *lines*, and a curved element has no tangent line to round against
 * — its curvature is what the shift parameters would have to be measured from.
 *
 * Rather than extend that closed form to a circle-and-line case with its four
 * tangency signs, the chain is built forwards and one number is solved for: the
 * station `s` on the arc where it leaves. Everything else follows from it.
 * The straight's direction is fixed, so the *total* turn from the arc's tangent
 * at `s` to the exit is known, and the two transitions take a known share of it
 * — which leaves the new arc's sweep, and with it the whole chain. What is left
 * over is one condition: the far end has to land on the straight.
 *
 *     r(s) = signed distance of the chain's end from the straight   →   0
 *
 * Both hands of the new arc are tried; the one that turns the way its own sign
 * says, and that leaves both original elements a sane length, wins.
 *
 * `dep` and `arr` are `{ pointUtm, bearing, signedR, farUtm }` — the picked end
 * with its tangent in the element's own direction, its curvature (null on a
 * straight) and its other end, which the re-shaped element runs to.
 */
export function computeArcStraightSplice(dep, arr, radius, clothoidDep = 0, clothoidArr = 0, transitionType = 'clothoid') {
  if (!(radius > 0)) return { error: 'splice_error_parallel' }
  const arcIsDeparture = dep.signedR != null
  if (arcIsDeparture === (arr.signedR != null)) return { error: 'splice_error_mixed' }

  // Always solve with the arc leading. Where it is the arrival, the same chain
  // read backwards *is* that problem — the arrival element is traversed against
  // its own direction, so reading the whole thing the other way round traverses
  // it with its direction, which is what a departure is. Only the finished chain
  // has to be turned round again.
  const a = arcIsDeparture ? dep : arr
  const b = arcIsDeparture ? arr : dep
  const Ld = Math.max(0, (arcIsDeparture ? clothoidDep : clothoidArr) || 0)
  const La = Math.max(0, (arcIsDeparture ? clothoidArr : clothoidDep) || 0)
  const zone = a.pointUtm.zone

  // The straight is met against its own direction: the chain runs into its far
  // end, which is where the merged track carries on.
  const exitBearing = (b.bearing + 180) % 360
  const exitDir = { e: Math.sin(exitBearing * DEG2RAD), n: Math.cos(exitBearing * DEG2RAD) }
  const lineNormal = { e: -exitDir.n, n: exitDir.e }

  /** The chain from station `s` on the arc, for one hand of the new arc. */
  const build = (s, Rn) => {
    const J1 = endPointCurvedUtm(a.pointUtm, a.bearing, s, a.signedR)
    const b1 = bearingAfterUtm(a.bearing, s, a.signedR)
    const tIn  = transitionTurn(Ld, a.signedR, Rn, transitionType)
    const tOut = transitionTurn(La, Rn, null, transitionType)
    const arcTurn = turnBetween(b1 + tIn + tOut, exitBearing)
    if (Math.sign(arcTurn) !== Math.sign(Rn)) return null
    // The turns above are bearings, in degrees; an arc length is not.
    const arcLength = Math.abs(arcTurn) * DEG2RAD * radius

    const A1 = Ld > 0 ? transitionPointAtUtm(J1, b1, Ld, a.signedR, Rn, transitionType, Ld) : J1
    const bA1 = b1 + tIn
    const A2 = endPointCurvedUtm(A1, bA1, arcLength, Rn)
    const bA2 = bA1 + arcTurn
    const E  = La > 0 ? transitionPointAtUtm(A2, bA2, La, Rn, null, transitionType, La) : A2

    const residual = (E.easting - b.pointUtm.easting) * lineNormal.e
                   + (E.northing - b.pointUtm.northing) * lineNormal.n
    return { J1, b1, A1, bA1, A2, bA2, E, arcLength, arcTurn, residual }
  }

  /** The station nearest the picked end where the chain closes — or null. */
  const solveStation = (Rn) => {
    const f = (s) => build(s, Rn)?.residual ?? NaN
    const f0 = f(0)
    if (Number.isFinite(f0) && Math.abs(f0) < 1e-6) return 0

    const bisect = (lo, hi, flo) => {
      for (let k = 0; k < 80 && Math.abs(hi - lo) > 1e-9; k++) {
        const mid = (lo + hi) / 2
        const fm = f(mid)
        if (!Number.isFinite(fm)) break
        if (flo * fm < 0) hi = mid; else { lo = mid; flo = fm }
      }
      return (lo + hi) / 2
    }

    // Walk out from the picked end, each way on its own, and keep the root that
    // moves the junction least — the pick is where the user wants the splice.
    const step = Math.max(1, radius / 100)
    let best = null
    for (const way of [1, -1]) {
      let prev = 0, fprev = f0
      for (let i = 1; i <= 500; i++) {
        const s = way * i * step
        const fs = f(s)
        if (Number.isFinite(fprev) && Number.isFinite(fs) && fprev * fs < 0) {
          const root = bisect(prev, s, fprev)
          if (best == null || Math.abs(root) < Math.abs(best)) best = root
          break
        }
        prev = s; fprev = fs
      }
    }
    return best
  }

  // Both hands, best effort; the one that leaves both originals a sane length wins.
  let chosen = null
  for (const Rn of [radius, -radius]) {
    const s = solveStation(Rn)
    if (s == null) continue
    const built = build(s, Rn)
    if (!built) continue
    const cvA = computeCurvedValuesUtm(a.farUtm, built.J1, a.signedR)
    if (!(cvA.length > 0) || cvA.length > Math.PI * Math.abs(a.signedR)) continue
    const along = (built.E.easting - b.farUtm.easting) * exitDir.e
                + (built.E.northing - b.farUtm.northing) * exitDir.n
    if (along > 0.01) continue          // the chain would overshoot the straight's far end
    // Both hands can close, on quite different loops. The one that belongs to
    // the picked ends is the one that barely moves the junction off them.
    if (!chosen || Math.abs(s) < Math.abs(chosen.s)) chosen = { Rn, s, built, cvA }
  }
  if (!chosen) return { error: 'splice_error_no_fit' }

  const { Rn, built, cvA } = chosen
  const { J1, b1, A1, A2, bA2, E, arcLength } = built
  const wgs = (p) => utmToWgs84(p.easting, p.northing, zone)
  const node = (p) => [p.easting, p.northing]

  const elements = []

  // ── Re-shaped arc side (its far end → J1) ────────────────────────────────
  elements.push({
    elementType: 1,
    startNode: cvA.startNode, endNode: cvA.endNode,
    bearing: cvA.bearing, length: cvA.length, endBearing: cvA.endBearing,
    radius: a.signedR,
    geometry:     { type: 'LineString', coordinates: arcCoordsFromRadiusUtm(a.farUtm, J1, a.signedR, SAGITTA_ELEMENT) || [wgs(a.farUtm), wgs(J1)] },
    renderCoords: arcCoordsFromRadiusUtm(a.farUtm, J1, a.signedR, SAGITTA_TRACK) || [wgs(a.farUtm), wgs(J1)],
  })

  const transition = (from, fromBearing, to, length, r1, r2) => {
    const cl  = computeClothoidUtm(from, fromBearing, length, r1, r2, SAGITTA_ELEMENT, transitionType)
    const clR = computeClothoidUtm(from, fromBearing, length, r1, r2, SAGITTA_TRACK, transitionType)
    return {
      elementType: 2, transitionType, r1, r2,
      bearing: fromBearing, endBearing: cl.endBearing,
      length,
      startNode: node(from), endNode: node(to),
      geometry:     { type: 'LineString', coordinates: [...cl.coords.slice(0, -1),  wgs(to)] },
      renderCoords: [...clR.coords.slice(0, -1), wgs(to)],
    }
  }

  if (Ld > 0) elements.push(transition(J1, b1, A1, Ld, a.signedR, Rn))

  const cvNew = computeCurvedValuesUtm(A1, A2, Rn)
  elements.push({
    elementType: 1,
    startNode: cvNew.startNode, endNode: cvNew.endNode,
    bearing: cvNew.bearing, length: arcLength, endBearing: cvNew.endBearing,
    radius: Rn,
    geometry:     { type: 'LineString', coordinates: arcCoordsFromRadiusUtm(A1, A2, Rn, SAGITTA_ELEMENT) || [wgs(A1), wgs(A2)] },
    renderCoords: arcCoordsFromRadiusUtm(A1, A2, Rn, SAGITTA_TRACK) || [wgs(A1), wgs(A2)],
  })

  if (La > 0) elements.push(transition(A2, bA2, E, La, Rn, null))

  // ── Re-shaped straight side (E → its far end) ────────────────────────────
  const svB = computeStraightValuesUtm(E, b.farUtm)
  elements.push({
    elementType: 0,
    startNode: svB.startNode, endNode: svB.endNode,
    bearing: svB.bearing, length: svB.length,
    geometry: { type: 'LineString', coordinates: [wgs(E), wgs(b.farUtm)] },
  })

  const ordered = arcIsDeparture ? elements : [...elements].reverse().map(reverseElement)
  const previewCoords = ordered.reduce((acc, el, i) => {
    const c = el.renderCoords ?? el.geometry.coordinates
    return i === 0 ? [...c] : [...acc, ...c.slice(1)]
  }, [])

  return {
    elements: ordered, previewCoords,
    arcLength, signedR: Rn,
    clothoidDepLength: clothoidDep, clothoidArrLength: clothoidArr,
    transitionType, zone,
  }
}
