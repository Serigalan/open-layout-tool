import { arcCenter } from '../../core/utils/elementUtils'

// Splicing two tracks in the local build (decision 293): the service's
// construction (tools/optimizer/olt_optimizer/splice.py) in a simplified form,
// in the browser. It answers in the service's form, so commands/splice reads
// the answer and writes the merged track the same way.
//
// What it keeps of splice.py: the three cases — an arc of the radius asked for
// in the corner of two straights, a straight between two arcs, a new arc
// between an arc and a straight — every pair of ends tried (AP S.2), which pick
// departs (Entscheidung 182), the loops dropped, the chain checked for gaps and
// kinks, the solutions ranked by how much they rebuild, and where nothing fits
// the largest radius below (and between an arc and a straight the smallest
// above) that would.
//
// What it leaves out: transitions, a single transition from arc to arc, the
// spacing to a neighbouring track and the rule catalogue on the stretch — the
// check panel judges the merged track afterwards.
//
// Conventions are the service's: bearings in degrees clockwise from grid
// north, signed radius > 0 for a right-hand curve.

const DEG = Math.PI / 180

// A tangent point may lie this far behind the start of its element [m].
const TOL = 0.01
// Samples along the arc a straight is spliced to, when the leaving point is looked for.
const ARC_STRAIGHT_SAMPLES = 2000
// How far two elements may part or kink at a junction and still be one chain [m, °].
const JOIN_GAP = 1e-4
const JOIN_KINK = 1e-4
// The radius search where nothing fits: down from the radius asked for in
// steps of this ratio, no further than R_MIN, up no further than R_MAX.
const EXPLAIN_RATIO = 0.9
const EXPLAIN_R_MIN = 50
const EXPLAIN_R_MAX = 50000

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

/** The element run the other way: ends and bearings swapped, curvature negated. */
function reversedElement(el) {
  const out = {
    ...el, startNode: el.endNode, endNode: el.startNode,
    bearing: norm360((el.endBearing ?? el.bearing) + 180), endBearing: norm360(el.bearing + 180),
  }
  if (el.elementType === 1) out.radius = -el.radius
  return out
}

// ── two straights: an arc in the corner ──────────────────────────────────────

/**
 * The arc of `radius` between two directed lines, the entry `p1` + t·`d1` and
 * the exit `p2` + t·`d2` (`p2` its far end): where it touches them and how much
 * of each straight it leaves — the service's fit_curve_group without transitions.
 */
function fitArc(p1, d1, p2, d2, radius) {
  const cross = d1[0] * d2[1] - d1[1] * d2[0]
  const turn = Math.atan2(cross, d1[0] * d2[0] + d1[1] * d2[1])
  if (Math.abs(turn) < 1e-9) return null
  const left = turn > 0
  const sign = left ? -1 : 1
  const rhs1 = sign * radius + p1[0] * d1[1] - p1[1] * d1[0]
  const rhs2 = sign * radius + p2[0] * d2[1] - p2[1] * d2[0]
  const ce = (-rhs1 * d2[0] + rhs2 * d1[0]) / cross
  const cn = (d1[1] * rhs2 - d2[1] * rhs1) / cross
  const foot = (p, d) => {
    const t = (ce - p[0]) * d[0] + (cn - p[1]) * d[1]
    return [p[0] + t * d[0], p[1] + t * d[1]]
  }
  const start = foot(p1, d1)
  const end = foot(p2, d2)
  let sweep = Math.atan2(end[1] - cn, end[0] - ce) - Math.atan2(start[1] - cn, start[0] - ce)
  if (left && sweep < 0) sweep += 2 * Math.PI
  if (!left && sweep > 0) sweep -= 2 * Math.PI
  if (Math.abs(sweep) < 1e-6 || Math.abs(sweep) > Math.PI + 1e-6) return null
  return {
    signedR: left ? -radius : radius, start, end, arcLength: Math.abs(sweep) * radius,
    entry: (start[0] - p1[0]) * d1[0] + (start[1] - p1[1]) * d1[1],
    exit: (p2[0] - end[0]) * d2[0] + (p2[1] - end[1]) * d2[1],
  }
}

function corner(dep, arr, radius) {
  const d1 = dirOf(dep.bearing)
  const a = dirOf(arr.bearing)
  const d2 = [-a[0], -a[1]]
  if (Math.abs(d1[0] * d2[1] - d1[1] * d2[0]) < 1e-9) throw new SpliceError('splice_error_parallel')
  const fit = fitArc(dep.start, d1, arr.start, d2, radius)
  if (!fit) throw new SpliceError('splice_error_no_fit')
  return fit
}

const fits = (fit) => fit.entry >= -TOL && fit.exit >= -TOL

/** The largest radius up to `upto` whose arc still fits on both straights, or null. */
function largestCornerRadius(dep, arr, upto) {
  const ok = (r) => {
    try { return fits(corner(dep, arr, r)) } catch { return false }
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

function spliceStraights(dep, arr, radius) {
  if (!(radius > 0)) throw new SpliceError('splice_error_parallel')
  const fit = corner(dep, arr, radius)
  if (!fits(fit)) {
    const side = fit.entry < -TOL ? 'dep' : 'arr'
    throw new SpliceError(`splice_error_${side}_too_large`, { rMax: largestCornerRadius(dep, arr, radius) })
  }
  const els = []
  if (fit.entry > 1e-6) els.push(straight(dep.start, fit.start, 'dep'))
  els.push(arc(fit.start, fit.end, fit.signedR, 'new'))
  if (fit.exit > 1e-6) els.push(straight(fit.end, arr.start, 'arr'))
  return { elements: els, info: { arcLength: fit.arcLength, signedR: fit.signedR } }
}

// ── two arcs joined by a straight ────────────────────────────────────────────

function spliceArcsStraight(dep, arr) {
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
  const de = o2[0] - o1[0], dn = o2[1] - o1[1]
  const m = Math.hypot(de, dn)
  if (m < 1e-6) throw new SpliceError('splice_error_parallel')
  const c = sig2 * r2 - sig1 * r1
  if (Math.abs(c) > m + 1e-6) throw new SpliceError('splice_error_parallel')
  const gamma = Math.atan2(de, dn)
  const base = Math.asin(Math.max(-1, Math.min(1, c / m)))
  let best = null
  for (const bm of [gamma + base, gamma + Math.PI - base]) {
    const b = norm360(bm / DEG)
    const u = dirOf(b)
    const lnu = leftNormal(u)
    const f1 = [o1[0] - sig1 * r1 * lnu[0], o1[1] - sig1 * r1 * lnu[1]]
    const f2 = [o2[0] - sig2 * r2 * lnu[0], o2[1] - sig2 * r2 * lnu[1]]
    const fwd = (f2[0] - f1[0]) * u[0] + (f2[1] - f1[1]) * u[1]
    if (!best || fwd > best.fwd) best = { b, f1, f2, fwd }
  }
  if (!best || best.fwd <= 0) throw new SpliceError('splice_error_parallel')
  const { b, f1, f2, fwd } = best
  return {
    elements: [
      reshapedArc(dep.start, f1, r1s, 'dep', b, true),
      straight(f1, f2, 'new'),
      reshapedArc(f2, arr.start, -r2s, 'arr', b, false),
    ],
    info: { straightLength: fwd },
  }
}

// ── an arc and a straight, joined by a new arc ───────────────────────────────

/**
 * A new arc of `radius` between an arc and a straight, built forwards from
 * the station `s` on the arc where the chain leaves it: the straight's
 * direction fixes the turn and with it the chain, and `s` is found where its
 * far end lands on the straight — over the whole arc the element can become,
 * for both hands of the new arc; the root that moves the junction least wins.
 */
function spliceArcStraight(dep, arr, radius) {
  if (!(radius > 0)) throw new SpliceError('splice_error_parallel')
  const arcIsDep = dep.radius != null
  if (arcIsDep === (arr.radius != null)) throw new SpliceError('splice_error_mixed')
  // Always solved with the arc leading: read backwards, the other case is this one.
  const [a, b] = arcIsDep ? [dep, arr] : [arr, dep]
  const ra = a.radius
  const exitBearing = norm360(b.bearing + 180)
  const exitDir = dirOf(exitBearing)
  const normal = [-exitDir[1], exitDir[0]]

  const build = (s, rn) => {
    const [j1, b1] = pointOnArc(a.end, a.bearing, s, ra)
    const arcTurn = turnOf(b1, exitBearing)
    if (arcTurn === 0 || Math.sign(arcTurn) !== Math.sign(rn)) return null
    const arcLength = Math.abs(arcTurn) * DEG * radius
    const [end] = arcForward(j1, b1, rn, arcLength / radius)
    const residual = (end[0] - b.end[0]) * normal[0] + (end[1] - b.end[1]) * normal[1]
    return { j1, b1, end, arcLength, residual }
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
  const { built } = chosen
  let { rn } = chosen
  const [roleA, roleB] = arcIsDep ? ['dep', 'arr'] : ['arr', 'dep']
  let els = []
  if (dist(built.j1, a.start) > 1e-6) els.push(reshapedArc(a.start, built.j1, ra, roleA, built.b1, true))
  els.push(arc(built.j1, built.end, rn, 'new'))
  if (dist(b.start, built.end) > 1e-6) els.push(straight(built.end, b.start, roleB))
  if (!arcIsDep) {
    // Solved read backwards: the chain, and the hand of the new arc, turned round.
    els = els.reverse().map(reversedElement)
    rn = -rn
  }
  return { elements: els, info: { arcLength: built.arcLength, signedR: rn } }
}

// ── the picks ────────────────────────────────────────────────────────────────

function readPick(raw) {
  const r = raw.radius
  const p = {
    start: [Number(raw.start[0]), Number(raw.start[1])], end: [Number(raw.end[0]), Number(raw.end[1])],
    bearing: Number(raw.bearing),
    radius: r == null || Number(r) === 0 ? null : Number(r),
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
  return s[0] < e[0] || (s[0] === e[0] && s[1] <= e[1]) ? s : e
}
const keyLess = (a, b) => a[0] < b[0] || (a[0] === b[0] && a[1] <= b[1])

// ── the constructions, and which ends meet ───────────────────────────────────

function construct(dep, arr, radius) {
  if (dep.radius == null && arr.radius == null) return spliceStraights(dep, arr, radius)
  if (dep.radius != null && arr.radius != null) return spliceArcsStraight(dep, arr)
  return spliceArcStraight(dep, arr, radius)
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

/** The splice where `ends` meet, as a solution (throws SpliceError). */
function pair(picks, ends, radius) {
  let c = keyLess(key(picks[0]), key(picks[1])) ? 0 : 1
  if (ends[c] !== ends[1 - c] && ends[c] === 'start') c = 1 - c   // an end meeting a start departs from the end
  const d = departure(picks, ends)
  let res
  try {
    res = construct(toward(picks[c], ends[c]), toward(picks[1 - c], ends[1 - c]), radius)
  } catch (err) {
    if (err instanceof SpliceError && c !== d) err.code = swapSide(err.code)
    throw err
  }
  if (c !== d) res = reversedSolution(res)
  continuous(res.elements)
  return { ...res, depPick: d, ends: [...ends], reverseDep: ends[d] === 'start', reverseArr: ends[1 - d] === 'end' }
}

/** Is the chain one line — no gap, no kink? A hard condition, not a rule. */
function continuous(els) {
  for (let i = 0; i + 1 < els.length; i++) {
    const a = els[i], b = els[i + 1]
    if (dist(a.endNode, b.startNode) > JOIN_GAP || Math.abs(turnOf(a.endBearing ?? a.bearing, b.bearing)) > JOIN_KINK) {
      throw new SpliceError('splice_error_discontinuous')
    }
  }
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

/** Does a solution turn by more than half a circle beyond what the two picks turned already? */
function loops(sol, picks) {
  const d = sol.depPick
  let own = 0
  for (const [i, flip] of [[d, sol.reverseDep], [1 - d, sol.reverseArr]]) {
    const r = picks[i].radius
    if (r != null) own += picks[i].length / (flip ? -r : r)
  }
  const turned = sol.elements.reduce((s, el) => s + (el.elementType === 1 ? el.length / el.radius : 0), 0)
  return Math.abs(turned - own) > Math.PI + 1e-6
}

const gap = (picks, ends) => dist(picks[0][ends[0]], picks[1][ends[1]])

/** Every pair of ends that can be joined, the least rebuilt first — or SpliceError for the closest pair. */
function solutions(picks, radius) {
  const found = [], errors = []
  for (const ends of PAIRS.filter(e => picks.every((p, k) => p.joinAt == null || p.joinAt === e[k]))) {
    let sol
    try {
      sol = pair(picks, ends, radius)
    } catch (err) {
      if (!(err instanceof SpliceError)) throw err
      errors.push({ gap: gap(picks, ends), ends, err })
      continue
    }
    if (loops(sol, picks)) continue
    found.push({ ...sol, rebuilt: cost(sol, picks) })
  }
  if (found.length) return found.sort((a, b) => a.rebuilt - b.rebuilt)
  if (!errors.length) throw new SpliceError('splice_error_no_fit')
  const closest = errors.reduce((a, b) => (b.gap < a.gap ? b : a))
  explain(picks, closest.ends, radius, closest.err)
  throw closest.err
}

/**
 * What would fit where `ends` do not, into the error's params: between an arc
 * and a straight the largest radius below the one asked for (`rMax`) and the
 * smallest above it (`rMin`). Two straights name `rMax` themselves.
 */
function explain(picks, ends, radius, err) {
  const free = picks[0].radius == null || picks[1].radius == null
  if (!free || !(radius > 0) || err.params.rMax != null || err.code === 'splice_error_discontinuous') return
  const ok = (r) => {
    try { pair(picks, ends, r); return true } catch { return false }
  }
  const bounded = (good, failed) => {
    let lo = good, hi = failed
    while (Math.abs(hi - lo) > 0.5) {
      const mid = (lo + hi) / 2
      if (ok(mid)) lo = mid
      else hi = mid
    }
    return lo < hi ? Math.floor(lo) : Math.ceil(lo)
  }
  let failed = radius, r = radius * EXPLAIN_RATIO
  while (r >= EXPLAIN_R_MIN && !ok(r)) { failed = r; r *= EXPLAIN_RATIO }
  if (r >= EXPLAIN_R_MIN) err.params.rMax = bounded(r, failed)
  if (picks.some(p => p.radius != null)) {
    failed = radius; r = radius / EXPLAIN_RATIO
    while (r <= EXPLAIN_R_MAX && !ok(r)) { failed = r; r /= EXPLAIN_RATIO }
    if (r <= EXPLAIN_R_MAX) err.params.rMin = bounded(r, failed)
  }
}

/** No transition beside either pick: the `lengths` of the service's answer. */
const NO_TRANSITIONS = () => [{ mode: 'fixed', length: 0 }, { mode: 'fixed', length: 0 }]

/**
 * The answer to a splice request (commands/splice spliceRequest) as the
 * service gives it: { solutions }, the least rebuilt first, each with its
 * elements, info, depPick, ends, reverseDep, reverseArr and rebuilt — nothing
 * judged — or { error, params } where no two ends can be joined. Of the
 * request it reads the two picks and the radius; transitions, the way two
 * arcs are joined and the spacing it does not know.
 */
export function localSplice(request) {
  const picks = [readPick(request.dep), readPick(request.arr)]
  const radius = Math.abs(Number(request.radius) || 0)
  const twoArcs = picks.every(p => p.radius != null)
  try {
    return {
      solutions: solutions(picks, radius).map(sol => ({
        ...sol, lengths: NO_TRANSITIONS(), findings: [], worst: 'ok', judged: false, alternative: false,
        ...(twoArcs ? { arcJoin: 'straight' } : {}),
      })),
    }
  } catch (err) {
    if (!(err instanceof SpliceError)) throw err
    return { error: err.code, params: err.params }
  }
}
