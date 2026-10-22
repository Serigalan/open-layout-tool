import { curvatureOf, radiusOfCurvature } from '../geometry'
import { switchChainBearingAt, switchChainPointUtm } from './route'
import { STRAIGHT_CURVATURE } from './catalogue'

// The elements between the two branches of a switch connection (Entscheidung
// 305): one, two or three of them, each a straight, an arc or a transition.
// What the dialog states of each — its length, and an arc's radius — is given
// where it is filled in and sought where it is left empty; exactly two values
// are sought, the third unknown being where the second turnout sits. A
// transition runs between the curvatures of its neighbours (the branch's at
// either end of the chain), so it is never more than its length.
//
// A spec: [{ type: 'straight' | 'arc' | 'transition', length: number|null,
// radius: number|null, side?: ±1 }] — radius as a magnitude, the side it bends
// to part of the solution unless `side` fixes it (the sign of its project
// radius, as an adopted answer of the Python solver states it).

/** The one element the connection always had: an arc whose length and radius both follow. */
export const DEFAULT_MIDS = [{ type: 'arc', length: null, radius: null }]

/** Is this the connection as it always was — solved in closed form, not by iteration? */
export const isDefaultMids = (mids) => !mids?.length
  || (mids.length === 1 && mids[0].type === 'arc' && mids[0].length == null && mids[0].radius == null)

/** The values a spec leaves open: [{ i, field: 'length' | 'k' }]. */
export function midUnknowns(mids) {
  const out = []
  mids.forEach((m, i) => {
    if (m.length == null) out.push({ i, field: 'length' })
    if (m.type === 'arc' && m.radius == null) out.push({ i, field: 'k' })
  })
  return out
}

/** How many values the solver needs open: the third unknown is the second turnout. */
export const MID_OPEN = 2

/**
 * The pieces ({ length, r1, r2 }) of a spec for one choice of its open values
 * (`values`, in midUnknowns' order) and of the sides its given radii bend to
 * (`signs`, one per arc with a given radius, ±1). `kStart` and `kEnd` are the
 * curvatures of the branches at either end, which a transition there runs
 * from or to.
 */
function midPieces(mids, values, signs, kStart, kEnd) {
  const open = midUnknowns(mids)
  const value = (i, field) => {
    const at = open.findIndex(u => u.i === i && u.field === field)
    return at < 0 ? null : values[at]
  }
  let sign = 0
  const parts = mids.map((m, i) => {
    const length = m.length ?? value(i, 'length')
    if (m.type === 'straight') return { length, k: 0 }
    if (m.type === 'arc') {
      const k = m.radius != null ? signs[sign++] / m.radius : value(i, 'k')
      return { length, k }
    }
    return { length, transition: true }
  })
  // A transition takes its neighbours' curvatures; next to another transition
  // that is a straight's.
  const kOf = (j) => {
    if (j < 0) return kStart
    if (j >= parts.length) return kEnd
    return parts[j].transition ? 0 : parts[j].k
  }
  return parts.map((p, i) => {
    if (!p.transition) {
      const r = Math.abs(p.k) < STRAIGHT_CURVATURE ? null : 1 / p.k
      return { length: p.length, r1: r, r2: r }
    }
    return { length: p.length, r1: radiusOfCurvature(kOf(i - 1)), r2: radiusOfCurvature(kOf(i + 1)) }
  })
}

const wrapDeg = (a) => ((a + 180) % 360 + 360) % 360 - 180

/** Below this the chain's end misses the second branch [m] — the closed form's own tolerance (SOLVE_TOL). */
const CLOSE_TOL = 1e-8

/**
 * The open values of a spec that close the connection: the chain leaving the
 * first branch's end `start` ({ utm, bearing, k }) has to arrive on the second
 * branch's start, which `endAt(s2)` gives for the second turnout at s2
 * ({ utm, bearing, k } in the direction the connection runs, or null where it
 * cannot sit). Damped Newton over (s2, the two open values), from the closed
 * form's answer (`s2Start`, `lgStart`, the middle element's length, and
 * `deltaStart`, its turn [rad]) and a few variations of it; the first that
 * closes with every length positive is taken, the sides the given radii bend
 * to tried in the order most likely first. A `seed` ({ s2, values }, the open
 * values in midUnknowns' order) is tried before all of them.
 *
 * Returns { s2, pieces } or null.
 */
export function solveMidChain({ mids, start, endAt, s2Start = 0, lgStart, deltaStart = 0, seed = null }) {
  const open = midUnknowns(mids)
  if (open.length !== MID_OPEN) return null
  // Every combination of sides, the one that turns with the connection first;
  // a side the spec fixes stays.
  const signSets = midSignSets(mids, Math.sign(deltaStart) || 1)

  const given = mids.reduce((sum, m) => sum + (m.length ?? 0), 0)
  const openLengths = open.filter(u => u.field === 'length').length
  const lg = Number.isFinite(lgStart) && lgStart > 0 ? lgStart : 20
  const each = openLengths ? Math.max(lg - given, lg / 2) / openLengths : 0
  const kGuess = lg > 0 ? deltaStart / lg : 0
  const starts = [kGuess, 0, -kGuess, 2 * kGuess].map(k =>
    [s2Start, ...open.map(u => (u.field === 'length' ? each : k))])
  if (seed?.values?.length === open.length && Number.isFinite(seed.s2)) starts.unshift([seed.s2, ...seed.values])

  for (const signs of signSets) {
    for (const init of starts) {
      const found = chainNewton(mids, signs, start, endAt, init)
      if (found) return found
    }
  }
  return null
}

/**
 * The sides the given radii of a spec may bend to, each a list of ±1 in the
 * order of those arcs: what the spec fixes stays, the rest both ways, the
 * side `turn` first.
 */
export function midSignSets(mids, turn = 1) {
  const fixed = mids.filter(m => m.type === 'arc' && m.radius != null).map(m => m.side ?? null)
  return [...Array(2 ** fixed.length).keys()]
    .map(bits => fixed.map((side, b) => side ?? ((bits >> b) & 1 ? -turn : turn)))
    .filter((set, i, all) => all.findIndex(other => other.join() === set.join()) === i)
}

/**
 * Damped Newton over three unknowns: the station s that `endAt` reads and the
 * spec's open values (midUnknowns' order) — or, with `sFixed`, the open
 * values alone at that station, three of them. `x0` holds the unknowns in
 * that order. With `patience`, a run that has not halved its miss in that
 * many steps gives up — it is sliding towards a minimum that is no root.
 * Returns { s2, pieces } or null.
 */
export function chainNewton(mids, signs, start, endAt, x0, { sFixed = null, patience = null } = {}) {
  const open = midUnknowns(mids)
  const free = sFixed == null
  const lengthAt = [...(free ? [false] : []), ...open.map(u => u.field === 'length')]
  const sOf = (x) => (free ? x[0] : sFixed)
  const residual = (x) => {
    const end = endAt(sOf(x))
    if (!end) return null
    const pieces = midPieces(mids, free ? x.slice(1) : x, signs, start.k, end.k)
    if (pieces.some(p => !(p.length > 1e-6) && (p.r1 !== p.r2))) return null
    const scale = Math.max(10, pieces.reduce((s, p) => s + Math.abs(p.length), 0))
    const p = switchChainPointUtm(start.utm, start.bearing, pieces)
    const b = switchChainBearingAt(start.bearing, pieces)
    return { f: [p.easting - end.utm.easting, p.northing - end.utm.northing, wrapDeg(b - end.bearing) * Math.PI / 180 * scale], pieces }
  }
  const norm = (f) => Math.hypot(f[0], f[1], f[2])
  let x = [...x0]
  let r = residual(x)
  if (!r) return null
  const misses = []
  for (let it = 0; it < 50; it++) {
    if (norm(r.f) < CLOSE_TOL) break
    misses.push(norm(r.f))
    if (patience && it >= patience && misses[it] > misses[it - patience] / 2) return null
    // Jacobian by differences, one column per unknown.
    const J = [0, 1, 2].map(j => {
      const h = free && j === 0 ? 1e-4 : lengthAt[j] ? 1e-5 * Math.max(1, Math.abs(x[j])) : 1e-8
      const xh = [...x]; xh[j] += h
      const rh = residual(xh)
      return rh ? rh.f.map((v, k) => (v - r.f[k]) / h) : null
    })
    if (J.some(c => !c)) return null
    const step = solve3(J, r.f)
    if (!step) return null
    // Halve the step until the miss shrinks.
    let t = 1, next = null
    for (let k = 0; k < 20; k++, t /= 2) {
      const xt = x.map((v, j) => v - t * step[j])
      const rt = residual(xt)
      if (rt && norm(rt.f) < norm(r.f)) { next = { x: xt, r: rt }; break }
    }
    if (!next) return null
    x = next.x
    r = next.r
  }
  if (norm(r.f) >= 1e-6) return null
  if (r.pieces.some(p => !(p.length > 1e-3))) return null
  return { s2: sOf(x), pieces: r.pieces }
}

/** x with J·x = f, J given as its three columns — or null where J is singular. */
function solve3(cols, f) {
  const [a, b, c] = cols
  const det = (u, v, w) => u[0] * (v[1] * w[2] - v[2] * w[1]) - v[0] * (u[1] * w[2] - u[2] * w[1]) + w[0] * (u[1] * v[2] - u[2] * v[1])
  const d = det(a, b, c)
  if (!Number.isFinite(d) || Math.abs(d) < 1e-18) return null
  return [det(f, b, c) / d, det(a, f, c) / d, det(a, b, f) / d]
}

/** Curvature at the end of a chain of pieces ({ r2 } of its last). */
export const endCurvature = (chain) => curvatureOf(chain[chain.length - 1]?.r2 ?? null)
