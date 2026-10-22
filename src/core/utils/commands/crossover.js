import { connectionBranchEnds, midUnknowns } from '../switch'
import {
  CANT_DEFICIENCY_COEFF, comparisonRadiusLimits, MAX_SWITCH_CANT_DEF, minElementLength,
} from '../rules'
import { connectionRemnants, settleConnection, stems } from './sCurve'

// The Python solver of a switch connection (Entscheidungen 357–358): where no
// shift of the slider gives a connection, the optimizer service searches the
// toe of both turnouts and one to three elements between them. The turnout
// geometry stays here — the request carries both branch ends sampled over the
// elements the turnouts were picked on, for every form the speed falls back
// through, and the limits the dialog holds the middle to. An answer comes back
// as a shift and a spec of the middle elements, which the dialog solves again.

/** Between two samples of a branch end [m]. */
const SAMPLE_STEP = 0.5

/** How far from either pick the turnouts are searched [m]. */
const SEARCH_REACH = 300

/** Two cants at the ldS this close are one [mm] — switchConnectionUtils' CANT_TOL. */
const CANT_TOL = 1

/**
 * The request for `/crossover`: the two picks of the dialog and its speed.
 * Coordinates relative to the first branch end at the pick, so the service
 * works with metres, not UTM eastings. A sample is `ok` where its turnout
 * keeps its own checks and leaves no piece of its element shorter than l_min
 * (connectionRemnants). `form`: the one form to sample (a connection edited,
 * Entscheidung 364), else the speed's fallback chain.
 */
export function crossoverRequest({ picks, speed, form = null }) {
  const { g1, g2 } = stems(picks)
  const { flipped2, forms } = connectionBranchEnds(g1, g2, speed, { step: SAMPLE_STEP, reach: SEARCH_REACH, form })
  const origin = forms.flatMap(f => f.first)[0] ?? { x: 0, y: 0 }
  const remnantsOk = (k, s, through) => !connectionRemnants(
    picks, k === 0 ? s : 0, { s2: k === 1 ? s : 0, flipped2, throughLength: through }, speed,
  ).some(r => r.track === k && r.short)
  const sample = (k, through) => (p) => ({
    s: p.s, x: p.x - origin.x, y: p.y - origin.y, psi: p.psi, kappa: p.kappa,
    tail: p.tail, cantLds: p.cantLds, ok: p.ok && remnantsOk(k, p.s, through),
  })
  const rw = comparisonRadiusLimits(speed)
  return {
    speed,
    limits: {
      lMin: minElementLength(speed) ?? 0,
      rwReg: rw?.reg ?? null,
      rwDiscretion: rw?.discretion ?? null,
      maxCantDef: MAX_SWITCH_CANT_DEF,
      cantDefCoeff: CANT_DEFICIENCY_COEFF,
      cantTol: CANT_TOL,
    },
    forms: forms.map(f => ({
      label: f.sw.label,
      first: f.first.map(sample(0, f.through)),
      second: f.second.map(sample(1, f.through)),
    })),
  }
}

/** The values of a middle chain in midUnknowns' order, from an answer's pieces. */
const valuesOf = (pieces, open) => open.map(u => (u.field === 'length'
  ? pieces[u.i].length
  // midChain's curvature is the project's, 1/R: the answer's is math-signed.
  : -pieces[u.i].kappa))

/**
 * One solution of the service, adopted into the dialog: the shift of the
 * first toe, the middle elements as a spec with two of their values sought —
 * the rest given as the solver found them — and the seed the iteration starts
 * from. The pair left open is the first whose spec closes again at that
 * shift; the values given are rounded as one would type them (a length to
 * the millimetre, a radius to the decimetre), or kept exact where the rounded
 * spec does not close. Null where none does.
 *
 * A solution: { s1, s2, pieces: [{ type, length, kappa }] } (kappa math-signed,
 * an arc's own, else null).
 */
export function adoptCrossover({ picks, speed, solution, form = null, lenient = false }) {
  const { s1, s2, pieces } = solution
  const exact = pieces.map(p => (p.type === 'arc'
    ? { type: 'arc', length: p.length, radius: 1 / Math.abs(p.kappa), side: -Math.sign(p.kappa) }
    : { type: p.type, length: p.length, radius: null }))
  const round = (v, digits) => Number(v.toFixed(digits))
  const rounded = exact.map(m => ({
    ...m, length: round(m.length, 3), radius: m.radius == null ? null : round(m.radius, 1),
  }))
  for (const full of [rounded, exact]) {
    const adopted = adoptSpec({ picks, speed, form, lenient, s1, s2, pieces, full })
    if (adopted) return adopted
  }
  return null
}

/** The first pair of values of `full` left open that closes again at s1 — or null. */
function adoptSpec({ picks, speed, form, lenient, s1, s2, pieces, full }) {
  const slots = full.flatMap((m, i) => [
    { i, field: 'length' },
    ...(m.type === 'arc' ? [{ i, field: 'k' }] : []),
  ])
  // Lengths first: an open radius makes the iteration choose a side again.
  const pairs = []
  for (let a = 0; a < slots.length; a++) {
    for (let b = a + 1; b < slots.length; b++) pairs.push([slots[a], slots[b]])
  }
  pairs.sort((p, q) => p.filter(u => u.field === 'k').length - q.filter(u => u.field === 'k').length)
  for (const pair of pairs) {
    const mids = full.map((m, i) => ({
      ...m,
      ...(pair.some(u => u.i === i && u.field === 'length') ? { length: null } : {}),
      ...(pair.some(u => u.i === i && u.field === 'k') ? { radius: null, side: undefined } : {}),
    }))
    const seed = { ds: s2 - s1, values: valuesOf(pieces, midUnknowns(mids)) }
    const settled = settleConnection({ picks, speed, shift: s1, mids, seed, form })
    if (settled.result?.valid || (lenient && settled.result?.overridable)) return { shift: settled.shift, mids, seed }
  }
  return null
}
