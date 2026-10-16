import { useI18n } from '../../../locales/i18nContext'
import { MID_OPEN, midUnknowns } from '../../../utils/switch/midChain'
import NumberInput from '../../form/NumberInput'
import FormSection from '../../form/FormSection'

const TYPES = ['straight', 'arc', 'transition']
const MAX_MIDS = 3

const fmtM = (v) => `${v.toFixed(3)} m`
const fmtR = (r) => (r == null ? '∞' : `${Math.abs(r).toFixed(1)} m`)

/** What a solved piece reads as: its length, and its radius or radii. */
function solvedText(t, type, route) {
  if (!route) return null
  if (type === 'straight') return fmtM(route.length)
  if (type === 'arc') return `${fmtM(route.length)} · R ${fmtR(route.r1)}`
  return `${fmtM(route.length)} · ${fmtR(route.r1)} → ${fmtR(route.r2)}`
}

/**
 * The elements between the two branches of a switch connection (Entscheidung
 * 305): one to three, each a straight, an arc or a transition, with its length
 * and an arc's radius either typed in — given — or left empty — sought.
 * Exactly two have to be sought; the line under the list says how many are.
 * Under each element stands what the solution made of it.
 *
 * `mids` is the spec (switch/midChain), `solved` the solution's pieces in the
 * same order, where there is one.
 */
export default function MidChainFields({ mids, onChange, solved }) {
  const { t, fill } = useI18n()
  const set = (i, patch) => onChange(mids.map((m, j) => (j === i ? { ...m, ...patch } : m)))
  const num = (v) => (v === '' || v == null || !Number.isFinite(Number(v)) || Number(v) <= 0 ? null : Number(v))
  const open = midUnknowns(mids).length

  return (
    <FormSection title={t('scurve_mids')}>
      {mids.map((m, i) => (
        <div key={i} className="mid-chain-row">
          <div className="form-field">
            <label>{fill('scurve_mid_n', { n: String(i + 1) })}</label>
            <div className="mid-chain-type">
              <select value={m.type} onChange={e => set(i, { type: e.target.value, ...(e.target.value === 'arc' ? {} : { radius: null }) })}>
                {TYPES.map(type => <option key={type} value={type}>{t(`scurve_mid_type_${type}`)}</option>)}
              </select>
              {mids.length > 1 && (
                <button type="button" className="mid-chain-remove" aria-label={t('scurve_mid_remove')}
                  title={t('scurve_mid_remove')} onClick={() => onChange(mids.filter((_, j) => j !== i))}>×</button>
              )}
            </div>
          </div>
          <div className="form-field">
            <label>{t('scurve_mid_length')}</label>
            <NumberInput step="any" value={m.length ?? ''} placeholder={t('scurve_mid_sought')}
              onChange={e => set(i, { length: num(e.target.value) })} unit="m" />
          </div>
          {m.type === 'arc' && (
            <div className="form-field">
              <label>{t('scurve_mid_radius_abs')}</label>
              <NumberInput step="any" value={m.radius ?? ''} placeholder={t('scurve_mid_sought')}
                onChange={e => set(i, { radius: num(e.target.value) })} unit="m" />
            </div>
          )}
          {solved?.[i] && <p className="msg-hint mid-chain-solved">= {solvedText(t, m.type, solved[i])}</p>}
        </div>
      ))}
      {mids.length < MAX_MIDS && (
        <button type="button" className="panel-btn secondary mid-chain-add"
          onClick={() => onChange([...mids, { type: 'straight', length: null, radius: null }])}>
          + {t('scurve_mid_add')}
        </button>
      )}
      <p className={open === MID_OPEN ? 'msg-hint' : 'form-error'}>
        {fill('scurve_mid_open', { n: String(open), need: String(MID_OPEN) })}
      </p>
    </FormSection>
  )
}
