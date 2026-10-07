import { useI18n } from '../../locales/i18nContext'
import { ruleById } from '../../utils/regelkatalog'

/**
 * Setting a transition's length to the shortest the rules allow
 * (rules/transitionLength): at their Regelwert, or down to their
 * Ermessensgrenze — each with the rules that set it below it, their formula
 * and the bound it comes to. `lengths` is { regular, minimum, regularBy,
 * minimumBy }, a length null where the rules give none; `onPick` takes the
 * one chosen.
 */
export default function TransitionLengthButtons({ lengths, onPick }) {
  const { t, fill, num } = useI18n()
  if (!lengths) return null
  const row = (key, value, by) => (
    <div className="transition-length-row">
      <button type="button" className="panel-btn" disabled={value == null}
        title={t(`${key}_hint`)} onClick={() => value != null && onPick(value)}>
        {fill(key, { l: value != null ? num(value, { digits: 1 }) : '–' })}
      </button>
      {by?.map(b => (
        <span key={b.id} className="transition-length-rule" title={ruleById(b.id)?.title}>
          {b.id}: {b.formula ?? ruleById(b.id)?.title} = {num(b.length, { digits: 1, unit: 'm' })}
        </span>
      ))}
    </div>
  )
  return (
    <div className="transition-length-actions">
      {row('transition_regular', lengths.regular, lengths.regularBy)}
      {row('transition_minimum', lengths.minimum, lengths.minimumBy)}
    </div>
  )
}
