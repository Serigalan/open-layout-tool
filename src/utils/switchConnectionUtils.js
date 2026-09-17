import { utmToWgs84 } from './coordinateUtils'
import {
  arcCoordsFromRadiusUtm, computeCurvedValuesUtm, computeStraightValuesUtm, projectOnArcUtm,
} from './elementUtils'
import {
  SAGITTA_ELEMENT, SAGITTA_TRACK, MAX_SWITCH_CANT, MAX_SWITCH_CANT_DEF, computeCantDefSigned,
} from './mapConstants'
import {
  SWITCH_TYPES, SWITCH_TYPES_ALT1, SWITCH_TYPES_ALT2, STRAIGHT_CURVATURE,
  switchStraightLength, switchBranchLength, switchBranchSections, switchBranchChain,
  switchRouteVaries, switchRoutePointUtm, switchRouteBearingAt, switchRouteRadiusAt,
  switchRouteSlice, switchChainPointUtm, switchChainBearingAt, switchChainSegmentsUtm,
} from './switchUtils'
import { computeClothoidUtm } from './clothoidUtils'

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
 * **The stem is a route, not a radius** (AP 2.2). Everything below reads the
 * track through switchElementRoute — `{ length, r1, r2 }` — so a straight, an
 * arc and a transition curve are one case and not three. On a transition the
 * rule is unchanged, κ_branch = κ_stem + κ_form at every station
 * (switchBranchRoute), and since the stem's curvature runs linearly so does the
 * branch's: the branch is then a clothoid of the stem's own parameter, and the
 * element built from it is a transition. That is what makes the ToDo's list of
 * combinations — straight against arc, arc against arc either sense, a
 * transition involved — one construction rather than a table of cases.
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
 * too short to lie between two reverse curves (Lg < minl), or when its curve or
 * a bent branch exceeds the cant deficiency the design speed allows.
 *
 * It also stops where **the cant at the two ends of the middle element does not
 * agree**. A branch may ramp — it is a transition element there, which is the
 * one kind this model lets state a cant at each end — but the element between
 * the two branches carries a single value, so the ends it joins have to state
 * the same one. Anything else would leave a cant step in the track, which is a
 * ramp of no length. Giving that element a ramp means giving an arc or a
 * straight two cant values, which the model ties to transitions today; that is
 * the shared piece AP 4.1 has to settle.
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

// Fallback chain for a speed: primary type → ALT1 → ALT2.
function fallbackChain(speed) {
  // Every form of that speed, primary table first and within a table in its own
  // order — a speed may have more than one form, and then the flatter one is
  // tried before the sharper one it falls back to.
  return [SWITCH_TYPES, SWITCH_TYPES_ALT1, SWITCH_TYPES_ALT2]
    .flatMap(table => table.filter(s => s.speed === speed))
}

/**
 * A stem is the element a turnout of the connection sits on, as the route it is
 * — `{ length, r1, r2 }`, so a straight, an arc and a transition are one thing
 * (switchElementRoute). It is read from the element's own start, which is where
 * its route is stationed from:
 *
 *   startUtm, bearing   the element's start node and the tangent there
 *   route               its route, in the element's own direction
 *   along               the station the pick sits at
 *   cantStart, cantEnd  the cant at the element's two ends, its own direction
 *                       (the same value twice on anything but a transition)
 *   dir                 +1 where the connection runs with the element, −1 against
 *
 * Everything below is stated as a station `s` measured from the pick in the
 * direction the connection runs, which `dir` turns back into a station along the
 * element. Running a stem the other way is that flag and nothing else — the
 * route stays as it is and its radii and cant are turned where they are read.
 */
export const reverseStem = (g) => ({ ...g, dir: -(g.dir ?? 1) })

/** Station along the element, `s` metres from the pick in the running direction. */
const stemStation = (g, s) => g.along + (g.dir ?? 1) * s

/** The point `s` from the pick, in the plane. */
const stemPoint = (g, s) => switchRoutePointUtm(g.startUtm, g.bearing, g.route, stemStation(g, s))

/** The tangent bearing `s` from the pick, in the running direction. */
function stemBearing(g, s) {
  const b = switchRouteBearingAt(g.bearing, g.route, stemStation(g, s))
  return (g.dir ?? 1) > 0 ? b : (b + 180) % 360
}

/** The signed radius `s` from the pick, in the running direction. */
function stemRadius(g, s) {
  const r = switchRouteRadiusAt(g.route, stemStation(g, s))
  return (g.dir ?? 1) > 0 ? r : negR(r)
}

/** The cant `s` from the pick, in the running direction — a transition ramps. */
function stemCant(g, s) {
  const L = g.route.length
  const a = g.cantStart ?? 0, b = g.cantEnd ?? a
  const u = L > 0 ? a + (b - a) * Math.min(L, Math.max(0, stemStation(g, s))) / L : a
  return (g.dir ?? 1) > 0 ? u : -u
}

/** The stretch of stem a turnout covers: from `s` forward by `length`, running direction. */
function stemUnder(g, s, length) {
  const a = stemStation(g, s), b = stemStation(g, s + length)
  const slice = switchRouteSlice(g.route, Math.min(a, b), Math.max(a, b))
  return (g.dir ?? 1) > 0 ? slice : { length: slice.length, r1: negR(slice.r2), r2: negR(slice.r1) }
}

/**
 * The stem oriented towards `target` — the direction the connection leaves it
 * in. Reversing a track turns its curvature and its cant with it, so a caller
 * must not do this by adding 180° to a bearing.
 */
export function orientStemToward(g, target) {
  const rad = stemBearing(g, 0) * DEG2RAD
  const from = stemPoint(g, 0)
  const toward = (target.easting - from.easting) * Math.sin(rad)
             + (target.northing - from.northing) * Math.cos(rad)
  return toward < 0 ? reverseStem(g) : g
}

/**
 * The two tracks in the frame the construction runs in: track 1 oriented towards
 * track 2, track 2 oriented with it, the toe of turnout 1 slid `s` along track 1,
 * and the side track 2 lies on. Both stems keep their curvature and their cant —
 * reversing a track turns both, which is what reverseStem is for.
 */
function connectionFrame(g1, g2, s) {
  const psi1Pick = psiOf(stemBearing(g1, 0))
  const u1E = Math.cos(psi1Pick), u1N = Math.sin(psi1Pick)

  // Track 2 may be digitised against track 1; the line is what counts, not the
  // direction it was drawn in.
  const psi2Raw = psiOf(stemBearing(g2, 0))
  const flipped2 = (Math.cos(psi2Raw) * u1E + Math.sin(psi2Raw) * u1N) < 0
  const t2 = flipped2 ? reverseStem(g2) : g2

  // The toe of turnout 1: the pick slid `s` along track 1 — along its own
  // geometry, be that a straight, an arc or a transition.
  const toe1 = stemPoint(g1, s)
  const psiToe1 = psiOf(stemBearing(g1, s))

  // Which side track 2 is on, seen from the toe: the left normal of track 1 there.
  const n1E = -Math.sin(psiToe1), n1N = Math.cos(psiToe1)
  const p2 = stemPoint(t2, 0)
  const dE = p2.easting - toe1.easting, dN = p2.northing - toe1.northing
  const side = Math.sign(dE * n1E + dN * n1N) || 1

  return { stem1: g1, stem2: t2, s1: s, toe1, psiToe1, side, flipped2 }
}

/** Track spacing at the toe: the distance from it to track 2, straight or arc. */
function trackGap(frame) {
  const { toe1, stem2 } = frame
  const p2 = stemPoint(stem2, 0)
  const psi = psiOf(stemBearing(stem2, 0))
  const Rs2 = stemRadius(stem2, 0)
  if (!Rs2) {
    const dE = p2.easting - toe1.easting, dN = p2.northing - toe1.northing
    return Math.abs(dE * -Math.sin(psi) + dN * Math.cos(psi))
  }
  // Centre of track 2's curvature there, then the distance from the toe to it.
  const sg  = Rs2 >= 0 ? -1 : 1
  const cE  = p2.easting  + sg * Math.abs(Rs2) * -Math.sin(psi)
  const cN  = p2.northing + sg * Math.abs(Rs2) *  Math.cos(psi)
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
  const { toe1, psiToe1, stem1, stem2, s1, side } = frame
  const w   = Math.atan(1 / sw.ratio)
  const Lb  = switchBranchLength(sw)              // the form's branch, bent or not
  const Rf  = -side * sw.R                        // the form's radius, project-signed
  // The form as its own chain, signed the way this connection turns: one entry
  // per section, so a form that ends in a straight piece has two (AP 3.1).
  const formChain = switchBranchSections(sw).map(section => ({
    length:  section.length,
    signedR: section.R == null ? null : Math.sign(Rf) * section.R,
  }))

  // Branch 1: the form laid on the stretch of stem it covers, so on a straight
  // it is the form's arc, in a curve the bent one, and on a transition a
  // clothoid of the stem's own parameter. It parts where the form's sections
  // part and where the elements under the turnout do. It does not depend on s₂.
  const chain1  = switchBranchChain(formChain, stemUnder(stem1, s1, Lb))
  const bear1   = stemBearing(stem1, s1)
  const B1E     = switchChainPointUtm(toe1, bear1, chain1)
  const t1      = psiOf(switchChainBearingAt(bear1, chain1))
  const b1E = B1E.easting, b1N = B1E.northing

  // Turnout 2 opens against the way the connection runs, so its own stem is
  // track 2 read backwards; its branch turns the same way in the plane, which
  // is the same form side again.
  const back2 = reverseStem(stem2)

  /** Everything that depends on where turnout 2 sits. */
  const at = (s2) => {
    const TP2 = stemPoint(stem2, s2)
    // In turnout 2's own frame the toe sits at −s₂ from the pick.
    const bearOwn = stemBearing(back2, -s2)
    const chain2own = switchBranchChain(formChain, stemUnder(back2, -s2, Lb))
    const B2A = switchChainPointUtm(TP2, bearOwn, chain2own)
    const t2  = psiOf(switchChainBearingAt(bearOwn, chain2own)) + Math.PI

    const delta = normalizeAngle(t2 - t1)
    const half  = delta / 2
    const uE = Math.cos(t1 + half), uN = Math.sin(t1 + half)
    const dE = B2A.easting - b1E, dN = B2A.northing - b1N
    return {
      TP2, B2A, t2, delta, chain2own, bearOwn,
      // Signed distance of B2A from the ray the middle element's end runs along.
      residual: dE * -uN + dN * uE,
      // …and how far along that ray it lies, which is the middle element's length.
      Lg: (dE * uE + dN * uN) / (Math.abs(half) < 1e-12 ? 1 : Math.sin(half) / half),
    }
  }

  // The search stays on the element the second turnout was picked on: outside it
  // there is no stem to lay a turnout in, and the shift bounds refuse it anyway.
  const s2 = solveStation(at, Lb, stem2.route.length + 2 * Lb)
  const hit = s2 == null ? null : at(s2)

  if (!hit || !Number.isFinite(hit.Lg)) {
    return { sw, valid: false, reason: 'no_solution', Lg: NaN, s2: null }
  }

  const { TP2, B2A, t2, delta, Lg, chain2own, bearOwn } = hit

  // Middle radius, signed the project's way: a left turn (δ > 0) runs on a
  // negative radius. Below the project's straight threshold it is a straight —
  // beyond ~1e7 m the radius is numerical noise anyway, and over a middle
  // element that curvature stays under a tenth of a millimetre.
  const curvature = Lg > 0 ? delta / Lg : 0
  const signedRg = Math.abs(curvature) < STRAIGHT_CURVATURE ? null : -1 / curvature

  // Branch 2 as the connection runs it, B2A → TP2: the same chain backwards.
  const chain2 = [...chain2own].reverse()
    .map(piece => ({ length: piece.length, r1: negR(piece.r2), r2: negR(piece.r1) }))

  // The cant the connection carries is the cant of the tracks it joins: each
  // branch takes its own stem's, as a turnout laid into a track does
  // (SwitchOnTrackForm), read at the station of the branch it belongs to. All
  // of it in the direction the three elements are built in.
  const cant1Start = stemCant(stem1, s1)
  const cant1End   = stemCant(stem1, s1 + Lb)
  const cant2Start = stemCant(stem2, s2 - Lb)      // at B2A
  const cant2End   = stemCant(stem2, s2)           // at TP2
  // The element between them can only carry one value, so the two ends it joins
  // have to agree on it.
  const cantMid = cant1End

  const worst = (a, b) => (Math.abs(a) >= Math.abs(b) ? a : b)
  // The worst deficiency anywhere along a branch: the pieces of a chain are not
  // alike — the form's arc is sharp where a straight end piece is not — so each
  // is asked and the worst answer counts.
  const defOf = (chain, uA, uB) => Math.max(0, ...chain.map((piece) => {
    const r = worst(piece.r1, piece.r2)
    return r ? computeCantDefSigned(speed, r, worst(uA, uB)) : 0
  }))
  const defMid = signedRg ? computeCantDefSigned(speed, signedRg, cantMid) : 0
  const defB1  = defOf(chain1, cant1Start, cant1End)
  const defB2  = defOf(chain2, cant2Start, cant2End)
  const worstCant = Math.max(
    Math.abs(cant1Start), Math.abs(cant1End), Math.abs(cant2Start), Math.abs(cant2End))

  const reason =
    !Number.isFinite(Lg)                                  ? 'no_solution'
      : Lg < sw.minl                                      ? 'too_short'
        : cant1End !== cant2Start                         ? 'cant_mismatch'
          : worstCant > MAX_SWITCH_CANT                   ? 'cant_over'
            : Math.max(defB1, defB2) > MAX_SWITCH_CANT_DEF ? 'branch_too_sharp'
              : defMid > MAX_SWITCH_CANT_DEF              ? 'too_sharp'
                : null

  return {
    sw, R: sw.R, w, side, delta, s2,
    TP1: toe1, B1E, B2A, TP2,
    Lg, signedRg,
    chain1, chain2,
    // The branch radius each turnout is built with: the form's own arc, which
    // is the piece at the toe. A straight end piece says nothing about the form.
    signedR1: chain1[0].r1, signedR2: negR(chain2own[0].r1),
    L1: Lb, L2: Lb,
    cant1Start, cant1End, cant2Start, cant2End, cantMid,
    cantDef: defMid, branchCantDef: Math.max(defB1, defB2),
    bearing1: bearingOf(psiToe1),
    bearing2:  bearOwn,                       // at TP2, towards B2A — where the split parts
    bearing2A: bearingOf(t2),                 // at B2A, the way the connection runs
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
function solveStation(at, step, span = Math.max(50 * step, 500)) {
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
 * The design speeds a connection can be built for, each once — the primary
 * table may hold more than one form for a speed (AP 3.1), and they are the same
 * choice to whoever picks one.
 */
export const CONNECTION_SPEEDS = [...new Set(SWITCH_TYPES.map(type => type.speed))]

/**
 * Which speeds this pair of tracks can be connected with at the given shift —
 * drives the dropdown's disabled state. A speed counts as available when any
 * form in its fallback chain builds a valid connection.
 */
export function computeSwitchConnections(g1, g2, s = 0) {
  const frame = connectionFrame(g1, g2, s)
  return CONNECTION_SPEEDS.map(speed => ({
    speed,
    valid: fallbackChain(speed).some(sw => buildConnection(sw, frame, speed).valid),
  }))
}

/**
 * Switch connection between two tracks for a selected speed. The form is
 * resolved through the primary → ALT1 → ALT2 fallback (the first one that builds
 * a valid connection; the last one tried when none does, so the caller can say
 * why). Result plugs into buildConnectionElements + the preview helpers.
 *
 * `g1` and `g2` are the two stems (see above), both in the same CRS plane and
 * `g1` already oriented towards `g2` (orientStemToward). The caller converts a
 * second track that lives in another plane.
 *
 * @param {number} speed selected design speed [km/h]
 * @param {number} s     shift of the first toe along track 1 [m]
 */
export function solveSwitchConnection(g1, g2, speed, s = 0) {
  const zone  = g1.startUtm.zone
  const frame = connectionFrame(g1, g2, s)

  const chain = fallbackChain(speed)
  let c = null
  for (const sw of chain) {
    c = buildConnection(sw, frame, speed)
    if (c.valid) break
  }
  if (!c) return null

  const gap = trackGap(frame)
  const throughLength = switchStraightLength(c.sw)

  // A pick the construction has no answer for comes back before anything is
  // derived from a point that does not exist.
  if (!Number.isFinite(c.Lg)) {
    return {
      TP1: frame.toe1, R: c.sw.R, w: Math.atan(1 / c.sw.ratio), delta: 0, Lg: NaN, signedRg: null,
      arc1Coords: null, arc2Coords: null, midCoords: [], allCoords: [],
      branch1: [], branch2: [],
      valid: false, reason: c.reason, zone, gap, switchType: c.sw, throughLength,
      s2: null, flipped2: frame.flipped2,
      cant1Start: 0, cant1End: 0, cant2Start: 0, cant2End: 0, cantMid: 0,
    }
  }

  const { TP1, B1E, B2A, TP2, signedR1, signedR2, signedRg } = c

  const tp1Wgs = utmToWgs84(TP1.easting, TP1.northing, zone)
  const b1eWgs = utmToWgs84(B1E.easting, B1E.northing, zone)
  const b2aWgs = utmToWgs84(B2A.easting, B2A.northing, zone)
  const tp2Wgs = utmToWgs84(TP2.easting, TP2.northing, zone)

  // Each branch as the pieces one element is built from, and as the one
  // polyline the preview draws. The pieces are built whatever the verdict —
  // a connection refused for its cant or its middle element still has the
  // geometry a caller may want to look at; only the drawn polyline waits for
  // a valid one, as it always has.
  const branch1 = chainPieces(TP1, c.bearing1,  c.chain1, zone, tp1Wgs, b1eWgs)
  const branch2 = chainPieces(B2A, c.bearing2A, c.chain2, zone, b2aWgs, tp2Wgs)
  const arc1Coords       = c.valid ? joinCoords(branch1.map(p => p.coords)) : null
  const arc1CoordsRender = c.valid ? joinCoords(branch1.map(p => p.renderCoords)) : null
  const arc2Coords       = c.valid ? joinCoords(branch2.map(p => p.coords)) : null
  const arc2CoordsRender = c.valid ? joinCoords(branch2.map(p => p.renderCoords)) : null

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
  const laenge = projectOnArcUtm(TP1, TP2, c.bearing1, stemRadius(frame.stem1, frame.s1)).along

  return {
    TP1, B1E, B2A, TP2,
    tp1Wgs, b1eWgs, b2aWgs, tp2Wgs,
    delta: c.delta, s2: c.s2, flipped2: frame.flipped2,
    R: c.R, w: c.w, L1: c.L1, L2: c.L2, Lg: c.Lg,
    signedR1, signedR2, signedRg,
    chain1: c.chain1, chain2: c.chain2, branch1, branch2, bearing2A: c.bearing2A,
    stemR1: stemRadius(frame.stem1, frame.s1),
    stemR2: stemRadius(frame.stem2, c.s2),
    cant1Start: c.cant1Start, cant1End: c.cant1End,
    cant2Start: c.cant2Start, cant2End: c.cant2End, cantMid: c.cantMid,
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

/** Polylines laid end to end, the shared point kept once. */
const joinCoords = (parts) => parts.reduce(
  (out, part) => (out.length ? [...out, ...part.slice(1)] : [...part]), [])

/**
 * A branch chain placed in the plane: one piece per element the connection will
 * build, each with its own polyline. The two ends of the whole branch keep the
 * WGS84 points the solution settled on, so the joins with the track and the
 * middle element stay exact; the points between the pieces are the chain's own.
 */
function chainPieces(startUtm, bearing, chain, zone, startWgs, endWgs) {
  const segments = switchChainSegmentsUtm(startUtm, bearing, chain)
  return segments.map((seg, i) => {
    const aWgs = i === 0 ? startWgs : utmToWgs84(seg.startUtm.easting, seg.startUtm.northing, zone)
    const bWgs = i === segments.length - 1
      ? endWgs
      : utmToWgs84(seg.endUtm.easting, seg.endUtm.northing, zone)
    return {
      startUtm: seg.startUtm,
      endUtm:   seg.endUtm,
      bearing:  seg.bearing,
      route:    { length: seg.length, r1: seg.r1, r2: seg.r2 },
      s0:       seg.s0,
      coords:       routeCoords(seg.startUtm, seg.bearing, seg, SAGITTA_ELEMENT, aWgs, bWgs),
      renderCoords: routeCoords(seg.startUtm, seg.bearing, seg, SAGITTA_TRACK,   aWgs, bWgs),
    }
  })
}

/**
 * The polyline of a route laid from `startUtm` on `bearing`: two points for a
 * straight, an arc where the curvature is constant, and the integrated curve
 * where it runs. The stored end points are kept as they are, so the joins with
 * the neighbours are exact — the same rule reconstructElements follows.
 */
function routeCoords(startUtm, bearing, route, sagitta, startWgs, endWgs) {
  if (switchRouteVaries(route)) {
    const cl = computeClothoidUtm(startUtm, bearing, route.length, route.r1, route.r2, sagitta)
    return [startWgs, ...cl.coords.slice(1, -1), endWgs]
  }
  if (!route.r1) return [startWgs, endWgs]
  const a = arcCoordsFromRadiusUtm(
    startUtm,
    switchRoutePointUtm(startUtm, bearing, route),
    route.r1, sagitta)
  return a ? [startWgs, ...a.slice(1, -1), endWgs] : [startWgs, endWgs]
}

/**
 * One element of a solved connection, as the route made it: a straight, an arc,
 * or the transition a turnout laid into a transition curve produces. `cant` is
 * the value at its two ends — one number on anything that carries one value, a
 * ramp on a transition, which is the only kind of element this model lets carry
 * two.
 */
function connectionElement(a, b, bearing, route, speed, cantA, cantB, coords, renderCoords) {
  const varies = switchRouteVaries(route)
  if (varies) {
    return {
      elementType: 2, transitionType: 'clothoid',
      r1: route.r1, r2: route.r2,
      startNode: [a.easting, a.northing],
      endNode:   [b.easting, b.northing],
      bearing,
      endBearing: switchRouteBearingAt(bearing, route),
      length:    route.length,
      absLength: route.length,
      speed,
      ...(cantA || cantB ? { cantStart: cantA, cantEnd: cantB } : {}),
      geometry: { type: 'LineString', coordinates: coords },
      renderCoords,
    }
  }
  const signedR = route.r1
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
    ...(cantA ? { cant: cantA } : {}),
    geometry: { type: 'LineString', coordinates: coords },
  }
}

/**
 * The track elements of a solved connection — branch, middle element, branch —
 * ready to go into a track. Each is a straight, an arc or a transition exactly
 * as the solution made it, and each carries the cant the solution read off the
 * tracks it joins.
 *
 * A branch is a list, not one element: a form that ends in a straight piece
 * builds two, and a turnout lying across several elements of its host track
 * builds one per piece. The cant runs along the branch, so a piece takes it at
 * its own two ends.
 */
export function buildConnectionElements(result, speed) {
  const { B1E, B2A, signedRg, branch1, branch2, midCoords, midCoordsRender,
          cant1Start, cant1End, cant2Start, cant2End, cantMid } = result
  const mid = { length: 0, r1: signedRg, r2: signedRg }

  const branchEls = (pieces, cantA, cantB) => {
    const total = pieces.reduce((sum, p) => sum + p.route.length, 0)
    const cantAt = (s) => (total > 0 ? cantA + (cantB - cantA) * s / total : cantA)
    return pieces.map(p => connectionElement(
      p.startUtm, p.endUtm, p.bearing, p.route, speed,
      cantAt(p.s0), cantAt(p.s0 + p.route.length), p.coords, p.renderCoords))
  }

  return {
    branch1: branchEls(branch1, cant1Start, cant1End),
    midEl:   connectionElement(B1E, B2A, null, mid, speed,
      cantMid, cantMid, midCoords, midCoordsRender),
    branch2: branchEls(branch2, cant2Start, cant2End),
  }
}
