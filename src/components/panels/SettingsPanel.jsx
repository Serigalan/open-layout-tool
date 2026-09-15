import { languageLabels } from '../../locales/i18n'

const COLOR_SWATCHES = [
  '#303383', '#786ABF', '#2980b9', '#16a085', '#27ae60',
  '#f39c12', '#e67e22', '#e74c3c', '#8e44ad', '#2c3e50',
]

export default function SettingsPanel({ language, onLanguageChange, color, onColorChange, t }) {
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
          onChange={(e) => onLanguageChange(e.target.value)}
        >
          {Object.entries(languageLabels).map(([code, label]) => (
            <option key={code} value={code}>{label}</option>
          ))}
        </select>
      </div>
      <div className="settings-row">
        <label className="settings-label">{t('settings_color_label')}</label>
        <div className="settings-color-swatches">
          {COLOR_SWATCHES.map(c => (
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
