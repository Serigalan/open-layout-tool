import {
  CANT_STEP, MAX_SWITCH_CANT, MAX_SWITCH_CANT_EXCEPTION, clampSwitchCant,
} from '../../../utils/mapConstants'

/**
 * The cant of a turnout and, above 100 mm, the reason it is allowed to be there.
 *
 * A switch is held to MAX_SWITCH_CANT; MAX_SWITCH_CANT_EXCEPTION is reachable
 * only with a written justification, and the text is the exception — clearing it
 * takes the limit back down and the value with it. So the field for it appears
 * as soon as the cant leaves the plain range, and the commit stays blocked while
 * it is empty. An exception that could be clicked away would be no exception.
 *
 * The number input never accepts more than the 120 mm ceiling: past that there
 * is no justification that would do, so there is nothing to type either.
 *
 * `readOnlyText` is for the cant a turnout does not set but inherits — laid into
 * a canted track it runs on that track's cant, possibly a ramp between two
 * values. It is shown as it reads there, and `magnitude` says what the limit has
 * to answer for: the worst of the ramp, not its value at the toe.
 */
export default function SwitchCantField({
  t, cant, onCant, reason, onReason, label, readOnlyText, magnitude,
}) {
  const needsReason = (magnitude ?? Math.abs(cant ?? 0)) > MAX_SWITCH_CANT
  return (
    <>
      <div className="form-field">
        <label>{label ?? t('cant')}</label>
        {readOnlyText != null
          ? <input type="text" readOnly value={readOnlyText} />
          : <input
            type="number" step={CANT_STEP}
            min={-MAX_SWITCH_CANT_EXCEPTION} max={MAX_SWITCH_CANT_EXCEPTION}
            value={cant}
            onChange={e => onCant(clampSwitchCant(Number(e.target.value) || 0))}
          />}
      </div>
      {needsReason && (
        <div className="form-field">
          <label>{t('switch_cant_exception')}</label>
          <input
            type="text" value={reason}
            placeholder={t('switch_cant_exception_placeholder')}
            onChange={e => onReason(e.target.value)}
            style={reason.trim() ? undefined : { borderColor: '#c0392b' }}
          />
          <span className="selecting-hint">{t('switch_cant_exception_hint')}</span>
        </div>
      )}
    </>
  )
}
