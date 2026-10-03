import { useState } from 'react'
import { useI18n } from '../../locales/i18nContext'
import GuideDialog from '../GuideDialog'

/**
 * What an empty project offers at the head of the info panel (R10.13): the
 * three ways in — draw a track, bring in data, read the guideline (in its
 * window, as the start page opens it). Gone once the project has a track.
 */
export default function FirstSteps({ onDraw, onImport }) {
  const { t } = useI18n()
  const [guide, setGuide] = useState(false)
  return (
    <section className="first-steps" aria-label={t('first_steps_title')}>
      <h2>{t('first_steps_title')}</h2>
      <p className="selecting-hint">{t('first_steps_hint')}</p>
      <div className="first-steps-actions">
        <button type="button" className="panel-btn panel-btn-full" onClick={onDraw}>{t('first_steps_draw')}</button>
        <button type="button" className="panel-btn panel-btn-full secondary" onClick={onImport}>{t('first_steps_import')}</button>
        <button type="button" className="panel-btn panel-btn-full secondary" onClick={() => setGuide(true)}>{t('first_steps_guide')}</button>
      </div>
      {guide && <GuideDialog onClose={() => setGuide(false)} />}
    </section>
  )
}
