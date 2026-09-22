import { SWITCH_PICK_TYPES } from '../../../utils/switchUtils'

/**
 * The turnout form a dialog builds with, in the two groups the Ril itself
 * keeps: Regelformen (800.0120A01) first, Sonderbauformen (A02) behind them.
 * Both are offered — the Ril permits a Sonderbauform, it only does not make it
 * the rule — and the group a form stands in is what says which it is.
 *
 * The value is the index into SWITCH_PICK_TYPES, which is what the dialogs
 * have always held; the groups only change how the list is drawn.
 */
export default function SwitchFormField({ t, value, onChange }) {
  const optionen = (klasse) => SWITCH_PICK_TYPES
    .map((form, i) => ({ form, i }))
    .filter(entry => entry.form.klasse === klasse)
    .map(({ form, i }) => <option key={i} value={i}>{form.label}</option>)

  return (
    <div className="form-field">
      <label>{t('switch_form')}</label>
      <select value={value} onChange={e => onChange(Number(e.target.value))}>
        <optgroup label={t('switch_form_regel')}>{optionen('regel')}</optgroup>
        <optgroup label={t('switch_form_sonder')}>{optionen('sonderbauform')}</optgroup>
      </select>
    </div>
  )
}
