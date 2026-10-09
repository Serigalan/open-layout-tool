import { utmToWgs84 } from '../coordinateUtils'
import { bearingAfterUtm, computeStraightValuesUtm, computeCurvedValuesUtm } from '../elementUtils'
import { switchElementMark } from '../switchModel'
import { arcElement, straightElement } from '../elementFactory'
import { STRAIGHT_CURVATURE } from './catalogue'
import { negR, routeCoords, utmEndRoute } from './route'

// Crossings and crossing switches: their angle, legs and geometry.

// ── Crossings and crossing switches (AP 3.2, AP 3.4) ────────────────────────
//
// A crossing is two routes that cross instead of parting, so it has no toe and
// no branch: its geometry is stated from the crossing point, and its two
// routes are the crossing legs. A crossing switch adds connecting routes
// between the legs' ends, one per slip route.
//
// In every form but one the legs are straights and the connecting routes arcs
// tangential to both. The Bogenkreuzungsweiche (EBKW, DBKW — AP 3.4) turns
// that round: its legs are arcs of one radius, curved the same way (`Rk`), and
// its connecting routes are what that leaves — on the legs' convex side a
// straight, and on their concave side, in the DBKW only, an arc tighter than
// either leg (`Ri`).

/** Crossing angle of a form [rad], stated as its slope (1:9). */
export function crossingAngle(type) {
  return Math.atan(1 / type.ratio)
}

/**
 * Radius of a form's crossing legs [m], unsigned — null where they are
 * straights, which is every form but the Bogenkreuzungsweiche.
 */
export function crossingLegRadius(type) {
  return type?.Rk ?? null
}

/**
 * Signed radius of a form's legs as they run A→C and B→D (positive = right),
 * for a cross route leaving on the side `crossAngleDeg` states — null for
 * straight legs. Both legs of a Bogenkreuzungsweiche curve the same way, and
 * away from the side its cross route leaves on: only then is the connecting
 * route A→D the straight one, and A→D is the single slip's one route
 * (switchModel), which in an EBKW is its straight.
 */
export function crossingLegSignedRadius(type, crossAngleDeg) {
  const R = crossingLegRadius(type)
  if (!R) return null
  return crossAngleDeg >= 0 ? -R : R
}

/**
 * How far each of a crossing's four ends lies from the crossing point [m],
 * measured along its leg.
 *
 * The plain crossing states it outright: `lt`, its tangent, is this distance.
 * So does the Bogenkreuzungsweiche, as `lb` — the length of its curved legs
 * from the crossing point to each end, which makes its whole length
 * l_KW = 2·l_b (the client's decision of 2026-09-22, OP.W.02). A crossing
 * switch with straight legs states neither: its ends are the tangent points of
 * its connecting curves, R·tan(α/2) along each leg — the curves are tangential
 * to both, which is what places them.
 */
export function crossingEndDistance(type) {
  return type.lt ?? type.lb ?? type.R * Math.tan(crossingAngle(type) / 2)
}

/**
 * The connecting curve of a slip route between straight legs, as a route
 * running from one leg to the other: an arc on the form's radius, tangential to
 * both legs, turning through the crossing angle. `side` says which pair of ends
 * it joins — 'left' or 'right' of the main route's running direction.
 */
function slipRoute(type, side) {
  const a = crossingAngle(type)
  const sign = side === 'left' ? -1 : 1
  return { length: type.R * a, r1: sign * type.R, r2: sign * type.R }
}

/**
 * A route on a given radius — null for a straight — from one plane point to
 * another: the chord, or the arc on that radius over it. With both ends and
 * the radius fixed, the bearing is what is left to follow; this is how a
 * Bogenkreuzungsweiche's connecting routes lie exactly on the ports they join.
 * Its polyline starts and ends on the caller's WGS84 twins of the two points.
 */
function routeBetween(fromUtm, fromWgs, toUtm, toWgs, signedR) {
  if (!signedR) {
    const v = computeStraightValuesUtm(fromUtm, toUtm)
    return { route: { length: v.length, r1: null, r2: null }, coords: [fromWgs, toWgs] }
  }
  const v = computeCurvedValuesUtm(fromUtm, toUtm, signedR)
  const route = { length: v.length, r1: signedR, r2: signedR }
  const coords = routeCoords(fromUtm, fromWgs, v.bearing, route, toWgs)
  coords[coords.length - 1] = toWgs
  return { route, coords }
}

/**
 * One wedge of a crossing's body as a closed ring: from the end of `toP` across
 * to the end of `toQ`, back along `toQ` to the crossing point and out along
 * `toP` again — both legs given as they run from the crossing point, as WGS84
 * or plane pairs alike. On straight legs this is the triangle P, Q, O, P; on a
 * Bogenkreuzungsweiche's its two long sides follow the legs' curves.
 */
export function crossingWedgeRing(toP, toQ) {
  return [toP[toP.length - 1], ...[...toQ].reverse(), ...toP.slice(1)]
}

/**
 * Where a crossing lies whose port A is `portUtm`, its main leg leaving there
 * on `bearing` towards the crossing point: the crossing point, and the main
 * leg's bearing at it — which a curved leg has turned by on the way.
 */
function crossingCentreFromPortA(portUtm, bearing, type, crossAngleDeg) {
  const t = crossingEndDistance(type)
  const r = crossingLegSignedRadius(type, crossAngleDeg)
  return {
    centreUtm: utmEndRoute(portUtm, bearing, t, r),
    bearing: bearingAfterUtm(bearing, t, r),
  }
}

/**
 * Does a stretch of track carry the leg `signedR` states — given as the pieces
 * a placement walked along it from the crossing point (placeSwitchOnTrack), in
 * the direction it walked? A straight leg wants straight track under it; a
 * Bogenkreuzungsweiche's the arc of its own radius and sense, to within what
 * counts as straight here. Anything else would lay the body beside the line it
 * is meant to be part of.
 */
export function crossingLegFitsTrack(pieces, signedR) {
  return piecesOnRadius(pieces, signedR)
}

/**
 * Do the pieces of a route all run on `signedR` — straight for null — to within
 * what counts as straight here? What a body that is laid into a track, rather
 * than onto it, asks of the track under it.
 */
export function piecesOnRadius(pieces, signedR) {
  if (!signedR) return pieces.every(p => p.r1 == null && p.r2 == null)
  const k = 1 / signedR
  const on = (r) => r != null && Math.abs(1 / r - k) < STRAIGHT_CURVATURE
  return pieces.every(p => on(p.r1) && on(p.r2))
}

/**
 * Geometry of a crossing or crossing switch, in the plane of `epsg`.
 *
 * The crossing point is `centreUtm`; the main route (A→C) runs through it on
 * `bearing`, the cross route (B→D) at the crossing angle to its right —
 * `crossAngle` signed in degrees, positive = the cross route turns right off
 * the main one. Each leg reaches `crossingEndDistance` along itself to either
 * side of the crossing point, so the point is its middle and the four ports
 * are its ends:
 *
 *   portA  main route, against the bearing   portC  main route, along it
 *   portB  cross route, against its bearing  portD  cross route, along it
 *
 * The legs are straights, or in a Bogenkreuzungsweiche one arc each through
 * the crossing point, both curved away from the cross route's side
 * (crossingLegSignedRadius).
 *
 * The slip routes join the ends on each side of the crossing point: `slip1`
 * (A→D) the pair the main route leaves on one side, `slip2` (B→C) the pair on
 * the other. Between straight legs both are arcs tangential to the legs at the
 * ports; the single slip builds only slip1. In a Bogenkreuzungsweiche each runs
 * on its catalogue radius from port to port — slip1 straight, slip2 on `Ri` —
 * which is three measures holding at once that the delivered row does not
 * quite reconcile: with the legs' R, the angle 1:9 and l_b all binding, the
 * straight meets the legs 0.107 mrad off their tangent and the inner
 * arc 0.019 mrad off, instead of exactly on it (OP.W.02).
 *
 * Returns everything the dialogs, the symbol and the plan export read:
 *   mainCoords, crossCoords   the two legs as WGS84 polylines, A→C and B→D
 *   legCoords                 each leg on its own as it is committed: A and B
 *                              into the crossing point, C and D out of it
 *   mainLegR, crossLegR       the legs' signed radii, A→C and B→D (null: straight)
 *   slip1Coords, slip2Coords  the connecting routes, or null where the kind has none
 *   slip1Route, slip2Route    the same as routes, running A→D and B→C
 *   fillCoords                the body: the two wedges between the legs at the acute
 *                              crossing angle, as a pair of closed rings
 *   portA..portD              the four ends as [easting, northing]
 *   portA_wgs..portD_wgs      the same as WGS84
 *   mainEndDistance           how far each end lies from the crossing point [m]
 *   centreUtm                 the crossing point itself
 *   mainBearing, crossBearing the legs' bearings at it
 */
export function computeCrossingGeometryUtm(centreUtm, bearing, type, crossAngleDeg, startWgsMain = null, startWgsCross = null, epsg = null) {
  const zone   = epsg ?? centreUtm.zone
  const centre = { ...centreUtm, zone }
  const t      = crossingEndDistance(type)
  const crossBearing = (bearing + crossAngleDeg + 360) % 360
  const legR   = crossingLegSignedRadius(type, crossAngleDeg)
  // Run backwards from the crossing point, the same arc bends the other way.
  const backR  = negR(legR)
  const behind = (b) => (b + 180) % 360

  // The four ends, each t along its leg from the crossing point. Their
  // polylines end on the caller's WGS84 twins of the ports, so the joins with
  // the tracks there are exact.
  const aUtm = utmEndRoute(centre, behind(bearing), t, backR)
  const cUtm = utmEndRoute(centre, bearing, t, legR)
  const bUtm = utmEndRoute(centre, behind(crossBearing), t, backR)
  const dUtm = utmEndRoute(centre, crossBearing, t, legR)
  const aWgs = startWgsMain ?? utmToWgs84(aUtm.easting, aUtm.northing, zone)
  const cWgs = utmToWgs84(cUtm.easting, cUtm.northing, zone)
  const bWgs = startWgsCross ?? utmToWgs84(bUtm.easting, bUtm.northing, zone)
  const dWgs = utmToWgs84(dUtm.easting, dUtm.northing, zone)
  const oWgs = utmToWgs84(centre.easting, centre.northing, zone)

  // Each leg from the crossing point out to its port.
  const leg = (legBearing, r, portWgs) => {
    const coords = routeCoords(centre, oWgs, legBearing, { length: t, r1: r, r2: r }, portWgs)
    coords[coords.length - 1] = portWgs
    return coords
  }
  const toA = leg(behind(bearing), backR, aWgs)
  const toC = leg(bearing, legR, cWgs)
  const toB = leg(behind(crossBearing), backR, bWgs)
  const toD = leg(crossBearing, legR, dWgs)
  const reversed = (coords) => [...coords].reverse()

  // The slip routes. Each joins two ends on opposite sides of the crossing
  // point: slip1 the pair A–D, slip2 the pair B–C.
  const hasSlip1 = type.kind === 'single_slip' || type.kind === 'double_slip'
  const hasSlip2 = type.kind === 'double_slip'
  let slip1 = null
  let slip2 = null
  if (legR == null) {
    // Between straight legs the arc leaves each leg tangentially, running
    // *towards* the crossing point at its start port and away from it at its
    // end port, turning through the crossing angle — so its centre lies in the
    // wedge between the two legs, and its tangent points sit at R·tan(α/2) from
    // the crossing point, which is where the ports are. The leg bearing at a
    // start port is the one running towards the crossing point: slip1 leaves A
    // along the main leg, slip2 leaves B along the cross.
    const crossRight = crossAngleDeg >= 0
    const buildSlip = (side, fromUtm, fromWgs, toWgs, legBearing) => {
      const route = slipRoute(type, side)
      return { route, coords: routeCoords(fromUtm, fromWgs, legBearing, route, toWgs) }
    }
    if (hasSlip1) slip1 = buildSlip(crossRight ? 'right' : 'left', aUtm, aWgs, dWgs, bearing)
    if (hasSlip2) slip2 = buildSlip(crossRight ? 'left' : 'right', bUtm, bWgs, cWgs, crossBearing)
  } else {
    // A Bogenkreuzungsweiche's straight lies on the legs' convex side, the
    // inner arc on their concave one, turning the way the legs do.
    if (hasSlip1) slip1 = routeBetween(aUtm, aWgs, dUtm, dWgs, null)
    if (hasSlip2) slip2 = routeBetween(bUtm, bWgs, cUtm, cWgs, Math.sign(legR) * type.Ri)
  }

  // The body: the two wedges between the legs at the acute crossing angle —
  // each from the crossing point out along both legs to the two ends on a
  // side, closed by the chord that spans them (the form's end measure c, the
  // 1.84 m the two ends on a side of a Kr 1:9 lie apart). The crossing kinds'
  // counterpart of a turnout's switchFillRing, as a pair of rings; the obtuse
  // wedges carry no body.
  const fillCoords = [crossingWedgeRing(toA, toB), crossingWedgeRing(toC, toD)]

  return {
    kind: type.kind, label: type.label,
    mainCoords: [...reversed(toA), ...toC.slice(1)],
    crossCoords: [...reversed(toB), ...toD.slice(1)],
    legCoords: { A: reversed(toA), B: reversed(toB), C: toC, D: toD },
    mainLegR: legR, crossLegR: legR,
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
    centreUtm: centre,
    mainBearing: bearing,
    crossBearing,
  }
}

/**
 * The same, placed from its port A rather than from its crossing point: the
 * end-anchored dialog's crossing, whose main leg continues the picked element
 * at `portUtm` (its WGS84 twin `portWgs`) on `bearing`. Port A is the caller's
 * point exactly — the leg that ends there is appended to that element's track.
 */
export function computeCrossingGeometryFromPortA(portUtm, portWgs, bearing, type, crossAngleDeg) {
  const at = crossingCentreFromPortA(portUtm, bearing, type, crossAngleDeg)
  const g = computeCrossingGeometryUtm(at.centreUtm, at.bearing, type, crossAngleDeg, portWgs)
  return { ...g, portA: [portUtm.easting, portUtm.northing], portA_utm: portUtm }
}

/**
 * The elements a crossing kind is committed as, each marked with its route:
 * one per leg — A and B running into the crossing point, C and D out of it —
 * and one per connecting route. A piece that is straight becomes a straight
 * element, one that bends an arc of its own radius, so what is committed is the
 * body the geometry drew. Both crossing dialogs commit from here; the one that
 * lays a crossing into a track keeps its host's own elements for A and C.
 */
export function crossingElements(g, identity) {
  const piece = (fromUtm, toUtm, signedR, coords, route) => {
    const extra = { ...switchElementMark(identity, route), geometry: { type: 'LineString', coordinates: coords } }
    const el = signedR ? arcElement(fromUtm, toUtm, signedR, extra) : straightElement(fromUtm, toUtm, extra)
    // A crossing's legs are drawn by its body; they carry no coarse polyline of their own.
    const { renderCoords: _r, ...rest } = el
    return { ...rest, absLength: el.length }
  }
  return {
    A: piece(g.portA_utm, g.centreUtm, g.mainLegR, g.legCoords.A, 'main'),
    C: piece(g.centreUtm, g.portC_utm, g.mainLegR, g.legCoords.C, 'main'),
    B: piece(g.portB_utm, g.centreUtm, g.crossLegR, g.legCoords.B, 'cross'),
    D: piece(g.centreUtm, g.portD_utm, g.crossLegR, g.legCoords.D, 'cross'),
    slip1: g.slip1Route
      ? piece(g.portA_utm, g.portD_utm, g.slip1Route.r1, g.slip1Coords, 'slip1') : null,
    slip2: g.slip2Route
      ? piece(g.portB_utm, g.portC_utm, g.slip2Route.r1, g.slip2Coords, 'slip2') : null,
  }
}
