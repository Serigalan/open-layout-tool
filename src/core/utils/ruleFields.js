import { ruleById, severityRank, worstSeverity } from './regelkatalog'

// Which form field a rule's finding belongs to (R10.4): the value it reads, as
// the dialog asks for it. A deficiency is the speed's — that is the field to
// change, as the element table marks it — and a ramp the cant's.

const FIELD_OF = {
  'element.design_speed': 'speed',
  'element.radius': 'radius',
  'element.cant': 'cant',
  'element.length': 'length',
  'physics.u_f': 'speed',
  'physics.delta_u_f': 'speed',
  'physics.delta_u': 'cant',
}

/** The fields of a rule's inputs. */
export function ruleFields(rule) {
  return [...new Set(Object.values(rule?.inputs ?? {}).map(input => FIELD_OF[input?.from]).filter(Boolean))]
}

/**
 * The findings of rule results per field: { speed: { severity, ids }, … } for
 * every result past a hint — a hint is advice, not a fault in the field.
 */
export function fieldFindings(results) {
  const out = {}
  for (const result of results ?? []) {
    if (severityRank(result.severity) <= severityRank('hint')) continue
    for (const field of ruleFields(ruleById(result.id))) {
      const seen = out[field]
      out[field] = {
        severity: worstSeverity([seen?.severity, result.severity]),
        ids: [...new Set([...(seen?.ids ?? []), result.id])],
      }
    }
  }
  return out
}
