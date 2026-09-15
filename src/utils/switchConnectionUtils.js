import { utmToWgs84 } from './coordinateUtils'
import {
  arcCoordsFromRadiusUtm, computeCurvedValuesUtm, computeStraightValuesUtm,
} from './elementUtils'
import { SAGITTA_ELEMENT, SAGITTA_TRACK, MAX_SWITCH_CANT_DEF, computeCantDef } from './mapConstants'
import {
  SWITCH_TYPES, SWITCH_TYPES_ALT1, SWITCH_TYPES_ALT2, STRAIGHT_CURVATURE,
} from './switchUtils'

const DEG2RAD = Math.PI / 180

export { SWITCH_TYPES }

/**
 * A switch connection (Gleisverbindung) is two turnouts of one form facing each
 * other, laid into the two tracks they join. That fixes almost everything about
 * it: each turnout sits on its own track, so its branch leaves that track at the
 * form's own angle w = atan(1/n) on the form's own radius R. Neither angle nor
 * radius is a free parameter — a solver that bends them produces a curve no
 * turnout can build, and the switch symbol drawn from the form then misses it.
 *
 * What is left free is the element between the two branch ends, and it is fully
 * determined by the tracks: the branch of turnout 1 runs at ψ1 + w, the branch
 * of turnout 2 arrives at ψ2 + w, so the element between them must turn by
 * exactly δ = ψ2 − ψ1 — the angle between the two tracks. Parallel tracks
 * (δ = 0) give the classical Zwischengerade; tracks that converge or diverge
 * slightly give a Zwischenbogen of radius Lg/δ. There is no third case and no
 * residual kink at either end: the connection leaves track 1 and meets track 2
 * tangentially whatever δ is.
 *
 * That leaves one unknown, the length Lg of that middle element, against one
 * condition — the far end must land on track 2. Both the middle element's chord
 * and the second branch's displacement are linear in Lg, so it solves in closed
 * form (see solveSwitchConnection); no iteration, no convergence to fail.
 *
 * The construction stops being a switch connection when the middle element gets
 * too short to lie between two reverse curves (Lg < minl) or so sharp that it
 * exceeds the cant deficiency the design speed allows — which is what "these
 * two tracks are not parallel enough" actually means, measured on the geometry
 * instead of on a bearing tolerance.
 */

/** Signed turn from a1 to a2, in (−π, π]. */
function normalizeAngle(a) {
  const r = ((a + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI
  return r === -Math.PI ? Math.PI : r
}

/** From (E, N) heading psi, turn by the signed angle d on radius r → [E, N, heading]. */
function arcStep(E, N, psi, d, r) {
  const sg = Math.sign(d) || 1
  const psiE = psi + d
  return [
    E + sg * r * (Math.sin(psiE) - Math.sin(psi)),
    N - sg * r * (Math.cos(psiE) - Math.cos(psi)),
    psiE,
  ]
}

// Fallback chain for a speed: primary type → ALT1 → ALT2.
function fallbackChain(speed) {
  return [SWITCH_TYPES, SWITCH_TYPES_ALT1, SWITCH_TYPES_ALT2]
    .map(table => table.find(s => s.speed === speed))
    .filter(Boolean)
}

/**
 * The two tracks reduced to the frame the construction runs in: line 1 oriented
 * towards line 2, line 2 oriented with it, their angle δ, the side line 2 lies
 * on and the track spacing at TP1. Everything downstream is expressed in it.
 */
function connectionFrame(g1Start, g1Bearing, g2Start, g2Bearing, s) {
  const u1E = Math.sin(g1Bearing * DEG2RAD), u1N = Math.cos(g1Bearing * DEG2RAD)
  let u2E = Math.sin(g2Bearing * DEG2RAD),   u2N = Math.cos(g2Bearing * DEG2RAD)
  // Track 2 may be digitised against track 1; the line is what counts, not the
  // direction it was drawn in.
  if (u1E * u2E + u1N * u2N < 0) { u2E = -u2E; u2N = -u2N }

  const psi1 = Math.atan2(u1N, u1E)                 // math angle (CCW from East)
  const delta = normalizeAngle(Math.atan2(u2N, u2E) - psi1)

  // Start point: g1Start slid along line 1 by s metres (stays on line 1).
  const TP1 = {
    easting:  g1Start.easting  + s * u1E,
    northing: g1Start.northing + s * u1N,
    zone: g1Start.zone,
  }

  const n1E = -u1N, n1N = u1E                       // left normal of line 1
  const n2E = -u2N, n2N = u2E                       // left normal of line 2
  const dE = g2Start.easting - TP1.easting, dN = g2Start.northing - TP1.northing
  const side = Math.sign(dE * n1E + dN * n1N) || 1  // which side line 2 is on
  const gap  = Math.abs(dE * n2E + dN * n2N)        // track spacing at TP1

  return { TP1, psi1, delta, side, gap, u1E, u1N, n2E, n2N }
}

/**
 * The connection built from one switch form, in the frame above. Both branch
 * arcs are the form's (radius R, turn ±w); the middle element turns by δ and its
 * length Lg is solved so TP2 lands on line 2.
 *
 * TP2(Lg) = C + Lg·k·û: the middle element's chord is Lg·k long on the bearing
 * that bisects its turn (k = sin(δ/2)/(δ/2), 1 for a straight), and the second
 * branch's displacement from B2A does not depend on Lg at all — so the far end
 * runs along a line as Lg grows and meets line 2 once.
 */
function buildConnection(sw, frame, g2Start, speed) {
  const { TP1, psi1, delta, side, n2E, n2N } = frame
  const R = sw.R
  const w = Math.atan(1 / sw.ratio)
  const alpha1 = side * w, alpha2 = -side * w

  const [b1eE, b1eN, psiMid] = arcStep(TP1.easting, TP1.northing, psi1, alpha1, R)

  // Second branch: entered at psiMid + δ, leaving parallel to line 2.
  const psiIn = psiMid + delta, psiEnd = psiIn + alpha2
  const sg2 = Math.sign(alpha2) || 1
  const a2E =  sg2 * R * (Math.sin(psiEnd) - Math.sin(psiIn))
  const a2N = -sg2 * R * (Math.cos(psiEnd) - Math.cos(psiIn))

  // Middle element: chord Lg·k on the bearing halfway through its turn.
  const half = delta / 2
  const k  = Math.abs(half) < 1e-12 ? 1 : Math.sin(half) / half
  const uE = Math.cos(psiMid + half), uN = Math.sin(psiMid + half)
  const Cx = b1eE + a2E, Cy = b1eN + a2N

  const denom = k * (uE * n2E + uN * n2N)
  const Lg = Math.abs(denom) > 1e-9
    ? ((g2Start.easting - Cx) * n2E + (g2Start.northing - Cy) * n2N) / denom
    : NaN

  const chord = Lg * k
  const B2A = { easting: b1eE + chord * uE, northing: b1eN + chord * uN, zone: TP1.zone }
  const TP2 = { easting: Cx   + chord * uE, northing: Cy   + chord * uN, zone: TP1.zone }

  // Middle radius, signed the project's way (positive = right-hand curve): a
  // left turn (δ > 0) runs on a negative radius. Below the project's straight
  // threshold it is a straight — beyond ~1e7 m the radius is numerical noise
  // anyway, and over a middle element that curvature stays under a tenth of a
  // millimetre.
  const curvature = Lg > 0 ? delta / Lg : 0
  const signedRg = Math.abs(curvature) < STRAIGHT_CURVATURE ? null : -1 / curvature

  // Why it is not a connection, in the order an engineer would hit it.
  const cantDef = signedRg ? computeCantDef(speed, signedRg, 0) : 0
  const reason =
    !Number.isFinite(Lg)               ? 'no_solution'
      : Lg < sw.minl                   ? 'too_short'
        : cantDef > MAX_SWITCH_CANT_DEF ? 'too_sharp'
          : null

  return {
    sw, R, w, alpha1, alpha2, side, delta,
    TP1, B1E: { easting: b1eE, northing: b1eN, zone: TP1.zone }, B2A, TP2,
    Lg, signedRg, cantDef,
    signedR1: -side * R, signedR2: side * R,
    L1: R * w, L2: R * w,
    valid: reason === null, reason,
  }
}

/**
 * Which primary speeds this pair of tracks can be connected with at the given
 * shift — drives the dropdown's disabled state. A speed counts as available
 * when any form in its fallback chain builds a valid connection.
 */
export function computeSwitchConnections(g1Start, g1Bearing, g2Start, g2Bearing, s = 0) {
  const frame = connectionFrame(g1Start, g1Bearing, g2Start, g2Bearing, s)
  return SWITCH_TYPES.map(p => ({
    speed: p.speed,
    valid: fallbackChain(p.speed).some(sw => buildConnection(sw, frame, g2Start, p.speed).valid),
  }))
}

/**
 * Switch connection between two straight tracks for a selected speed. The form
 * is resolved through the primary → ALT1 → ALT2 fallback (the first one that
 * builds a valid connection; the last one tried when none does, so the caller
 * can say why). Result plugs into buildConnectionElements + the preview helpers.
 *
 * @param {object} g1Start   { easting, northing, zone } — point on track 1
 * @param {number} g1Bearing bearing of track 1 [deg], oriented towards track 2
 * @param {object} g2Start   { easting, northing, zone } — point on track 2
 * @param {number} g2Bearing bearing of track 2 [deg], either way round
 * @param {number} speed     selected design speed [km/h]
 * @param {number} s         shift of the first toe TP1 along track 1 [m]
 */
export function solveSwitchConnection(g1Start, g1Bearing, g2Start, g2Bearing, speed, s = 0) {
  const zone  = g1Start.zone
  const frame = connectionFrame(g1Start, g1Bearing, g2Start, g2Bearing, s)

  const chain = fallbackChain(speed)
  let c = null
  for (const sw of chain) {
    c = buildConnection(sw, frame, g2Start, speed)
    if (c.valid) break
  }
  if (!c) return null

  // A degenerate pick — the middle element running parallel to track 2 — has no
  // far end at all, so it comes back before anything is derived from one (the
  // projection would throw on the non-finite point).
  if (!Number.isFinite(c.Lg)) {
    return {
      TP1: c.TP1, R: c.R, w: c.w, delta: c.delta, Lg: c.Lg, signedRg: null,
      arc1Coords: null, arc2Coords: null, midCoords: [], allCoords: [],
      valid: false, reason: c.reason, zone, gap: frame.gap, switchType: c.sw,
    }
  }

  const { TP1, B1E, B2A, TP2, signedR1, signedR2, signedRg } = c

  const arc1Coords       = c.valid ? arcCoordsFromRadiusUtm(TP1, B1E, signedR1, SAGITTA_ELEMENT) : null
  const arc1CoordsRender = c.valid ? arcCoordsFromRadiusUtm(TP1, B1E, signedR1, SAGITTA_TRACK)   : null
  const arc2Coords       = c.valid ? arcCoordsFromRadiusUtm(B2A, TP2, signedR2, SAGITTA_ELEMENT) : null
  const arc2CoordsRender = c.valid ? arcCoordsFromRadiusUtm(B2A, TP2, signedR2, SAGITTA_TRACK)   : null

  const tp1Wgs = utmToWgs84(TP1.easting, TP1.northing, zone)
  const b1eWgs = utmToWgs84(B1E.easting, B1E.northing, zone)
  const b2aWgs = utmToWgs84(B2A.easting, B2A.northing, zone)
  const tp2Wgs = utmToWgs84(TP2.easting, TP2.northing, zone)

  // The middle element's polyline: its two ends when straight, an arc otherwise.
  // Both keep the neighbours' own WGS84 points, so the joins stay exact.
  const midArc = (sagitta) => {
    const a = arcCoordsFromRadiusUtm(B1E, B2A, signedRg, sagitta)
    return a ? [b1eWgs, ...a.slice(1, -1), b2aWgs] : [b1eWgs, b2aWgs]
  }
  const midCoords       = c.valid && signedRg ? midArc(SAGITTA_ELEMENT) : [b1eWgs, b2aWgs]
  const midCoordsRender = c.valid && signedRg ? midArc(SAGITTA_TRACK)   : [b1eWgs, b2aWgs]

  const allCoords = [...(arc1Coords ?? []), ...midCoords.slice(1), ...((arc2Coords ?? []).slice(1))]
  const valid = c.valid && !!arc1Coords && !!arc2Coords

  // Construction length: TP1 → TP2 projected on track 1 — the Verbindungslänge
  // the connection takes up along the track it leaves.
  const laenge = (TP2.easting - TP1.easting) * frame.u1E + (TP2.northing - TP1.northing) * frame.u1N

  return {
    TP1, B1E, B2A, TP2,
    tp1Wgs, b1eWgs, b2aWgs, tp2Wgs,
    alpha1: c.alpha1, alpha2: c.alpha2, delta: c.delta,
    R: c.R, w: c.w, L1: c.L1, L2: c.L2, Lg: c.Lg,
    signedR1, signedR2, signedRg,
    cantDef: c.cantDef,
    arc1Coords, arc1CoordsRender, arc2Coords, arc2CoordsRender,
    midCoords, midCoordsRender,
    allCoords,
    valid, reason: c.reason,
    zone,
    gap: frame.gap, laenge, switchType: c.sw,
  }
}

/**
 * The three track elements of a solved connection — branch arc, middle element,
 * branch arc — ready to go into a track. The middle one is a straight or an arc
 * exactly as the solution made it.
 */
export function buildConnectionElements(result, speed) {
  const { TP1, B1E, B2A, TP2, signedR1, signedR2, signedRg,
          arc1Coords, arc1CoordsRender, arc2Coords, arc2CoordsRender,
          midCoords, midCoordsRender } = result

  const cv1 = computeCurvedValuesUtm(TP1, B1E, signedR1)
  const arc1El = {
    elementType: 1,
    startNode:  cv1.startNode,
    endNode:    cv1.endNode,
    bearing:    cv1.bearing,
    length:     cv1.length,
    absLength:  cv1.length,
    speed,
    endBearing: cv1.endBearing,
    radius:     signedR1,
    geometry:     { type: 'LineString', coordinates: arc1Coords },
    renderCoords: arc1CoordsRender,
  }

  const cvM = signedRg
    ? computeCurvedValuesUtm(B1E, B2A, signedRg)
    : computeStraightValuesUtm(B1E, B2A)
  const midEl = {
    elementType: signedRg ? 1 : 0,
    startNode: cvM.startNode,
    endNode:   cvM.endNode,
    bearing:   cvM.bearing,
    length:    cvM.length,
    absLength: cvM.length,
    speed,
    ...(signedRg ? { endBearing: cvM.endBearing, radius: signedRg, renderCoords: midCoordsRender } : {}),
    geometry:  { type: 'LineString', coordinates: midCoords },
  }

  const cv2 = computeCurvedValuesUtm(B2A, TP2, signedR2)
  const arc2El = {
    elementType: 1,
    startNode:  cv2.startNode,
    endNode:    cv2.endNode,
    bearing:    cv2.bearing,
    length:     cv2.length,
    absLength:  cv2.length,
    speed,
    endBearing: cv2.endBearing,
    radius:     signedR2,
    geometry:     { type: 'LineString', coordinates: arc2Coords },
    renderCoords: arc2CoordsRender,
  }

  return { arc1El, midEl, arc2El }
}
