import { useI18n } from '../locales/i18nContext'

/** The guideline per language, served from `public` (as the start page shows it). */
const GUIDE_PAGES = { de: './guideline.html', en: './guideline_en.html' }

/**
 * What an empty project offers instead of an empty map (R10.13): the three
 * ways in — draw a track, bring in data, read the guideline. Gone once the
 * project has a track, or when it is closed.
 */
export default function FirstSteps({ onDraw, onImport, onClose }) {
  const { t, language } = useI18n()
  return (
    <div className="first-steps" role="dialog" aria-label={t('first_steps_title')}>
      <h2>{t('first_steps_title')}</h2>
      <p className="selecting-hint">{t('first_steps_hint')}</p>
      <div className="first-steps-actions">
        <button type="button" className="panel-btn panel-btn-full" onClick={onDraw}>{t('first_steps_draw')}</button>
        <button type="button" className="panel-btn panel-btn-full secondary" onClick={onImport}>{t('first_steps_import')}</button>
        <a className="panel-btn panel-btn-full secondary link-as-btn" href={GUIDE_PAGES[language] ?? GUIDE_PAGES.de}
          target="_blank" rel="noreferrer">{t('first_steps_guide')}</a>
      </div>
      <button type="button" className="link-btn first-steps-close" onClick={onClose}>{t('first_steps_close')}</button>
    </div>
  )
}
