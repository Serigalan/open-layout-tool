import { transitionCantEnds } from '../geometry'
import { catalogSpeedRange, severityRank } from './regelkatalog'
import { elementVerdict } from './trassierungCheck'

// Speed is designed in 5 km/h steps, like cant is in 5 mm ones.
export const SPEED_STEP = 5

const isTransition = (el) => el.elementType === 2

/**
 * Radius (m) and signed cant (mm) that govern an element's cant physics.
 * An arc carries both itself. Across a transition both ramp, so the tighter end
 * governs — and its cant is the one of the neighbouring element on that side,
 * or the ramp value a cut transition keeps there (transitionCantEnds, the same
 * rule the exchange export uses for the ramp ends). A straight has neither,
 * hence null: no deficiency, no curvature-imposed speed limit.
 */
export function governing(elements, i) {
  const el = elements[i]
  // The radius comes back signed: cant that follows the curve helps, cant
  // against it (a bent switch's second route) adds to the deficiency, so the
  // sign has to survive as far as the deficiency and the speed limit.
  if (el.radius) return { radius: el.radius, cant: el.cant ?? 0 }
  if (isTransition(el)) {
    const r1 = el.r1 ? Math.abs(el.r1) : Infinity   // a null end runs into a straight
    const r2 = el.r2 ? Math.abs(el.r2) : Infinity
    if (!Number.isFinite(Math.min(r1, r2))) return null
    const ends = transitionCantEnds(elements, i)
    return r1 <= r2
      ? { radius: el.r1, cant: ends.start }
      : { radius: el.r2, cant: ends.end }
  }
  return null
}

const isError = (r) => severityRank(r.severity) >= severityRank('error')

/**
 * The highest design speed the rule catalogue lets element `i` carry
 * (Entscheidung 372): the fastest speed on the 5 km/h step inside the range
 * the catalogue speaks about (LP.ALL.01), and at most `cap` where one is
 * given, at which nothing it says about the element itself — its own rules,
 * its ramp, the joints at both its ends — is an error. Hinweise, Warnungen,
 * Zustimmung and Sonderfall are allowed: they ask for a reason, not for
 * another speed. Each speed is judged with the element's neighbours at that
 * speed too, so a joint is read at the speed the element runs through it
 * (LP.KS.01 takes the faster side); the neighbour's own speed is the
 * neighbour's business. Every speed is tried, not only down to the first
 * that fails: a transition's ramp of the deficiency (LP.UB.05) can fail
 * slow and hold fast, where the cant is in excess of the speed.
 *
 * An error that stands at every speed (a cant off the 5 mm step, a cant jump
 * at a joint) is no reason for any speed and does not count — it is returned
 * as `fixed`, the rule ids, for the table to show.
 *
 * Returns { speed, fixed } — `speed` null where no speed is free of the others.
 */
export function ruleMaxSpeed(elements, i, { cap = null, context = null } = {}) {
  const el = elements[i]
  if (!el) return { speed: null, fixed: [] }
  // One copy of the chain, its three elements around `i` set to each speed in turn.
  const view = elements.slice()
  const near = [i - 1, i, i + 1].filter(j => j >= 0 && j < elements.length)
  const lo = Math.ceil(catalogSpeedRange.min / SPEED_STEP) * SPEED_STEP
  const hi = Math.floor(catalogSpeedRange.max / SPEED_STEP) * SPEED_STEP
  const errors = []
  for (let v = hi; v >= lo; v -= SPEED_STEP) {
    for (const j of near) view[j] = { ...elements[j], speed: v }
    errors.push({ v, ids: new Set(elementVerdict(view, i, { context }).filter(isError).map(r => `${r.at}:${r.id}`)) })
  }
  const fixed = [...errors[errors.length - 1].ids].filter(id => errors.every(e => e.ids.has(id)))
  const free = errors.find(e => (cap == null || e.v <= cap) && [...e.ids].every(id => fixed.includes(id)))
  return { speed: free?.v ?? null, fixed: [...new Set(fixed.map(id => id.slice(id.indexOf(':') + 1)))] }
}

const speedsOf = new WeakMap()

/**
 * ruleMaxSpeed for every element of a chain, without a cap — worked out once
 * per chain (the array is the model's, replaced on every change), since each
 * element costs the whole catalogue at every speed step.
 */
export function ruleMaxSpeedsOf(elements) {
  let hit = speedsOf.get(elements)
  if (!hit) {
    hit = elements.map((el, i) => ruleMaxSpeed(elements, i))
    speedsOf.set(elements, hit)
  }
  return hit
}

/**
 * Every element's speed raised to what the rule catalogue lets it carry under
 * the line speed `cap` (ruleMaxSpeed) — null lets the rules alone decide. An
 * element no speed is free for keeps the speed it had, trimmed to the cap.
 * Since each element's highest speed holds the joints at both its ends at
 * that speed, and a joint is judged at the faster side, setting them all at
 * once adds no error. Elements that keep their speed are returned as they are.
 */
export function maxSpeeds(elements, cap) {
  return elements.map((el, i) => {
    const speed = ruleMaxSpeed(elements, i, { cap }).speed
    if (speed == null) return cap != null && el.speed > cap ? { ...el, speed: cap } : el
    return el.speed === speed ? el : { ...el, speed }
  })
}
