import { utmToWgs84 } from './coordinateUtils'
import { computeClothoidUtm, transitionShift } from './clothoidUtils'
import { computeCurvedValuesUtm, computeStraightValuesUtm, arcCoordsFromRadiusUtm } from './elementUtils'
import { SAGITTA_ELEMENT, SAGITTA_TRACK } from './mapConstants'

const DEG2RAD = Math.PI / 180
const RAD2DEG = 180 / Math.PI

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
