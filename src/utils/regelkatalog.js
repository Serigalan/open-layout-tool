/**
 * The rule catalogue — DB Ril 800.0110 Linienführung as the repo holds it
 * (src/regelkataloge/trassierung-lageplan.json), read and applied.
 *
 * The file is the rule, not a description of one: every limit, every step of
 * severity and every formula lives there, and this module only walks it. That
 * is the whole point of the shape the catalogue is written in — a value moved
 * from the file into code here would be a value no longer maintained where the
 * rulebook is maintained, which is the drift the repo's other regelwerke are
 * checked against on disk.
 *
 * Reading is split from the model: this module knows nothing about tracks or
 * elements. It is handed a flat scope of the names a rule declares
 * (`element.design_speed`, `physics.u_f`, …) and gives back a severity.
 * trassierungCheck.js is what fills that scope from the app's own elements.
 */

import KATALOG from '../regelkataloge/trassierung-lageplan.json'
import { evalExpr } from './ruleExpr'

export { KATALOG }

export const CATALOG_ID = KATALOG.catalog.id

const RANK = Object.fromEntries(KATALOG.severity_levels.map(s => [s.id, s.rank]))

/** Rank of a severity — higher is worse. */
export const severityRank = (id) => RANK[id] ?? -1

/** The worst of several severities; null when none was applied. */
export function worstSeverity(ids) {
  let worst = null
  for (const id of ids) {
    if (id && (worst === null || severityRank(id) > severityRank(worst))) worst = id
  }
  return worst
}

/**
 * Locale key naming a severity. The catalogue states a German title for each,
 * which is right in a viewer that shows the catalogue itself; a cell in the
 * element table is the app speaking, and the app speaks both languages.
 */
export const severityLabelKey = (id) => `rule_sev_${id}`

/** The rules written for one kind of object: 'element', 'boundary', 'cant_ramp'. */
export const rulesForScope = (scope) =>
  KATALOG.rules.filter(rule => rule.applies_to?.scope === scope)

/** A rule by its id — for a test or a viewer that wants one by name. */
export const ruleById = (id) => KATALOG.rules.find(rule => rule.id === id) ?? null

/**
 * A table asked for a key it does not cover. Thrown rather than returned so
 * that a threshold deep inside an expression still reaches the rule, which
 * answers with the table's own `out_of_range` severity — the catalogue says
 * what a missing value means, and it is never "pass".
 */
class OutOfRange extends Error {
  constructor(severity) {
    super(`out of range → ${severity}`)
    this.severity = severity
  }
}

/** One step of a piecewise table (min_element_length): the piece's own formula. */
export function lookupPiecewise(table, key) {
  for (const piece of table.pieces) {
    const lowOk = piece.key_min !== undefined ? key >= piece.key_min
      : piece.key_min_exclusive !== undefined ? key > piece.key_min_exclusive
        : true
    const highOk = piece.key_max !== undefined ? key <= piece.key_max : true
    if (lowOk && highOk) return evalExpr(piece.expr, { [table.key]: key }, {})
  }
  throw new OutOfRange(table.out_of_range)
}

/**
 * One column of a speed table (comparison_radius). A tabulated speed always
 * gives the tabulated value — the catalogue says so outright; `key_mode` only
 * governs what happens between two rows, and past the last row there is no
 * value at all.
 */
export function lookupSpeedTable(table, key, column, physics = {}) {
  const exact = table.rows.find(row => row[table.key] === key)
  if (exact) return exact[column]
  const higher = table.rows.find(row => row[table.key] > key)
  if (!higher) throw new OutOfRange(table.out_of_range)
  const mode = table.key_mode?.[column] ?? { mode: 'next_higher' }
  if (mode.mode === 'formula' && (mode.key_max === undefined || key <= mode.key_max)) {
    const scope = { [table.key]: key }
    for (const [name, spec] of Object.entries(mode.inputs ?? {})) {
      scope[name] = resolveFrom(spec.from, { physics })
    }
    const value = evalExpr(mode.expr, scope, {})
    return mode.rounding ? Math.round(value / mode.rounding) * mode.rounding : value
  }
  return higher[column]
}

/** `physics.u0_factor` → providers.physics.u0_factor. */
function resolveFrom(from, providers) {
  const dot = from.indexOf('.')
  const provider = providers[from.slice(0, dot)]
  const key = from.slice(dot + 1)
  if (!provider || !(key in provider)) throw new Error(`no value for ${from}`)
  return provider[key]
}

/**
 * The functions the catalogue's expressions may call. `if` is not among them —
 * the language evaluates it itself so that only the chosen branch is computed
 * (see ruleExpr.js).
 */
export function catalogFunctions({ inContext = () => false, physics = {} } = {}) {
  return {
    min: (...xs) => Math.min(...xs),
    max: (...xs) => Math.max(...xs),
    abs: (x) => Math.abs(x),
    // Half a step rounds up, as the catalogue states.
    round_to: (x, step) => Math.round(x / step) * step,
    lookup: (tableId, key, column) => {
      const table = KATALOG.tables[tableId]
      if (!table) throw new Error(`unknown table ${tableId}`)
      return table.type === 'piecewise'
        ? lookupPiecewise(table, key)
        : lookupSpeedTable(table, key, column, physics)
    },
    in_context: (id) => inContext(id),
  }
}

/**
 * Apply one rule to one object.
 *
 * `base` is a flat scope of the model's names. The rule's own inputs are
 * resolved from it — by name (`from`) or by formula (`expr`) — then the
 * condition decides whether the rule applies at all, then the thresholds are
 * computed in the order the file lists them (a later one may use an earlier),
 * and finally the first matching line of `evaluation` gives the severity.
 *
 * Returns { id, applied, severity, values }. `applied: false` means the rule
 * does not speak about this object (`not_applicable`), which is not the same
 * as `ok` and is not aggregated as one.
 */
export function evaluateRule(rule, base, options = {}) {
  const fns = catalogFunctions(options)
  const scope = { ...base }
  try {
    for (const [name, spec] of Object.entries(rule.inputs ?? {})) {
      scope[name] = spec.expr !== undefined
        ? evalExpr(spec.expr, scope, fns)
        : nameValue(scope, spec.from, rule.id, name)
    }
    if (rule.condition !== undefined && !evalExpr(rule.condition, scope, fns)) {
      return { id: rule.id, applied: false, severity: null, values: scope }
    }
    for (const [name, spec] of Object.entries(rule.thresholds ?? {})) {
      scope[name] = evalExpr(spec.expr, scope, fns)
    }
    for (const entry of rule.evaluation) {
      if ('else' in entry) return { id: rule.id, applied: true, severity: entry.else, values: scope }
      if (evalExpr(entry.if, scope, fns)) {
        return { id: rule.id, applied: true, severity: entry.severity, values: scope }
      }
    }
    // A catalogue whose last line is not an `else` leaves a case unanswered.
    throw new Error(`${rule.id}: no branch of evaluation matched`)
  } catch (err) {
    if (err instanceof OutOfRange) {
      return { id: rule.id, applied: true, severity: err.severity, values: scope, outOfRange: true }
    }
    throw err
  }
}

function nameValue(scope, from, ruleId, input) {
  if (!(from in scope)) throw new Error(`${ruleId}: nothing provides ${from} for ${input}`)
  return scope[from]
}

/**
 * The element rules that speak about this kind of element. A rule without
 * `element_types` speaks about all of them; one that names `forms` speaks only
 * about a transition curve of that form.
 */
export function rulesForElement(typeId, formId = null) {
  return rulesForScope('element').filter(rule => {
    const applies = rule.applies_to
    if (applies.element_types && !applies.element_types.includes(typeId)) return false
    if (applies.forms && !(formId && applies.forms.includes(formId))) return false
    return true
  })
}

/**
 * Apply a list of rules to one object. `excluded` names the contexts the
 * object lies in that a rule may exclude itself from — a curvature jump
 * *inside* a turnout belongs to the switch catalogue, not to this one, and
 * says so with `applies_to.excludes`.
 *
 * Rules that do not speak about the object are dropped, so what comes back is
 * what was really applied, with the worst severity among it.
 */
export function evaluateRules(rules, base, options = {}) {
  const excluded = new Set(options.excluded ?? [])
  const results = rules
    .filter(rule => !(rule.applies_to?.excludes ?? []).some(id => excluded.has(id)))
    .map(rule => evaluateRule(rule, base, options))
    .filter(result => result.applied)
  return { results, severity: worstSeverity(results.map(r => r.severity)) }
}

export { OutOfRange }
