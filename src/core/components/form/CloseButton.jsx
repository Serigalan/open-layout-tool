import { useI18n } from '../../locales/i18nContext'

/** The ✕ of an overlay or a bar (R6.5), named for a screen reader in the interface language. */
export default function CloseButton({ onClick, label, disabled, className = 'track-table-close' }) {
  const { t } = useI18n()
  const name = label ?? t('btn_close')
  return (
    <button type="button" className={className} onClick={onClick} disabled={disabled} aria-label={name} title={name}>
      <span aria-hidden="true">✕</span>
    </button>
  )
}
