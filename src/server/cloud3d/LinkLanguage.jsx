import { useI18n } from '../../core/locales/i18nContext'
import { languageLabels } from '../../core/locales/i18n'

/** The language a copied link opens in. */
export default function LinkLanguage({ value, onChange }) {
  const { t } = useI18n()
  return (
    <label className="cloud3d-field">
      <span>{t('cloud3d_link_language')}</span>
      <select value={value} onChange={e => onChange(e.target.value)}>
        {Object.entries(languageLabels).map(([lang, label]) => <option key={lang} value={lang}>{label}</option>)}
      </select>
    </label>
  )
}
