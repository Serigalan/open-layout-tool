import { utmToWgs84 } from './coordinateUtils'
import {
  arcCoordsFromRadiusUtm, computeCurvedValuesUtm, computeStraightValuesUtm, projectOnArcUtm,
} from './elementUtils'
import {
  SAGITTA_ELEMENT, SAGITTA_TRACK, MAX_SWITCH_CANT, MAX_SWITCH_CANT_DEF, computeCantDefSigned,
} from './mapConstants'
import {
  SWITCH_TYPES, SWITCH_TYPES_ALT1, SWITCH_TYPES_ALT2, STRAIGHT_CURVATURE,
  switchArcLength, switchStraightLength, branchRadius, asRadius,
} from './switchUtils'

const DEG2RAD = Math.PI / 180
const RAD2DEG = 180 / Math.PI

export { SWITCH_TYPES }

/**
 * A switch connection (Gleisverbindung) is two turnouts of one form facing each
 * other, laid into the two tracks they join. That fixes almost everything about
 * it: each turnout sits on its own track, so its branch leaves that track at the
 * form's own angle w = atan(1/n) — at every station, bent or not. Neither angle
 * nor form radius is a free parameter; a solver that bends them produces a curve
 * no turnout can build, and the switch symbol drawn from the form then misses it.
 *
 * **On a straight** that leaves one unknown against one condition. Both branches
 * turn by ±w, so the element between them must turn by exactly δ = ψ₂ − ψ₁, the
 * angle between the two tracks; its length Lg is the only freedom, and the far
 * end landing on track 2 is the only condition. Chord and displacement are both
 * linear in Lg, so it solves in closed form — no iteration, no convergence to
 * fail. Parallel tracks (δ = 0) give the classical Zwischengerade, tracks that
 * converge slightly a Zwischenbogen of radius Lg/δ.
 *
 * **In a curve none of that survives.** A turnout laid into a curve is a bent
 * turnout: both of its routes take the stem's curvature on top of their own
 * (branchRadius), so the branch radius is no longer the form's R, and the angle
 * the branch has turned through in the plane is no longer ±w but the stem's turn
 * plus it. Worse, the tangent of track 2 now depends on *where* the second
 * turnout sits, so the middle element's turn is not known before the position
 * is. The construction has to be solved rather than written down.
 *
 * What it is solved over: the two toe stations s₁ and s₂. s₁ is the freedom the
 * dialog's slider offers; s₂ is the unknown. The middle element is *defined* as
 * the arc that leaves the first branch's end on its tangent and turns by
 * Δ = t₂ − t₁, so it meets the second branch tangentially whatever s₂ is —
 * tangent continuity is by construction, at both ends, and what is left is
 * position. An arc of a given turn reaches, as its length grows, along the ray
 * that bisects that turn, so the one condition is that the second branch's end
 * lies on that ray:
 *
 *     r(s₂) = (B2A − B1E) · n̂(t₁ + Δ/2)   →   0,
 *
 * a signed distance in metres, smooth in s₂, and **linear** in it wherever
 * track 2 is straight — so the secant iteration below lands on the straight
 * case's exact answer in a single step and there is only one construction here,
 * not a curved one beside a straight one.
 *
 * The construction stops being a switch connection when the middle element gets
 * too short to lie between two reverse curves (Lg < minl), when its curve or a
 * bent branch exceeds the cant deficiency the design speed allows, or when the
 * cant the two tracks carry is not the same — a crossover between tracks at
 * different cant needs a ramp on the middle element, which is a transition and
 * not the single arc this builds (AP 2.2).
 */

/** Signed turn from a1 to a2, in (−π, π]. */
function normalizeAngle(a) {
  const r = ((a + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI
  return r === -Math.PI ? Math.PI : r
}

/** Math angle (CCW from East) of a project bearing (CW from North) [deg → rad]. */
const psiOf = (bearing) => Math.atan2(Math.cos(bearing * DEG2RAD), Math.sin(bearing * DEG2RAD))

/** …and back. */
const bearingOf = (psi) => ((Math.atan2(Math.cos(psi), Math.sin(psi)) * RAD2DEG) % 360 + 360) % 360

const negR = (r) => (r == null ? null : -r)

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

/**
 * Travel `L` from (E, N) heading `psi` on the project's signed radius `Rp`
 * (positive = right-hand curve, null = straight) → [E, N, heading]. A negative
 * `L` runs the same route backwards.
 */
function stepOn(E, N, psi, L, Rp) {
  if (!Rp) return [E + L * Math.cos(psi), N + L * Math.sin(psi), psi]
  return arcStep(E, N, psi, -L / Rp, Math.abs(Rp))
}

// Fallback chain for a speed: primary type → ALT1 → ALT2.
function fallbackChain(speed) {
  return [SWITCH_TYPES, SWITCH_TYPES_ALT1, SWITCH_TYPES_ALT2]
    .map(table => table.find(s => s.speed === speed))
    .filter(Boolean)
}

/** A stem run the other way: same line, opposite direction, so radius and cant turn with it. */
export const reverseStem = (g) => ({
  pointUtm: g.pointUtm,
  bearing: (g.bearing + 180) % 360,
  radius: negR(asRadius(g.radius)),
  cant: -(g.cant ?? 0),
})

/**
 * The stem oriented towards `target` — the direction the connection leaves it
 * in. Reversing a track turns its curvature and its cant with it, so a caller
 * must not do this by adding 180° to a bearing.
 */
export function orientStemToward(g, target) {
  const rad = g.bearing * DEG2RAD
  const toward = (target.easting - g.pointUtm.easting) * Math.sin(rad)
             + (target.northing - g.pointUtm.northing) * Math.cos(rad)
  return toward < 0 ? reverseStem(g) : g
}

/**
 * The two tracks in the frame the construction runs in: track 1 oriented towards
 * track 2, track 2 oriented with it, the toe of turnout 1 slid `s` along track 1,
 * and the side track 2 lies on. Both stems keep their curvature and their cant —
 * reversing a track turns both, which is what reverseStem is for.
 */
function connectionFrame(g1, g2, s) {
  const t1 = g1
  const psi1Pick = psiOf(t1.bearing)
  const u1E = Math.cos(psi1Pick), u1N = Math.sin(psi1Pick)

  // Track 2 may be digitised against track 1; the line is what counts, not the
  // direction it was drawn in.
  const psi2Raw = psiOf(g2.bearing)
  const flipped2 = (Math.cos(psi2Raw) * u1E + Math.sin(psi2Raw) * u1N) < 0
  const t2 = flipped2 ? reverseStem(g2) : g2

  // The toe of turnout 1: the pick slid `s` along track 1 — along its arc where
  // it has one, not along its tangent.
  const Rs1 = asRadius(t1.radius)
  const [toeE, toeN, psiToe1] = stepOn(
    t1.pointUtm.easting, t1.pointUtm.northing, psi1Pick, s, Rs1)
  const toe1 = { easting: toeE, northing: toeN, zone: t1.pointUtm.zone }

  // Which side track 2 is on, seen from the toe: the left normal of track 1 there.
  const n1E = -Math.sin(psiToe1), n1N = Math.cos(psiToe1)
  const dE = t2.pointUtm.easting - toeE, dN = t2.pointUtm.northing - toeN
  const side = Math.sign(dE * n1E + dN * n1N) || 1

  return { stem1: t1, stem2: t2, toe1, psiToe1, Rs1, Rs2: asRadius(t2.radius), side, flipped2 }
}

/** Track spacing at the toe: the distance from it to track 2, straight or arc. */
function trackGap(frame) {
  const { toe1, stem2, Rs2 } = frame
  const psi = psiOf(stem2.bearing)
  if (!Rs2) {
    const dE = stem2.pointUtm.easting - toe1.easting, dN = stem2.pointUtm.northing - toe1.northing
    return Math.abs(dE * -Math.sin(psi) + dN * Math.cos(psi))
  }
  // Centre of track 2's arc, then the distance from the toe to the circle.
  const sg  = Rs2 >= 0 ? -1 : 1
  const cE  = stem2.pointUtm.easting  + sg * Math.abs(Rs2) * -Math.sin(psi)
  const cN  = stem2.pointUtm.northing + sg * Math.abs(Rs2) *  Math.cos(psi)
  return Math.abs(Math.hypot(toe1.easting - cE, toe1.northing - cN) - Math.abs(Rs2))
}

/**
 * Below this the residual is met [m]. Far tighter than the joint tolerance on
 * purpose: the residual is the gap between the middle element's end and the
 * second branch, and the element values are read back from the nodes
 * (computeCurvedValuesUtm), so a residual of r over a middle element of length
 * Lg shows up as a tangent step of about r/Lg at the joint. Ten nanometres keeps
 * that under a millionth of a degree — the invariant checker's own limit — and
 * still sits well above what float64 resolves on a UTM easting.
 */
const SOLVE_TOL = 1e-8

/** Iterations the secant gets before the scan takes over. */
const SOLVE_STEPS = 40

/**
 * The connection built from one switch form, in the frame above.
 *
 * Both turnouts are the form laid into their own track, so each branch runs the
 * form's own length on the curvature its stem adds to the form's
 * (branchRadius). The middle element turns by whatever is left between the two
 * branch ends; its length follows from where they are.
 */
function buildConnection(sw, frame, speed) {
  const { toe1, psiToe1, Rs1, Rs2, stem2, side } = frame
  const w   = Math.atan(1 / sw.ratio)
  const Lb  = switchArcLength(sw.R, sw.ratio)     // the form's branch, bent or not
  const Rf  = -side * sw.R                        // the form's radius, project-signed
  const Rb1 = branchRadius(Rf, Rs1)               // branch 1, in the travel direction
  // Turnout 2 faces the other way, so its stem runs the other way under it; its
  // branch turns the same way in the plane, which is the same form side again.
  const Rb2 = negR(branchRadius(Rf, negR(Rs2)))   // branch 2, in the travel direction

  // Branch 1: from the toe, once — it does not depend on s₂.
  const [b1E, b1N, t1] = stepOn(toe1.easting, toe1.northing, psiToe1, Lb, Rb1)

  const psi2Pick = psiOf(stem2.bearing)

  /** Everything that depends on where turnout 2 sits. */
  const at = (s2) => {
    const [p2E, p2N, psiToe2] = stepOn(
      stem2.pointUtm.easting, stem2.pointUtm.northing, psi2Pick, s2, Rs2)
    // Back up along branch 2 from its toe: the same arc run the other way.
    const [aE, aN, psiBack] = stepOn(p2E, p2N, psiToe2 + Math.PI, Lb, negR(Rb2))
    const t2 = psiBack + Math.PI
    const delta = normalizeAngle(t2 - t1)
    const half  = delta / 2
    const uE = Math.cos(t1 + half), uN = Math.sin(t1 + half)
    const dE = aE - b1E, dN = aN - b1N
    return {
      TP2: { easting: p2E, northing: p2N, zone: toe1.zone },
      psiToe2,
      B2A: { easting: aE, northing: aN, zone: toe1.zone },
      t2, delta,
      // Signed distance of B2A from the ray the middle element's end runs along.
      residual: dE * -uN + dN * uE,
      // …and how far along that ray it lies, which is the middle element's length.
      Lg: (dE * uE + dN * uN) / (Math.abs(half) < 1e-12 ? 1 : Math.sin(half) / half),
    }
  }

  const s2 = solveStation(at, Lb)
  const hit = s2 == null ? null : at(s2)

  if (!hit || !Number.isFinite(hit.Lg)) {
    return { sw, valid: false, reason: 'no_solution', Lg: NaN, s2: null }
  }

  const { TP2, B2A, delta, Lg, psiToe2 } = hit
  const B1E = { easting: b1E, northing: b1N, zone: toe1.zone }

  // Middle radius, signed the project's way: a left turn (δ > 0) runs on a
  // negative radius. Below the project's straight threshold it is a straight —
  // beyond ~1e7 m the radius is numerical noise anyway, and over a middle
  // element that curvature stays under a tenth of a millimetre.
  const curvature = Lg > 0 ? delta / Lg : 0
  const signedRg = Math.abs(curvature) < STRAIGHT_CURVATURE ? null : -1 / curvature

  // The cant the connection carries is the cant of the tracks it joins: each
  // branch takes its own stem's, as a turnout laid into a track does
  // (SwitchOnTrackForm), and the element between them can only carry one value.
  // Both are stated in the travel direction, which is the direction the three
  // elements are built in — turnout 2 opens against it, but the element that
  // carries its branch does not, so its stem's cant goes in as it stands.
  const cant1 = frame.stem1.cant ?? 0
  const cant2 = stem2.cant ?? 0
  const cantMid = cant1

  const defMid = signedRg ? computeCantDefSigned(speed, signedRg, cantMid) : 0
  const defB1  = Rb1 ? computeCantDefSigned(speed, Rb1, cant1) : 0
  const defB2  = Rb2 ? computeCantDefSigned(speed, Rb2, cant2) : 0

  const reason =
    !Number.isFinite(Lg)                                  ? 'no_solution'
      : Lg < sw.minl                                      ? 'too_short'
        : cant1 !== cant2                                 ? 'cant_mismatch'
          : Math.max(Math.abs(cant1), Math.abs(cant2)) > MAX_SWITCH_CANT ? 'cant_over'
            : Math.max(defB1, defB2) > MAX_SWITCH_CANT_DEF ? 'branch_too_sharp'
              : defMid > MAX_SWITCH_CANT_DEF              ? 'too_sharp'
                : null

  return {
    sw, R: sw.R, w, side, delta, s2,
    TP1: toe1, B1E, B2A, TP2,
    Lg, signedRg,
    signedR1: Rb1, signedR2: Rb2,
    L1: Lb, L2: Lb,
    cant1, cant2, cantMid,
    cantDef: defMid, branchCantDef: Math.max(defB1, defB2),
    bearing1: bearingOf(psiToe1),
    bearing2: bearingOf(psiToe2 + Math.PI),   // from TP2 towards B2A
    valid: reason === null, reason,
  }
}

/**
 * The station on track 2 that closes the construction: the root of the residual
 * above. Secant from the pick outwards — the user picked where they want the
 * connection to land, so the answer is near s₂ = 0 — and a scan for a sign
 * change where that wanders off. Where track 2 is straight the residual is
 * linear and the first secant step is already exact.
 */
function solveStation(at, step) {
  let a = 0, fa = at(0).residual
  if (Math.abs(fa) < SOLVE_TOL) return 0
  let b = step, fb = at(b).residual

  for (let i = 0; i < SOLVE_STEPS; i++) {
    if (!Number.isFinite(fa) || !Number.isFinite(fb)) break
    if (Math.abs(fb - fa) < 1e-15) break
    const next = b - fb * (b - a) / (fb - fa)
    if (!Number.isFinite(next)) break
    const stalled = Math.abs(next - b) < 1e-12
    a = b; fa = fb
    b = next; fb = at(b).residual
    if (Math.abs(fb) < SOLVE_TOL) return b
    // Two stations a picometre apart say the same thing; nothing more is coming.
    if (stalled) break
  }

  // Secant lost it: look for a sign change over a stretch of track 2 and halve
  // it down. The residual is smooth, so one crossing is one solution.
  const span = Math.max(50 * step, 500)
  const n = 96
  let prevS = -span, prevF = at(prevS).residual
  for (let i = 1; i <= n; i++) {
    const s = -span + (2 * span * i) / n
    const f = at(s).residual
    if (Number.isFinite(prevF) && Number.isFinite(f) && prevF === 0) return prevS
    if (Number.isFinite(prevF) && Number.isFinite(f) && prevF * f < 0) {
      let lo = prevS, hi = s, flo = prevF
      for (let k = 0; k < 60; k++) {
        const mid = (lo + hi) / 2
        const fm = at(mid).residual
        if (Math.abs(fm) < SOLVE_TOL) return mid
        if (flo * fm < 0) { hi = mid } else { lo = mid; flo = fm }
      }
      return (lo + hi) / 2
    }
    prevS = s; prevF = f
  }
  return null
}

/**
 * Which primary speeds this pair of tracks can be connected with at the given
 * shift — drives the dropdown's disabled state. A speed counts as available
 * when any form in its fallback chain builds a valid connection.
 */
export function computeSwitchConnections(g1, g2, s = 0) {
  const frame = connectionFrame(g1, g2, s)
  return SWITCH_TYPES.map(p => ({
    speed: p.speed,
    valid: fallbackChain(p.speed).some(sw => buildConnection(sw, frame, p.speed).valid),
  }))
}

/**
 * Switch connection between two tracks for a selected speed. The form is
 * resolved through the primary → ALT1 → ALT2 fallback (the first one that builds
 * a valid connection; the last one tried when none does, so the caller can say
 * why). Result plugs into buildConnectionElements + the preview helpers.
 *
 * `g1` and `g2` are the two picks, each `{ pointUtm, bearing, radius, cant }` in
 * the track's own plane and direction — `g1.bearing` oriented towards `g2`, the
 * radius of the track at that point (null on a straight) and the cant it carries
 * there. Both must be in the same CRS plane; the caller converts.
 *
 * @param {number} speed selected design speed [km/h]
 * @param {number} s     shift of the first toe along track 1 [m]
 */
export function solveSwitchConnection(g1, g2, speed, s = 0) {
  const zone  = g1.pointUtm.zone
  const frame = connectionFrame(g1, g2, s)

  const chain = fallbackChain(speed)
  let c = null
  for (const sw of chain) {
    c = buildConnection(sw, frame, speed)
    if (c.valid) break
  }
  if (!c) return null

  const gap = trackGap(frame)
  const throughLength = switchStraightLength(c.sw.R, c.sw.ratio)

  // A pick the construction has no answer for comes back before anything is
  // derived from a point that does not exist.
  if (!Number.isFinite(c.Lg)) {
    return {
      TP1: frame.toe1, R: c.sw.R, w: Math.atan(1 / c.sw.ratio), delta: 0, Lg: NaN, signedRg: null,
      arc1Coords: null, arc2Coords: null, midCoords: [], allCoords: [],
      valid: false, reason: c.reason, zone, gap, switchType: c.sw, throughLength,
      s2: null, flipped2: frame.flipped2, cant1: 0, cant2: 0, cantMid: 0,
    }
  }

  const { TP1, B1E, B2A, TP2, signedR1, signedR2, signedRg } = c

  // A branch that comes out straight (the outer-bent form's limiting case) is
  // drawn as the two points it runs between, like any straight.
  const arcLine = (a, b, signedR, sagitta, aWgs, bWgs) => (signedR
    ? arcCoordsFromRadiusUtm(a, b, signedR, sagitta)
    : [aWgs, bWgs])

  const tp1Wgs = utmToWgs84(TP1.easting, TP1.northing, zone)
  const b1eWgs = utmToWgs84(B1E.easting, B1E.northing, zone)
  const b2aWgs = utmToWgs84(B2A.easting, B2A.northing, zone)
  const tp2Wgs = utmToWgs84(TP2.easting, TP2.northing, zone)

  const arc1Coords       = c.valid ? arcLine(TP1, B1E, signedR1, SAGITTA_ELEMENT, tp1Wgs, b1eWgs) : null
  const arc1CoordsRender = c.valid ? arcLine(TP1, B1E, signedR1, SAGITTA_TRACK,   tp1Wgs, b1eWgs) : null
  const arc2Coords       = c.valid ? arcLine(B2A, TP2, signedR2, SAGITTA_ELEMENT, b2aWgs, tp2Wgs) : null
  const arc2CoordsRender = c.valid ? arcLine(B2A, TP2, signedR2, SAGITTA_TRACK,   b2aWgs, tp2Wgs) : null

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

  // Construction length: the stretch of track 1 the connection takes up — the
  // station of TP2's foot on track 1, measured along the track and not along a
  // tangent it leaves.
  const laenge = projectOnArcUtm(TP1, TP2, c.bearing1, frame.Rs1).along

  return {
    TP1, B1E, B2A, TP2,
    tp1Wgs, b1eWgs, b2aWgs, tp2Wgs,
    delta: c.delta, s2: c.s2, flipped2: frame.flipped2,
    R: c.R, w: c.w, L1: c.L1, L2: c.L2, Lg: c.Lg,
    signedR1, signedR2, signedRg,
    stemR1: frame.Rs1, stemR2: frame.Rs2,
    cant1: c.cant1, cant2: c.cant2, cantMid: c.cantMid,
    cantDef: c.cantDef, branchCantDef: c.branchCantDef,
    bearing1: c.bearing1, bearing2: c.bearing2,
    arc1Coords, arc1CoordsRender, arc2Coords, arc2CoordsRender,
    midCoords, midCoordsRender,
    allCoords,
    valid, reason: c.reason,
    zone,
    gap, laenge, switchType: c.sw, throughLength,
  }
}

/** One element of a solved connection: an arc where it curves, a straight where it does not. */
function connectionElement(a, b, signedR, speed, cant, coords, renderCoords) {
  const v = signedR ? computeCurvedValuesUtm(a, b, signedR) : computeStraightValuesUtm(a, b)
  return {
    elementType: signedR ? 1 : 0,
    startNode: v.startNode,
    endNode:   v.endNode,
    bearing:   v.bearing,
    length:    v.length,
    absLength: v.length,
    speed,
    ...(signedR ? { endBearing: v.endBearing, radius: signedR, renderCoords } : {}),
    ...(cant ? { cant } : {}),
    geometry: { type: 'LineString', coordinates: coords },
  }
}

/**
 * The three track elements of a solved connection — branch arc, middle element,
 * branch arc — ready to go into a track. Each is a straight or an arc exactly as
 * the solution made it, and each carries the cant the solution read off the
 * tracks it joins.
 */
export function buildConnectionElements(result, speed) {
  const { TP1, B1E, B2A, TP2, signedR1, signedR2, signedRg,
          arc1Coords, arc1CoordsRender, arc2Coords, arc2CoordsRender,
          midCoords, midCoordsRender, cant1, cant2, cantMid } = result

  return {
    arc1El: connectionElement(TP1, B1E, signedR1, speed, cant1, arc1Coords, arc1CoordsRender),
    midEl:  connectionElement(B1E, B2A, signedRg, speed, cantMid, midCoords, midCoordsRender),
    arc2El: connectionElement(B2A, TP2, signedR2, speed, cant2, arc2Coords, arc2CoordsRender),
  }
}
