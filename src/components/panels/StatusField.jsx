import { STATUSES } from '../../utils/planStatus'

/**
 * Planning status of a track or switch: existing, new or removed. `auto`, when
 * given, adds a first choice that leaves the status to be derived — its label
 * says what it currently comes to.
 */
export default function StatusField({ t, value, onChange, auto }) {
  return (
    <div className="form-field">
      <label>{t('status')}</label>
      <select value={value ?? ''} onChange={e => onChange(e.target.value || null)}>
        {auto && <option value="">{t('status_auto').replace('{s}', t(`status_${auto}`))}</option>}
        {STATUSES.map(s => <option key={s} value={s}>{t(`status_${s}`)}</option>)}
      </select>
    </div>
  )
}
