import { arcCenter } from '../geometry'
import { transitionLengths, checkTrack, severityRank, worstSeverity } from '../rules'

// Splicing two tracks into one — the construction of "Zwei Gleise
// zusammenfügen", in the browser for both builds (decision 294). Ported from
// the optimizer service (tools/optimizer/olt_optimizer/splice.py), which keeps
// its own for reconnecting (Paket N) and the alignment fit (phase 12); the two
// are held alike by the service's answers to the same requests
// (serviceAnswers.json, written and checked by
// tools/optimizer/tests/splice_answers_fixture.py).
//
// The two picked elements come in the plane of their track: each with its two
// ends, the bearing at its end and its signed radius. Which ends meet is
// found here, not taken from the clicks (Paket S, AP S.2): every pair of ends
// is constructed, the departure run into the splice at its end and the
// arrival met at its end, a pick joined at its other end handed over flipped.
// The cases: an arc of the radius asked for in the corner of two straights, a
// straight between two arcs or a single transition from the one to the other,
// a new arc between an arc and a straight — with a transition beside either
// pick (clothoid or Bloss, as given or at the Regel- or Mindestlänge the rules
// ask for in the very chain solved, AP S.3). Each solution is judged as a
// whole by the rule catalogue (AP S.4); the best comes first (Entscheidung
// 180). The answer has the service's form, which commands/splice reads. A
// spacing to a neighbouring track stays with the service (decision 295) —
// the dialog asks it there, and the local build has none.
//
// Conventions are the service's: bearings in degrees clockwise from grid
// north, signed radius > 0 for a right-hand curve, curvature κ = −1/r in the
// plane's angle.

const DEG = Math.PI / 180

// A tangent point may lie this far behind the start of its element [m].
const TOL = 0.01
// Beyond this a transition is not a design any more [m].
const MAX_TRANSITION_LENGTH = 5000
// Samples along the arc a straight is spliced to, when the leaving point is looked for.
const ARC_STRAIGHT_SAMPLES = 2000
// How far two elements may part or kink at a junction and still be one chain [m, °].
const JOIN_GAP = 1e-4
const JOIN_KINK = 1e-4
// How often the lengths are set from the chain they stand in and the chain built again.
const MAX_ROUNDS = 8
// Two arcs over a straight offered as the other way of joining them get
// transitions at the Regellänge where none were asked for, the search starting here [m].
const ALTERNATIVE_START = 60
// The radius search where nothing fits: down from the radius asked for in
// steps of this ratio, no further than R_MIN, up no further than R_MAX.
const EXPLAIN_RATIO = 0.9
const EXPLAIN_R_MIN = 50
const EXPLAIN_R_MAX = 50000

const LENGTH_MODES = ['fixed', 'regular', 'minimum']
const PROFILES = ['clothoid', 'bloss']

class SpliceError extends Error {
  constructor(code, params = {}) {
    super(code)
    this.code = code
    this.params = params
  }
}

// ── plane geometry ───────────────────────────────────────────────────────────

const norm360 = (b) => ((b % 360) + 360) % 360
const bearingOf = (frm, to) => norm360(Math.atan2(to[0] - frm[0], to[1] - frm[1]) / DEG)
const dirOf = (b) => [Math.sin(b * DEG), Math.cos(b * DEG)]
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1])
/** Signed bearing change from `frm` to `to`, in [-180, 180) degrees. */
const turnOf = (frm, to) => ((((to - frm + 180) % 360) + 360) % 360) - 180
const kappa = (r) => (r ? -1 / r : 0)

/** Signed sweep between the two ends of an arc about its centre (the app's convention). */
function arcSweep(s, e, cx, cy, signedR) {
  const twoPi = 2 * Math.PI
  const mod = (a) => ((a % twoPi) + twoPi) % twoPi
  const a1 = Math.atan2(s[1] - cy, s[0] - cx)
  const a2 = Math.atan2(e[1] - cy, e[0] - cx)
  return signedR >= 0 ? -mod(mod(a1) - mod(a2)) : mod(mod(a2) - mod(a1))
}

/** Centre of the circle through `p` with tangent `bearing` and `signedR`. */
const centreOf = (p, bearing, signedR) => [p[0] + signedR * Math.cos(bearing * DEG), p[1] - signedR * Math.sin(bearing * DEG)]

/** Along an arc from `p` heading `bearing`: the point and bearing `sweep` radians on. */
function arcForward(p, bearing, signedR, sweep) {
  const side = signedR >= 0 ? 1 : -1
  const [dx, dy] = dirOf(bearing)
  const r = Math.abs(signedR)
  const cx = p[0] + r * (side > 0 ? dy : -dy)
  const cy = p[1] + r * (side > 0 ? -dx : dx)
  const ang = -side * sweep
  const rx = p[0] - cx, ry = p[1] - cy
  return [
    [cx + rx * Math.cos(ang) - ry * Math.sin(ang), cy + rx * Math.sin(ang) + ry * Math.cos(ang)],
    norm360(bearing + side * sweep / DEG),
  ]
}

/** Point and bearing `s` metres along an arc from `p` (negative: backwards). */
const pointOnArc = (p, bearing, s, signedR) => arcForward(p, bearing, signedR, s / Math.abs(signedR))

/** Compass tangent bearing at circle angle `angle` on a curve to the right or left. */
const arcBearingAt = (angle, right) => norm360((right
  ? Math.atan2(Math.sin(angle), -Math.cos(angle))
  : Math.atan2(-Math.sin(angle), Math.cos(angle))) / DEG)

// ── transitions (geometry.py: heading_coeffs, transition_end, transition_shift) ──

/** The heading polynomial h(s) = a1 s + a2 s² + a3 s³ + a4 s⁴ of a transition. */
function headingCoeffs(profile, k1, k2, length) {
  const dk = k2 - k1
  return profile === 'bloss' ? [k1, 0, dk / (length * length), -dk / (2 * length ** 3)] : [k1, dk / (2 * length), 0, 0]
}

// Gauss-Legendre nodes and weights on [0, 1], as the service integrates a transition.
const GL_NODES = [
  [0.01985507175123191, 0.05061426814518834],
  [0.10166676129318664, 0.11119051722668717],
  [0.23723379504183550, 0.15685332293894352],
  [0.40828267875217511, 0.18134189168918088],
  [0.59171732124782483, 0.18134189168918088],
  [0.76276620495816450, 0.15685332293894352],
  [0.89833323870681336, 0.11119051722668717],
  [0.98014492824876809, 0.05061426814518834],
]

/** ∫ (cos, sin) of phi0 + h(s) over [0, length], divided by the length. */
function integrate(phi0, [a1, a2, a3, a4], length) {
  let x = 0, y = 0
  for (const [u, w] of GL_NODES) {
    const s = u * length
    const p = phi0 + s * (a1 + s * (a2 + s * (a3 + s * a4)))
    x += w * Math.cos(p)
    y += w * Math.sin(p)
  }
  return [x, y]
}

/** End point and end bearing of a transition from `p` heading `bearing`. */
function transitionEnd(p, bearing, length, r1, r2, profile) {
  const k1 = kappa(r1), k2 = kappa(r2)
  const [x, y] = integrate((90 - bearing) * DEG, headingCoeffs(profile, k1, k2, length), length)
  return [[p[0] + length * x, p[1] + length * y], norm360(bearing - (k1 + k2) * length / 2 / DEG)]
}

/** Shift parameters [p, t, phi] of a straight-to-arc transition into `radius` > 0. */
function transitionShift(length, radius, profile) {
  if (!(length > 0)) return [0, 0, 0]
  const [x, y] = integrate(0, headingCoeffs(profile, 0, 1 / radius, length), length)
  const phi = length / (2 * radius)
  return [length * y + radius * Math.cos(phi) - radius, length * x - radius * Math.sin(phi), phi]
}

/** A transition laid from the origin heading east: [Δe, Δn, turn in degrees]. */
function transitionShape(length, r1, r2, profile) {
  if (!(length > 0)) return [0, 0, 0]
  const [[e, n], b] = transitionEnd([0, 0], 90, length, r1, r2, profile)
  return [e, n, turnOf(90, b)]
}

/** Where a transition of `shape` ends that starts at `p` heading `bearing`. */
function placed(p, bearing, shape) {
  const phi = (90 - bearing) * DEG
  const c = Math.cos(phi), s = Math.sin(phi)
  return [p[0] + shape[0] * c - shape[1] * s, p[1] + shape[0] * s + shape[1] * c]
}

/** The transition shapes of a construction, [departure's, arrival's]: one name for both, or a pair. */
const pp = (profile) => (typeof profile === 'string' ? [profile, profile] : profile)

// ── elements in the app's form ───────────────────────────────────────────────

const straight = (frm, to, role) => ({
  elementType: 0, role, startNode: [frm[0], frm[1]], endNode: [to[0], to[1]],
  bearing: bearingOf(frm, to), length: dist(frm, to),
})

/** The arc of `signedR` from `frm` to `to`, the way it turns — always the one shorter than half a circle. */
function arc(frm, to, signedR, role) {
  const c = arcCenter(frm[0], frm[1], to[0], to[1], signedR)
  if (!c) throw new SpliceError('splice_error_no_fit')
  const sweep = Math.abs(arcSweep(frm, to, c.cx, c.cy, signedR))
  const side = signedR > 0 ? 1 : -1
  const chord = bearingOf(frm, to)
  const turn = sweep / DEG
  return {
    elementType: 1, role, radius: signedR, startNode: [frm[0], frm[1]], endNode: [to[0], to[1]],
    bearing: norm360(chord - side * turn / 2), endBearing: norm360(chord + side * turn / 2),
    length: sweep * Math.abs(signedR),
  }
}

/**
 * What is left of a picked arc, re-shaped along its own circle to a junction
 * whose bearing is `bearingAt` (`atEnd`: the arc ends there, else it starts
 * there) — refused where it would have to wrap more than half its circle.
 */
function reshapedArc(frm, to, signedR, role, bearingAt, atEnd) {
  const el = arc(frm, to, signedR, role)
  if (Math.abs(turnOf(atEnd ? el.endBearing : el.bearing, bearingAt)) > 1e-3) {
    throw new SpliceError(`splice_error_${role}_too_large`)
  }
  return el
}

/** A transition from `frm`; `end` / `endBearing` snap it onto the construction's own junction. */
function transition(frm, bearing, length, r1, r2, profile, role = 'new', end = null, endBearing = null) {
  const [e, b] = transitionEnd(frm, bearing, length, r1, r2, profile)
  return {
    elementType: 2, role, transitionType: profile, r1, r2,
    startNode: [frm[0], frm[1]], endNode: end ? [end[0], end[1]] : e,
    bearing: norm360(bearing), endBearing: norm360(endBearing ?? b), length,
  }
}

/** The element run the other way: ends and bearings swapped, curvature negated. */
function reversedElement(el) {
  const out = {
    ...el, startNode: el.endNode, endNode: el.startNode,
    bearing: norm360((el.endBearing ?? el.bearing) + 180), endBearing: norm360(el.bearing + 180),
  }
  if (el.elementType === 1) out.radius = -el.radius
  if (el.elementType === 2) {
    out.r1 = el.r2 != null ? -el.r2 : null
    out.r2 = el.r1 != null ? -el.r1 : null
  }
  return out
}

// ── two straights: an arc in the corner ──────────────────────────────────────

/**
 * Transition, arc, transition between two directed lines, the entry `p1` +
 * t·`d1` and the exit `p2` + t·`d2` (`p2` its far end) — geometry.py
 * fit_curve_group. Null where none fits.
 */
function fitCurveGroup(p1, d1, p2, d2, radius, l1, l2, type1, type2) {
  const cross = d1[0] * d2[1] - d1[1] * d2[0]
  const turn = Math.atan2(cross, d1[0] * d2[0] + d1[1] * d2[1])
  if (Math.abs(turn) < 1e-9) return null
  const left = turn > 0
  const sign = left ? -1 : 1
  const [p1Shift, t1, phi1] = transitionShift(l1, radius, type1)
  const [p2Shift, t2, phi2] = transitionShift(l2, radius, type2)
  const rhs1 = sign * (radius + p1Shift) + p1[0] * d1[1] - p1[1] * d1[0]
  const rhs2 = sign * (radius + p2Shift) + p2[0] * d2[1] - p2[1] * d2[0]
  const ce = (-rhs1 * d2[0] + rhs2 * d1[0]) / cross
  const cn = (d1[1] * rhs2 - d2[1] * rhs1) / cross
  const foot = (p, d) => {
    const t = (ce - p[0]) * d[0] + (cn - p[1]) * d[1]
    return [p[0] + t * d[0], p[1] + t * d[1]]
  }
  const virt1 = foot(p1, d1), virt2 = foot(p2, d2)
  const clStart = [virt1[0] - t1 * d1[0], virt1[1] - t1 * d1[1]]
  const clEnd = [virt2[0] + t2 * d2[0], virt2[1] + t2 * d2[1]]
  const startAng = Math.atan2(virt1[1] - cn, virt1[0] - ce) - phi1 * sign
  const endAng = Math.atan2(virt2[1] - cn, virt2[0] - ce) + phi2 * sign
  let sweep = endAng - startAng
  if (left && sweep < 0) sweep += 2 * Math.PI
  if (!left && sweep > 0) sweep -= 2 * Math.PI
  if (Math.abs(sweep) < 1e-6 || Math.abs(sweep) > Math.PI + 1e-6) return null
  return {
    signedR: left ? -radius : radius, clStart, clEnd,
    arcStart: [ce + radius * Math.cos(startAng), cn + radius * Math.sin(startAng)],
    arcEnd: [ce + radius * Math.cos(endAng), cn + radius * Math.sin(endAng)],
    arcLength: Math.abs(sweep) * radius,
    entry: (clStart[0] - p1[0]) * d1[0] + (clStart[1] - p1[1]) * d1[1],
    exit: (p2[0] - clEnd[0]) * d2[0] + (p2[1] - clEnd[1]) * d2[1],
    arcStartBearing: arcBearingAt(startAng, !left),
    arcEndBearing: arcBearingAt(startAng + sweep, !left),
  }
}

function corner(dep, arr, radius, lDep, lArr, profile) {
  const [pd, pa] = pp(profile)
  const d1 = dirOf(dep.bearing)
  const a = dirOf(arr.bearing)
  const d2 = [-a[0], -a[1]]
  if (Math.abs(d1[0] * d2[1] - d1[1] * d2[0]) < 1e-9) throw new SpliceError('splice_error_parallel')
  const fit = fitCurveGroup(dep.start, d1, arr.start, d2, radius, lDep, lArr, pd, pa)
  if (!fit) throw new SpliceError('splice_error_clothoid_too_long')
  return { fit, d2 }
}

const fits = (fit) => fit.entry >= -TOL && fit.exit >= -TOL

/** The largest radius up to `upto` whose arc still fits on both straights, or null. */
function largestCornerRadius(dep, arr, lDep, lArr, profile, upto) {
  const ok = (r) => {
    try { return fits(corner(dep, arr, r, lDep, lArr, profile).fit) } catch { return false }
  }
  let lo = 1, hi = upto
  if (!ok(lo)) return null
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2
    if (ok(mid)) lo = mid
    else hi = mid
  }
  return Math.floor(lo)
}

function spliceStraights(dep, arr, radius, lDep, lArr, profile) {
  if (!(radius > 0)) throw new SpliceError('splice_error_parallel')
  const { fit, d2 } = corner(dep, arr, radius, lDep, lArr, profile)
  if (!fits(fit)) {
    const side = fit.entry < -TOL ? 'dep' : 'arr'
    throw new SpliceError(`splice_error_${side}_too_large`, { rMax: largestCornerRadius(dep, arr, lDep, lArr, profile, radius) })
  }
  const sr = fit.signedR
  const [pd, pa] = pp(profile)
  const exitBearing = norm360(Math.atan2(d2[0], d2[1]) / DEG)
  const els = []
  if (fit.entry > 1e-6) els.push(straight(dep.start, fit.clStart, 'dep'))
  if (lDep > 0) els.push(transition(fit.clStart, dep.bearing, lDep, null, sr, pd, 'new', fit.arcStart, fit.arcStartBearing))
  els.push(arc(fit.arcStart, fit.arcEnd, sr, 'new'))
  if (lArr > 0) els.push(transition(fit.arcEnd, fit.arcEndBearing, lArr, sr, null, pa, 'new', fit.clEnd, exitBearing))
  if (fit.exit > 1e-6) els.push(straight(fit.clEnd, arr.start, 'arr'))
  return { elements: els, info: { arcLength: fit.arcLength, signedR: sr } }
}

// ── two arcs joined by a straight ────────────────────────────────────────────

function spliceArcsStraight(dep, arr, lDep, lArr, profile) {
  const r1s = dep.radius, r2s = arr.radius
  const r1 = Math.abs(r1s), r2 = Math.abs(r2s)
  const leftNormal = (d) => [-d[1], d[0]]
  const ln1 = leftNormal(dirOf(dep.bearing)), ln2 = leftNormal(dirOf(arr.bearing))
  const sgn1 = r1s >= 0 ? -1 : 1
  const sgn2 = r2s >= 0 ? -1 : 1
  const o1 = [dep.end[0] + sgn1 * r1 * ln1[0], dep.end[1] + sgn1 * r1 * ln1[1]]
  const o2 = [arr.end[0] + sgn2 * r2 * ln2[0], arr.end[1] + sgn2 * r2 * ln2[1]]
  // Side of each centre against the straight's travel (+1 = left of it): the
  // departure arc runs forward, the arrival arc backwards.
  const sig1 = r1s < 0 ? 1 : -1
  const sig2 = r2s < 0 ? -1 : 1
  const [pd, pa] = pp(profile)
  const [p1, t1, phi1] = transitionShift(lDep, r1, pd)
  const [p2, t2, phi2] = transitionShift(lArr, r2, pa)
  const dd1 = r1 + p1, dd2 = r2 + p2
  const de = o2[0] - o1[0], dn = o2[1] - o1[1]
  const m = Math.hypot(de, dn)
  if (m < 1e-6) throw new SpliceError('splice_error_parallel')
  const c = sig2 * dd2 - sig1 * dd1
  if (Math.abs(c) > m + 1e-6) throw new SpliceError('splice_error_parallel')
  const gamma = Math.atan2(de, dn)
  const base = Math.asin(Math.max(-1, Math.min(1, c / m)))
  let best = null
  for (const bm of [gamma + base, gamma + Math.PI - base]) {
    const b = norm360(bm / DEG)
    const u = dirOf(b)
    const lnu = leftNormal(u)
    const f1 = [o1[0] - sig1 * dd1 * lnu[0], o1[1] - sig1 * dd1 * lnu[1]]
    const f2 = [o2[0] - sig2 * dd2 * lnu[0], o2[1] - sig2 * dd2 * lnu[1]]
    const fwd = (f2[0] - f1[0]) * u[0] + (f2[1] - f1[1]) * u[1]
    if (!best || fwd > best.fwd) best = { b, u, f1, f2, fwd }
  }
  if (!best || best.fwd <= 0) throw new SpliceError('splice_error_parallel')
  const { b, u, f1, f2 } = best
  const s1 = [f1[0] + t1 * u[0], f1[1] + t1 * u[1]]
  const s2 = [f2[0] - t2 * u[0], f2[1] - t2 * u[1]]
  const straightLength = (s2[0] - s1[0]) * u[0] + (s2[1] - s1[1]) * u[1]
  if (straightLength < -TOL) throw new SpliceError('splice_error_clothoid_too_long')
  const uAng = Math.atan2(u[1], u[0])
  const aDep = uAng - sig1 * phi1
  const j1 = [o1[0] - r1 * Math.cos(aDep + sig1 * Math.PI / 2), o1[1] - r1 * Math.sin(aDep + sig1 * Math.PI / 2)]
  const bearingJ1 = norm360(90 - aDep / DEG)
  const aArr = uAng + sig2 * phi2
  const j2 = [o2[0] - r2 * Math.cos(aArr + sig2 * Math.PI / 2), o2[1] - r2 * Math.sin(aArr + sig2 * Math.PI / 2)]

  const els = [reshapedArc(dep.start, j1, r1s, 'dep', bearingJ1, true)]
  if (lDep > 0) els.push(transition(j1, bearingJ1, lDep, r1s, null, pd, 'new', s1, b))
  els.push(straight(s1, s2, 'new'))
  let bearingJ2 = b
  if (lArr > 0) {
    els.push(transition(s2, b, lArr, null, -r2s, pa, 'new', j2))
    bearingJ2 = els.at(-1).endBearing
  }
  els.push(reshapedArc(j2, arr.start, -r2s, 'arr', bearingJ2, false))
  return { elements: els, info: { straightLength } }
}

// ── two arcs joined directly by one transition ───────────────────────────────

/**
 * Compound or reverse curve: the transition whose end circle is the arrival
 * circle. Its length alone sets how far the centre of the circle it reaches
 * lies from the departure's centre, so it is found from that distance, and
 * the figure is then turned about the departure's centre until the two
 * centres line up.
 */
function spliceArcsTransition(dep, arr, profile) {
  const r1 = dep.radius
  const r2 = -arr.radius      // the arrival arc is run backwards
  if (Math.abs(r1 - r2) < 1e-9) throw new SpliceError('splice_error_arcs_no_fit')
  const o1 = centreOf(dep.end, dep.bearing, dep.radius)
  const o2 = centreOf(arr.end, arr.bearing, arr.radius)
  const target = dist(o1, o2)

  const canon = (length) => {
    const [end, b] = length > 0 ? transitionEnd([0, 0], 0, length, r1, r2, profile) : [[0, 0], 0]
    const c = centreOf(end, b, r2)
    return { end, b, c, d: Math.hypot(c[0] - r1, c[1]) }
  }
  const d0 = canon(0).d
  const d1 = canon(1e-3).d
  const direction = d1 !== d0 ? Math.sign(d1 - d0) : 1
  if ((target - d0) * direction < -1e-6) throw new SpliceError('splice_error_arcs_no_fit')
  const reach = (length) => (canon(length).d - target) * direction
  let hi = Math.max(20, Math.abs(r1 - r2))
  while (reach(hi) < 0 && hi < MAX_TRANSITION_LENGTH) hi *= 2
  if (reach(hi) < 0) throw new SpliceError('splice_error_arcs_too_far')
  let lo = 0
  for (let i = 0; i < 100; i++) {
    const mid = (lo + hi) / 2
    if (reach(mid) < 0) lo = mid
    else hi = mid
  }
  const length = (lo + hi) / 2
  if (!(length > 0)) throw new SpliceError('splice_error_arcs_no_fit')
  const { end, b: bEnd, c } = canon(length)

  const theta = Math.atan2(o2[1] - o1[1], o2[0] - o1[0]) - Math.atan2(c[1], c[0] - r1)
  const ct = Math.cos(theta), st = Math.sin(theta)
  const place = ([e, n]) => [o1[0] + (e - r1) * ct - n * st, o1[1] + (e - r1) * st + n * ct]
  const turned = (bearing) => norm360(bearing - theta / DEG)
  const j1 = place([0, 0]), j2 = place(end)
  return {
    elements: [
      reshapedArc(dep.start, j1, r1, 'dep', turned(0), true),
      transition(j1, turned(0), length, r1, r2, profile, 'new', j2, turned(bEnd)),
      reshapedArc(j2, arr.start, r2, 'arr', turned(bEnd), false),
    ],
    info: { transitionLength: length, compound: (r1 > 0) === (r2 > 0) },
  }
}

// ── an arc and a straight, joined by a new arc ───────────────────────────────

/**
 * A new arc of `radius` between an arc and a straight, transitions optional,
 * built forwards from the station `s` on the arc where the chain leaves it:
 * the straight's direction fixes the whole turn, the transitions take their
 * share, which leaves the new arc's sweep and with it the chain. Its far end
 * has to land on the straight — solved for `s` over the whole arc the element
 * can become, for both hands of the new arc; the root that moves the junction
 * least wins.
 */
function spliceArcStraight(dep, arr, radius, lDep, lArr, profile) {
  if (!(radius > 0)) throw new SpliceError('splice_error_parallel')
  const arcIsDep = dep.radius != null
  if (arcIsDep === (arr.radius != null)) throw new SpliceError('splice_error_mixed')
  // Always solved with the arc leading: read backwards, the other case is this one.
  const [a, b] = arcIsDep ? [dep, arr] : [arr, dep]
  const [la, lb] = arcIsDep ? [lDep, lArr] : [lArr, lDep]
  const [pd, pa] = pp(profile)
  const [fa, fb] = arcIsDep ? [pd, pa] : [pa, pd]
  const ra = a.radius
  const exitBearing = norm360(b.bearing + 180)
  const exitDir = dirOf(exitBearing)
  const normal = [-exitDir[1], exitDir[0]]

  // The two transitions do not change with where they start, only turn with
  // it: worked out once per hand of the new arc.
  const shapes = new Map([radius, -radius].map(rn => [rn, [transitionShape(la, ra, rn, fa), transitionShape(lb, rn, null, fb)]]))

  const build = (s, rn) => {
    const [j1, b1] = pointOnArc(a.end, a.bearing, s, ra)
    const [shapeIn, shapeOut] = shapes.get(rn)
    const arcTurn = turnOf(b1 + shapeIn[2] + shapeOut[2], exitBearing)
    if (arcTurn === 0 || Math.sign(arcTurn) !== Math.sign(rn)) return null
    const arcLength = Math.abs(arcTurn) * DEG * radius
    const a1 = placed(j1, b1, shapeIn)
    const [a2, ba2] = arcForward(a1, b1 + shapeIn[2], rn, arcLength / radius)
    const end = placed(a2, ba2, shapeOut)
    const residual = (end[0] - b.end[0]) * normal[0] + (end[1] - b.end[1]) * normal[1]
    return { j1, b1, a1, a2, ba2, end, arcLength, residual }
  }

  // How far the junction may move along the arc: back to its start, or on
  // until the element would be half a circle.
  const c = arcCenter(a.start[0], a.start[1], a.end[0], a.end[1], ra)
  const lenA = c ? Math.abs(arcSweep(a.start, a.end, c.cx, c.cy, ra)) * Math.abs(ra) : 0
  const sMin = -lenA, sMax = Math.PI * Math.abs(ra) - lenA
  const f = (s, rn) => build(s, rn)?.residual ?? NaN

  let chosen = null
  for (const rn of [radius, -radius]) {
    const n = ARC_STRAIGHT_SAMPLES
    const xs = Array.from({ length: n + 1 }, (_, i) => sMin + (sMax - sMin) * i / n)
    const ys = xs.map(x => f(x, rn))
    for (let i = 0; i < n; i++) {
      const y0 = ys[i], y1 = ys[i + 1]
      if (!(Number.isFinite(y0) && Number.isFinite(y1)) || y0 * y1 > 0) continue
      let lo = xs[i], hi = xs[i + 1], flo = y0
      for (let k = 0; k < 80; k++) {
        const mid = (lo + hi) / 2
        const fm = f(mid, rn)
        if (!Number.isFinite(fm)) break
        if (flo * fm <= 0) hi = mid
        else { lo = mid; flo = fm }
      }
      const s = (lo + hi) / 2
      const built = build(s, rn)
      if (!built || Math.abs(built.residual) > 1e-4) continue
      // The re-shaped straight must not run past its far end.
      const along = (built.end[0] - b.start[0]) * exitDir[0] + (built.end[1] - b.start[1]) * exitDir[1]
      if (along > TOL) continue
      if (!chosen || Math.abs(s) < Math.abs(chosen.s)) chosen = { rn, s, built }
    }
  }
  if (!chosen) throw new SpliceError('splice_error_no_fit')
  const { built: k } = chosen
  let { rn } = chosen
  const [roleA, roleB] = arcIsDep ? ['dep', 'arr'] : ['arr', 'dep']
  let els = []
  if (dist(k.j1, a.start) > 1e-6) els.push(reshapedArc(a.start, k.j1, ra, roleA, k.b1, true))
  if (la > 0) els.push(transition(k.j1, k.b1, la, ra, rn, fa, 'new', k.a1))
  els.push(arc(k.a1, k.a2, rn, 'new'))
  if (lb > 0) els.push(transition(k.a2, k.ba2, lb, rn, null, fb, 'new', k.end))
  if (dist(b.start, k.end) > 1e-6) els.push(straight(k.end, b.start, roleB))
  if (!arcIsDep) {
    // Solved read backwards: the chain, and the hand of the new arc, turned round.
    els = els.reverse().map(reversedElement)
    rn = -rn
  }
  return { elements: els, info: { arcLength: k.arcLength, signedR: rn } }
}

// ── the picks ────────────────────────────────────────────────────────────────

function readPick(raw) {
  const r = raw.radius
  const p = {
    start: [Number(raw.start[0]), Number(raw.start[1])], end: [Number(raw.end[0]), Number(raw.end[1])],
    bearing: Number(raw.bearing),
    radius: r == null || Number(r) === 0 ? null : Number(r),
    // The cant the picked element carries, a magnitude [mm], and its design speed.
    cant: Math.abs(Number(raw.cant) || 0),
    speed: Math.max(0, Number(raw.speed) || 0),
    before: Math.max(0, Number(raw.before) || 0),
    after: Math.max(0, Number(raw.after) || 0),
    joinAt: raw.joinAt === 'start' || raw.joinAt === 'end' ? raw.joinAt : null,
  }
  p.length = Number(raw.length) || lengthOf(p)
  return p
}

/** The bearing at a pick's start, in its own direction. */
function startBearing(p) {
  if (p.radius == null) return p.bearing
  const r = p.radius
  const c = centreOf(p.end, p.bearing, r)
  // The centre lies `r` to the right of the tangent: (cos b, -sin b) · r.
  return norm360(Math.atan2(-(c[1] - p.start[1]) / r, (c[0] - p.start[0]) / r) / DEG)
}

/** A pick's length where the request does not give it: its chord, or its arc. */
function lengthOf(p) {
  if (p.radius == null || dist(p.start, p.end) < 1e-9) return dist(p.start, p.end)
  const sweep = norm360((p.bearing - startBearing(p)) * Math.sign(p.radius))
  return sweep * DEG * Math.abs(p.radius)
}

/** The pick run the other way: the constructions join the departure and the arrival at their ends. */
const flipped = (p) => ({
  ...p, start: p.end, end: p.start,
  bearing: norm360(startBearing(p) + 180),
  radius: p.radius != null ? -p.radius : null,
  before: p.after, after: p.before,
})

const toward = (p, end) => (end === 'end' ? p : flipped(p))
const trackLength = (p) => p.before + p.length + p.after

/** An order of two picks that neither the clicks nor a track's direction change: by the lower of their ends. */
function key(p) {
  const r = (pt) => pt.map(c => Math.round(c * 1000) / 1000)
  const [s, e] = [r(p.start), r(p.end)]
  return keyLess(s, e) ? s : e
}
const keyLess = (a, b) => a[0] < b[0] || (a[0] === b[0] && a[1] <= b[1])

// ── the constructions, and which ends meet ───────────────────────────────────

/** The splice of the case the two picks make (throws SpliceError). */
function construct(dep, arr, radius, lDep, lArr, profile, arcJoin, direct) {
  if (dep.radius == null && arr.radius == null) return spliceStraights(dep, arr, radius, lDep, lArr, profile)
  if (dep.radius != null && arr.radius != null) {
    return arcJoin === 'transition' ? spliceArcsTransition(dep, arr, direct) : spliceArcsStraight(dep, arr, lDep, lArr, profile)
  }
  return spliceArcStraight(dep, arr, radius, lDep, lArr, profile)
}

// The four pairs of ends two picks can meet at: [the first pick's, the second's].
const PAIRS = [['end', 'start'], ['start', 'end'], ['end', 'end'], ['start', 'start']]

/**
 * Which pick departs where `ends` meet: an end meeting a start leaves the
 * tracks as they run; two ends or two starts turn the shorter track round
 * (Entscheidung 182) — equally long, the second pick.
 */
function departure(picks, ends) {
  if (ends[0] !== ends[1]) return ends[0] === 'end' ? 0 : 1
  const [l0, l1] = picks.map(trackLength)
  if (Math.abs(l0 - l1) < 1e-6) return ends[0] === 'end' ? 0 : 1
  const longer = l0 > l1 ? 0 : 1
  return ends[0] === 'end' ? longer : 1 - longer
}

const swapSide = (code) => code.replace('_dep_', '_tmp_').replace('_arr_', '_dep_').replace('_tmp_', '_arr_')

/** A construction read the other way: the chain turned round, departure and arrival swapped. */
function reversedSolution(res) {
  const swap = { dep: 'arr', arr: 'dep' }
  const elements = [...res.elements].reverse().map(el => ({ ...reversedElement(el), role: swap[el.role] ?? el.role }))
  const info = { ...res.info }
  if (info.signedR != null) info.signedR = -info.signedR
  return { ...res, elements, info }
}

/** The splice where `ends` meet with the transitions `lengths` beside the two picks (throws SpliceError). */
function pair(picks, ends, spec, lengths) {
  let c = keyLess(key(picks[0]), key(picks[1])) ? 0 : 1
  if (ends[c] !== ends[1 - c] && ends[c] === 'start') c = 1 - c   // an end meeting a start departs from the end
  const d = departure(picks, ends)
  let res
  try {
    res = construct(toward(picks[c], ends[c]), toward(picks[1 - c], ends[1 - c]), spec.radius, lengths[c], lengths[1 - c],
      [spec.profiles[c], spec.profiles[1 - c]], spec.arcJoin, spec.profile)
  } catch (err) {
    if (err instanceof SpliceError && c !== d) err.code = swapSide(err.code)
    throw err
  }
  if (c !== d) res = reversedSolution(res)
  const sol = { ...res, depPick: d, ends: [...ends], reverseDep: ends[d] === 'start', reverseArr: ends[1 - d] === 'end' }
  annotate(sol, picks, spec)
  return sol
}

/**
 * Each element's design speed and cant, as the app will write them: what is
 * left of a picked element keeps its own, what the splice inserts takes the
 * dialog's speed, and an inserted arc the dialog's cant — signed with its curve.
 */
function annotate(sol, picks, spec) {
  const d = sol.depPick
  for (const el of sol.elements) {
    const own = el.role === 'dep' ? picks[d] : el.role === 'arr' ? picks[1 - d] : null
    el.speed = own ? own.speed : spec.speed
    if (el.elementType === 1) el.cant = Math.sign(el.radius) * (own ? own.cant : spec.cant)
    else if (el.elementType === 0) el.cant = 0
  }
}

/**
 * The transitions a solution inserts, by the pick they stand beside: {pick:
 * element index} — those before the inserted arc or straight beside the
 * departure, those after it beside the arrival. A single transition from arc
 * to arc stands beside neither.
 */
function sides(sol) {
  const els = sol.elements
  const body = els.findIndex(el => el.role === 'new' && el.elementType !== 2)
  if (body < 0) return {}
  const d = sol.depPick
  const out = {}
  els.forEach((el, i) => {
    if (el.role === 'new' && el.elementType === 2) out[i < body ? d : 1 - d] = i
  })
  return out
}

// The rules' lengths for the same neighbours are asked again and again while
// the lengths settle and the alternatives are tried: kept per question.
const lengthsAsked = new Map()

/** The shortest transitions the rules allow between `prev` and `next` (rules/transitionLength). */
function rulesLengths(prev, next, r1, type, speed) {
  const pick = (el) => el && { elementType: el.elementType, radius: el.radius ?? null, r1: el.r1 ?? null, cant: el.cant ?? 0, speed: el.speed ?? 0 }
  const asked = JSON.stringify([pick(prev), pick(next), r1 ?? null, type, speed])
  if (!lengthsAsked.has(asked)) {
    if (lengthsAsked.size > 500) lengthsAsked.clear()
    lengthsAsked.set(asked, transitionLengths({ prev: pick(prev), next: pick(next), r1: r1 ?? null, type, speed }))
  }
  return lengthsAsked.get(asked)
}

/** The rules' lengths for each transition the solution inserts, between its neighbours there. */
function sideRules(sol, spec) {
  const els = sol.elements
  const out = {}
  for (const [k, i] of Object.entries(sides(sol))) {
    out[k] = rulesLengths(els[i - 1], els[i + 1], els[i].r1, spec.profiles[k], spec.speed)
  }
  return out
}

/** A rule's lengths without the formula, as the service answers them. */
const plainBy = ({ regular, minimum, regularBy, minimumBy }) => ({
  regular, minimum,
  regularBy: regularBy.map(({ id, length, binding }) => ({ id, length, binding })),
  minimumBy: minimumBy.map(({ id, length, binding }) => ({ id, length, binding })),
})

/**
 * The splice where `ends` meet, the transitions each as long as its mode asks
 * (Entscheidung 179): 'fixed' as given, 'regular' or 'minimum' the Regel- or
 * Mindestlänge between its neighbours in the very chain it stands in — built,
 * the lengths read off, built again with them, until they stand (throws
 * SpliceError). Says for each pick what its transition is.
 */
function solve(picks, ends, spec) {
  let cur = [...spec.lengths]
  let sol, rules
  let settled = false
  for (let round = 0; round < MAX_ROUNDS; round++) {
    sol = pair(picks, ends, spec, cur)
    rules = sideRules(sol, spec)
    const want = cur.map((l, k) => {
      const ask = spec.modes[k]
      return (ask === 'regular' || ask === 'minimum') && rules[k]?.[ask] != null && l > 0 ? rules[k][ask] : l
    })
    if (want.every((l, k) => Math.abs(l - cur[k]) < 1e-9)) { settled = true; break }
    cur = want
  }
  if (!settled) throw new SpliceError('splice_error_lengths_unstable')
  continuous(sol.elements)
  sol.lengths = [0, 1].map(k => (k in rules
    ? { mode: spec.modes[k], length: cur[k], ...plainBy(rules[k]) }
    : { mode: 'fixed', length: 0 }))
  return sol
}

/**
 * Between an arc and a straight: does the new arc curve the same way as the
 * picked arc, as the splice lays it without transitions where the ends lie
 * closest? Where that does not fit either, no — the stricter reverse curve.
 */
function sameHand(picks, spec) {
  const k = picks[0].radius != null ? 0 : 1
  const pairs = allowedPairs(picks).sort((a, b) => gap(picks, a) - gap(picks, b))
  for (const ends of pairs) {
    let sol
    try { sol = pair(picks, ends, spec, [0, 0]) } catch { continue }
    const role = sol.depPick === k ? 'dep' : 'arr'
    const own = sol.elements.filter(el => el.role === role && el.elementType === 1)
    const r = sol.info.signedR
    if (own.length && r) return (own.at(-1).radius > 0) === (r > 0)
  }
  return false
}

/**
 * The transition beside each pick where no splice fits: the lengths the rules
 * ask for between the picked element and what the splice would put beside it,
 * so that the dialog can still offer them.
 */
function unsolvedLengths(picks, spec) {
  const twoArcs = picks.every(p => p.radius != null)
  const direct = twoArcs && spec.arcJoin === 'transition'
  const same = !twoArcs && spec.radius > 0 && picks.some(p => p.radius) && sameHand(picks, spec)
  return picks.map((p, k) => {
    if (direct || !(spec.lengths[k] > 0)) return { mode: 'fixed', length: 0 }
    const side = { mode: spec.modes[k], length: spec.lengths[k] }
    if (!twoArcs && !(spec.radius > 0)) return side
    const own = p.radius
      ? { elementType: 1, radius: Math.abs(p.radius), cant: p.cant, speed: p.speed }
      : { elementType: 0, cant: 0, speed: p.speed }
    let body
    if (twoArcs) body = { elementType: 0, cant: 0, speed: spec.speed }
    else {
      const hand = p.radius == null || same ? 1 : -1
      body = { elementType: 1, radius: hand * spec.radius, cant: hand * spec.cant, speed: spec.speed }
    }
    return { ...side, ...plainBy(rulesLengths(own, body, own.radius, spec.profiles[k], spec.speed)) }
  })
}

/** How much a solution rebuilds [m]: the track given up, the picks re-shaped, the new stretch. */
function cost(sol, picks) {
  const d = sol.depPick
  let sum = 0
  for (const [i, role] of [[d, 'dep'], [1 - d, 'arr']]) {
    const p = picks[i]
    sum += sol.ends[i] === 'end' ? p.after : p.before
    const kept = sol.elements.filter(el => el.role === role).reduce((s, el) => s + el.length, 0)
    sum += Math.abs(kept - p.length)
  }
  return sum + sol.elements.filter(el => el.role === 'new').reduce((s, el) => s + el.length, 0)
}

/** How far an element turns [rad], signed (right > 0). */
function elementTurn(el) {
  if (el.elementType === 1) return el.length / el.radius
  if (el.elementType === 2) return turnOf(el.bearing, el.endBearing) * DEG
  return 0
}

/** Does a solution turn by more than half a circle beyond what the two picks turned already? */
function loops(sol, picks) {
  const d = sol.depPick
  let own = 0
  for (const [i, flip] of [[d, sol.reverseDep], [1 - d, sol.reverseArr]]) {
    const r = picks[i].radius
    if (r != null) own += picks[i].length / (flip ? -r : r)
  }
  return Math.abs(sol.elements.reduce((s, el) => s + elementTurn(el), 0) - own) > Math.PI + 1e-6
}

/** Is the chain one line — no gap, no kink, every transition meeting its neighbours' curvature? */
function continuous(els) {
  const k = (r) => (r ? 1 / r : 0)
  const kEnd = (el) => (el.elementType === 2 ? k(el.r2) : k(el.radius))
  const kStart = (el) => (el.elementType === 2 ? k(el.r1) : k(el.radius))
  for (let i = 0; i + 1 < els.length; i++) {
    const a = els[i], b = els[i + 1]
    if (dist(a.endNode, b.startNode) > JOIN_GAP
      || Math.abs(turnOf(a.endBearing ?? a.bearing, b.bearing)) > JOIN_KINK
      || ((a.elementType === 2 || b.elementType === 2) && Math.abs(kEnd(a) - kStart(b)) > 1e-9)) {
      throw new SpliceError('splice_error_discontinuous')
    }
  }
}

const gap = (picks, ends) => dist(picks[0][ends[0]], picks[1][ends[1]])
const allowedPairs = (picks) => PAIRS.filter(e => picks.every((p, k) => p.joinAt == null || p.joinAt === e[k]))

/**
 * The ways to try, the one asked for first: for two arcs also the other way to
 * join them — the straight with the transitions asked for, and where none
 * were, at the Regellänge (Entscheidung 183).
 */
function joins(picks, spec) {
  if (picks.some(p => p.radius == null)) return [spec]
  const other = { ...spec, arcJoin: spec.arcJoin === 'transition' ? 'straight' : 'transition' }
  if (other.arcJoin === 'straight' && !spec.lengths.some(l => l > 0) && spec.speed > 0) {
    Object.assign(other, { lengths: [ALTERNATIVE_START, ALTERNATIVE_START], modes: ['regular', 'regular'] })
  }
  return [spec, other]
}

/**
 * What the catalogue finds on the whole stretch a solution writes — the rest
 * of the departure, what is inserted, the rest of the arrival and the joints
 * between them (AP S.4) — with the speed and cant each element will carry:
 * `findings` every result worse than ok as { at, index, id, severity }, `at`
 * '#i' for an element and '#i|#j' for a joint; `worst` the worst of them;
 * `judged` whether any element has a design speed.
 */
function judge(sol) {
  const check = checkTrack(sol.elements)
  const findings = []
  const add = (at, index, results) => {
    for (const r of results) {
      if (severityRank(r.severity) > severityRank('ok')) findings.push({ at, index, id: r.id, severity: r.severity })
    }
  }
  const ramps = new Map(check.ramps.map(r => [r.index, r]))
  check.elements.forEach((el, i) => {
    add(`#${i}`, [i], el.results ?? [])
    add(`#${i}`, [i], ramps.get(i)?.results ?? [])
  })
  for (const b of check.boundaries) add(`#${b.index}|#${b.index + 1}`, [b.index, b.index + 1], b.results ?? [])
  sol.findings = findings
  sol.worst = findings.length ? worstSeverity(findings.map(f => f.severity)) : 'ok'
  sol.judged = sol.elements.some(el => el.speed)
}

/**
 * Every pair of ends that can be joined, the way asked for before the other
 * and the least rebuilt first — or SpliceError for the pair whose ends lie
 * closest, where none can, with what would fit. Where only the other way of
 * joining two arcs fits, `requested` says why the way asked for does not.
 */
function solutions(picks, spec) {
  const twoArcs = picks.every(p => p.radius != null)
  const found = [], errors = []
  joins(picks, spec).forEach((sp, k) => {
    for (const ends of allowedPairs(picks)) {
      let sol
      try {
        sol = solve(picks, ends, sp)
      } catch (err) {
        if (!(err instanceof SpliceError)) throw err
        if (k === 0) errors.push({ gap: gap(picks, ends), ends, err })
        continue
      }
      if (loops(sol, picks)) continue
      const done = { ...sol, rebuilt: cost(sol, picks), alternative: k > 0, ...(twoArcs ? { arcJoin: sp.arcJoin } : {}) }
      judge(done)
      found.push(done)
    }
  })
  if (!found.length && !errors.length) throw new SpliceError('splice_error_no_fit')
  // Best first: nothing found before a hint before a warning and so on up to
  // an error, then the way of joining asked for before the other, then little
  // rebuilt — stable, as the service sorts.
  found.sort((a, b) => (severityRank(a.worst) - severityRank(b.worst)) || (a.alternative - b.alternative)
    || (Math.round(a.rebuilt * 1e6) - Math.round(b.rebuilt * 1e6)))
  const out = { solutions: found }
  if (!found.some(sol => !sol.alternative)) {
    const closest = errors.reduce((a, b) => (b.gap < a.gap ? b : a))
    explain(picks, closest.ends, spec, closest.err)
    if (!found.length) throw closest.err
    out.requested = { error: closest.err.code, params: closest.err.params }
  }
  return out
}

/**
 * What would fit where `ends` do not, into the error's params (AP S.5): `rMax`
 * the largest radius up to the one asked for and, between an arc and a
 * straight, `rMin` the smallest above it; `lMax` the longest transitions, as
 * long on both sides, that fit at the radius asked for. Two straights name
 * `rMax` themselves.
 */
function explain(picks, ends, spec, err) {
  if (err.code === 'splice_error_discontinuous') return
  const ok = (sp, lengths = null) => {
    try {
      if (lengths) pair(picks, ends, sp, lengths)
      else solve(picks, ends, sp)
      return true
    } catch { return false }
  }
  const bounded = (good, failed) => {
    let lo = good, hi = failed
    while (Math.abs(hi - lo) > 0.5) {
      const mid = (lo + hi) / 2
      if (ok({ ...spec, radius: mid })) lo = mid
      else hi = mid
    }
    return lo < hi ? Math.floor(lo) : Math.ceil(lo)
  }
  const free = picks.some(p => p.radius == null)
  if (free && spec.radius > 0 && err.params.rMax == null) {
    let failed = spec.radius, r = spec.radius * EXPLAIN_RATIO
    while (r >= EXPLAIN_R_MIN && !ok({ ...spec, radius: r })) { failed = r; r *= EXPLAIN_RATIO }
    if (r >= EXPLAIN_R_MIN) err.params.rMax = bounded(r, failed)
    if (picks.some(p => p.radius != null)) {
      failed = spec.radius; r = spec.radius / EXPLAIN_RATIO
      while (r <= EXPLAIN_R_MAX && !ok({ ...spec, radius: r })) { failed = r; r /= EXPLAIN_RATIO }
      if (r <= EXPLAIN_R_MAX) err.params.rMin = bounded(r, failed)
    }
  }
  const withLength = [0, 1].filter(k => spec.lengths[k] > 0)
  const direct = !free && spec.arcJoin === 'transition'
  if (withLength.length && !direct) {
    const at = (length) => [0, 1].map(k => (withLength.includes(k) ? length : 0))
    const longest = Math.max(...spec.lengths)
    if (ok(spec, at(0)) && !ok(spec, at(longest))) {
      let lo = 0, hi = longest
      while (hi - lo > 0.05) {
        const mid = (lo + hi) / 2
        if (ok(spec, at(mid))) lo = mid
        else hi = mid
      }
      err.params.lMax = Math.floor(lo * 10) / 10
    }
  }
}

/**
 * The answer to a splice request (commands/splice spliceRequest), in the form
 * the service gives it: { solutions }, the best first, each with its
 * elements, info, depPick, ends, reverseDep, reverseArr, rebuilt, lengths,
 * findings, worst, judged, alternative and for two arcs arcJoin — and
 * `requested` where only the other way of joining two arcs fits — or { error,
 * params, lengths } where no two ends can be joined. A spacing to a
 * neighbouring track (`clearance` in the request) is the service's alone
 * (decision 295): the dialog asks it there.
 */
export function solveSplice(request) {
  const picks = [readPick(request.dep), readPick(request.arr)]
  const modes = [request.modeDep || 'fixed', request.modeArr || 'fixed']
  const profile = request.transition || 'clothoid'
  const spec = {
    radius: Math.abs(Number(request.radius) || 0),
    lengths: [Math.max(0, Number(request.lDep) || 0), Math.max(0, Number(request.lArr) || 0)],
    modes: modes.map(m => (LENGTH_MODES.includes(m) ? m : 'fixed')),
    profile: PROFILES.includes(profile) ? profile : 'clothoid',
    profiles: [request.transitionDep || profile, request.transitionArr || profile].map(p => (PROFILES.includes(p) ? p : 'clothoid')),
    arcJoin: request.arcJoin === 'transition' ? 'transition' : 'straight',
    speed: Math.max(0, Number(request.speed) || 0),
    cant: Math.abs(Number(request.cant) || 0),
  }
  try {
    return solutions(picks, spec)
  } catch (err) {
    if (!(err instanceof SpliceError)) throw err
    return { error: err.code, params: err.params, lengths: unsolvedLengths(picks, spec) }
  }
}
