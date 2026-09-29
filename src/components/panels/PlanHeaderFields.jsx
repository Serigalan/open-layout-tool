import { fileToLogo } from '../../utils/logoImage'
import { PARTIES, STAFF } from '../../utils/planHeader'

/** Longest side of a location sketch image [px] — it fills a box of 13 × 4 cm. */
const SKETCH_PX = 1600

/** Editing of the title block: plan title, parties with logo and address, sketch, staff. */
/** The staff rows the simple title block has room for. */
const SIMPLE_STAFF = ['drawn', 'checked']

/**
 * `simple`: only what the simple title block states besides the plan itself —
 * who drew and who checked it.
 */
export default function PlanHeaderFields({ t, header, onChange, onError, simple = false }) {
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

  const pickSketch = async (file) => {
    if (!file) return
    try {
      onChange({ ...header, sketch: await fileToLogo(file, SKETCH_PX) })
    } catch {
      onError?.(t('plan_logo_failed'))
    }
  }

  const field = (key, labelKey, placeholder) => (
    <div className="form-field">
      <label>{t(labelKey)}</label>
      <input type="text" value={header[key]} placeholder={placeholder}
        onChange={e => onChange({ ...header, [key]: e.target.value })} />
    </div>
  )

  const staffRows = STAFF.filter(({ key }) => !simple || SIMPLE_STAFF.includes(key)).map(({ key, labelKey }) => (
    <div className="form-field" key={key}>
      <label>{t(labelKey)}</label>
      <div style={{ display: 'flex', gap: 4 }}>
        {/* The browser's calendar; the plan writes the day in the language's own form. */}
        <input type="date" style={{ width: '45%', minWidth: 0 }} value={header.staff[key].date}
          title={t('plan_staff_date')}
          onChange={e => setStaff(key, { date: e.target.value })} />
        <input type="text" style={{ flex: 1, minWidth: 0 }} value={header.staff[key].name}
          placeholder={t('plan_staff_name')}
          onChange={e => setStaff(key, { name: e.target.value })} />
      </div>
    </div>
  ))

  if (simple) return <>{staffRows}</>

  return (
    <>
      {field('range', 'plan_range', t('plan_range_hint'))}
      {field('subtitle', 'plan_subtitle')}
      {field('code', 'plan_code')}

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
            {/* The lines are drawn only under a column that names someone. */}
            <label className="transition-curve-row" style={{ marginTop: 4 }}>
              <input type="checkbox" checked={party.signs}
                onChange={e => setParty(key, { signs: e.target.checked })} />
              <span>{t('plan_party_signs')}</span>
            </label>
          </div>
        )
      })}

      <div className="form-field">
        <label>{t('plan_sketch')}</label>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {header.sketch && (
            <img src={header.sketch.dataUrl} alt="" style={{ maxHeight: 40, maxWidth: 120, background: '#fff' }} />
          )}
          <label className="panel-btn" style={{ cursor: 'pointer' }}>
            {t('plan_sketch_add')}
            <input type="file" accept="image/*" style={{ display: 'none' }}
              onChange={e => { pickSketch(e.target.files?.[0]); e.target.value = '' }} />
          </label>
          {header.sketch && (
            <button className="panel-btn" onClick={() => onChange({ ...header, sketch: null })}>
              {t('plan_sketch_remove')}
            </button>
          )}
        </div>
        {!header.sketch && <p style={{ fontSize: 11, color: '#888', margin: '4px 0 0' }}>{t('plan_sketch_auto')}</p>}
      </div>

      {staffRows}
    </>
  )
}
