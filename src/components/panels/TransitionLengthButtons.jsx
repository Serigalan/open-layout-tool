import { useI18n } from '../../locales/i18nContext'

/**
 * Setting a transition's length to the shortest the rules allow
 * (rules/transitionLength): at their Regelwert, or down to their
 * Ermessensgrenze. `lengths` is { regular, minimum } [m], either null where
 * the rules give none; `onPick` takes the one chosen.
 */
export default function TransitionLengthButtons({ lengths, onPick }) {
  const { t, fill, num } = useI18n()
  if (!lengths) return null
  const button = (key, value) => (
    <button type="button" className="panel-btn" disabled={value == null}
      title={t(`${key}_hint`)} onClick={() => value != null && onPick(value)}>
      {fill(key, { l: value != null ? num(value, { digits: 1 }) : '–' })}
    </button>
  )
  return (
    <div className="transition-length-actions">
      {button('transition_regular', lengths.regular)}
      {button('transition_minimum', lengths.minimum)}
    </div>
  )
}
