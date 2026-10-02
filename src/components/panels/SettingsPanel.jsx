import { languageLabels } from '../../locales/i18n'
import { useI18n } from '../../locales/i18nContext'
import { PROJECT_COLORS } from '../../styles/palette'

export default function SettingsPanel({ color, onColorChange }) {
  const { language, t, setLanguage } = useI18n()
  return (
    <>
      <h2>{t('settings')}</h2>
      <div className="settings-row">
        <label className="settings-label" htmlFor="language-select">
          {t('settings_language_label')}
        </label>
        <select
          id="language-select"
          className="settings-select"
          value={language}
          onChange={(e) => setLanguage(e.target.value)}
        >
          {Object.entries(languageLabels).map(([code, label]) => (
            <option key={code} value={code}>{label}</option>
          ))}
        </select>
      </div>
      <div className="settings-row">
        <label className="settings-label">{t('settings_color_label')}</label>
        <div className="settings-color-swatches">
          {PROJECT_COLORS.map(c => (
            <button
              key={c}
              className={`settings-color-swatch${color === c ? ' active' : ''}`}
              style={{ background: c }}
              onClick={() => onColorChange(c)}
              title={c}
            />
          ))}
        </div>
      </div>
    </>
  )
}
