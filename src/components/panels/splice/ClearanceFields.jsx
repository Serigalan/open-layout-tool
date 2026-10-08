import { useI18n } from '../../../locales/i18nContext'
import FormSection from '../../form/FormSection'
import NumberInput from '../../form/NumberInput'
import { QUERSCHNITT_KATALOG } from '../../../utils/gaugeProfiles'

// The Regelgleisabstände of Ril 800.0130, as a hint beside the minimum spacing.
const REGEL_ABSTAENDE = [...new Set(QUERSCHNITT_KATALOG.streckenquerschnitte.rows.map(r => r.gleisabstand))]
  .sort((a, b) => a - b)

/**
 * Keeping a spacing to another track (Entscheidung 167, 201): switched on
 * (`on`, `onToggle`), the track picked on the map (`refName`, `picking`,
 * `onPick`) and the minimum spacing, free to choose (`dMin`, `onDMin`) — what
 * the cant adds comes on top. `children` stand below, for what a dialog adds.
 */
export default function ClearanceFields({ on, onToggle, refName, picking, onPick, dMin, onDMin, children }) {
  const { t } = useI18n()
  return (
    <FormSection title={t('splice_clearance_section')}>
      <label className="transition-curve-row">
        <input type="checkbox" checked={on} onChange={e => onToggle(e.target.checked)} />
        <span>{t('splice_clearance_on')}</span>
      </label>
      {on && (
        <>
          <div className="form-field">
            <label>{t('splice_clearance_track')}</label>
            <div className="splice-clearance-pick">
              <span>{refName || '–'}</span>
              <button type="button" className={`panel-btn${picking ? ' active' : ''}`} onClick={onPick}>
                {t(picking ? 'splice_clearance_picking' : 'splice_clearance_pick')}
              </button>
            </div>
          </div>
          <div className="form-field">
            <label>{t('splice_clearance_dmin')}</label>
            <NumberInput min={0.1} step={0.05} value={dMin} onChange={e => onDMin(Number(e.target.value))} />
            <span className="range-use">
              {t('splice_clearance_regel')} {REGEL_ABSTAENDE.map(d => `${d.toFixed(2)} m`).join(' · ')}
            </span>
          </div>
          {children}
        </>
      )}
    </FormSection>
  )
}
