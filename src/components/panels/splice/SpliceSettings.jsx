import { MAX_CANT, computeCantDef } from '../../../utils/rules/cant'
import { useI18n } from '../../../locales/i18nContext'
import CantField from '../CantField'
import ReadOnlyField from '../../form/ReadOnlyField'
import FieldRule from '../../form/FieldRule'
import NumberInput from '../../form/NumberInput'
import FormSection from '../../form/FormSection'
import TransitionLengthButtons from '../TransitionLengthButtons'
import { QUERSCHNITT_KATALOG } from '../../../utils/gaugeProfiles'

// The Regelgleisabstände of Ril 800.0130, as a hint beside the minimum spacing.
const REGEL_ABSTAENDE = [...new Set(QUERSCHNITT_KATALOG.streckenquerschnitte.rows.map(r => r.gleisabstand))]
  .sort((a, b) => a - b)

/**
 * The settings of a splice: how two arcs are joined, the radius of an arc put
 * between straights with its speed and cant, and the transitions either side
 * — their kind, and how long each is unless the construction solves it: the
 * Regellänge or the Mindestlänge the service sets in the chain it solves
 * (`s.modes`, the two buttons, Entscheidung 179), or a length typed
 * (`s.transitions`, mode 'fixed'). `transitionRules` [first, second] is what
 * the service answered for each: its length and every rule on it. Both belong
 * to the two `picks` in the order they were clicked; they are listed
 * departure first, as the solution shown runs (`departure`). `s` holds the
 * settings, `set(key, value)` changes one.
 *
 * Below them the spacing to another track (Entscheidung 167): the track,
 * picked on the map (`clearance.onPickRef`), the minimum spacing and — where
 * the case has a radius to choose — whether the largest radius that keeps it
 * is searched. Searched, the radius and its cant are the service's answer
 * (`clearance.found`), shown rather than typed.
 */
export default function SpliceSettings({
  picks, departure, s, set, cant, setCant, transitionLength, transitionRules = null, clearance = {},
}) {
  const { t } = useI18n()
  const bothArcs = picks[0]?.signedR != null && picks[1]?.signedR != null
  // Departure first: the pick that departs, then the other.
  const order = departure === picks[1] ? [1, 0] : [0, 1]
  const role = (k) => t(k === order[0] ? 'splice_departure' : 'splice_arrival')
  const byPick = (key, k, v) => s[key].map((x, j) => (j === k ? v : x))
  // A length typed is a fixed one; a button switches the side to its mode.
  const setLength = (k, v) => { set('transitions', byPick('transitions', k, v)); set('modes', byPick('modes', k, 'fixed')) }
  const setMode = (k, mode) => set('modes', byPick('modes', k, mode))
  // What a side shows: the length the service set, or the one typed.
  const shown = (k) => (s.modes[k] !== 'fixed' && transitionRules?.[k]?.length ? transitionRules[k].length : s.transitions[k])
  // Joined straight from one arc to the other, the transition's length is the
  // answer rather than an input — there is nothing to type and nothing to switch on.
  const directTransition = bothArcs && s.arcJoin === 'transition'
  const number = (key, { min, step, clampMin } = {}) => (
    <NumberInput min={min} step={step} value={s[key]}
      onChange={e => set(key, clampMin != null ? Math.max(clampMin, Number(e.target.value) || clampMin) : Number(e.target.value))} />
  )
  return (
    <div className="element-form">
      {order.map(k => <ReadOnlyField key={k} label={role(k)} value={picks[k]?.label ?? ''} />)}
      {bothArcs ? (
        <div className="form-field">
          <label>{t('splice_arc_join')}</label>
          <select value={s.arcJoin} onChange={e => set('arcJoin', e.target.value)}>
            <option value="straight">{t('splice_arc_join_straight')}</option>
            <option value="transition">{t('splice_arc_join_transition')}</option>
          </select>
        </div>
      ) : clearance.maximize ? (
        <ReadOnlyField label={t('field_radius')} value={clearance.found != null ? `${clearance.found} m` : '…'} />
      ) : (
        <div className="form-field"><label>{t('field_radius')}</label>{number('radius', { min: 1 })}  <FieldRule name="radius" />
</div>
      )}
      <div className="form-field"><label>{t('field_speed')}</label>{number('speed', { min: 0 })}  <FieldRule name="speed" />
</div>
      {!(Number(s.speed) > 0) && <p className="selecting-hint">{t('splice_no_speed')}</p>}
      {/* The radius field here is a magnitude, so the cant is one too — it is
          signed by the fitted arc when the element is written. */}
      {!bothArcs && (clearance.maximize ? (
        <>
          <ReadOnlyField label={t('cant')} value={clearance.found != null ? `${cant} mm` : '…'} />
          {clearance.found != null && (
            <ReadOnlyField type="number" label={t('cant_def')} value={computeCantDef(s.speed, clearance.found, cant)} />
          )}
        </>
      ) : (
        <>
          <CantField value={cant} onChange={setCant} min={0} max={MAX_CANT} speed={s.speed} radius={Math.abs(Number(s.radius))} />
          <ReadOnlyField type="number" label={t('cant_def')} value={computeCantDef(s.speed, s.radius, cant)} />
        </>
      ))}
      {!directTransition && (
        <label className="transition-curve-row">
          <input type="checkbox" checked={s.clothoidEnabled} onChange={e => set('clothoidEnabled', e.target.checked)} />
          <span>{t('transition_curve')}</span>
        </label>
      )}
      {(s.clothoidEnabled || directTransition) && (
        <>
          <div className="form-field">
            <label>{t('type')}</label>
            <select value={s.transitionType} onChange={e => set('transitionType', e.target.value)}>
              <option value="clothoid">{t('transition_type_clothoid')}</option>
              <option value="bloss">{t('transition_type_bloss')}</option>
            </select>
          </div>
          {directTransition ? (
            <ReadOnlyField label={t('field_length')} value={transitionLength != null ? `${transitionLength.toFixed(1)} m` : ''} />
          ) : (
            <>
              {order.map(k => (
                <div key={k}>
                  <div className="form-field">
                    <label>{role(k)} – {t('field_length')}</label>
                    <NumberInput min={1} step={10} value={shown(k)}
                      onChange={e => setLength(k, Math.max(1, Number(e.target.value) || 1))} />
                    {s.modes[k] === 'fixed' && <span className="range-use">{t('transition_fixed')}</span>}
                  </div>
                  <TransitionLengthButtons lengths={transitionRules?.[k]} active={s.modes[k]}
                    onPick={(_v, mode) => setMode(k, mode)} />
                </div>
              ))}
            </>
          )}
        </>
      )}
      <FormSection title={t('splice_clearance_section')}>
        <label className="transition-curve-row">
          <input type="checkbox" checked={s.clearanceOn} onChange={e => set('clearanceOn', e.target.checked)} />
          <span>{t('splice_clearance_on')}</span>
        </label>
        {s.clearanceOn && (
          <>
            <div className="form-field">
              <label>{t('splice_clearance_track')}</label>
              <div className="splice-clearance-pick">
                <span>{clearance.refName || '–'}</span>
                <button type="button" className={`panel-btn${clearance.pickingRef ? ' active' : ''}`} onClick={clearance.onPickRef}>
                  {t(clearance.pickingRef ? 'splice_clearance_picking' : 'splice_clearance_pick')}
                </button>
              </div>
            </div>
            <div className="form-field">
              <label>{t('splice_clearance_dmin')}</label>
              {number('clearanceDMin', { min: 0.1, step: 0.05 })}
              <span className="range-use">
                {t('splice_clearance_regel')} {REGEL_ABSTAENDE.map(d => `${d.toFixed(2)} m`).join(' · ')}
              </span>
            </div>
            {!bothArcs ? (
              <label className="transition-curve-row">
                <input type="checkbox" checked={s.clearanceMax} onChange={e => set('clearanceMax', e.target.checked)} />
                <span>{t('splice_clearance_max')}</span>
              </label>
            ) : (
              <p className="msg-hint">{t('splice_clearance_arcs')}</p>
            )}
          </>
        )}
      </FormSection>
    </div>
  )
}
