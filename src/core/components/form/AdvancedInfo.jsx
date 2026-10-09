import { Children } from 'react'
import { useI18n } from '../../locales/i18nContext'

/**
 * The values a dialog states but does not let one type — start and end
 * coordinates, bearings, what a computation found — folded away under
 * "Advanced info" until asked for, so the fields one fills in come first.
 * Nothing to state, no fold.
 */
export default function AdvancedInfo({ children }) {
  const { t } = useI18n()
  if (Children.toArray(children).length === 0) return null
  return (
    <details className="advanced-info">
      <summary>{t('advanced_info')}</summary>
      <div className="advanced-info-body">{children}</div>
    </details>
  )
}
