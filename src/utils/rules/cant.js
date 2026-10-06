import {
  MAX_SWITCH_CANT as RW_MAX_SWITCH_CANT,
  MAX_SWITCH_CANT_DEF as RW_MAX_SWITCH_CANT_DEF,
  CANT_DEFICIENCY_COEFF as RW_CANT_DEFICIENCY_COEFF,
} from '../regelwerkDefaults'
import { catalogLimit, catalogSpeedRange, IN_SWITCH_AREA } from '../regelkatalog'

// Cant, cant deficiency and the speeds they allow — the dialogs' rules (LP.KB).

/**
 * The cant a curve may carry (mm) — LP.KB.01, read out of DB Ril 800.0110
 * rather than restated here (see regelkatalog.js `catalogLimit`). It used to
 * be 170 and is now the Ril's 160: since AP R.8 the dialogs create to the
 * rulebook, not merely beside it.
 */
export const MAX_CANT = catalogLimit('LP.KB.01', 'max', { 'element.cant': 0 })

// The step cant is designed in [mm] — LP.KB.03's own threshold, read rather
// than restated. It was the last number of that rule the app still knew by
// heart (Entscheidung 51): the rule stated 5 only inside its expression, so
// the catalogue now names it and nothing has to parse anything to find it.
export const CANT_STEP = catalogLimit('LP.KB.03', 'step', { 'element.cant': 0 })

/**
 * The cant deficiency a line element may be built with at `speed` (mm) —
 * LP.KB.02's **Ermessensgrenze**, which is what a dialog refuses past.
 *
 * The Regelwert is 130 mm at every speed; above 150 km/h the Ril lets a design
 * reach 150 mm in its own discretion, so between the two there is now a
 * warning rather than a pass. Reading the discretion limit here is the same
 * reading the switch cant already has, where LP.KB.05's exception is the
 * ceiling and its Regelwert below only marks the finding.
 */
export const cantDefLimit = (speed) =>
  catalogLimit('LP.KB.02', 'discretion', { 'element.design_speed': speed ?? 0, 'physics.u_f': 0 })

/**
 * Where that step stands, found by asking rather than by reading 150 out of
 * the rule's text: [{ from, limit }, …], one entry per stretch of speed the
 * Ril gives its own limit. A Ril that later has three steps needs no change
 * here.
 */
const CANT_DEF_STEPS = (() => {
  const steps = []
  for (let v = catalogSpeedRange.min; v <= catalogSpeedRange.max; v++) {
    const limit = cantDefLimit(v)
    if (!steps.length || steps[steps.length - 1].limit !== limit) steps.push({ from: v, limit })
  }
  return steps
})()

/** The deficiency this element may be built with — what the dialogs refuse past. */
export const limitCantDef = (el) =>
  (el?.switchBranch ? MAX_SWITCH_CANT_DEF : cantDefLimit(el?.speed))

/**
 * What a cant deficiency says about the element carrying it: `'over'` — past
 * the limit it may be built with, so it is not buildable as it stands; null —
 * ordinary.
 *
 * Only a deficiency counts. A negative value is cant in excess of what the
 * speed needs, which has its own rules and is not judged here.
 */
export const cantDefLevel = (el, cantDef) => (cantDef > limitCantDef(el) ? 'over' : null)

const CANT_COEFF    = 6.5   // C = k·v²/R — LP.KB.04's Regelüberhöhung
const CANT_DEF_COEFF = RW_CANT_DEFICIENCY_COEFF // D = k·v²/R − C

/**
 * Cant is stored SIGNED, following the curve: positive when the left rail is
 * raised (right-hand curve, radius > 0), negative when the right rail is raised
 * (radius < 0). So sign(cant) === sign(radius) for a normally canted curve; the
 * magnitude is what the physics uses, hence the `Math.abs` on input here.
 */
export const cantSign = (radius) => (radius < 0 ? -1 : 1)

/** Snap a cant to the design step; the magnitude decides, not the sign. */
export const roundCant = (mm) => Math.sign(mm) * Math.round(Math.abs(mm) / CANT_STEP) * CANT_STEP

/** Below this cant deficiency without any cant, computeAutoC proposes none [mm]. */
const AUTO_CANT_MIN_DEF = 60

/**
 * computeAutoC's figures, for the optimizer service to propose the same cant
 * for every radius it tries (the splice's search for the largest radius that
 * keeps a track spacing, clearance.py `auto_cant`).
 */
export const AUTO_CANT_MODEL = {
  coeff: CANT_COEFF, defCoeff: CANT_DEF_COEFF, defMin: AUTO_CANT_MIN_DEF, max: MAX_CANT, step: CANT_STEP,
}

/** Auto-compute cant from speed (km/h) and signed radius (m); result is signed.
 *  If cant deficiency without any cant < 60 mm, no cant is needed. */
export function computeAutoC(speed, radius) {
  const R = Math.abs(radius)
  if (R <= 0) return 0
  const defWithoutCant = Math.round((CANT_DEF_COEFF * speed * speed) / R)
  if (defWithoutCant < AUTO_CANT_MIN_DEF) return 0
  return cantSign(radius) * Math.min(MAX_CANT, roundCant((CANT_COEFF * speed * speed) / R))
}

/**
 * The **Regelüberhöhung** — LP.KB.04's `u_reg`, read out of the rule rather
 * than recomputed here: 6.5 · v²/R on the 5 mm step, capped at the cant the
 * Ril allows (160 on plain line, 100 inside a turnout). Signed like the curve.
 *
 * It is what `computeAutoC` proposes, with one difference that matters: that
 * one answers 0 where a curve is gentle enough to need no cant at all (a
 * deficiency under 60 mm without any), which LP.KB.04 does not know about. So
 * on a gentle curve the proposal and the rule part company, and the rule is
 * what this offers.
 */
export function regelCant(speed, radius, { inSwitch = false } = {}) {
  const R = Math.abs(radius)
  if (!(R > 0)) return 0
  return cantSign(radius) * catalogLimit('LP.KB.04', 'u_reg', {
    'element.design_speed': speed, 'element.radius': R, 'element.cant': 0,
  }, inSwitch ? IN_SWITCH_AREA : {})
}

/**
 * What a turnout may be canted to. A switch is built on one set of sleepers and
 * its two routes run over the same rails, so it is held well below the line's
 * own 170 mm: 100 mm, and 120 only where the design states in writing why it has
 * to be. The deficiency ceiling is the same either way.
 *
 * The justification is the text itself (`cantException` on the element), not a
 * flag: an exception nobody had to write down is one that can be clicked away,
 * and then it is no exception at all. It is stated on the plan and warned about
 * in the element table, so it stays visible long after the dialog is gone.
 */
export const MAX_SWITCH_CANT           = RW_MAX_SWITCH_CANT      // LP.KB.05 reg
// …raised to this by a written justification — LP.KB.05's Ermessensgrenze,
// which is exactly what a written justification is for.
export const MAX_SWITCH_CANT_EXCEPTION = catalogLimit('LP.KB.05', 'discretion', { 'element.cant': 0 }, IN_SWITCH_AREA)
export const MAX_SWITCH_CANT_DEF       = RW_MAX_SWITCH_CANT_DEF  // LP.KB.06

/** The justification an element carries, trimmed — '' when it carries none. */
export const cantExceptionOf = (el) =>
  (typeof el?.cantException === 'string' ? el.cantException.trim() : '')

/** The cant a switch route may carry, given the justification offered for it. */
export const switchCantLimit = (reason) =>
  (reason?.trim() ? MAX_SWITCH_CANT_EXCEPTION : MAX_SWITCH_CANT)

/** The cant this element may carry: a switch route's limit, or the line's own. */
export const cantLimit = (el) =>
  (el?.switchBranch ? switchCantLimit(cantExceptionOf(el)) : MAX_CANT)

/**
 * The cant magnitudes an element carries. An arc has the one; a transition ramps
 * between two, and a turnout laid into one is built on that ramp — so both ends
 * are read, or a switch element on a ramp would answer for a cant it is not on.
 */
const cantsOf = (el) => (el?.elementType === 2 && (el.cantStart != null || el.cantEnd != null)
  ? [el.cantStart ?? 0, el.cantEnd ?? 0]
  : [el?.cant ?? 0])

/** The greatest cant magnitude anywhere along this element. */
export const worstCantOf = (el) => Math.max(...cantsOf(el).map(Math.abs))

/** Does this element carry more cant than it is allowed to, anywhere along it? */
export const cantExceedsLimit = (el) => worstCantOf(el) > cantLimit(el)

/**
 * The justification field an element built with this cant needs, ready to be
 * spread in. Below the plain limit there is nothing to justify, so nothing is
 * written — a stale reason must not sit on an element that no longer needs one.
 */
export const cantExceptionFields = (cant, reason) =>
  (Math.abs(cant ?? 0) > MAX_SWITCH_CANT && reason?.trim() ? { cantException: reason.trim() } : {})

/**
 * What a cant typed into a field becomes when the field is left: rounded onto
 * the design step and held inside the limits — or null where there is nothing
 * to take from it. An empty field and a half-typed "-" are not values, and
 * must leave what stood there rather than become a zero nobody asked for.
 *
 * Kept apart from the typing on purpose: a field that rounds every keystroke
 * cannot reach a value whose leading digits are not themselves on the step —
 * typing 65 went 6 → 5, and the 5 that was left is what the next keystroke
 * built on.
 */
export function cantFromInput(draft, min, max) {
  const typed = Number(draft)
  if (String(draft).trim() === '' || !Number.isFinite(typed)) return null
  return roundCant(Math.max(min, Math.min(max, typed)))
}

/** A cant typed into a switch dialog, on the design step and under the ceiling. */
export const clampSwitchCant = (value) =>
  roundCant(Math.max(-MAX_SWITCH_CANT_EXCEPTION, Math.min(MAX_SWITCH_CANT_EXCEPTION, value)))

/**
 * What stands between this cant and being built, as a key the dialogs translate:
 * `'over'` — past even the exception, so there is no reason that would do;
 * `'unjustified'` — past the plain limit with nothing written down; null — fine.
 */
export function switchCantError(cant, reason) {
  const magnitude = Math.abs(cant ?? 0)
  if (magnitude > MAX_SWITCH_CANT_EXCEPTION) return 'over'
  if (magnitude > switchCantLimit(reason)) return 'unjustified'
  return null
}

/**
 * Auto-compute cant for a switch (signed): 0 unless the deficiency would exceed
 * 110, then just enough to bring it back to that — capped at the plain 100 mm,
 * since a value nobody typed carries no justification. Where the cap is not
 * enough the deficiency stays over its limit and the dialog refuses the design,
 * rather than the turnout being over-canted on no one's authority.
 */
export function computeSwitchCant(speed, radius) {
  const R = Math.abs(radius)
  if (R <= 0) return 0
  const defAt0 = Math.round((CANT_DEF_COEFF * speed * speed) / R)
  if (defAt0 <= MAX_SWITCH_CANT_DEF) return 0
  const needed = roundCant((CANT_DEF_COEFF * speed * speed) / R - MAX_SWITCH_CANT_DEF)
  return cantSign(radius) * Math.min(MAX_SWITCH_CANT, Math.max(0, needed))
}

/**
 * Highest speed this element's geometry allows under the deficiency limit that
 * really holds there — the switch route's own, or the Ril's step.
 *
 * The step is why this is not one call to computeMaxSpeed: the limit rises
 * above 150 km/h, so a curve can be *too slow* for the higher limit and yet
 * fast enough once it is past the step. Each stretch of speed is therefore
 * solved with its own limit and clipped to its own stretch, and the fastest
 * answer that lands inside the stretch it was computed for wins.
 */
export function maxSpeedFor(el, radius, cant) {
  if (!(Math.abs(radius) > 0)) return null
  // Never past the fastest speed the Ril speaks about (LP.ALL.01): a column
  // that proposed 324 km/h would be proposing something the rulebook has no
  // limits for, and the button beside it would write it into every element.
  const ceiling = catalogSpeedRange.max
  if (el?.switchBranch) {
    return Math.min(computeMaxSpeed(radius, cant, MAX_SWITCH_CANT_DEF), ceiling)
  }
  let best = 0
  CANT_DEF_STEPS.forEach((step, i) => {
    const until = CANT_DEF_STEPS[i + 1] ? CANT_DEF_STEPS[i + 1].from - 1 : ceiling
    const reached = Math.min(computeMaxSpeed(radius, cant, step.limit), until)
    if (reached >= step.from) best = Math.max(best, reached)
  })
  return best
}

/** Compute cant deficiency from speed (km/h), radius (m), and signed cant (mm). */
export function computeCantDef(speed, radius, cant) {
  const R = Math.abs(radius)
  if (R <= 0) return 0
  return Math.round(((CANT_DEF_COEFF * speed * speed) / R) - Math.abs(cant))
}

/**
 * Cant deficiency of a route whose cant may be applied the wrong way round. A
 * bent switch has one cant on one set of sleepers but two routes: where they
 * bend apart (the outer-bent switch) the cant that serves the stem works
 * against the branch. So the sign is read rather than dropped — `cant` shares
 * the sign of `radius` on a normally canted curve and adds to the deficiency
 * when it does not. Same value as computeCantDef whenever the signs agree.
 */
export function computeCantDefSigned(speed, radius, cant) {
  const R = Math.abs(radius)
  if (R <= 0) return 0
  return Math.round(((CANT_DEF_COEFF * speed * speed) / R) - (cant ?? 0) * Math.sign(radius))
}

/**
 * Highest speed (km/h) radius (m) and signed cant (mm) allow — the inverse of
 * computeCantDef, solved for the speed at which the deficiency reaches `limit`.
 * Returns null for a straight: without curvature the geometry imposes no limit.
 */
export function computeMaxSpeed(radius, cant, limit) {
  const R = Math.abs(radius)
  if (!(R > 0)) return null
  // Cant that follows the curve buys speed; cant applied against it — a bent
  // switch's second route runs on the cant the first one was banked for —
  // spends it, and can leave no admissible speed at all.
  const room = (cant ?? 0) * Math.sign(radius) + limit
  if (room <= 0) return 0
  let v = Math.floor(Math.sqrt((R * room) / CANT_DEF_COEFF))
  // computeCantDefSigned rounds, so the exact root can fall one km/h short of
  // what that rounded check still admits — step up to stay in step with it.
  while (computeCantDefSigned(v + 1, radius, cant) <= limit) v++
  return v
}
