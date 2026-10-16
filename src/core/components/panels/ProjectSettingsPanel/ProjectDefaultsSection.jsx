import { updateProject } from '../../../storage'
import { LINE_CATEGORIES } from '../../../utils/track/identifierUtils'
import { projectLineCategory } from '../../../utils/elevation/gradientCheck'
import { dominantSystem, projectSystemSetting, systemChoices } from '../../../utils/project/projectSettings'
import { crsSystemName } from '../../../utils/geometry/coordinateUtils'
import { GAUGE_PROFILES, DEFAULT_GAUGE_PROFILE, gaugeProfileLabelKey, LICHTRAUM_SOURCE } from '../../../utils/crossSection/gaugeProfiles'
import { useI18n } from '../../../locales/i18nContext'
import FormSection from '../../form/FormSection'
import InfoTip from '../../form/InfoTip'

/**
 * What the project gives every track that does not name its own: the line
 * category the Höhenplan rules judge it by (decision 320), and the coordinate
 * system a new track is laid out in (decisions 318, 323) — a system, not a
 * plane: the meridian strip comes from where the track is drawn and stays
 * settable track by track. The tracks there are stay where they are.
 *
 * Without a system of its own the project takes the one most of its tracks lie
 * in, and says so; the empty choice goes back to that. And the clearance
 * profile the cross section and the clearance checks hold the tracks to
 * (decision 332) — one for the whole project.
 */
export default function ProjectDefaultsSection({ project }) {
  const { t, fill } = useI18n()
  const setting = projectSystemSetting(project)
  const dominant = dominantSystem(project.tracks)
  const choices = systemChoices(...(project.tracks ?? []).map(tr => tr.epsg), project.epsg)
  const fallback = dominant
    ? fill('project_settings_crs_from_tracks', { crs: crsSystemName(dominant) })
    : t('project_settings_crs_by_click')

  return (
    <FormSection title={t('project_settings_defaults')}>
      <div className="form-field">
        <label htmlFor="project-line-category">{t('line_category')} <InfoTip text={t('project_settings_line_category_hint')} /></label>
        <select id="project-line-category" value={projectLineCategory(project)}
          onChange={e => updateProject({ lineCategory: e.target.value })}>
          {LINE_CATEGORIES.map(key => <option key={key} value={key}>{t(`line_category_${key}`)}</option>)}
        </select>
      </div>
      <div className="form-field">
        <label htmlFor="project-crs">{t('project_settings_crs')} <InfoTip text={t('project_settings_crs_hint')} /></label>
        <select id="project-crs" value={setting ?? ''}
          onChange={e => updateProject({ crsSystem: e.target.value || undefined, ...(project.epsg != null ? { epsg: undefined } : {}) })}>
          <option value="">{fallback}</option>
          {[...new Set([...choices, setting].filter(Boolean))].map(key => (
            <option key={key} value={key}>{crsSystemName(key)}</option>
          ))}
        </select>
      </div>
      <div className="form-field">
        <label htmlFor="project-gauge">{t('project_settings_gauge')}</label>
        <select id="project-gauge" value={project.gaugeProfile ?? DEFAULT_GAUGE_PROFILE}
          onChange={e => updateProject({ gaugeProfile: e.target.value })}>
          {Object.keys(GAUGE_PROFILES).map(key => (
            <option key={key} value={key}>{`${t(gaugeProfileLabelKey(key))} · ${LICHTRAUM_SOURCE}`}</option>
          ))}
        </select>
      </div>
    </FormSection>
  )
}
