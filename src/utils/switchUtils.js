import { wgs84ToUTM, utmToWgs84 } from './coordinateUtils'
import { reverseElement, bearingAfterUtm, projectOnArcUtm } from './elementUtils'

// minl = minimum intermediate straight between two turnouts in a crossover [m].
// Primary table — checked first by the switch-connection calculation.
export const SWITCH_TYPES = [
  { label: '185 – 1:7',     R: 185,  ratio: 7,    speed: 40,  dLcs: 2.7,  minl: 6  },
  { label: '300 – 1:9',     R: 300,  ratio: 9,    speed: 50,  dLcs: 3.9,  minl: 5  },
  { label: '500 – 1:12',    R: 500,  ratio: 12,   speed: 60,  dLcs: 6.3,  minl: 6  },
  { label: '760 – 1:14',    R: 760,  ratio: 14,   speed: 80,  dLcs: 9.9,  minl: 12 },
  { label: '1200 – 1:18.5', R: 1200, ratio: 18.5, speed: 100, dLcs: 11,   minl: 15 },
  { label: '2500 – 1:26.5', R: 2500, ratio: 26.5, speed: 130, dLcs: 12.9, minl: 26 },
]

// First fallback — used when a primary type cannot reach its minl for the spacing.
export const SWITCH_TYPES_ALT1 = [
  { label: '300 – 1:9.4',     R: 300,  ratio: 9.4,    speed: 50,  dLcs: 3.9,  minl: 5  },
  { label: '500 – 1:14',      R: 500,  ratio: 14,     speed: 60,  dLcs: 6.3,  minl: 6  },
  { label: '760 – 1:15',      R: 760,  ratio: 15,     speed: 80,  dLcs: 9.9,  minl: 12 },
  { label: '1200 – 1:19.277', R: 1200, ratio: 19.277, speed: 100, dLcs: 11,   minl: 15 },
]

// Second fallback — used when both the primary and ALT1 type fail.
export const SWITCH_TYPES_ALT2 = [
  { label: '760 – 1:18.5', R: 760, ratio: 18.5, speed: 80, dLcs: 9.9, minl: 12 },
]

/** Any switch form, primary table or fallback, looked up by its label. */
export function switchTypeByLabel(label) {
  return [...SWITCH_TYPES, ...SWITCH_TYPES_ALT1, ...SWITCH_TYPES_ALT2].find(t => t.label === label) ?? null
}

export function switchArcLength(R, ratio) {
  return R * Math.atan(1 / ratio)
}

/**
 * Length of the through route of a switch form — the tangent polygon from the
 * toe to the switch end. A bent switch keeps it: bending moves no sleeper, it
 * only lays the same length on the stem's curvature instead of on a straight.
 */
export function switchStraightLength(R, ratio) {
  const arcLen = switchArcLength(R, ratio)
  return 2 * R * Math.tan(arcLen / (2 * R))
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

// ── Pure UTM helpers ────────────────────────────────────────────────────────

function utmEndStraight(utm, bearing, length) {
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
 *  all three draw the same curve. A straight is its two ends. */
export function switchRouteSegments(length, signedR) {
  return signedR ? Math.max(2, Math.ceil(length / SWITCH_STEP)) : 1
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
 * never sent through WGS84 and back.
 */
function routeCoords(originUtm, originWgs, bearing, length, signedR, endWgs) {
  return signedR
    ? [originWgs, ...utmArcCoords(originUtm, bearing, length, signedR).slice(1)]
    : [originWgs, endWgs]
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
function routeOffsetCoords(originUtm, bearing, length, signedR, offset, epsg) {
  const n = switchRouteSegments(length, signedR)
  const coords = []
  for (let i = 0; i <= n; i++) {
    const s = length * i / n
    const p = utmEndRoute(originUtm, bearing, s, signedR)
    const b = (bearingAfterUtm(bearing, s, signedR)) * Math.PI / 180
    coords.push(utmToWgs84(p.easting - offset * Math.cos(b), p.northing + offset * Math.sin(b), epsg))
  }
  return coords
}

/** Points of a switch route in the plane, stepped like everything else here. */
function routePointsUtm(originUtm, bearing, length, signedR) {
  const n = switchRouteSegments(length, signedR)
  const pts = []
  for (let i = 0; i <= n; i++) {
    const p = utmEndRoute(originUtm, bearing, length * i / n, signedR)
    pts.push([p.easting, p.northing])
  }
  return pts
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
 */
export function switchLabelGeometry(toeUtm, bearing, through, branch, epsg) {
  const centre = ringCentroid(switchFillRing(
    routePointsUtm(toeUtm, bearing, through.length, through.radius),
    routePointsUtm(toeUtm, bearing, branch.length, branch.radius)))
  const centreUtm = { easting: centre[0], northing: centre[1], zone: epsg }

  // Where the centre sits beside a route (positive to the left of the running
  // direction), and from that the offset a label needs to stand `d` from it on
  // the route's far side.
  const away = (route, d) => {
    const { perp } = projectOnArcUtm(toeUtm, centreUtm, bearing, route.radius ?? null)
    const c = -perp
    return c - Math.sign(c || 1) * d
  }
  return {
    labelCoords: routeOffsetCoords(toeUtm, bearing, through.length, through.radius,
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
 * Display symbol of a switch — the body between the branch and the through
 * route (fillCoords) and the LCS mark (lcsCoords), both WGS84 — rebuilt from
 * the tracks it joins. Port B1 names the branch: its element at the switch end
 * carries the node and the tangent direction, and the switch form named by
 * `label` gives both route lengths, so the symbol keeps the turnout's own
 * dimensions whatever the tracks do later. `mainRadius` is the stem radius of a
 * bent switch, signed in the direction the branch leaves the node; without one
 * the through route is straight. The record itself keeps only name, label,
 * trailing, speed, that radius and the ports, so the symbol can never disagree
 * with the tracks. Returns the record with the symbol set — or without one when
 * the branch is missing.
 */
export function rebuildSwitchSymbol(sw, trackById) {
  const {
    fillCoords: _f, lcsCoords: _l, labelCoords: _lc, bodyCentre: _bc, bauform: _b, ...rest
  } = sw
  const branch = trackById[sw.portB1_trackId]
  const els    = branch?.elements ?? []
  if (!els.length) return rest
  const stored = sw.portB1_endpoint === 'END' ? els[els.length - 1] : els[0]
  // Oriented away from the node, whichever end of the track the switch is at.
  const arcEl  = sw.portB1_endpoint === 'END' ? reverseElement(stored) : stored
  const arc    = arcEl.geometry?.coordinates ?? []
  if (arc.length < 2 || !(arcEl.length > 0) || !arcEl.startNode || !arcEl.endNode) return rest

  const epsg = branch.epsg
  const type = switchTypeByLabel(sw.label)
  // Through route length: the form's, so a bent switch (whose branch element
  // carries the *combined* radius) still gets its own dimension. A record whose
  // label no longer resolves falls back to the branch's own tangent length.
  const absR    = Math.abs(arcEl.radius ?? 0)
  const mainLen = type ? switchStraightLength(type.R, type.ratio)
    : absR > 0 ? 2 * absR * Math.tan(arcEl.length / (2 * absR))
      : null
  if (mainLen == null) return rest

  const stemR      = asRadius(sw.mainRadius)
  const nodePt     = { easting: arcEl.startNode[0], northing: arcEl.startNode[1], zone: epsg }
  const mainEndUtm = utmEndRoute(nodePt, arcEl.bearing, mainLen, stemR)
  const mainEndWgs = utmToWgs84(mainEndUtm.easting, mainEndUtm.northing, epsg)
  const mainCoords = routeCoords(nodePt, arc[0], arcEl.bearing, mainLen, stemR, mainEndWgs)
  // The branch is drawn from the element's own node, bearing, length and radius
  // rather than from its stored polyline: same curve, same source of truth, but
  // stepped like every other switch route — a branch element saved at some other
  // density would otherwise give the symbol a different outline after a reload.
  const branchCoords = routeCoords(nodePt, arc[0], arcEl.bearing, arcEl.length,
    asRadius(arcEl.radius), arc[arc.length - 1])
  const lcsCoords  = type
    ? lcsLine([nodePt.easting, nodePt.northing], arcEl.endNode,
      [mainEndUtm.easting, mainEndUtm.northing], type.dLcs, epsg)
    : null
  return {
    ...rest,
    fillCoords: switchFillRing(mainCoords, branchCoords),
    ...switchLabelGeometry(nodePt, arcEl.bearing,
      { length: mainLen, radius: stemR },
      { length: arcEl.length, radius: asRadius(arcEl.radius) }, epsg),
    bauform: bauform(stemR, asRadius(arcEl.radius)),
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
 */
export function computeSwitchGeometryUtm(startUtm, bearing, sw, side, trailing, startWgs = null, mainR = null) {
  const arcLen      = switchArcLength(sw.R, sw.ratio)
  const straightLen = switchStraightLength(sw.R, sw.ratio)
  const formR       = side === 'left' ? -sw.R : sw.R
  const mainSignedR = asRadius(mainR)

  const sWgs = startWgs ?? utmToWgs84(startUtm.easting, startUtm.northing, startUtm.zone)

  // Through route: the form's through length, laid on the stem's curvature.
  const straightUtm    = utmEndRoute(startUtm, bearing, straightLen, mainSignedR)
  const mainEndBearing = bearingAfterUtm(bearing, straightLen, mainSignedR)

  // The branch leaves the toe — the start point of a facing switch, the far end
  // of a trailing one taken against the through route. Reversing that direction
  // flips the sign of the stem radius the branch's curvature is added to.
  const arcOriginUtm = trailing ? straightUtm : startUtm
  const curveBearing = trailing ? (mainEndBearing + 180) % 360 : bearing
  const stemAtToe    = mainSignedR == null ? null : (trailing ? -mainSignedR : mainSignedR)
  const signedR      = branchRadius(formR, stemAtToe)
  const curvedUtm    = utmEndRoute(arcOriginUtm, curveBearing, arcLen, signedR)

  // Ports as UTM [easting, northing]
  const portA  = trailing ? [straightUtm.easting, straightUtm.northing] : [startUtm.easting, startUtm.northing]
  const portB1 = [curvedUtm.easting, curvedUtm.northing]
  const portB2 = trailing ? [startUtm.easting, startUtm.northing] : [straightUtm.easting, straightUtm.northing]

  // WGS84 coords for map rendering
  const straightEnd  = utmToWgs84(straightUtm.easting, straightUtm.northing, startUtm.zone)
  const arcOriginWgs = trailing ? straightEnd : sWgs
  const curvedEnd    = utmToWgs84(curvedUtm.easting, curvedUtm.northing, startUtm.zone)
  const straightCoords = routeCoords(startUtm, sWgs, bearing, straightLen, mainSignedR, straightEnd)
  const arcCoords      = routeCoords(arcOriginUtm, arcOriginWgs, curveBearing, arcLen, signedR, curvedEnd)

  const portA_wgs  = trailing ? straightEnd : sWgs
  const portB1_wgs = curvedEnd
  const portB2_wgs = trailing ? sWgs : straightEnd

  const lcsCoords = lcsLine(portA, portB1, portB2, sw.dLcs, startUtm.zone)

  // The symbol, built once here so every caller draws the same turnout. Both
  // routes have to run from the toe: a trailing switch's through route is built
  // towards it, so it turns round for the ring.
  const throughFromToe = trailing ? [...straightCoords].reverse() : straightCoords
  const fillCoords = switchFillRing(throughFromToe, arcCoords)
  const labelGeom = switchLabelGeometry(arcOriginUtm, curveBearing,
    { length: straightLen, radius: stemAtToe },
    { length: arcLen, radius: signedR }, startUtm.zone)

  return {
    straightCoords, arcCoords, fillCoords, ...labelGeom,
    bauform: bauform(stemAtToe, signedR),
    portA, portB1, portB2,
    portA_wgs, portB1_wgs, portB2_wgs,
    lcsCoords,
    straightEnd, arcOrigin: arcOriginWgs, curvedEnd,
    startUtm, straightUtm, arcOriginUtm, curvedUtm,
    signedR, mainSignedR, stemAtToe,
    curveBearing, mainEndBearing, arcLen, straightLen,
  }
}
