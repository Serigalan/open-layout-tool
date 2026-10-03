import { useI18n } from '../../../locales/i18nContext'
import NumberInput from '../../form/NumberInput'
import { splitUnit } from '../../../locales/i18n'
export default function TransitionCurveSection({ enabled, onEnabledChange, type, onTypeChange, length, onLengthChange }) {
  const { t } = useI18n()
  return (
    <div className="element-form">
      <label className="transition-curve-row">
        <input type="checkbox" checked={enabled} onChange={e => onEnabledChange(e.target.checked)} />
        <span>{t('transition_curve')}</span>
      </label>
      {enabled && (
        <>
          <div className="form-field">
            <label>{t('type')}</label>
            <select value={type} onChange={e => onTypeChange(e.target.value)}>
              <option value="clothoid">{t('transition_type_clothoid')}</option>
              <option value="bloss">{t('transition_type_bloss')}</option>
            </select>
          </div>
          <div className="form-field">
            <label>{splitUnit(t('field_length')).text}</label>
            <NumberInput min="1" value={length}
              onChange={e => onLengthChange(Math.max(1, Number(e.target.value) || 1))} unit="m" />
          </div>
        </>
      )}
    </div>
  )
}
