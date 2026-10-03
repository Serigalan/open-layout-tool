import { useI18n } from '../../locales/i18nContext'
import useEscape from '../../shell/useEscape'

/** A form's Cancel on its own (R10.2): Escape presses it too. */
export default function CancelButton({ onClick, className = 'panel-btn panel-btn-full mt-8 secondary', children }) {
  const { t } = useI18n()
  useEscape(onClick, !!onClick)
  return <button type="button" className={className} onClick={onClick}>{children ?? t('btn_cancel')}</button>
}
