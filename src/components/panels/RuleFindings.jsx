import { checkTrack } from '../../utils/trassierungCheck'
import { ruleById, severityLabelKey, worstSeverity } from '../../utils/regelkatalog'

/**
 * What the rule catalogue says about what a dialog is about to create (AP R.8)
 * — the same rules, from the same file, that the element table judges a
 * finished chain by.
 *
 * It is the checking half of "created to the rulebook": the limits a dialog
 * clamps to already come from the catalogue (mapConstants), but a clamp only
 * stops the two or three things it was written for. This says everything the
 * Ril has to say about what is on screen — a length under the minimum for the
 * speed, a speed off the 5 km/h grid, a cant that is not the Regelüberhöhung —
 * before the element exists rather than after.
 *
 * Takes one `element` or a whole chain of `elements`. A single element is
 * judged on its own: the rules over an element boundary need a neighbour, and
 * until it is committed there is none — the element table picks those up the
 * moment there is. A chain is judged as one, boundaries and all, and its
 * findings are gathered per rule with the number of places each was found, so
 * a parallel track of forty elements does not report the same rule forty
 * times.
 *
 * Rendered as the panel's other messages are — one line per finding, in the
 * colour of its step (`rule-sev-*`, the one ladder the element table and the
 * catalogue's legend read from too), with no bullets: a panel keeps those for
 * what it is about to do, not for what it has to say about it.
 */
export default function RuleFindings({ t, element, elements }) {
  const chain = elements ?? (element ? [element] : [])
  const check = checkTrack(chain)
  // Nothing was judged at all — every element had an unknown design speed.
  if (!check.perElement.some(entry => !entry.unchecked)) return null

  const byRule = new Map()
  for (const result of check.perElement.flatMap(entry => entry.results)) {
    if (result.severity === 'ok') continue
    const seen = byRule.get(result.id)
    byRule.set(result.id, {
      id: result.id,
      severity: worstSeverity([seen?.severity, result.severity]),
      places: (seen?.places ?? 0) + 1,
    })
  }

  if (!byRule.size) {
    return <p className="rule-findings rule-findings-ok">✓ {t('table_rules_ok')}</p>
  }
  return (
    <ul className="rule-findings">
      {[...byRule.values()].map(found => (
        <li key={found.id} className={`rule-sev-${found.severity}`}>
          {found.id} · {t(severityLabelKey(found.severity))}: {ruleById(found.id)?.title}
          {found.places > 1 && ` (${found.places}×)`}
        </li>
      ))}
    </ul>
  )
}
