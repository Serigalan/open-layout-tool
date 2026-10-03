import { splitUnit } from '../../locales/i18n'
import { useI18n } from '../../locales/i18nContext'

/**
 * A value the dialog states but does not let one type (R4.3): a label and a
 * read-only field. A `type="number"` value is written as the interface
 * language writes numbers, with the label's unit behind it (R10.8).
 */
export default function ReadOnlyField({ label, value, type = 'text' }) {
  const { num } = useI18n()
  if (type !== 'number') {
    return (
      <div className="form-field">
        <label>{label}</label>
        <input type="text" readOnly value={value ?? ''} />
      </div>
    )
  }
  const { text, unit } = splitUnit(label)
  const field = <input type="text" readOnly value={num(value)} />
  return (
    <div className="form-field">
      <label>{text}</label>
      {unit ? <span className="number-field">{field}<span className="number-unit">{unit}</span></span> : field}
    </div>
  )
}
