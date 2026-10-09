import { useI18n } from '../../locales/i18nContext'
import { ruleById } from '../../utils/regelkatalog'

/**
 * Setting a transition's length to the shortest the rules allow
 * (rules/transitionLength): at their Regelwert, or down to their
 * Ermessensgrenze — two small buttons, each beside the rule that sets its
 * length with its formula (Entscheidung 185; the others are left out, the
 * findings name them where they fail). `lengths` is { regular, minimum,
 * regularBy, minimumBy }, a length null where the rules give none;
 * `onPick(length, mode)` takes the one chosen, mode 'regular' or 'minimum'.
 */
export default function TransitionLengthButtons({ lengths, onPick }) {
  const { t, fill, num } = useI18n()
  if (!lengths) return null
  const row = (key, mode, value, by) => (
    <div className="transition-length-row">
      <button type="button" className="panel-btn panel-btn-small" disabled={value == null}
        title={t(`${key}_hint`)} onClick={() => value != null && onPick(value, mode)}>
        {fill(key, { l: value != null ? num(value, { digits: 1 }) : '–' })}
      </button>
      {by?.filter(b => b.binding).map(b => (
        <span key={b.id} className="transition-length-rule" title={ruleById(b.id)?.title}>
          {b.id}: {b.formula ?? ruleById(b.id)?.title}
        </span>
      ))}
    </div>
  )
  return (
    <div className="transition-length-actions">
      {row('transition_regular', 'regular', lengths.regular, lengths.regularBy)}
      {row('transition_minimum', 'minimum', lengths.minimum, lengths.minimumBy)}
    </div>
  )
}
