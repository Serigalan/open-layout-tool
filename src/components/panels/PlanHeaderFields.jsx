import { fileToLogo } from '../../utils/logoImage'
import { PARTIES, STAFF } from '../../utils/planHeader'
import { useI18n } from '../../locales/i18nContext'

/** Longest side of a location sketch image [px] — it fills a box of 13 × 4 cm. */
const SKETCH_PX = 1600

/** Editing of the title block: plan title, parties with logo and address, sketch, staff. */
/** The staff rows the simple title block has room for. */
const SIMPLE_STAFF = ['drawn', 'checked']

/**
 * `simple`: only what the simple title block states besides the plan itself —
 * who drew and who checked it.
 */
export default function PlanHeaderFields({ header, onChange, onError, simple = false }) {
  const { t } = useI18n()
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
      <div className="row-tight">
        {/* The browser's calendar; the plan writes the day in the language's own form. */}
        <input type="date" className="plan-date-input" value={header.staff[key].date}
          title={t('plan_staff_date')}
          onChange={e => setStaff(key, { date: e.target.value })} />
        <input className="grow" type="text" value={header.staff[key].name}
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
            <div className="mt-4 row">
              {party.logo && (
                <img src={party.logo.dataUrl} alt="" className="plan-logo-thumb" />
              )}
              <label className="panel-btn clickable">
                {party.logo ? t('plan_logo_change') : t('plan_logo_add')}
                <input hidden type="file" accept="image/*"
                  onChange={e => { pickLogo(key, e.target.files?.[0]); e.target.value = '' }} />
              </label>
              {party.logo && (
                <button className="panel-btn" onClick={() => setParty(key, { logo: null })}>
                  {t('plan_logo_remove')}
                </button>
              )}
            </div>
            {/* The lines are drawn only under a column that names someone. */}
            <label className="transition-curve-row mt-4">
              <input type="checkbox" checked={party.signs}
                onChange={e => setParty(key, { signs: e.target.checked })} />
              <span>{t('plan_party_signs')}</span>
            </label>
          </div>
        )
      })}

      <div className="form-field">
        <label>{t('plan_sketch')}</label>
        <div className="row">
          {header.sketch && (
            <img src={header.sketch.dataUrl} alt="" className="plan-sketch-thumb" />
          )}
          <label className="panel-btn clickable">
            {t('plan_sketch_add')}
            <input hidden type="file" accept="image/*"
              onChange={e => { pickSketch(e.target.files?.[0]); e.target.value = '' }} />
          </label>
          {header.sketch && (
            <button className="panel-btn" onClick={() => onChange({ ...header, sketch: null })}>
              {t('plan_sketch_remove')}
            </button>
          )}
        </div>
        {!header.sketch && <p className="msg-hint msg-small">{t('plan_sketch_auto')}</p>}
      </div>

      {staffRows}
    </>
  )
}
