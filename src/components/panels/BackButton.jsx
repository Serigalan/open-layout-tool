import { BackIcon } from '../icons'
import { useI18n } from '../../locales/i18nContext'

/** The "Back" button at the head of a panel page. */
export default function BackButton({ onBack }) {
  const { t } = useI18n()
  return (
    <button className="back-btn" onClick={onBack}>
      <BackIcon />
      {t('btn_back')}
    </button>
  )
}
