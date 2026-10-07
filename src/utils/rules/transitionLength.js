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
 */
export function transitionLengths({ prev, next, r1 = null, type = 'clothoid', speed }) {
  if (!(speed > 0)) return { regular: null, minimum: null }
  const resultsAt = (length) => transitionCheck(transitionChain({ prev, next, r1, length, type, speed })).results
  // The rules on the length, by those that hold for a transition as long as any.
  const binding = new Set(resultsAt(LONGEST)
    .filter(r => r.severity === 'ok' && readsLength(ruleById(r.id)))
    .map(r => r.id))
  const shortest = (worst) => {
    const holds = (length) => resultsAt(length)
      .every(r => !binding.has(r.id) || severityRank(r.severity) <= severityRank(worst))
    let lo = 0, hi = LONGEST
    for (let k = 0; k < 60 && hi - lo > 1e-6; k++) {
      const mid = (lo + hi) / 2
      if (holds(mid)) hi = mid; else lo = mid
    }
    // Rounded up — the search closes in on the bound from above, by less
    // than a step's thousandth — and a step more where the rounding fell short.
    const steps = Math.ceil(hi * STEPS_PER_M - 1e-3)
    return holds(steps / STEPS_PER_M) ? steps / STEPS_PER_M : (steps + 1) / STEPS_PER_M
  }
  return { regular: shortest('ok'), minimum: shortest('warning') }
}

/** Does the catalogue call anything about the transition of such a chain an error? */
export const transitionHasError = (chain) =>
  severityRank(transitionCheck(chain).severity) >= severityRank('error')

/** Does the catalogue call anything about the elements at `indices` of a chain an error? */
export const errorAt = (elements, indices) => checkTrack(elements).perElement
  .some(entry => indices.includes(entry.index) && severityRank(entry.severity) >= severityRank('error'))
