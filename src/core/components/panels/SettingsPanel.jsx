import { languageLabels } from '../../locales/i18n'
import { useI18n } from '../../locales/i18nContext'
import { PROJECT_COLORS } from '../../styles/palette'
import { AboutIcon } from '../icons'
import BackButton from './BackButton'
import InfoPanel from './InfoPanel'

/**
 * The app's own settings — language, colour — and, as a page of them, the
 * information about the tool (decision 325): the page a project opens on,
 * with its first steps. `page` ('main' | 'info') is the shell's, so the
 * workspace can open on the information; `onDraw`/`onImport` go on to it.
 */
export default function SettingsPanel({ color, onColorChange, page = 'main', onPage, onDraw, onImport }) {
  const { language, t, setLanguage } = useI18n()
  if (page === 'info') {
    return (
      <>
        <BackButton onBack={() => onPage?.('main')} />
        <InfoPanel onDraw={onDraw} onImport={onImport} />
      </>
    )
  }
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
      <hr className="divider" />
      <div className="create-element-options">
        <button type="button" className="create-element-btn" onClick={() => onPage?.('info')}>
          <AboutIcon />
          {t('info')}
        </button>
      </div>
    </>
  )
}
