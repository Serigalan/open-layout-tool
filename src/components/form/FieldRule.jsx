import { ruleById, severityLabelKey } from '../../utils/regelkatalog'
import { useI18n } from '../../locales/i18nContext'
import { useRuleField } from './ruleFieldsContext'

/**
 * What the rule catalogue says about this field, under it (R10.4): the rules
 * that read its value and do not hold, in the colour of their step. The field
 * above takes the colour too (styles: .form-field:has(.field-rule)).
 */
export default function FieldRule({ name }) {
  const { t } = useI18n()
  const found = useRuleField(name)
  if (!found) return null
  return (
    <span className={`field-rule rule-sev-${found.severity}`}>
      {found.ids.map(id => `${id} · ${t(severityLabelKey(found.severity))}: ${ruleById(id)?.title ?? ''}`).join('; ')}
    </span>
  )
}
