import { useContext, useEffect } from 'react'
import { fieldFindings } from '../../../utils/ruleFields'
import { RuleFieldsContext } from '../../form/ruleFieldsContext'
import { ruleById, severityLabelKey } from '../../../utils/regelkatalog'
import { useI18n } from '../../../locales/i18nContext'

const TYPE_KEY = { 0: 'table_type_straight', 1: 'table_type_arc', 2: 'transition_curve' }
const ROLE_KEY = { dep: 'splice_departure', arr: 'splice_arrival', new: 'splice_inserted' }

/**
 * What the rule catalogue finds on the stretch a splice writes (AP S.4) — as
 * the service judged it, the rest of the departure, what is inserted, the
 * rest of the arrival and the joints between them — one line per finding,
 * by the element or joint it is about, in chain order. The findings on the
 * inserted arc are also shown at the dialog's fields (R10.4), which ask for
 * exactly that arc. `result` is the solution shown (commands/splice
 * spliceFromAnswer): its `elements` with their roles, `findings` and whether
 * anything was `judged` at all — nothing is without a design speed.
 */
export default function SpliceFindings({ result }) {
  const { t, num } = useI18n()
  const { elements = [], findings = [], judged } = result ?? {}
  const arc = elements.findIndex(el => el.role === 'new' && el.elementType === 1)
  const scope = useContext(RuleFieldsContext)
  const fieldsKey = JSON.stringify(fieldFindings(findings.filter(f => f.at === `#${arc}`)))
  const setFields = scope?.setFields
  useEffect(() => {
    if (!setFields) return undefined
    setFields(JSON.parse(fieldsKey))
    return () => setFields(null)
  }, [setFields, fieldsKey])
  if (!judged) return null
  if (!findings.length) return <p className="rule-findings rule-findings-ok">✓ {t('table_rules_ok')}</p>

  const name = (i) => {
    const el = elements[i]
    return `${t(TYPE_KEY[el.elementType])} (${t(ROLE_KEY[el.role] ?? 'splice_inserted')}, ${num(el.length, { digits: 1, unit: 'm' })})`
  }
  const place = (f) => (f.index.length === 2
    ? `${t('splice_joint')} ${name(f.index[0])} → ${name(f.index[1])}`
    : name(f.index[0]))
  const sorted = [...findings].sort((a, b) => a.index[0] - b.index[0] || a.index.length - b.index.length)
  return (
    <ul className="rule-findings">
      {sorted.map(f => (
        <li key={`${f.at}|${f.id}`} className={`rule-sev-${f.severity}`}>
          {place(f)}: {f.id} · {t(severityLabelKey(f.severity))}: {ruleById(f.id)?.title}
        </li>
      ))}
    </ul>
  )
}
