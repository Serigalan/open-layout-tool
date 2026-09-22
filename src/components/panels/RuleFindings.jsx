import { checkTrack } from '../../utils/trassierungCheck'
import { ruleById, severityLabelKey } from '../../utils/regelkatalog'

/**
 * What the rule catalogue says about the element a dialog is about to create
 * (AP R.8) — the same rules, from the same file, that the element table judges
 * a finished chain by.
 *
 * It is the checking half of "created to the rulebook": the limits a dialog
 * clamps to already come from the catalogue (mapConstants), but a clamp only
 * stops the two or three things it was written for. This says everything the
 * Ril has to say about what is on screen — a length under the minimum for the
 * speed, a speed off the 5 km/h grid, a cant that is not the Regelüberhöhung —
 * before the element exists rather than after.
 *
 * Judged on its own, as the single element it is about to be: the rules over
 * an element boundary need a neighbour, and until it is committed there is
 * none. The element table picks those up the moment there is.
 *
 * Rendered as the panel's other messages are — one line per finding, in the
 * colour of its step (`rule-sev-*`, the one ladder the element table and the
 * catalogue's legend read from too), with no bullets: a panel keeps those for
 * what it is about to do, not for what it has to say about it.
 */
export default function RuleFindings({ t, element }) {
  const entry = checkTrack([element]).perElement[0]
  if (!entry || entry.unchecked) return null

  const fired = entry.results.filter(result => result.severity !== 'ok')
  if (!fired.length) {
    return <p className="rule-findings rule-findings-ok">✓ {t('table_rules_ok')}</p>
  }
  return (
    <ul className="rule-findings">
      {fired.map(result => (
        <li key={result.id} className={`rule-sev-${result.severity}`}>
          {result.id} · {t(severityLabelKey(result.severity))}: {ruleById(result.id)?.title}
        </li>
      ))}
    </ul>
  )
}
