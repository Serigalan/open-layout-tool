import { fileToLogo } from '../../utils/logoImage'
import { PARTIES, STAFF } from '../../utils/planHeader'

/** Editing of the title block: parties with logo and address, staff, plan name. */
export default function PlanHeaderFields({ t, header, onChange, onError }) {
  const setParty = (key, patch) => onChange({
    ...header, parties: { ...header.parties, [key]: { ...header.parties[key], ...patch } },
  })
  const setStaff = (key, patch) => onChange({
    ...header, staff: { ...header.staff, [key]: { ...header.staff[key], ...patch } },
  })

  const pickLogo = async (key, file) => {
    if (!file) return
    try {
      setParty(key, { logo: await fileToLogo(file) })
    } catch {
      onError?.(t('plan_logo_failed'))
    }
  }

  return (
    <>
      <div className="form-field">
        <label>{t('plan_subtitle')}</label>
        <input type="text" value={header.subtitle}
          onChange={e => onChange({ ...header, subtitle: e.target.value })} />
      </div>

      {PARTIES.map(({ key, labelKey }) => {
        const party = header.parties[key]
        return (
          <div className="form-field" key={key}>
            <label>{t(labelKey)}</label>
            <textarea rows={4} value={party.address} placeholder={t('plan_address_hint')}
              onChange={e => setParty(key, { address: e.target.value })} />
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4 }}>
              {party.logo && (
                <img src={party.logo.dataUrl} alt="" style={{ maxHeight: 28, maxWidth: 80, background: '#fff' }} />
              )}
              <label className="panel-btn" style={{ cursor: 'pointer' }}>
                {party.logo ? t('plan_logo_change') : t('plan_logo_add')}
                <input type="file" accept="image/*" style={{ display: 'none' }}
                  onChange={e => { pickLogo(key, e.target.files?.[0]); e.target.value = '' }} />
              </label>
              {party.logo && (
                <button className="panel-btn" onClick={() => setParty(key, { logo: null })}>
                  {t('plan_logo_remove')}
                </button>
              )}
            </div>
          </div>
        )
      })}

      {STAFF.map(({ key, labelKey }) => (
        <div className="form-field" key={key}>
          <label>{t(labelKey)}</label>
          <div style={{ display: 'flex', gap: 4 }}>
            <input type="text" style={{ width: '40%' }} value={header.staff[key].date}
              placeholder={t('plan_staff_date')}
              onChange={e => setStaff(key, { date: e.target.value })} />
            <input type="text" style={{ flex: 1 }} value={header.staff[key].name}
              placeholder={t('plan_staff_name')}
              onChange={e => setStaff(key, { name: e.target.value })} />
          </div>
        </div>
      ))}
    </>
  )
}
