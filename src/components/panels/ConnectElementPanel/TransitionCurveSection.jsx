import { useMemo } from 'react'
import { useI18n } from '../../../locales/i18nContext'
import NumberInput from '../../form/NumberInput'
import { formatNum, splitUnit } from '../../../locales/i18n'
import RuleFindings from '../RuleFindings'
import { transitionChain, transitionLengths } from '../../../utils/rules/transitionLength'

/**
 * The transition a connect dialog may put in front of what it appends.
 *
 * Its length is checked as it is typed against the rules a transition answers
 * to (LP.EL.01, LP.UB.*): between `prev`, the track's last element, and
 * `next`, what is appended — the cant it ramps, the deficiency it changes and
 * the design speed decide. And it can be set to the shortest length the rules
 * allow at their Regelwert or down to their Ermessensgrenze
 * (transitionLengths), once there is something to run into.
 */
export default function TransitionCurveSection({
  enabled, onEnabledChange, type, onTypeChange, length, onLengthChange, prev, next, r1, speed,
}) {
  const { t, fill, language } = useI18n()
  // The search runs the check a hundred times; the cursor moving over the map
  // re-renders the dialog far more often than what it depends on changes. The
  // elements are rebuilt on every render — what they are made of is not.
  const has = enabled && !!next
  const [prevCant, nextRadius, nextCant] = [prev?.cant ?? 0, next?.radius ?? null, next?.cant ?? 0]
  const lengths = useMemo(() => (has ? transitionLengths({
    prev: { elementType: 0, cant: prevCant, speed },
    next: { elementType: nextRadius ? 1 : 0, radius: nextRadius, cant: nextCant, speed },
    r1, type, speed,
  }) : null), [has, prevCant, nextRadius, nextCant, r1, type, speed])
  const chain = enabled && next ? transitionChain({ prev, next, r1, length, type, speed }) : null
  const set = (value) => value != null && onLengthChange(value)
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
            <NumberInput min="1" step="0.1" value={length}
              onChange={e => onLengthChange(Math.max(1, Number(e.target.value) || 1))} unit="m" />
          </div>
          {lengths && (
            <div className="transition-length-actions">
              <button type="button" className="panel-btn" disabled={lengths.regular == null}
                title={t('transition_regular_hint')} onClick={() => set(lengths.regular)}>
                {fill('transition_regular', { l: lengths.regular != null ? formatNum(lengths.regular, language, { digits: 1 }) : '–' })}
              </button>
              <button type="button" className="panel-btn" disabled={lengths.minimum == null}
                title={t('transition_minimum_hint')} onClick={() => set(lengths.minimum)}>
                {fill('transition_minimum', { l: lengths.minimum != null ? formatNum(lengths.minimum, language, { digits: 1 }) : '–' })}
              </button>
            </div>
          )}
          {next && !(speed > 0) && <p className="selecting-hint">{t('transition_no_speed')}</p>}
          {chain && <RuleFindings elements={chain} judge={[1]} fields={false} />}
        </>
      )}
    </div>
  )
}
