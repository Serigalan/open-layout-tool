// What the splice dialog makes of an answer (commands/splice spliceFromAnswer):
// the settings it starts from, the sentence for a solution or an error, which
// solution is chosen. The switch between several solutions is SolutionSwitch.

/** The settings a splice dialog starts with. */
export const SPLICE_DEFAULTS = {
  // The speed is the faster pick's once both are picked (Entscheidung 181).
  radius: 500, speed: '',
  // The transition beside each pick, in the order they were clicked: switched
  // on or not — one side alone is fine — and its shape ('clothoid' | 'bloss').
  transitionOn: [false, false], transitionTypes: ['clothoid', 'clothoid'],
  // The shape of a single transition from arc to arc.
  transitionType: 'clothoid',
  // Two arcs can be joined either by a straight between them or by a single
  // transition curve straight from one to the other (AP 4.1).
  arcJoin: 'straight',                                  // 'straight' | 'transition'
  // The transition beside each pick: switched on, the Regellänge the answer
  // names is set once ('regular', Entscheidung 185), from then on the length
  // here as it is ('fixed').
  transitions: [60, 60], modes: ['regular', 'regular'],
}

/**
 * A splice that does not fit, as a sentence: the error, and what would fit
 * (AP S.5) — the largest radius below the one asked for, the smallest above
 * it, the longest transitions.
 */
export function spliceErrorText(t, fill, error, params = {}) {
  // The keys are the splice's (and the service's, splice.py); one this bundle does not know reads as no fit.
  const known = error.startsWith('splice_error_') || error === 'splice_clearance_unavailable'
  const text = t(known ? error : 'splice_error_no_fit')
  const hints = [
    params.rMax != null && fill('splice_r_max', { r: String(params.rMax) }),
    params.rMin != null && fill('splice_r_min', { r: String(params.rMin) }),
    params.lMax != null && fill('splice_l_max', { l: String(params.lMax).replace('.', ',') }),
  ].filter(Boolean)
  // The error texts end with or without a full stop; each hint is a sentence of its own.
  return hints.length ? `${text}${/[.!?]$/.test(text) ? '' : '.'} ${hints.join(' ')}` : text
}

/** What the dialog says about a splice: its error, or the solution shown. */
export function spliceMessage(t, fill, splice, solution) {
  if (splice.error) return { msg: spliceErrorText(t, fill, splice.error, splice.params), error: true }
  const { result, dep, arr } = solution
  // Departure first, as the solution runs.
  const side = (k) => result.lengths[k]?.length ?? 0
  const [Ld, La] = [side(result.depPick), side(1 - result.depPick)]
  const tr = (Ld > 0 || La > 0) ? ` | ${t('transition_curve')}: ${Ld.toFixed(1)}+${La.toFixed(1)} m` : ''
  // Two arcs, or an arc and a straight: re-shaped elements and a solved
  // construction rather than an arc rounding a corner.
  const arcMode = dep.signedR != null || arr.signedR != null
  if (result.transitionLength != null) {
    return { msg: `${t(result.compound ? 'splice_compound' : 'splice_reverse')}: ${t('transition_curve')} ~${result.transitionLength.toFixed(1)} m`, error: false }
  }
  if (result.straightLength != null) {
    return { msg: `${t('splice_arrival')} ↔ ${t('splice_departure')}: ~${result.straightLength.toFixed(1)} m${tr}`, error: false }
  }
  const len = `${t('splice_arc_length')}: ~${result.arcLength.toFixed(1)} m${tr}`
  return { msg: arcMode ? len : `${len} | ${t(result.signedR < 0 ? 'splice_left' : 'splice_right')}`, error: false }
}

/** Which solution is chosen: by the ends it joins and, for two arcs, how. */
export const solutionKey = (sol) => `${sol.result.ends.join()}|${sol.result.arcJoin ?? ''}`

/**
 * Two arcs joined the other way than asked for, taken over as the setting —
 * over a straight with the transitions the solution has: the settings to
 * merge in.
 */
export function adoptedSettings(sol) {
  const { arcJoin, lengths } = sol.result
  if (arcJoin !== 'straight') return { arcJoin }
  const on = lengths.map(l => l.length > 0)
  return {
    arcJoin, transitionOn: on,
    ...(on.some(Boolean) ? { modes: ['fixed', 'fixed'], transitions: lengths.map(l => l.length || SPLICE_DEFAULTS.transitions[0]) } : {}),
  }
}
