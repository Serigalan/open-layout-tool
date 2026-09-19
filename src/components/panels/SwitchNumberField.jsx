/**
 * The number a turnout is created under, with the designation it composes shown
 * beside it. The designation is not editable: it follows the number, so the two
 * can never say different things.
 */
export default function SwitchNumberField({ t, number, onChange, name, taken }) {
  return (
    <>
      <div className="form-field">
        <label>{t('switch_number')}</label>
        <input
          type="number" min="1" step="1" value={number}
          onChange={e => onChange(Math.max(1, Math.round(Number(e.target.value) || 0)))}
          style={taken ? { borderColor: '#e74c3c' } : undefined}
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
