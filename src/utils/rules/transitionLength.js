import { ruleById, severityRank } from '../regelkatalog'
import { checkTrack } from '../trassierungCheck'

// A length set by the rules is rounded up to a full decimetre.
const STEPS_PER_M = 10
// Longer than any transition the Ril knows: where a rule still fails here,
// it is not one a longer curve satisfies.
const LONGEST = 100000

/**
 * The transition a connect dialog puts between `prev` (the track's last
 * element) and `next` (what it appends): curvature from `r1` to the radius
 * `next` starts with, cant from `prev`'s to `next`'s, at `speed` — the same
 * element buildConnect* writes, without its geometry, which no rule reads.
 * Returned as the chain [prev, transition, next] the check judges it in.
 */
export function transitionChain({ prev, next, r1 = null, length, type = 'clothoid', speed }) {
  const transition = {
    elementType: 2, transitionType: type, r1, r2: next?.radius ?? null, length, speed,
  }
  return [prev ?? { elementType: 0, cant: 0, speed }, transition, next ?? { elementType: 0, cant: 0, speed }]
}

/** The findings on the transition of such a chain: its own rules and its joint with `prev`. */
export const transitionCheck = (chain) => checkTrack(chain).perElement[1]

// A rule's formula as the catalogue writes it, in the Ril's symbols.
const SYMBOLS = [[/\s*\*\s*/g, '·'], [/\s*\/\s*/g, '/'], [/delta_u_f/g, 'Δu_f'], [/delta_u/g, 'Δu']]
const pretty = (expr) => SYMBOLS.reduce((text, [re, to]) => text.replace(re, to), String(expr))

/**
 * The bound a rule sets on the length for `worst`: the threshold its
 * evaluation holds against at the step no worse than that — the Regelwert for
 * 'ok', the Ermessensgrenze for 'warning' where it has one — as { id, formula,
 * length } [m]. A rule on the ramp's slope 1:m bounds the length at m·Δu/1000.
 */
function basis(rule, result, worst) {
  const thresholds = Object.keys(rule?.thresholds ?? {})
  const entry = (rule?.evaluation ?? [])
    .filter(e => 'if' in e && severityRank(e.severity) <= severityRank(worst))
    .sort((a, b) => severityRank(b.severity) - severityRank(a.severity))[0]
  const name = thresholds.find(n => new RegExp(`\\b${n}\\b`).test(entry?.if ?? ''))
  const value = result?.values?.[name]
  if (!name || !Number.isFinite(value)) return { id: rule?.id, formula: null, length: null }
  const expr = rule.thresholds[name].expr
  if (Object.values(rule.inputs ?? {}).some(input => input.from === 'physics.ramp_slope')) {
    return { id: rule.id, formula: `${pretty(expr)}·Δu/1000`, length: value * (result.values['physics.delta_u'] ?? 0) / 1000 }
  }
  // A table the catalogue looks up has no formula to show, only its value.
  return { id: rule.id, formula: /lookup\(/.test(expr) ? null : pretty(expr), length: value }
}

// A rule a longer transition can satisfy: it reads the length or the ramp it
// sets, and holds for a transition as long as any.
const readsLength = (rule) => Object.values(rule?.inputs ?? {})
  .some(input => input.from === 'element.length' || input.from === 'physics.ramp_slope')

/**
 * The shortest transition the rules allow between `prev` and `next` (see
 * transitionChain), rounded up to a full decimetre:
 *
 * - `regular` — the Regellänge: every rule on the length at its Regelwert
 *   (LP.EL.01, LP.UB.03/04 and 05/06, LP.UB.07 at 1:600);
 * - `minimum` — the Mindestlänge: down to the Ermessensgrenze where a rule has
 *   one (LP.UB.03/04 at 8·v / 6·v, LP.UB.07 at 1:400), the Regelwert where it
 *   has none — anything shorter needs an approval or is an error.
 *
 * Read from the catalogue rather than restated: the length is searched for
 * which the rules that a longer curve satisfies hold. A rule that only a
 * shorter one does (LP.UB.08, the flattest ramp) is left to the check — it
 * says so when the Regellänge runs past it. Null where nothing can be said:
 * no design speed.
 *
 * `regularBy` and `minimumBy` name the rules that set each length — those a
 * transition a hair shorter would break — as [{ id, formula, length }]: the
 * bound each sets (see basis).
 */
export function transitionLengths({ prev, next, r1 = null, type = 'clothoid', speed }) {
  if (!(speed > 0)) return { regular: null, minimum: null, regularBy: [], minimumBy: [] }
  const resultsAt = (length) => transitionCheck(transitionChain({ prev, next, r1, length, type, speed })).results
  // The rules on the length, by those that hold for a transition as long as any.
  const binding = new Set(resultsAt(LONGEST)
    .filter(r => r.severity === 'ok' && readsLength(ruleById(r.id)))
    .map(r => r.id))
  const shortest = (worst) => {
    const failing = (length) => resultsAt(length)
      .filter(r => binding.has(r.id) && severityRank(r.severity) > severityRank(worst))
      .map(r => r.id)
    const holds = (length) => failing(length).length === 0
    let lo = 0, hi = LONGEST
    for (let k = 0; k < 60 && hi - lo > 1e-6; k++) {
      const mid = (lo + hi) / 2
      if (holds(mid)) hi = mid; else lo = mid
    }
    // Rounded up — the search closes in on the bound from above, by less
    // than a step's thousandth — and a step more where the rounding fell short.
    const steps = Math.ceil(hi * STEPS_PER_M - 1e-3)
    const length = holds(steps / STEPS_PER_M) ? steps / STEPS_PER_M : (steps + 1) / STEPS_PER_M
    // What sets it: the rules a hair shorter would break, each with the
    // bound it sets — read at the length found, where all of them apply.
    const at = new Map(resultsAt(length).map(r => [r.id, r]))
    return { length, by: failing(lo).map(id => basis(ruleById(id), at.get(id), worst)) }
  }
  const regular = shortest('ok'), minimum = shortest('warning')
  return { regular: regular.length, minimum: minimum.length, regularBy: regular.by, minimumBy: minimum.by }
}

/** Does the catalogue call anything about the transition of such a chain an error? */
export const transitionHasError = (chain) =>
  severityRank(transitionCheck(chain).severity) >= severityRank('error')

/** Does the catalogue call anything about the elements at `indices` of a chain an error? */
export const errorAt = (elements, indices) => checkTrack(elements).perElement
  .some(entry => indices.includes(entry.index) && severityRank(entry.severity) >= severityRank('error'))
