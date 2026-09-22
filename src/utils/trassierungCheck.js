/**
 * The rule catalogue applied to the app's own elements (AP R.7).
 *
 * regelkatalog.js knows the rules and nothing about tracks; this is the other
 * half — it fills the flat scope of names a rule declares
 * (`element.design_speed`, `physics.u_f`, `model.ramp_form_matches`, …) from
 * an element chain, and hands back what each rule said.
 *
 * The physics is not re-derived here: the cant deficiency comes from
 * mapConstants' own `computeCantDefSigned`, the ramp ends from
 * clothoidUtils' `transitionCantEnds`. A checker that computed a deficiency of
 * its own would be judging the layout against arithmetic the layout was never
 * drawn with, and the first thing it found would be its own disagreement.
 */

import {
  evaluateRules, rulesForElement, rulesForScope, severityRank, worstSeverity,
} from './regelkatalog'
import { transitionCantEnds } from './clothoidUtils'
import { computeCantDefSigned } from './mapConstants'
import { CANT_DEFICIENCY_COEFF } from './regelwerkDefaults'

const PHYSICS = { u0_factor: CANT_DEFICIENCY_COEFF }

// The catalogue's element types, by the number the store keeps.
const TYPE_BY_ELEMENT_TYPE = { 0: 'straight', 1: 'circular_arc', 2: 'transition_curve' }

const isTransition = (el) => el.elementType === 2

/** The catalogue's form id of a transition — everything that is not Bloß is a clothoid. */
export const formOf = (el) =>
  (isTransition(el) ? (el.transitionType === 'bloss' ? 'bloss' : 'clothoid') : null)

// Signed curvature [1/m]; a straight and an open transition end are 0.
const curvature = (r) => (r ? 1 / r : 0)
const curvatureAtStart = (el) => curvature(isTransition(el) ? el.r1 : el.radius)
const curvatureAtEnd = (el) => curvature(isTransition(el) ? el.r2 : el.radius)

// Two curvatures count as one where they agree to within a radius of a
// million metres — that is straight by any measure, and the difference is
// what floating point leaves behind after a chain has been rebuilt.
const CURVATURE_EPS = 1e-6

/** The signed cant [mm] at both ends of an element; a transition ramps between them. */
const cantEndsOf = (elements, i) => (isTransition(elements[i])
  ? transitionCantEnds(elements, i)
  : { start: elements[i].cant ?? 0, end: elements[i].cant ?? 0 })

/** Cant deficiency [mm] at one end, as the rest of the app computes it. 0 without curvature. */
const deficiency = (v, radius, cant) => (radius ? computeCantDefSigned(v, radius, cant) : 0)

/**
 * An element the catalogue can speak about at all. A design speed of 0 means
 * "unknown" in this store (an import that stated none) — and an unknown speed
 * is not a slow one: nearly every rule is a function of v, so judging it as
 * 39 km/h would produce a page of errors about a number nobody entered.
 */
export const isCheckable = (el) => !!el?.speed

/**
 * The scope an element rule reads. Names are the catalogue's, flat and dotted,
 * exactly as its `inputs[].from` states them.
 */
export function elementScope(elements, i) {
  const el = elements[i]
  const prev = elements[i - 1] ?? null
  const next = elements[i + 1] ?? null
  const v = el.speed ?? 0
  const ends = cantEndsOf(elements, i)
  // Over a reverse transition the cross level really does travel from one
  // rail to the other, so the ramp is the signed difference, not the
  // difference of the magnitudes.
  const deltaU = Math.abs(ends.end - ends.start)
  const deltaUf = isTransition(el)
    ? Math.abs(deficiency(v, el.r2, ends.end) - deficiency(v, el.r1, ends.start))
    : 0
  return {
    'element.design_speed': v,
    'element.length': el.length ?? 0,
    // The store keeps cant signed, following the curve; the rulebook's u is
    // the magnitude of the cross level (LP.KB.03 says outright that negative
    // cant is not treated).
    'element.cant': Math.abs(el.cant ?? 0),
    'element.radius': Math.abs(el.radius ?? 0),
    'element.transition_form': formOf(el) ?? '',
    'prev.design_speed': prev?.speed ?? v,
    'next.design_speed': next?.speed ?? v,
    'physics.u_f': el.radius ? computeCantDefSigned(v, el.radius, el.cant ?? 0) : 0,
    'physics.delta_u': deltaU,
    'physics.delta_u_f': deltaUf,
    // The mean ramp gradient 1:m. With no cant change there is no ramp, and
    // the two rules that read it say so themselves (`condition: delta_u > 0`).
    'physics.ramp_slope': deltaU > 0 ? (1000 * (el.length ?? 0)) / deltaU : Infinity,
    'model.reverse_curve_straight': el.elementType === 0 && !!prev && !!next
      && Math.abs(curvatureAtEnd(prev)) > CURVATURE_EPS
      && Math.abs(curvatureAtStart(next)) > CURVATURE_EPS
      && Math.sign(curvatureAtEnd(prev)) !== Math.sign(curvatureAtStart(next)),
  }
}

/** The scope a boundary rule reads, for the joint between elements i and i+1. */
export function boundaryScope(elements, i) {
  const prev = elements[i]
  const next = elements[i + 1]
  const k1 = curvatureAtEnd(prev)
  const k2 = curvatureAtStart(next)
  const step = Math.abs(k1 - k2)
  const jump = step > CURVATURE_EPS
  return {
    'prev.cant_end': cantEndsOf(elements, i).end,
    'next.cant_start': cantEndsOf(elements, i + 1).start,
    'prev.design_speed': prev.speed ?? 0,
    'next.design_speed': next.speed ?? 0,
    'physics.curvature_jump': jump,
    // 1/r_w = |κ1 − κ2| — a straight against an arc gives the arc's radius
    // back, two curves in the same sense the larger comparison radius, two
    // against each other the smaller. No jump, no comparison radius.
    'physics.r_w': jump ? 1 / step : Infinity,
  }
}

/**
 * The scope the ramp rule reads. Both answers follow from how this app models
 * a ramp rather than from any one layout:
 *
 * - it *is* the transition — cant is stated at the ends of an element and
 *   nowhere else, so a change of cant has an element of its own by
 *   construction (a cant that jumps at a joint is not a ramp at all, and is
 *   what LP.UB.01 is for);
 * - and it is always **straight**: every reader of the cant between two ends
 *   interpolates linearly (crossSectionUtils, switchPlacement). That matches
 *   the clothoid and does not match the Bloß curve, which asks for a curved
 *   ramp — so a Bloß transition is a Sonderfall here, and truthfully so: the
 *   app draws a straight ramp on it.
 */
export function rampScope(elements, i) {
  return {
    'model.ramp_on_transition': isTransition(elements[i]),
    'model.ramp_form_matches': formOf(elements[i]) === 'clothoid',
  }
}

const inSwitch = (el) => el?.switchId != null

/**
 * Every rule of the catalogue applied to one element chain.
 *
 * Returns the three groups the catalogue is written in — elements, boundaries
 * and cant ramps — and, for the element table, one entry per element that also
 * carries the joint it begins at: a boundary belongs to the two elements it
 * joins, and counting it at the start of the later one states it exactly once.
 */
export function checkTrack(elements = []) {
  const perElementResults = elements.map((el, i) => {
    if (!isCheckable(el)) return { index: i, severity: null, results: [], unchecked: true }
    const type = TYPE_BY_ELEMENT_TYPE[el.elementType] ?? 'straight'
    const options = { physics: PHYSICS, inContext: (id) => id === 'switch_area' && inSwitch(el) }
    return {
      index: i,
      ...evaluateRules(rulesForElement(type, formOf(el)), elementScope(elements, i), options),
    }
  })

  const ramps = elements.map((el, i) => {
    // Only where there is a ramp: a transition that changes the cant.
    if (!isCheckable(el) || !isTransition(el)) return null
    const scope = elementScope(elements, i)
    if (!(scope['physics.delta_u'] > 0)) return null
    return {
      index: i,
      ...evaluateRules(rulesForScope('cant_ramp'), rampScope(elements, i), { physics: PHYSICS }),
    }
  }).filter(Boolean)

  const boundaries = elements.slice(0, -1).map((el, i) => {
    const next = elements[i + 1]
    if (!isCheckable(el) || !isCheckable(next)) return null
    const both = inSwitch(el) && inSwitch(next) && el.switchId === next.switchId
    const options = {
      physics: PHYSICS,
      inContext: (id) => id === 'switch_area' && (inSwitch(el) || inSwitch(next)),
      // A curvature jump inside one turnout is the turnout's own business —
      // the catalogue excludes it and points at a catalogue of its own.
      excluded: both ? ['switch_internal'] : [],
    }
    return { index: i, ...evaluateRules(rulesForScope('boundary'), boundaryScope(elements, i), options) }
  }).filter(Boolean)

  const byIndex = (list) => new Map(list.map(entry => [entry.index, entry]))
  const rampAt = byIndex(ramps)
  const boundaryAt = byIndex(boundaries)

  const perElement = perElementResults.map((entry) => {
    const own = [entry, rampAt.get(entry.index), boundaryAt.get(entry.index - 1)].filter(Boolean)
    const results = own.flatMap(part => part.results ?? [])
    return {
      index: entry.index,
      unchecked: !!entry.unchecked,
      results,
      severity: worstSeverity(results.map(r => r.severity)),
    }
  })

  return {
    perElement,
    elements: perElementResults,
    boundaries,
    ramps,
    severity: worstSeverity(perElement.map(e => e.severity)),
  }
}

/**
 * Does the catalogue call anything about this chain an error? What a creation
 * dialog asks before it lets a commit through.
 *
 * Only `error` blocks. A Sonderfall ranks below it on purpose — the catalogue
 * says of one that it wants an experienced hand, not that it is forbidden, so
 * a Bloß transition is still buildable. And an element whose design speed is
 * unknown is not judged at all, so it cannot block either.
 */
export function hasRuleError(elements = []) {
  return severityRank(checkTrack(elements).severity) >= severityRank('error')
}
