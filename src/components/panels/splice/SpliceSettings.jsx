import { MAX_CANT, computeCantDef } from '../../../utils/rules/cant'
import { useI18n } from '../../../locales/i18nContext'
import CantField from '../CantField'
import ReadOnlyField from '../../form/ReadOnlyField'
import FieldRule from '../../form/FieldRule'
import NumberInput from '../../form/NumberInput'
import FormSection from '../../form/FormSection'
import TransitionLengthButtons from '../TransitionLengthButtons'
import ClearanceFields from './ClearanceFields'


/**
 * The settings of a splice: how two arcs are joined, the radius of an arc put
 * between straights with its speed and cant, and the transitions either side
 * — their kind, and how long each is unless the construction solves it.
 * Switched on, each side gets the Regellänge the service names once (mode
 * 'regular', Entscheidung 185); from then on its length is as typed or as a
 * button sets it — the Regel- or Mindestlänge where it stands now (mode
 * 'fixed'). `transitionRules` [first, second] is what the service answered
 * for each: its length and the rules on it, also where nothing fits. Both belong
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
  // A length typed or set by a button is a fixed one.
  const setLength = (k, v) => { set('transitions', byPick('transitions', k, v)); set('modes', byPick('modes', k, 'fixed')) }
  // Switched on, both sides ask for the Regellänge, once (Entscheidung 185).
  const enableTransitions = (on) => { set('clothoidEnabled', on); if (on) set('modes', ['regular', 'regular']) }
  // What a side shows: the Regellänge the service set, until it is taken over, or the length.
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
          <input type="checkbox" checked={s.clothoidEnabled} onChange={e => enableTransitions(e.target.checked)} />
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
                  </div>
                  <TransitionLengthButtons lengths={transitionRules?.[k]} onPick={v => setLength(k, v)} />
                </div>
              ))}
            </>
          )}
        </>
      )}
      <ClearanceFields on={s.clearanceOn} onToggle={v => set('clearanceOn', v)} refName={clearance.refName}
        picking={clearance.pickingRef} onPick={clearance.onPickRef} dMin={s.clearanceDMin} onDMin={v => set('clearanceDMin', v)}>
        {!bothArcs ? (
          <label className="transition-curve-row">
            <input type="checkbox" checked={s.clearanceMax} onChange={e => set('clearanceMax', e.target.checked)} />
            <span>{t('splice_clearance_max')}</span>
          </label>
        ) : (
          <p className="msg-hint">{t('splice_clearance_arcs')}</p>
        )}
      </ClearanceFields>
    </div>
  )
}
