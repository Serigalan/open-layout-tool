import { useI18n } from '../../locales/i18nContext'
import NumberInput from '../form/NumberInput'
/**
 * The number a turnout is created under, with the designation it composes shown
 * beside it. The designation is not editable: it follows the number, so the two
 * can never say different things.
 */
export default function SwitchNumberField({ number, onChange, name, taken }) {
  const { t } = useI18n()
  return (
    <>
      <div className="form-field">
        <label>{t('switch_number')}</label>
        <NumberInput
          min="1" step="1" value={number}
          onChange={e => onChange(Math.max(1, Math.round(Number(e.target.value) || 0)))}
          className={taken ? 'input-error' : undefined}
        />
        {taken && <span className="form-error">{t('switch_number_exists')}</span>}
      </div>
      <div className="form-field">
        <label>{t('switch_name')}</label>
        <input type="text" value={name} readOnly />
      </div>
    </>
  )
}
