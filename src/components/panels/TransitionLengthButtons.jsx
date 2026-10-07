import { useI18n } from '../../locales/i18nContext'
import { ruleById } from '../../utils/regelkatalog'

/**
 * Setting a transition's length to the shortest the rules allow
 * (rules/transitionLength): at their Regelwert, or down to their
 * Ermessensgrenze — each with every rule on the length below it, its formula
 * and the bound it comes to, the one that sets it set off from the rest. `lengths` is { regular, minimum, regularBy,
 * minimumBy }, a length null where the rules give none; `onPick(length,
 * mode)` takes the one chosen, mode 'regular' or 'minimum'. Where the buttons
 * switch a mode rather than set a length (the splice), `active` names the
 * mode switched on.
 */
export default function TransitionLengthButtons({ lengths, onPick, active = null }) {
  const { t, fill, num } = useI18n()
  if (!lengths) return null
  const row = (key, mode, value, by) => (
    <div className="transition-length-row">
      <button type="button" className={`panel-btn${active != null && active !== mode ? ' secondary' : ''}`} disabled={value == null}
        aria-pressed={active != null ? active === mode : undefined}
        title={t(`${key}_hint`)} onClick={() => value != null && onPick(value, mode)}>
        {fill(key, { l: value != null ? num(value, { digits: 1 }) : '–' })}
      </button>
      {by?.map(b => (
        <span key={b.id} className={`transition-length-rule${b.binding ? ' binding' : ''}`} title={ruleById(b.id)?.title}>
          {b.id}: {b.formula ?? ruleById(b.id)?.title} = {num(b.length, { digits: 2, unit: 'm' })}
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
