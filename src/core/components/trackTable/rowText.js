import { switchKindLabelKey, switchRouteLabelKey } from '../../utils/track'
import {
  ruleById, severityLabelKey, severityRank, cantExceedsLimit, cantExceptionOf, cantLimit, limitCantDef,
} from '../../utils/rules'
import { formatNum } from '../../locales/i18n'

// What the cells of the element table say — the words and marks of one row,
// worked out from the element, apart from the table that lays them out.

export const isTransition = (el) => el.elementType === 2

/**
 * A transition is neither straight nor arc — it is named by its own curvature
 * profile (clothoid or Bloss), which is what the element chain stores.
 */
const geometryLabel = (t, el) => (isTransition(el)
  ? t(el.transitionType === 'bloss' ? 'table_type_bloss' : 'table_type_transition')
  : t(el.radius ? 'table_type_arc' : 'table_type_straight'))

/**
 * What the type column says. An element of a switch route is named by the
 * switch — a turnout, a crossing or a crossing switch, and the form it was
 * built to — because that is what lies there: a row reading "straight" over a
 * turnout's through route says nothing about the turnout. The geometry has not
 * gone anywhere; it stands in the radius and length columns, and in the cell's
 * tooltip beside the switch's name and the route this is.
 */
export function typeLabel(t, el, sw) {
  if (!el.switchBranch) return geometryLabel(t, el)
  const kind = t(switchKindLabelKey(sw?.kind))
  const form = sw?.label
  return form ? `${kind} ${form}` : kind
}

/** Which switch this is, which of its routes, and the geometry its name stands in front of. */
export function switchNote(t, el, sw) {
  if (!el.switchBranch) return undefined
  const routeKey = switchRouteLabelKey(sw?.kind, el.switchRoute)
  return [sw?.name, routeKey && t(routeKey), geometryLabel(t, el)].filter(Boolean).join(' · ')
}

/**
 * An element the MDB import found a switch on but could not build into one
 * says so on its type — the alignment is there, the switch is not, and the
 * track must not read as plain running line.
 */
export const hintNote = (fill, el) => (el.switchHint ? fill('table_switch_hint', { text: el.switchHint }) : undefined)

/**
 * What the cant cell says about itself: over its limit it is an error — the
 * element is not buildable until the cant comes down or a reason is written
 * for it — and on a standing exception it carries that reason as its note.
 */
export function cantNote(fill, el) {
  if (cantExceedsLimit(el)) return fill('table_cant_over_limit', { mm: String(cantLimit(el)) })
  const reason = cantExceptionOf(el)
  return reason ? fill('table_cant_exception_note', { text: reason }) : undefined
}

/** Over the limit reads as an error, a standing exception as a mark, the ordinary case as nothing. */
export const cantClass = (el) => (cantExceedsLimit(el) ? 'input-error'
  : cantExceptionOf(el) ? 'track-table-input-exception' : '')

/**
 * The deficiency of a row as a cell class and a note: past the limit the
 * element may be built with it is an error, past what its speed should have
 * been designed against it is marked but not refused — the same two levels,
 * and the same colours, the cant column uses.
 */
export const defClass = (level) => (level === 'over' ? 'input-error'
  : level === 'design' ? 'track-table-input-exception' : '')

export const defNote = (fill, el, level, cantDef, vMax) => (level
  ? fill('table_cant_def_over', { mm: String(limitCantDef(el)), is: String(cantDef), v: String(vMax ?? '–') })
  : undefined)

/**
 * The rule a turnout's cant over 100 mm falls under (LP.KB.05): its reason is
 * the element's `cantException`, which also raises the limit to 120 mm.
 */
export const SWITCH_CANT_RULE = 'LP.KB.05'

/**
 * What the catalogue said about one row, in the two kinds the table tells
 * apart (Entscheidung 374): `errors` — what has to change — and `hints` —
 * every finding between ok and error (Hinweis, Warnung, Zustimmung,
 * Sonderfall), each standing once a reason is written for it. Each hint
 * carries its `reason`, '' where none is written.
 */
export function ruleGroups(entry, el) {
  const fired = (entry?.results ?? []).filter(r => r.severity && r.severity !== 'ok')
  const errors = fired.filter(r => severityRank(r.severity) >= severityRank('error'))
  const seen = new Set()
  const hints = fired.filter(r => severityRank(r.severity) < severityRank('error'))
    .filter(r => !seen.has(r.id) && seen.add(r.id))
    .map(r => ({ ...r, reason: reasonOf(el, r.id) }))
  return { errors, hints, justified: hints.every(h => h.reason) }
}

/** The reason written for rule `id` on an element, trimmed — '' where there is none. */
export function reasonOf(el, id) {
  if (id === SWITCH_CANT_RULE) return cantExceptionOf(el)
  const text = el?.reasons?.[id]
  return typeof text === 'string' ? text.trim() : ''
}

/** One finding as a line: its id, its step and the rule's own title. */
export const findingText = (t, result) =>
  `${result.id} · ${t(severityLabelKey(result.severity))}: ${ruleById(result.id)?.title ?? ''}`

export function ruleNote(t, entry) {
  if (!entry || entry.unchecked) return t('table_rules_unchecked')
  const fired = entry.results.filter(result => result.severity !== 'ok')
  if (!fired.length) return t('table_rules_ok')
  return fired.map(result => findingText(t, result)).join('\n')
}

/**
 * A bearing is shown, never typed: an element starts where the one before it
 * ended, and the chain is what sets that.
 */
export const degText = (deg, language) => (Number.isFinite(deg) ? formatNum(deg, language, { digits: 2 }) : '–')

/** A length that is read rather than typed, to the millimetre. */
export const lengthText = (m, language) => (Number.isFinite(m) ? formatNum(Math.round(m * 1000) / 1000, language) : '–')

/**
 * A transition has no single radius: it runs from r1 to r2 (∞ on the straight
 * end), so the column shows that ramp instead of an empty, uneditable cell.
 */
export function radiusText(el, language) {
  const r = (v) => (v ? formatNum(Math.round(v * 1000) / 1000, language) : '∞')
  return `${r(el.r1)} → ${r(el.r2)}`
}

/**
 * The comparison radius r_w at the joint an element starts with (LP.UB.01):
 * 1/r_w = |1/r_end − 1/r_start| of the two elements meeting there — the
 * radius the curvature jump amounts to. Where the curvature runs on there is
 * none.
 */
export const comparisonRadiusText = (rw, language) => (Number.isFinite(rw) ? lengthText(rw, language) : '–')
